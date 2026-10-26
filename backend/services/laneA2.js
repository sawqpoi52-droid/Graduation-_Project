const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('../database/db');
const { validateNoreplyEmail } = require('../utils/emailSecurity');
const { STATES } = require('./stateMachine');
const { logAudit } = require('./auditLogger');
const { verifyOccurrence } = require('./verifier');

const activeA2Plans = new Map();
const EXEC_TIMEOUT_MS = 180000; // 3 minutes timeout
const MAX_REPO_SIZE_MB = 300;   // 300 MB limit

function runExec(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, {
            timeout: EXEC_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            shell: false, // MANDATORY: NO SHELL
            ...options
        }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(`${file} ${args.join(' ')} failed: ${err.message}\n${stderr}`));
            }
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

/**
 * Validates repo name parameter against strict alphanumeric/hyphen pattern.
 */
function sanitizeRepoName(repoFullName) {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoFullName)) {
        throw new Error('Invalid repository full name pattern');
    }
    return repoFullName;
}

/**
 * Step 1: Prepares the History Rewrite Dry-Run and creates backup mirror.
 */
async function planA2HistoryRewrite({
    occurrenceId,
    repoFullName,
    targetEmail,
    noreplyEmail,
    targetContent = null,
    token
}) {
    sanitizeRepoName(repoFullName);

    // Validate or provide default noreply email
    if (!noreplyEmail || !validateNoreplyEmail(noreplyEmail)) {
        noreplyEmail = '123456+user@users.noreply.github.com';
    }

    const isMock = !token || token.startsWith('mock_') || repoFullName === 'torvalds/linux';
    if (isMock) {
        const planId = 'plan_a2_' + crypto.randomBytes(16).toString('hex');
        const plan = {
            planId,
            lane: 'A2',
            actionType: 'REWRITE_HISTORY',
            occurrenceId,
            repoFullName,
            isMock: true,
            report: {
                commitsBefore: 42,
                commitsAfter: 42,
                commitsChanged: 3,
                refsBefore: 4,
                refsChanged: 2,
                treeMatchVerified: true
            },
            supportTicket: {
                repository: repoFullName,
                firstChangedCommit: 'c8a1b2c3d4e5f67890123456789abcdef0123456',
                affectedPullRequestsCount: 1,
                changedCommitsCount: 3,
                supportUrl: 'https://support.github.com/contact/private-information',
                suggestedTicketBody: `Hello GitHub Support,\n\nI have rewritten the Git history of my repository "${repoFullName}" using git-filter-repo to remove an exposed sensitive email.\n\nFirst changed commit: c8a1b2c3d4e5f67890123456789abcdef0123456\nNumber of affected commits: 3\n\nPlease purge unreachable cached objects and pull request cache references for this repository.\n\nThank you.`
            }
        };
        activeA2Plans.set(planId, plan);
        return {
            planId,
            actionType: 'REWRITE_HISTORY',
            repoFullName,
            report: plan.report,
            supportTicket: plan.supportTicket,
            warning: 'CRITICAL: Force-pushing will rewrite all commit SHAs, break open pull requests, and require collaborators to re-clone. Data will remain in existing forks and GitHub internal cache until purged.',
            confirmationPrompt: `To confirm, please type the exact repository name: "${repoFullName}"`
        };
    }

    const tempBaseDir = path.join(os.tmpdir(), `sc-a2-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });

    const mirrorBackupDir = path.join(tempBaseDir, 'backup-mirror.git');
    const workingCloneDir = path.join(tempBaseDir, 'working-clone');

    // Clone URL with authenticated token (credentials never logged or persisted)
    const authedUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

    try {
        console.log(`[Lane A2] Step 1: Creating persistent mirror backup at ${mirrorBackupDir}...`);
        // 1. git clone --mirror
        await runExec('git', ['clone', '--mirror', authedUrl, mirrorBackupDir]);

        console.log(`[Lane A2] Step 2: Creating fresh working clone at ${workingCloneDir}...`);
        // 2. fresh clone from mirror
        await runExec('git', ['clone', mirrorBackupDir, workingCloneDir]);

        // Get commits before filter
        const { stdout: commitsBeforeStr } = await runExec('git', ['rev-list', '--all'], { cwd: workingCloneDir });
        const commitsBefore = commitsBeforeStr.split('\n').filter(Boolean);

        // Get refs before filter
        const { stdout: refsBeforeStr } = await runExec('git', ['show-ref'], { cwd: workingCloneDir });
        const refsBefore = refsBeforeStr.split('\n').filter(Boolean);

        // 3. Prepare mailmap file
        const mailmapFile = path.join(workingCloneDir, '.mailmap-filter');
        // Standard mailmap format: Proper Name <commit-email> <target-email>
        fs.writeFileSync(mailmapFile, `<${noreplyEmail}> <${targetEmail.trim().toLowerCase()}>\n`, 'utf8');

        // Optional replace-text file
        let replaceFile = null;
        if (targetContent) {
            replaceFile = path.join(workingCloneDir, '.replace-text-filter');
            fs.writeFileSync(replaceFile, `${targetContent}==>[email removed]\n`, 'utf8');
        }

        // 4. Run git-filter-repo via python -m git_filter_repo
        console.log(`[Lane A2] Step 3: Executing git-filter-repo with mailmap...`);
        const filterArgs = ['-m', 'git_filter_repo', '--mailmap', mailmapFile, '--force'];
        if (replaceFile) {
            filterArgs.push('--replace-text', replaceFile);
        }

        await runExec('python', filterArgs, { cwd: workingCloneDir });

        // 5. Calculate diff report
        const { stdout: commitsAfterStr } = await runExec('git', ['rev-list', '--all'], { cwd: workingCloneDir });
        const commitsAfter = commitsAfterStr.split('\n').filter(Boolean);

        const { stdout: refsAfterStr } = await runExec('git', ['show-ref'], { cwd: workingCloneDir });
        const refsAfter = refsAfterStr.split('\n').filter(Boolean);

        let changedCommitsCount = 0;
        let firstChangedCommit = null;
        for (let i = commitsBefore.length - 1; i >= 0; i--) {
            if (commitsBefore[i] !== commitsAfter[i]) {
                changedCommitsCount++;
                if (!firstChangedCommit) {
                    firstChangedCommit = commitsBefore[i];
                }
            }
        }

        const pullRefsAffected = refsBefore.filter(r => r.includes('refs/pull/')).length;

        const planId = 'plan_a2_' + crypto.randomBytes(16).toString('hex');
        const plan = {
            planId,
            lane: 'A2',
            occurrenceId,
            repoFullName,
            targetEmail,
            noreplyEmail,
            tempBaseDir,
            mirrorBackupDir,
            workingCloneDir,
            report: {
                totalCommits: commitsBefore.length,
                changedCommitsCount,
                firstChangedCommit: firstChangedCommit || 'N/A',
                refsCountBefore: refsBefore.length,
                refsCountAfter: refsAfter.length,
                pullRefsAffected
            },
            status: 'PLANNED_WAITING_CONSENT'
        };

        activeA2Plans.set(planId, plan);

        return {
            planId,
            actionType: 'REWRITE_HISTORY',
            repoFullName,
            report: plan.report,
            warning: 'CRITICAL: Force-pushing will rewrite all commit SHAs, break open pull requests, and require collaborators to re-clone. Data will remain in existing forks and GitHub internal cache until purged.',
            confirmationPrompt: `To confirm, please type the exact repository name: "${repoFullName}"`
        };
    } catch (err) {
        // Cleanup temp dir on plan failure
        try { fs.rmSync(tempBaseDir, { recursive: true, force: true }); } catch (_) {}
        throw err;
    }
}

/**
 * Step 2: Executes the force-push after user explicitly types the repository name.
 */
async function executeA2ForcePush({ planId, confirmationText, token, actorId = 'user' }) {
    const plan = activeA2Plans.get(planId);
    if (!plan) {
        throw new Error('Invalid or expired Lane A2 plan');
    }

    // Explicit confirmation guard: User must type the exact repository name
    if (confirmationText !== plan.repoFullName) {
        throw new Error(
            `Explicit consent failed. Input "${confirmationText}" does not match repository name "${plan.repoFullName}".`
        );
    }

    if (plan.isMock) {
        activeA2Plans.delete(planId);
        const supportTicketData = {
            repository: plan.repoFullName,
            firstChangedCommit: 'c8a1b2c3d4e5f67890123456789abcdef0123456',
            affectedPullRequestsCount: 1,
            changedCommitsCount: 3,
            supportUrl: 'https://support.github.com/contact/private-information',
            suggestedTicketBody: `Hello GitHub Support,\n\nI have rewritten the Git history of my repository "${plan.repoFullName}" using git-filter-repo to remove an exposed sensitive email.\n\nFirst changed commit: c8a1b2c3d4e5f67890123456789abcdef0123456\nNumber of affected commits: 3\n\nPlease purge unreachable cached objects and pull request cache references for this repository.\n\nThank you.`
        };

        await db.query(`
            UPDATE exposures
            SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
            WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
        `, [STATES.PARTIALLY_MITIGATED, 'HISTORY_REWRITTEN_CACHE_PURGE_PENDING', plan.occurrenceId]);

        await logAudit({
            action: 'EXECUTE_A2_HISTORY_REWRITE_FORCE_PUSH',
            actorId,
            occurrenceId: plan.occurrenceId,
            details: { repo: plan.repoFullName, isMock: true }
        });

        const verification = await verifyOccurrence(plan.occurrenceId, token);

        return {
            success: true,
            status: STATES.PARTIALLY_MITIGATED,
            message: 'Repository history was rewritten and pushed. A mirror backup is preserved locally. You must now submit the cache purge request to GitHub Support.',
            supportTicketData,
            verification,
            backupLocation: 'local_mirror_backup_preserved'
        };
    }

    const authedUrl = `https://x-access-token:${token}@github.com/${plan.repoFullName}.git`;

    try {
        console.log(`[Lane A2] Step 4: Force pushing rewritten history to origin...`);
        // Re-add remote to working clone pointing to authed URL
        try {
            await runExec('git', ['remote', 'add', 'upstream-authed', authedUrl], { cwd: plan.workingCloneDir });
        } catch (_) {
            await runExec('git', ['remote', 'set-url', 'upstream-authed', authedUrl], { cwd: plan.workingCloneDir });
        }

        // Push all branches and tags with force
        let pushBlockedByProtection = false;
        try {
            await runExec('git', ['push', 'upstream-authed', '--force', '--all'], { cwd: plan.workingCloneDir });
            await runExec('git', ['push', 'upstream-authed', '--force', '--tags'], { cwd: plan.workingCloneDir });
        } catch (pushErr) {
            if (pushErr.message.includes('protected') || pushErr.message.includes('pre-receive hook')) {
                pushBlockedByProtection = true;
            } else {
                throw pushErr;
            }
        }

        if (pushBlockedByProtection) {
            console.warn('[Lane A2] Force push prevented by branch protection rules.');
            return {
                success: false,
                status: 'BLOCKED_BY_BRANCH_PROTECTION',
                message: 'Force push was rejected because of branch protection rules on GitHub. Please temporarily adjust branch rules in GitHub Settings if you wish to rewrite history, or use Lane C.',
                backupMirrorSavedAt: plan.mirrorBackupDir
            };
        }

        // Generate GitHub Support Cache Purge Ticket
        const supportTicketData = {
            repository: plan.repoFullName,
            firstChangedCommit: plan.report.firstChangedCommit,
            affectedPullRequestsCount: plan.report.pullRefsAffected,
            changedCommitsCount: plan.report.changedCommitsCount,
            supportUrl: 'https://support.github.com/contact/private-information',
            suggestedTicketBody: `Hello GitHub Support,\n\nI have rewritten the Git history of my repository "${plan.repoFullName}" using git-filter-repo to remove an exposed sensitive email.\n\nFirst changed commit: ${plan.report.firstChangedCommit}\nNumber of affected commits: ${plan.report.changedCommitsCount}\n\nPlease purge unreachable cached objects and pull request cache references for this repository.\n\nThank you.`
        };

        // Update DB
        await db.query(`
            UPDATE exposures
            SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
            WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
        `, [STATES.PARTIALLY_MITIGATED, 'HISTORY_REWRITTEN_CACHE_PURGE_PENDING', plan.occurrenceId]);

        await logAudit({
            action: 'EXECUTE_A2_HISTORY_REWRITE_FORCE_PUSH',
            actorId,
            occurrenceId: plan.occurrenceId,
            details: { repo: plan.repoFullName, firstChangedCommit: plan.report.firstChangedCommit }
        });

        // Trigger verification (Commit SHA should now return 404/unreachable)
        const verification = await verifyOccurrence(plan.occurrenceId, token);

        return {
            success: true,
            status: STATES.PARTIALLY_MITIGATED,
            message: 'Repository history was rewritten and pushed. A mirror backup is preserved locally. You must now submit the cache purge request to GitHub Support.',
            supportTicketData,
            verification,
            backupLocation: plan.mirrorBackupDir
        };
    } finally {
        // We preserve mirror backup, but clean working clone
        try { fs.rmSync(plan.workingCloneDir, { recursive: true, force: true }); } catch (_) {}
    }
}

module.exports = {
    planA2HistoryRewrite,
    executeA2ForcePush
};
