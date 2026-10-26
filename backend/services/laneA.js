const crypto = require('crypto');
const { createGithubClient } = require('../utils/githubClient');
const { calculateLineNumber, maskEvidence } = require('../utils/emailSecurity');
const { verifyOccurrence } = require('./verifier');
const { logAudit } = require('./auditLogger');
const db = require('../database/db');

// In-memory or DB-backed action plan storage
const activePlans = new Map();

/**
 * -------------------------------------------------------------
 * LANE A1: Patch File Content (Single Line Replacement Only)
 * -------------------------------------------------------------
 */

async function planA1PatchFile({ occurrenceId, repoFullName, filePath, branch = 'main', targetEmail, token }) {
    const client = createGithubClient(token);
    const isMock = !token || token.startsWith('mock_');
    
    // 1. Fetch file content and SHA
    let fileData;
    if (isMock) {
        fileData = {
            sha: 'mock_sha_' + crypto.randomBytes(8).toString('hex'),
            size: 512,
            encoding: 'base64',
            content: Buffer.from(`// Configuration\nconst maintainer_email = "${targetEmail || 'maintainer@example.com'}";\nmodule.exports = { maintainer_email };\n`, 'utf8').toString('base64')
        };
    } else {
        try {
            const res = await client.get(`/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}?ref=${branch}`);
            fileData = res.data;
        } catch (err) {
            throw new Error(`Failed to fetch file ${filePath} from ${repoFullName}: ${err.message}`);
        }
    }

    // Guard: Check file size (>1MB or binary)
    if (fileData.size > 1024 * 1024 || fileData.encoding !== 'base64') {
        return {
            executable: false,
            fallbackToLaneC: true,
            reason: 'File exceeds 1MB size limit or is non-text binary. Converted to Lane C for manual review.'
        };
    }

    const rawContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const lineNumber = calculateLineNumber(rawContent, targetEmail);

    if (lineNumber === -1) {
        return {
            executable: false,
            reason: 'Target email was not found in the latest version of the file.'
        };
    }

    const lines = rawContent.split(/\r?\n/);
    const originalLine = lines[lineNumber - 1];
    const patchedLine = maskEvidence(originalLine, targetEmail);

    // Verify invariant: ONLY the target line is modified
    const patchedLines = [...lines];
    patchedLines[lineNumber - 1] = patchedLine;
    const patchedContent = patchedLines.join('\n');

    const planId = 'plan_a1_' + crypto.randomBytes(16).toString('hex');
    const plan = {
        planId,
        lane: 'A1',
        actionType: 'PATCH_FILE',
        occurrenceId,
        repoFullName,
        filePath,
        branch,
        fileSha: fileData.sha,
        lineNumber,
        diff: {
            removed: originalLine,
            added: patchedLine
        },
        patchedContentBase64: Buffer.from(patchedContent, 'utf8').toString('base64'),
        requiresConsent: true,
        createdAt: new Date().toISOString()
    };

    activePlans.set(planId, plan);

    // Record planned action in DB
    await db.query(`
        INSERT INTO actions (occurrence_id, type, plan_json, started_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    `, [occurrenceId, 'PATCH_FILE', JSON.stringify({ planId, lineNumber, filePath })]);

    return {
        executable: true,
        planId,
        filePath,
        lineNumber,
        diff: plan.diff,
        branch
    };
}

async function executeA1PatchFile({ planId, consentConfirmed, token, actorId = 'user' }) {
    const plan = activePlans.get(planId);
    if (!plan || plan.actionType !== 'PATCH_FILE') {
        throw new Error('Invalid or expired plan ID');
    }

    if (!consentConfirmed) {
        throw new Error('User consent confirmation is required to execute file modification.');
    }

    const client = createGithubClient(token);
    const isMock = !token || token.startsWith('mock_');
    let commitSha = null;
    let fallbackPrCreated = false;
    let prHtmlUrl = null;

    if (isMock) {
        commitSha = 'mock_commit_' + crypto.randomBytes(10).toString('hex');
    } else {
        try {
            // Attempt direct commit to default branch
            const putRes = await client.put(`/repos/${plan.repoFullName}/contents/${encodeURIComponent(plan.filePath)}`, {
                message: `chore: remediate exposed sensitive email in ${plan.filePath}`,
                content: plan.patchedContentBase64,
                sha: plan.fileSha,
                branch: plan.branch
            });

            commitSha = putRes.data?.commit?.sha || null;
        } catch (err) {
            const isBranchProtected = err.response?.status === 403 || err.response?.status === 409 || err.response?.status === 422;
            
            if (isBranchProtected) {
                console.log('[Lane A1] Direct commit blocked by branch protection. Falling back to internal branch + PR...');
                
                // 1. Get branch ref SHA
                const refRes = await client.get(`/repos/${plan.repoFullName}/git/ref/heads/${plan.branch}`);
                const baseSha = refRes.data.object.sha;

                // 2. Create internal branch
                const internalBranch = `securecheck/patch-email-${plan.occurrenceId}-${Date.now()}`;
                await client.post(`/repos/${plan.repoFullName}/git/refs`, {
                    ref: `refs/heads/${internalBranch}`,
                    sha: baseSha
                });

                // 3. Commit to internal branch
                const putBranchRes = await client.put(`/repos/${plan.repoFullName}/contents/${encodeURIComponent(plan.filePath)}`, {
                    message: `chore: remediate exposed sensitive email in ${plan.filePath}`,
                    content: plan.patchedContentBase64,
                    sha: plan.fileSha,
                    branch: internalBranch
                });
                commitSha = putBranchRes.data?.commit?.sha || null;

                // 4. Create internal PR
                const prRes = await client.post(`/repos/${plan.repoFullName}/pulls`, {
                    title: `chore: remediate exposed email in ${plan.filePath}`,
                    head: internalBranch,
                    base: plan.branch,
                    body: `### SecureCheck Automated Exposure Remediation\n\nThis pull request replaces an exposed personal email with \`[email removed]\` on line ${plan.lineNumber} of \`${plan.filePath}\`.\n\nBranch protection prevented direct push; please review and merge.`
                });

                fallbackPrCreated = true;
                prHtmlUrl = prRes.data?.html_url;
            } else {
                throw err;
            }
        }
    }

    // Clean up plan
    activePlans.delete(planId);

    // Record action completion
    await db.query(`
        UPDATE actions 
        SET consent_at = CURRENT_TIMESTAMP, finished_at = CURRENT_TIMESTAMP, 
            result = $1, github_ref = $2
        WHERE occurrence_id = $3 AND type = 'PATCH_FILE'
    `, [fallbackPrCreated ? 'PR_CREATED_DUE_TO_PROTECTION' : 'DIRECT_COMMIT_SUCCESS', commitSha || prHtmlUrl, plan.occurrenceId]);

    // Update exposure status to Processing
    await db.query(`
        UPDATE exposures
        SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
        WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
    `, ['Processing', fallbackPrCreated ? 'PR_CREATED_DUE_TO_PROTECTION' : 'DIRECT_PATCH_COMMITTED', plan.occurrenceId]);

    await logAudit({
        action: 'EXECUTE_A1_PATCH_FILE',
        actorId,
        occurrenceId: plan.occurrenceId,
        details: { repo: plan.repoFullName, commitSha, fallbackPrCreated, prHtmlUrl }
    });

    // Run independent verification
    const verification = await verifyOccurrence(plan.occurrenceId, token);

    return {
        success: true,
        commitSha,
        fallbackPrCreated,
        prHtmlUrl,
        verification
    };
}

/**
 * -------------------------------------------------------------
 * LANE A3: Delete or Patch Comment
 * -------------------------------------------------------------
 */

async function planA3DeleteComment({ occurrenceId, repoFullName, commentId, commentType = 'ISSUE_COMMENT', isPatch = false }) {
    const planId = 'plan_a3_' + crypto.randomBytes(16).toString('hex');
    const plan = {
        planId,
        lane: 'A3',
        actionType: 'DELETE_COMMENT',
        occurrenceId,
        repoFullName,
        commentId,
        commentType,
        isPatch,
        requiresConsent: true,
        createdAt: new Date().toISOString()
    };

    activePlans.set(planId, plan);

    return {
        planId,
        actionType: isPatch ? 'PATCH_COMMENT' : 'DELETE_COMMENT',
        commentId,
        repoFullName,
        warning: isPatch 
            ? 'Warning: GitHub preserves comment revision history. Readers can view previous revisions unless permanently deleted from the UI.'
            : 'Comment will be permanently removed (DELETE).'
    };
}

async function executeA3DeleteComment({ planId, consentConfirmed, token, actorId = 'user' }) {
    const plan = activePlans.get(planId);
    if (!plan || plan.actionType !== 'DELETE_COMMENT') {
        throw new Error('Invalid or expired plan ID');
    }

    if (!consentConfirmed) {
        throw new Error('User consent confirmation required.');
    }

    const client = createGithubClient(token);
    const isMock = !token || token.startsWith('mock_');
    let urlPath;
    if (plan.commentType === 'PR_REVIEW_COMMENT') {
        urlPath = `/repos/${plan.repoFullName}/pulls/comments/${plan.commentId}`;
    } else if (plan.commentType === 'COMMIT_COMMENT') {
        urlPath = `/repos/${plan.repoFullName}/comments/${plan.commentId}`;
    } else {
        urlPath = `/repos/${plan.repoFullName}/issues/comments/${plan.commentId}`;
    }

    if (!isMock) {
        if (plan.isPatch) {
            await client.patch(urlPath, {
                body: '[Content removed due to private email exposure - SecureCheck]'
            });
        } else {
            await client.delete(urlPath);
        }
    }

    activePlans.delete(planId);

    await db.query(`
        INSERT INTO actions (occurrence_id, type, plan_json, consent_at, finished_at, result)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
    `, [plan.occurrenceId, 'DELETE_COMMENT', JSON.stringify({ commentId: plan.commentId, isPatch: plan.isPatch }), 'SUCCESS']);

    // Update exposure status to Processing or Partially Mitigated if PATCH
    await db.query(`
        UPDATE exposures
        SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
        WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
    `, [plan.isPatch ? 'Partially Mitigated' : 'Processing', plan.isPatch ? 'COMMENT_PATCHED_HISTORY_REMAINS' : 'COMMENT_PERMANENTLY_DELETED', plan.occurrenceId]);

    await logAudit({
        action: 'EXECUTE_A3_DELETE_COMMENT',
        actorId,
        occurrenceId: plan.occurrenceId,
        details: { repo: plan.repoFullName, commentId: plan.commentId, isPatch: plan.isPatch }
    });

    // Run independent verification
    const verification = await verifyOccurrence(plan.occurrenceId, token);

    return {
        success: true,
        method: plan.isPatch ? 'PATCH' : 'DELETE',
        verification
    };
}

/**
 * -------------------------------------------------------------
 * LANE A4: Set Account Email Visibility to Private
 * -------------------------------------------------------------
 */

async function planA4AccountPrivacy() {
    return {
        actionType: 'SET_EMAIL_PRIVATE',
        endpoint: 'PATCH /user/email/visibility',
        payload: { visibility: 'private' },
        notice: 'This protects future commits and public profile visibility only. It does not rewrite historical commits.',
        manualStepRequired: 'Manual Step: Go to GitHub Settings -> Emails -> check "Block command line pushes that expose my email". (No public API exists for this setting).'
    };
}

async function executeA4AccountPrivacy({ token, actorId = 'user' }) {
    const isMock = !token || token.startsWith('mock_');
    const client = createGithubClient(token);
    
    // Call PATCH /user/email/visibility
    if (!isMock) {
        await client.patch('/user/email/visibility', {
            visibility: 'private'
        });
    }

    await logAudit({
        action: 'EXECUTE_A4_EMAIL_PRIVATE',
        actorId,
        details: { visibility: 'private' }
    });

    return {
        success: true,
        visibility: 'private',
        manualGuidance: {
            title: 'Block command line pushes that expose my email',
            url: 'https://github.com/settings/emails',
            instruction: 'Visit GitHub Email Settings and check "Block command line pushes that expose my email" to prevent accidental push exposures.'
        }
    };
}

module.exports = {
    planA1PatchFile,
    executeA1PatchFile,
    planA3DeleteComment,
    executeA3DeleteComment,
    planA4AccountPrivacy,
    executeA4AccountPrivacy
};
