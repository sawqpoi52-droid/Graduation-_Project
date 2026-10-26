const db = require('../database/db');
const { STATES } = require('./stateMachine');
const { logAudit } = require('./auditLogger');

/**
 * Generates a comprehensive, human-reviewed Markdown Evidence Package for Lane C.
 * Note: Automated submissions are strictly forbidden by GitHub Private Information Removal policy.
 * The package is generated for the user to submit manually.
 */
async function generateEvidencePackage({ occurrenceId, userExplanation = '' }) {
    // 1. Fetch occurrence, exposure, and verified email details
    const res = await db.query(`
        SELECT o.*, e.exposure_id, e.status, ue.email_hash, ue.email_masked, ue.verified_at, u.login, u.github_id
        FROM occurrences o
        JOIN exposures e ON o.exposure_id = e.exposure_id
        LEFT JOIN user_emails ue ON e.user_email_id = ue.id
        LEFT JOIN users u ON ue.user_id = u.user_id
        WHERE o.occurrence_id = $1
    `, [occurrenceId]);

    if (!res.rows || res.rows.length === 0) {
        throw new Error(`Occurrence #${occurrenceId} not found`);
    }

    const row = res.rows[0];

    // 2. Fetch action history for this occurrence
    const actionsRes = await db.query(`
        SELECT * FROM actions WHERE occurrence_id = $1 ORDER BY started_at ASC
    `, [occurrenceId]);

    const priorActions = (actionsRes.rows || []).map(a => {
        return `- **${a.type}** (${a.started_at}): Result: \`${a.result || 'Attempted'}\` (Ref: ${a.github_ref || 'N/A'})`;
    }).join('\n') || '- None recorded prior to manual escalation.';

    const permalink = row.permalink || row.html_url || 'N/A';
    const verifiedDate = row.verified_at ? new Date(row.verified_at).toUTCString() : 'Verified via GitHub OAuth';

    const markdown = `# GitHub Private Information Removal Evidence Package

> **Important Notice:** GitHub's Private Information Removal Policy is an extraordinary process reserved strictly for high-risk sensitive data (e.g. personal contact credentials, private keys, personally identifiable data). Automated bot submissions are strictly prohibited by GitHub terms. You must review this evidence package and submit it yourself through the official portal.

---

### 1. Proof of Ownership & Verified Identity
- **Account Owner:** @${row.login || 'Authenticated User'} (GitHub ID: \`${row.github_id || 'Verified'}\`)
- **Protected Email Address:** \`${row.email_masked || 'Confidential'}\`
- **Ownership Verification:** Cryptographically verified via GitHub OAuth on \`${verifiedDate}\`

---

### 2. Location of Exposed Content
- **Repository:** \`${row.repo_full_name || 'N/A'}\`
- **Occurrence Type:** \`${row.type}\`
- **Permanent URL with Line Number:** [${permalink}](${permalink})
- **Commit SHA:** \`${row.commit_sha || 'N/A'}\`
- **File / Path:** \`${row.file_path || 'N/A'}\` (Line: ${row.line_number || 'N/A'})
- **Evidence Snippet:**
\`\`\`
${row.evidence_masked || '[Sensitive email address exposed in public source]'}
\`\`\`

---

### 3. Record of Prior Remediation Attempts
${priorActions}

---

### 4. Risk Assessment & Justification
*(Please specify below why the public availability of this data poses a real-world security or personal safety risk):*

${userExplanation ? userExplanation : `> [Write your personal explanation here, e.g.: The exposed email address is my private personal address. It is receiving targeted phishing and credential stuffing attacks due to being indexed publicly in repository history.]`}

---

### 5. Next Steps for Manual Submission
1. Review the details above and copy this Markdown package.
2. Open the official GitHub Private Information Removal portal:
   - **Form:** [https://support.github.com/contact/private-information](https://support.github.com/contact/private-information)
   - Or GitHub Privacy Contact: [https://github.com/contact/privacy](https://github.com/contact/privacy)
3. Paste the URLs and the justification into the respective fields.
4. After submitting, return to SecureCheck and click **"I Have Submitted This Request"** to track resolution.
`;

    // Save package in DB
    const insRes = await db.query(`
        INSERT INTO evidence_packages (occurrence_id, content_md)
        VALUES ($1, $2)
    `, [occurrenceId, markdown]);

    const packageId = insRes.lastID || (await db.query('SELECT MAX(package_id) as id FROM evidence_packages')).rows[0].id;

    await logAudit({
        action: 'GENERATE_LANE_C_EVIDENCE_PACKAGE',
        occurrenceId,
        details: { packageId, repo: row.repo_full_name }
    });

    return {
        packageId,
        occurrenceId,
        contentMarkdown: markdown,
        submissionUrl: 'https://support.github.com/contact/private-information'
    };
}

/**
 * Confirms user has personally submitted the Lane C request to GitHub.
 * Only then is status updated to "Removal Requested".
 */
async function confirmLaneCSubmission({ occurrenceId, ticketRef = null, actorId = 'user' }) {
    await db.query(`
        UPDATE evidence_packages
        SET submitted_confirmed_at = CURRENT_TIMESTAMP, ticket_ref = $1
        WHERE occurrence_id = $2
    `, [ticketRef, occurrenceId]);

    await db.query(`
        UPDATE exposures
        SET status = $1, status_reason = $2, last_checked_at = CURRENT_TIMESTAMP
        WHERE exposure_id = (SELECT exposure_id FROM occurrences WHERE occurrence_id = $3)
    `, [STATES.REMOVAL_REQUESTED, `MANUAL_SUBMISSION_CONFIRMED${ticketRef ? `_REF_${ticketRef}` : ''}`, occurrenceId]);

    await logAudit({
        action: 'CONFIRM_LANE_C_SUBMISSION',
        actorId,
        occurrenceId,
        details: { ticketRef }
    });

    return {
        success: true,
        status: STATES.REMOVAL_REQUESTED,
        message: 'Manual removal request recorded. SecureCheck will verify status during scheduled audits.'
    };
}

module.exports = {
    generateEvidencePackage,
    confirmLaneCSubmission
};
