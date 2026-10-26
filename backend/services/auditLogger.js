const db = require('../database/db');
const { maskEmail } = require('../utils/emailSecurity');

/**
 * Sanitizes any object or string so that tokens, secrets, or plaintext emails are never logged.
 */
function sanitizeDetails(data) {
    if (!data) return {};
    let str = typeof data === 'string' ? data : JSON.stringify(data);

    // Redact tokens/secrets
    str = str.replace(/(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|bearer\s+[^\s"']+)/gi, '[REDACTED_TOKEN]');
    str = str.replace(/(token|secret|password|key)\s*[:=]\s*["']?[^"',\s}]+/gi, '$1:"[REDACTED]"');

    // Mask emails in the logs
    str = str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => maskEmail(match));

    try {
        return JSON.parse(str);
    } catch (_) {
        return { message: str };
    }
}

/**
 * Inserts a sanitized entry into remediation_audit_log.
 */
async function logAudit({ action, actorId = null, occurrenceId = null, details = {} }) {
    try {
        const sanitized = sanitizeDetails(details);
        const detailsStr = JSON.stringify(sanitized);

        await db.query(
            `INSERT INTO remediation_audit_log (action, actor_id, occurrence_id, details)
             VALUES ($1, $2, $3, $4)`,
            [action, actorId ? String(actorId) : 'system', occurrenceId || null, detailsStr]
        );

        console.log(`[Audit] [${action}] actor=${actorId || 'system'} occ=${occurrenceId || 'N/A'}`);
    } catch (e) {
        console.error('[Audit Logger Error]', e.message);
    }
}

module.exports = {
    logAudit,
    sanitizeDetails
};
