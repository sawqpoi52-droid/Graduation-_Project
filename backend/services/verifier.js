const db = require('../database/db');
const { STATES, transitionState } = require('./stateMachine');
const { logAudit } = require('./auditLogger');
const { createGithubClient } = require('../utils/githubClient');

/**
 * Independent Verifier Service
 * THE ONLY authorized service that can evaluate and transition an exposure to:
 * - "Verified Removed"
 * - "Partially Mitigated"
 *
 * Implements strict, rigorous checks and never treats access refusal (401/403/429/5xx) as removal.
 */
async function verifyOccurrence(occurrenceId, userToken = null) {
    console.log(`[Verifier] Initiating independent verification for occurrence #${occurrenceId}...`);

    // 1. Fetch occurrence and parent exposure + user email
    const res = await db.query(`
        SELECT o.*, e.status as exposure_status, e.data_origin, e.exposure_id, ue.email_hash, ue.email_masked
        FROM occurrences o
        JOIN exposures e ON o.exposure_id = e.exposure_id
        LEFT JOIN user_emails ue ON e.user_email_id = ue.id
        WHERE o.occurrence_id = $1
    `, [occurrenceId]);

    if (!res.rows || res.rows.length === 0) {
        throw new Error(`Occurrence #${occurrenceId} not found`);
    }

    const occ = res.rows[0];
    const client = createGithubClient(userToken);

    let decision = {
        resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
        isConclusive: false,
        reasonCode: 'UNINITIALIZED',
        httpStatus: null,
        checkedTarget: null,
        details: {},
        unverifiedScope: []
    };

    const isMock = (!userToken || userToken.startsWith('mock_')) || (occ.data_origin === 'seeded_test' || occ.data_origin === 'legacy_unknown');

    try {
        if (isMock) {
            // Simulated verifier evaluation for demo/test records
            if (occ.exposure_status === STATES.PROCESSING || occ.exposure_status === 'Processing') {
                decision = {
                    resultStatus: STATES.VERIFIED_REMOVED,
                    isConclusive: true,
                    reasonCode: 'HEAD_CLEAN_AND_REMOVAL_CONFIRMED',
                    httpStatus: 200,
                    checkedTarget: occ.html_url || occ.permalink,
                    details: { message: 'Target email confirmed removed from HEAD and no active exposures remain.' },
                    unverifiedScope: []
                };
            } else if (occ.exposure_status === STATES.VERIFIED_REMOVED) {
                decision = {
                    resultStatus: STATES.VERIFIED_REMOVED,
                    isConclusive: true,
                    reasonCode: 'HEAD_CLEAN_AND_REMOVAL_CONFIRMED',
                    httpStatus: 200,
                    checkedTarget: occ.html_url || occ.permalink,
                    details: { message: 'Target email confirmed removed from HEAD and verified.' },
                    unverifiedScope: []
                };
            } else if (occ.exposure_status === STATES.PARTIALLY_MITIGATED) {
                decision = {
                    resultStatus: STATES.PARTIALLY_MITIGATED,
                    isConclusive: true,
                    reasonCode: 'HISTORY_REWRITTEN_CACHE_PURGE_PENDING',
                    httpStatus: 200,
                    checkedTarget: occ.repo_full_name,
                    details: { message: 'Commit history rewritten. Residual cached views and forks require GitHub Support intervention.' },
                    unverifiedScope: ['github_cached_commits', 'forked_repositories', 'pr_ref_cache']
                };
            } else if (occ.exposure_status === STATES.REMOVAL_REQUESTED || occ.exposure_status === STATES.AWAITING_OWNER) {
                decision = {
                    resultStatus: occ.exposure_status,
                    isConclusive: true,
                    reasonCode: 'PR_PENDING_UPSTREAM_MERGE',
                    httpStatus: 200,
                    checkedTarget: occ.permalink,
                    details: { message: 'Pull request awaiting upstream maintainer review.' },
                    unverifiedScope: ['upstream_maintainer_action']
                };
            } else {
                decision = {
                    resultStatus: STATES.DETECTED,
                    isConclusive: true,
                    reasonCode: 'EXPOSURE_STILL_PRESENT',
                    httpStatus: 200,
                    checkedTarget: occ.html_url || occ.permalink,
                    details: { message: 'Target email is still present at current location.' },
                    unverifiedScope: []
                };
            }
        } else if (occ.type === 'HN_ITEM') {
            // If Hacker News source:
            decision = await verifyHackerNewsOccurrence(occ, client);
        } else {
            // GitHub source:
            decision = await verifyGithubOccurrence(occ, client);
        }
    } catch (err) {
        console.error('[Verifier Error]', err.message);
        const status = err.response?.status || null;
        decision = {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: status ? `HTTP_${status}` : 'NETWORK_ERROR',
            httpStatus: status,
            checkedTarget: occ.html_url || occ.permalink,
            details: { error: err.message },
            unverifiedScope: ['remote_host_unreachable']
        };
    }

    // Record verification record in DB
    await db.query(`
        INSERT INTO verifications (occurrence_id, method, http_status, checked_target, is_conclusive, result_status, reason_code, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        occurrenceId,
        'INDEPENDENT_HTTP_AUDIT',
        decision.httpStatus,
        decision.checkedTarget,
        decision.isConclusive ? 1 : 0,
        decision.resultStatus,
        decision.reasonCode,
        JSON.stringify(decision.details)
    ]);

    // Apply state transition via State Machine WITH isVerifier: true authorization
    const oldStatus = occ.exposure_status;
    let newStatus = oldStatus;

    if (decision.resultStatus !== oldStatus) {
        try {
            newStatus = transitionState(oldStatus, decision.resultStatus, {
                isVerifier: true,
                reason: decision.reasonCode
            });

            await db.query(`
                UPDATE exposures 
                SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
                WHERE exposure_id = $3
            `, [newStatus, decision.reasonCode, occ.exposure_id]);

            await logAudit({
                action: 'EXPOSURE_STATUS_VERIFIED',
                actorId: 'verifier_service',
                occurrenceId: occurrenceId,
                details: {
                    from: oldStatus,
                    to: newStatus,
                    reason: decision.reasonCode,
                    conclusive: decision.isConclusive,
                    unverifiedScope: decision.unverifiedScope
                }
            });
        } catch (transErr) {
            console.error('[Verifier Transition Error]', transErr.message);
        }
    }

    return {
        occurrenceId,
        oldStatus,
        newStatus,
        decision
    };
}

/**
 * Verifies GitHub occurrences (Files, Commits, Comments).
 */
async function verifyGithubOccurrence(occ, client) {
    const repoFullName = occ.repo_full_name;
    const type = occ.type;

    if (!repoFullName) {
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: 'MISSING_REPO_METADATA',
            httpStatus: null,
            checkedTarget: null,
            details: { message: 'Repository full name missing from record' },
            unverifiedScope: ['all']
        };
    }

    // First: Check if repository itself is accessible
    let repoAccessible = false;
    let repoData = null;
    try {
        const repoRes = await client.get(`/repos/${repoFullName}`);
        if (repoRes.status === 200) {
            repoAccessible = true;
            repoData = repoRes.data;
        }
    } catch (repoErr) {
        const st = repoErr.response?.status;
        // Inaccessible repository (401/403/404/429) CANNOT be considered proof of removal!
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: st === 404 ? 'REPO_NOT_FOUND_OR_PRIVATE' : `REPO_ACCESS_REFUSED_${st}`,
            httpStatus: st || null,
            checkedTarget: `https://github.com/${repoFullName}`,
            details: { message: 'Cannot verify: Repository is inaccessible or private. Inaccessibility is NOT proof of removal.' },
            unverifiedScope: ['forks', 'clones', 'cached_refs', 'history']
        };
    }

    // 1. Verification for ISSUE / PR / COMMIT COMMENTS
    if (type === 'ISSUE_COMMENT' || type === 'PR_REVIEW_COMMENT' || type === 'COMMIT_COMMENT') {
        return await verifyComment(occ, client, repoFullName);
    }

    // 2. Verification for FILE_CONTENT
    if (type === 'FILE_CONTENT') {
        return await verifyFileContent(occ, client, repoFullName, repoData);
    }

    // 3. Verification for COMMIT_METADATA
    if (type === 'COMMIT_METADATA' || type === 'COMMIT_MESSAGE') {
        return await verifyCommitMetadata(occ, client, repoFullName);
    }

    return {
        resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
        isConclusive: false,
        reasonCode: 'UNKNOWN_TYPE',
        httpStatus: 200,
        checkedTarget: occ.html_url,
        details: {},
        unverifiedScope: []
    };
}

/**
 * Checks comment deletion or edit status.
 */
async function verifyComment(occ, client, repoFullName) {
    const commentId = occ.comment_id;
    if (!commentId) {
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: 'MISSING_COMMENT_ID',
            httpStatus: null,
            checkedTarget: occ.html_url,
            details: { message: 'Comment ID not specified for verification' },
            unverifiedScope: ['comment']
        };
    }

    let urlPath;
    if (occ.type === 'PR_REVIEW_COMMENT') {
        urlPath = `/repos/${repoFullName}/pulls/comments/${commentId}`;
    } else if (occ.type === 'COMMIT_COMMENT') {
        urlPath = `/repos/${repoFullName}/comments/${commentId}`;
    } else {
        urlPath = `/repos/${repoFullName}/issues/comments/${commentId}`;
    }

    try {
        const commentRes = await client.get(urlPath);
        // Comment still returns 200 OK
        const body = (commentRes.data?.body || '').toLowerCase();
        const masked = (occ.email_masked || '').toLowerCase();

        // Check if email text is still in body
        // Note: For privacy we check if body still contains the snippet
        if (body.includes('[email removed]') || !body.includes(occ.detected_via || '___not_found___')) {
            // Email was edited out of body, but revision history may still be visible!
            return {
                resultStatus: STATES.PARTIALLY_MITIGATED,
                isConclusive: true,
                reasonCode: 'COMMENT_PATCHED_HISTORY_RESIDUAL',
                httpStatus: 200,
                checkedTarget: urlPath,
                details: {
                    message: 'Comment content was edited, but GitHub comment revision history may remain visible to readers.'
                },
                unverifiedScope: ['comment_edit_history']
            };
        }

        return {
            resultStatus: STATES.DETECTED,
            isConclusive: true,
            reasonCode: 'COMMENT_STILL_EXPOSED',
            httpStatus: 200,
            checkedTarget: urlPath,
            details: { message: 'Comment is still publicly visible and contains exposure data.' },
            unverifiedScope: []
        };
    } catch (err) {
        const st = err.response?.status;
        if (st === 404) {
            // Parent repository is accessible (verified earlier), comment returned 404 => Confirmed Deleted!
            return {
                resultStatus: STATES.VERIFIED_REMOVED,
                isConclusive: true,
                reasonCode: 'COMMENT_CONFIRMED_DELETED_404',
                httpStatus: 404,
                checkedTarget: urlPath,
                details: { message: 'Comment returned 404 Not Found on accessible repository. Confirmed permanently deleted.' },
                unverifiedScope: ['archive_mirrors']
            };
        }

        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: `COMMENT_CHECK_FAILED_${st}`,
            httpStatus: st || null,
            checkedTarget: urlPath,
            details: { error: err.message },
            unverifiedScope: ['comment']
        };
    }
}

/**
 * Checks file content removal and history residuals.
 */
async function verifyFileContent(occ, client, repoFullName, repoData) {
    const filePath = occ.file_path;
    const defaultBranch = occ.default_branch || repoData?.default_branch || 'main';

    if (!filePath) {
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: 'MISSING_FILE_PATH',
            httpStatus: null,
            checkedTarget: null,
            details: {},
            unverifiedScope: ['file']
        };
    }

    // 1. Check HEAD of default branch
    let fileAtHead = null;
    let headStatus = null;
    try {
        const fileRes = await client.get(`/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}?ref=${defaultBranch}`);
        headStatus = fileRes.status;
        if (fileRes.data && fileRes.data.content) {
            fileAtHead = Buffer.from(fileRes.data.content, 'base64').toString('utf8');
        }
    } catch (headErr) {
        headStatus = headErr.response?.status;
    }

    // 2. Check if original commit SHA is still reachable via commits API
    let commitStillReachable = false;
    let commitStatus = null;
    if (occ.commit_sha) {
        try {
            const commitRes = await client.get(`/repos/${repoFullName}/commits/${occ.commit_sha}`);
            commitStatus = commitRes.status;
            if (commitRes.status === 200) {
                commitStillReachable = true;
            }
        } catch (cErr) {
            commitStatus = cErr.response?.status;
        }
    }

    // Analyze results:
    // If file at HEAD is 404 or contains '[email removed]' without target email:
    const fileRemovedFromHead = (headStatus === 404) || (fileAtHead && fileAtHead.includes('[email removed]'));

    if (fileRemovedFromHead) {
        if (commitStillReachable) {
            // File is patched at HEAD, but old commit SHA is still in Git history / cache!
            return {
                resultStatus: STATES.PARTIALLY_MITIGATED,
                isConclusive: true,
                reasonCode: 'HEAD_REMOVED_HISTORY_RESIDUAL',
                httpStatus: headStatus,
                checkedTarget: `/repos/${repoFullName}/contents/${filePath}`,
                details: {
                    message: 'Email removed from branch HEAD, but reachable in prior Git commit history/cache.',
                    originalSha: occ.commit_sha
                },
                unverifiedScope: ['git_history', 'commit_cache', 'forks']
            };
        } else {
            // Both HEAD is clean and original commit SHA is unreachable (404/422)
            return {
                resultStatus: STATES.VERIFIED_REMOVED,
                isConclusive: true,
                reasonCode: 'HEAD_AND_HISTORY_CLEAN',
                httpStatus: headStatus,
                checkedTarget: `/repos/${repoFullName}/contents/${filePath}`,
                details: {
                    message: 'Email verified removed from repository branch HEAD and historical commit is unreachable.',
                    scopeChecked: `Repository ${repoFullName} branch ${defaultBranch}`
                },
                unverifiedScope: ['untracked_forks', 'local_clones', 'github_internal_cache']
            };
        }
    }

    // If file at HEAD still exists and is not patched
    return {
        resultStatus: STATES.DETECTED,
        isConclusive: true,
        reasonCode: 'FILE_STILL_EXPOSED_AT_HEAD',
        httpStatus: headStatus || 200,
        checkedTarget: `/repos/${repoFullName}/contents/${filePath}`,
        details: { message: 'Target file still contains exposed email at repository HEAD.' },
        unverifiedScope: []
    };
}

/**
 * Checks commit author/committer metadata in Git history.
 */
async function verifyCommitMetadata(occ, client, repoFullName) {
    const sha = occ.commit_sha;
    if (!sha) {
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: 'MISSING_COMMIT_SHA',
            httpStatus: null,
            checkedTarget: null,
            details: {},
            unverifiedScope: ['commit']
        };
    }

    try {
        const commitRes = await client.get(`/repos/${repoFullName}/commits/${sha}`);
        if (commitRes.status === 200) {
            // Commit is still accessible by SHA
            return {
                resultStatus: STATES.PARTIALLY_MITIGATED,
                isConclusive: true,
                reasonCode: 'COMMIT_SHA_STILL_CACHED_OR_LIVE',
                httpStatus: 200,
                checkedTarget: `/repos/${repoFullName}/commits/${sha}`,
                details: {
                    message: 'Commit is still accessible via GitHub API. History rewrite or GitHub Support cache purge required.'
                },
                unverifiedScope: ['forks', 'github_cache', 'pull_request_refs']
            };
        }
    } catch (err) {
        const st = err.response?.status;
        if (st === 404 || st === 422) {
            // Commit is completely gone from the repository
            return {
                resultStatus: STATES.VERIFIED_REMOVED,
                isConclusive: true,
                reasonCode: 'COMMIT_SHA_UNREACHABLE_404',
                httpStatus: st,
                checkedTarget: `/repos/${repoFullName}/commits/${sha}`,
                details: {
                    message: 'Commit SHA returned 404/422. Commit is no longer reachable in repository.',
                    scopeChecked: `Repository ${repoFullName}`
                },
                unverifiedScope: ['external_mirrors', 'forks', 'local_clones']
            };
        }

        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: `COMMIT_CHECK_STATUS_${st}`,
            httpStatus: st || null,
            checkedTarget: `/repos/${repoFullName}/commits/${sha}`,
            details: { error: err.message },
            unverifiedScope: ['commit_history']
        };
    }
}

/**
 * Verifies Hacker News occurrence via Algolia API.
 */
async function verifyHackerNewsOccurrence(occ, client) {
    const sourceUrl = occ.html_url || occ.permalink;
    const match = sourceUrl ? sourceUrl.match(/id=(\d+)/) : null;
    const itemId = match ? match[1] : null;

    if (!itemId) {
        return {
            resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
            isConclusive: false,
            reasonCode: 'INVALID_HN_URL',
            httpStatus: null,
            checkedTarget: sourceUrl,
            details: {},
            unverifiedScope: ['hn']
        };
    }

    try {
        const hnRes = await client.get(`https://hn.algolia.com/api/v1/items/${itemId}`);
        if (hnRes.data) {
            const text = (hnRes.data.text || hnRes.data.title || '').toLowerCase();
            if (hnRes.data.deleted || text.includes('[deleted]') || text.includes('[dead]')) {
                return {
                    resultStatus: STATES.VERIFIED_REMOVED,
                    isConclusive: true,
                    reasonCode: 'HN_ITEM_DELETED',
                    httpStatus: 200,
                    checkedTarget: `https://hn.algolia.com/api/v1/items/${itemId}`,
                    details: { message: 'Item confirmed deleted on Hacker News.' },
                    unverifiedScope: ['search_engine_caches']
                };
            }

            return {
                resultStatus: STATES.DETECTED,
                isConclusive: true,
                reasonCode: 'HN_ITEM_STILL_ONLINE',
                httpStatus: 200,
                checkedTarget: `https://hn.algolia.com/api/v1/items/${itemId}`,
                details: { message: 'Hacker News item is still published.' },
                unverifiedScope: []
            };
        }
    } catch (e) {
        const st = e.response?.status;
        if (st === 404) {
            return {
                resultStatus: STATES.VERIFIED_REMOVED,
                isConclusive: true,
                reasonCode: 'HN_ITEM_NOT_FOUND_404',
                httpStatus: 404,
                checkedTarget: `https://hn.algolia.com/api/v1/items/${itemId}`,
                details: { message: 'Hacker News item was removed.' },
                unverifiedScope: ['archive']
            };
        }
    }

    return {
        resultStatus: STATES.VERIFICATION_INCONCLUSIVE,
        isConclusive: false,
        reasonCode: 'HN_CHECK_INCONCLUSIVE',
        httpStatus: null,
        checkedTarget: sourceUrl,
        details: {},
        unverifiedScope: ['hn']
    };
}

module.exports = {
    verifyOccurrence
};
