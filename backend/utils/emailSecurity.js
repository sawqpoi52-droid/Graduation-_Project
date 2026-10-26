const crypto = require('crypto');
const { encryptPII, decryptPII } = require('./crypto');

const PRIVATE_SALT = process.env.PRIVATE_SALT || 'secure-check-default-salt-2026';

/**
 * Normalizes email address for consistent hashing and comparisons.
 */
function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * Computes HMAC-SHA256 for a normalized email address.
 * Never stores raw plaintext email in blind index lookup tables.
 */
function hashEmailHMAC(email, customSalt = null) {
    const norm = normalizeEmail(email);
    if (!norm) return '';
    const salt = customSalt || PRIVATE_SALT;
    return crypto.createHmac('sha256', salt).update(norm).digest('hex');
}

/**
 * Masks an email for safe display (e.g. "al***d@ex***e.com").
 */
function maskEmail(email) {
    const norm = normalizeEmail(email);
    if (!norm || !norm.includes('@')) return '***@***.***';

    const [localPart, domainPart] = norm.split('@');
    const domainSegments = domainPart.split('.');

    let maskedLocal;
    if (localPart.length <= 2) {
        maskedLocal = localPart[0] + '***';
    } else {
        maskedLocal = localPart[0] + '***' + localPart[localPart.length - 1];
    }

    const maskedDomainName = domainSegments[0].length <= 2
        ? domainSegments[0][0] + '***'
        : domainSegments[0][0] + '***' + domainSegments[0][domainSegments[0].length - 1];

    const tld = domainSegments.slice(1).join('.');
    return `${maskedLocal}@${maskedDomainName}.${tld}`;
}

/**
 * Masks all occurrences of target email within a string or evidence snippet.
 */
function maskEvidence(text, targetEmail) {
    if (!text || typeof text !== 'string') return '';
    if (!targetEmail || typeof targetEmail !== 'string') return text;

    const norm = targetEmail.trim();
    if (!norm) return text;

    // Literal case-insensitive replacement
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return text.replace(regex, '[email removed]');
}

/**
 * Encrypts an OAuth token using AES-256-GCM.
 */
function encryptToken(token) {
    if (!token) return null;
    return encryptPII(token);
}

/**
 * Decrypts an OAuth token.
 */
function decryptToken(tokenEnc, iv, tag) {
    if (!tokenEnc || !iv || !tag) return null;
    try {
        return decryptPII(tokenEnc, iv, tag);
    } catch (e) {
        return null;
    }
}

/**
 * Validates GitHub noreply email address.
 * Standard format: {username}@users.noreply.github.com or {id}+{username}@users.noreply.github.com
 */
function validateNoreplyEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const norm = email.trim().toLowerCase();
    const regex = /^([0-9]+\+)?[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?@users\.noreply\.github\.com$/;
    return regex.test(norm);
}

/**
 * Calculates 1-based line number for a target email in file contents using literal case-insensitive match.
 * Returns -1 if not found.
 */
function calculateLineNumber(fileContent, targetEmail) {
    if (typeof fileContent !== 'string' || !targetEmail) return -1;
    const targetNorm = targetEmail.trim().toLowerCase();
    const lines = fileContent.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(targetNorm)) {
            return i + 1; // 1-based index
        }
    }
    return -1;
}

/**
 * Builds canonical GitHub permalink with line number.
 */
function buildPermalink(repoFullName, sha, filePath, lineNumber) {
    if (!repoFullName || !sha || !filePath) return null;
    const lineSuffix = lineNumber && lineNumber > 0 ? `#L${lineNumber}` : '';
    return `https://github.com/${repoFullName}/blob/${sha}/${filePath}${lineSuffix}`;
}

module.exports = {
    normalizeEmail,
    hashEmailHMAC,
    maskEmail,
    maskEvidence,
    encryptToken,
    decryptToken,
    validateNoreplyEmail,
    calculateLineNumber,
    buildPermalink
};
