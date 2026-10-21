const crypto = require('crypto');

/**
 * SecureCheck Privacy Utility
 * Handles Blind Indexing and PII Encryption
 */

const ALGORITHM = 'aes-256-gcm';
const PRIVATE_SALT = process.env.PRIVATE_SALT || 'secure-check-default-salt-2026';
const ENCRYPTION_KEY = Buffer.from(process.env.DB_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

/**
 * Generates a Blind Index (Anonymous ID) for an email.
 * This allows lookup without storing the raw email.
 */
function generateAnonymousId(email) {
    return crypto.createHash('sha256')
        .update(email.toLowerCase().trim() + PRIVATE_SALT)
        .digest('hex');
}

/**
 * Anonymizes an IP address by hashing it with a daily salt.
 */
function anonymizeIP(ip) {
    const dailySalt = new Date().toISOString().split('T')[0]; // Rotates daily
    return crypto.createHash('sha256')
        .update(ip + dailySalt + PRIVATE_SALT)
        .digest('hex');
}

/**
 * Encrypts PII (like email) for secure storage.
 */
function encryptPII(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
        content: encrypted,
        iv: iv.toString('hex'),
        tag: authTag
    };
}

/**
 * Decrypts PII for use (e.g. sending an email).
 */
function decryptPII(encryptedContent, ivHex, tagHex) {
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = {
    generateAnonymousId,
    anonymizeIP,
    encryptPII,
    decryptPII
};
