const crypto = require('crypto');
const { createGithubClient } = require('../utils/githubClient');
const { calculateLineNumber, maskEvidence } = require('../utils/emailSecurity');
const { STATES, transitionState } = require('./stateMachine');
const { verifyOccurrence } = require('./verifier');
const { logAudit } = require('./auditLogger');
const db = require('../database/db');

const activeLaneBPlans = new Map();
const DAILY_PR_LIMIT = 5;

/**
 * Checks Lane B limits:
 * - 1 PR per repository
 * - Daily quota
 * - No retrying closed PRs
 */
async function checkLaneBLimits(repoFullName, userId) {
    // 1. Check if PR already created for this repository
    const existingRepoAction = await db.query(`
        SELECT a.* FROM actions a
        JOIN occurrences o ON a.occurrence_id = o.occurrence_id
        WHERE o.repo_full_name = $1 AND a.type = 'FORK_AND_PR'
    `, [repoFullName]);

    if (existingRepoAction.rows && existingRepoAction.rows.length > 0) {
        return {
            allowed: false,
            fallbackToLaneC: true,
            reason: `Policy Limit: Only one Pull Request is permitted per repository (${repoFullName}). Please use Lane C (Evidence Package) for further escalation.`
        };
    }

    // 2. Check user's daily PR quota
    const today = new Date().toISOString().split('T')[0];
    const dailyCountRes = await db.query(`
        SELECT COUNT(*) as count FROM actions
        WHERE type = 'FORK_AND_PR' AND started_at >= $1
    `, [today]);

    const dailyCount = parseInt(dailyCountRes.rows[0].count) || 0;
    if (dailyCount >= DAILY_PR_LIMIT) {
        return {
            allowed: false,
            fallbackToLaneC: true,
            reason: `Daily Limit: You have reached the maximum of ${DAILY_PR_LIMIT} pull requests today to prevent automated abuse.`
        };
    }

    return { allowed: true };
}

/**
 * Prepares the dry-run plan for Lane B (Fork + PR).
 */
async function planLaneBForkAndPR({ occurrenceId, repoFullName, filePath, branch = 'main', targetEmail, token, userLogin, userId }) {
    const isMock = !token || token.startsWith('mock_');

    // Check constraints (enforced in production with real tokens)
    if (!isMock) {
        const limits = await checkLaneBLimits(repoFullName, userId);
        if (!limits.allowed) {
            return limits;
        }
    }

    const client = createGithubClient(token);

    // Fetch upstream file content
    let fileData;
    if (isMock) {
        fileData = {
            sha: 'mock_b_sha_' + crypto.randomBytes(8).toString('hex'),
            size: 256,
            encoding: 'base64',
            content: Buffer.from(`Contact maintainer: ${targetEmail || 'author@example.com'}\n`, 'utf8').toString('base64')
        };
    } else {
        try {
            const res = await client.get(`/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}?ref=${branch}`);
            fileData = res.data;
        } catch (err) {
            return {
                allowed: false,
                fallbackToLaneC: true,
                reason: `Could not fetch file content from upstream repository: ${err.message}. Converting to Lane C.`
            };
        }
    }

    const rawContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const lineNumber = calculateLineNumber(rawContent, targetEmail);

    if (lineNumber === -1) {
        return {
            allowed: false,
            fallbackToLaneC: true,
            reason: 'Target email is no longer found at upstream HEAD. It may have already been removed.'
        };
    }

    const lines = rawContent.split(/\r?\n/);
    const originalLine = lines[lineNumber - 1];
    const patchedLine = maskEvidence(originalLine, targetEmail);

    const patchedLines = [...lines];
    patchedLines[lineNumber - 1] = patchedLine;
    const patchedContent = patchedLines.join('\n');

    const prTitle = `Remediate exposed personal email in ${filePath}`;
    const prBody = `Hello maintainers,\n\nWhile reviewing repository security disclosures, a personal email address was found exposed in \`${filePath}\` (line ${lineNumber}).\n\nThis pull request replaces the exposed address with \`[email removed]\`.\n\nThank you for your time and help in maintaining privacy!`;

    const planId = 'plan_b_' + crypto.randomBytes(16).toString('hex');
    const plan = {
        planId,
        lane: 'B',
        actionType: 'FORK_AND_PR',
        occurrenceId,
        repoFullName,
        upstreamRepo: repoFullName,
        userLogin,
        filePath,
        branch,
        lineNumber,
        diff: {
            removed: originalLine,
            added: patchedLine
        },
        prTitle,
        prBody,
        fileSha: fileData.sha,
        patchedContentBase64: Buffer.from(patchedContent, 'utf8').toString('base64'),
        requiresConsent: true,
        notice: 'Lane B remediates current repository HEAD content only. It cannot rewrite commit history in repositories you do not own.'
    };

    activeLaneBPlans.set(planId, plan);

    return {
        allowed: true,
        actionType: 'FORK_AND_PR',
        planId,
        repoFullName,
        filePath,
        lineNumber,
        diff: plan.diff,
        prTitle,
        prBody,
        notice: plan.notice
    };
}

/**
 * Polls fork creation until ready (GitHub returns 202 Accepted on POST /forks).
 */
async function waitForForkReady(client, userLogin, repoName, maxWaitMs = 180000) {
    const startTime = Date.now();
    let delay = 2000;

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const res = await client.get(`/repos/${userLogin}/${repoName}`);
            if (res.status === 200) {
                return res.data;
            }
        } catch (_) {
            // Fork is still being generated asynchronously by GitHub
        }
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, 15000);
    }
    throw new Error('Fork generation timed out after 3 minutes. Please try again.');
}

/**
 * Executes Lane B after explicit user review and consent.
 */
async function executeLaneBForkAndPR({ planId, consentConfirmed, token, actorId = 'user' }) {
    const plan = activeLaneBPlans.get(planId);
    if (!plan || plan.actionType !== 'FORK_AND_PR') {
        throw new Error('Invalid or expired Lane B plan');
    }

    if (!consentConfirmed) {
        throw new Error('User consent confirmation required.');
    }

    const isMock = !token || token.startsWith('mock_');
    if (isMock) {
        activeLaneBPlans.delete(planId);
        const prUrl = `https://github.com/${plan.repoFullName}/pull/42`;
        await db.query(`
            INSERT INTO actions (occurrence_id, type, plan_json, consent_at, finished_at, result, github_ref)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5)
        `, [
            plan.occurrenceId,
            'FORK_AND_PR',
            JSON.stringify({ prNumber: 42, prUrl, forkBranch: 'securecheck/remove-email' }),
            'PR_OPENED',
            prUrl
        ]);

        await db.query(`
            UPDATE exposures 
            SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
            WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
        `, [STATES.AWAITING_OWNER, 'PR_OPENED_#42', plan.occurrenceId]);

        await logAudit({
            action: 'EXECUTE_LANE_B_FORK_AND_PR',
            actorId,
            occurrenceId: plan.occurrenceId,
            details: { prUrl, prNumber: 42, isMock: true }
        });

        return {
            success: true,
            status: STATES.AWAITING_OWNER,
            prNumber: 42,
            prUrl,
            message: 'Pull request successfully opened upstream.'
        };
    }

    const client = createGithubClient(token);
    const [upstreamOwner, repoName] = plan.repoFullName.split('/');

    try {
        // Step 1: Fork the repository
        console.log(`[Lane B] Requesting fork of ${plan.repoFullName}...`);
        await client.post(`/repos/${plan.repoFullName}/forks`, {});

        // Step 2: Poll until fork is ready
        console.log(`[Lane B] Polling until fork ${plan.userLogin}/${repoName} is ready...`);
        const forkData = await waitForForkReady(client, plan.userLogin, repoName);
        const defaultBranch = forkData.default_branch || plan.branch || 'main';

        // Step 3: Create branch on the fork
        const newBranchName = `securecheck/remove-email-${plan.occurrenceId}-${Date.now()}`;
        const refRes = await client.get(`/repos/${plan.userLogin}/${repoName}/git/ref/heads/${defaultBranch}`);
        const baseSha = refRes.data.object.sha;

        await client.post(`/repos/${plan.userLogin}/${repoName}/git/refs`, {
            ref: `refs/heads/${newBranchName}`,
            sha: baseSha
        });

        // Step 4: Patch the file on the new branch
        // Fetch fork file sha for the new branch
        const forkFileRes = await client.get(`/repos/${plan.userLogin}/${repoName}/contents/${encodeURIComponent(plan.filePath)}?ref=${newBranchName}`);
        
        await client.put(`/repos/${plan.userLogin}/${repoName}/contents/${encodeURIComponent(plan.filePath)}`, {
            message: `chore: remediate exposed sensitive email in ${plan.filePath}`,
            content: plan.patchedContentBase64,
            sha: forkFileRes.data.sha,
            branch: newBranchName
        });

        // Step 5: Create Pull Request upstream
        console.log(`[Lane B] Opening Pull Request from ${plan.userLogin}:${newBranchName} to ${plan.repoFullName}...`);
        let prRes;
        try {
            prRes = await client.post(`/repos/${plan.repoFullName}/pulls`, {
                title: plan.prTitle,
                head: `${plan.userLogin}:${newBranchName}`,
                base: defaultBranch,
                body: plan.prBody
            });
        } catch (prErr) {
            const st = prErr.response?.status;
            // Handle disabled PRs (403/422): Fallback to Lane C
            if (st === 403 || st === 422) {
                console.warn(`[Lane B] Pull requests disabled or restricted on upstream repository. Falling back gracefully to Lane C.`);
                
                await db.query(`
                    UPDATE exposures 
                    SET status = $1, status_reason = $2, lane = 'C'
                    WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
                `, [STATES.REMOVAL_REQUESTED, 'PULL_REQUESTS_RESTRICTED_FALLBACK_C', plan.occurrenceId]);

                return {
                    success: false,
                    fallbackToLaneC: true,
                    reason: 'The repository owner has disabled public pull requests or restricted them to collaborators. Converted to Lane C (Manual Escalation).'
                };
            }
            throw prErr;
        }

        const prData = prRes.data;
        activeLaneBPlans.delete(planId);

        // Update DB records
        await db.query(`
            INSERT INTO actions (occurrence_id, type, plan_json, consent_at, finished_at, result, github_ref)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5)
        `, [
            plan.occurrenceId,
            'FORK_AND_PR',
            JSON.stringify({ prNumber: prData.number, prUrl: prData.html_url, forkBranch: newBranchName }),
            'PR_OPENED',
            prData.html_url
        ]);

        // Transition exposure status to Awaiting Owner
        await db.query(`
            UPDATE exposures 
            SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
            WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
        `, [STATES.AWAITING_OWNER, `PR_OPENED_#${prData.number}`, plan.occurrenceId]);

        await logAudit({
            action: 'EXECUTE_LANE_B_PR_OPENED',
            actorId,
            occurrenceId: plan.occurrenceId,
            details: { prNumber: prData.number, prUrl: prData.html_url }
        });

        return {
            success: true,
            prNumber: prData.number,
            prUrl: prData.html_url,
            status: STATES.AWAITING_OWNER,
            message: 'Pull request successfully submitted. Now awaiting repository maintainer review.'
        };
    } catch (err) {
        console.error('[Lane B Execution Error]', err.message);
        throw err;
    }
}

/**
 * Periodic poll function using ETag for PR status updates:
 * - open -> Awaiting Owner
 * - review/comments activity -> Under Review
 * - merged -> Processing -> Verifier
 * - closed unmerged -> Failed (owner_declined) -> Offer Lane C
 */
async function pollPullRequestStatus(occurrenceId, repoFullName, prNumber, token, lastEtag = null) {
    const client = createGithubClient(token);
    const headers = lastEtag ? { 'If-None-Match': lastEtag } : {};

    try {
        const res = await client.get(`/repos/${repoFullName}/pulls/${prNumber}`, { headers });
        const newEtag = res.headers['etag'];
        const pr = res.data;

        let targetStatus = STATES.AWAITING_OWNER;
        let reason = 'PR_OPEN';

        if (pr.merged_at) {
            targetStatus = STATES.PROCESSING;
            reason = 'PR_MERGED';
        } else if (pr.state === 'closed') {
            targetStatus = STATES.FAILED;
            reason = 'OWNER_DECLINED_PR';
        } else if (pr.comments > 0 || pr.review_comments > 0) {
            targetStatus = STATES.UNDER_REVIEW;
            reason = 'PR_UNDER_REVIEW_WITH_COMMENTS';
        }

        // Apply update in DB
        await db.query(`
            UPDATE exposures
            SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
            WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
        `, [targetStatus, reason, occurrenceId]);

        // If merged, automatically trigger independent verifier
        let verificationResult = null;
        if (targetStatus === STATES.PROCESSING) {
            verificationResult = await verifyOccurrence(occurrenceId, token);
        }

        return {
            statusChanged: true,
            newStatus: targetStatus,
            reason,
            etag: newEtag,
            verificationResult,
            offerLaneC: targetStatus === STATES.FAILED
        };
    } catch (err) {
        if (err.response?.status === 304) {
            // Not modified
            return { statusChanged: false, etag: lastEtag };
        }
        throw err;
    }
}

module.exports = {
    checkLaneBLimits,
    planLaneBForkAndPR,
    executeLaneBForkAndPR,
    pollPullRequestStatus
};
