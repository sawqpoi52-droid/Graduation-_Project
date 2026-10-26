const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeEmail,
    hashEmailHMAC,
    maskEmail,
    maskEvidence,
    validateNoreplyEmail,
    calculateLineNumber,
    buildPermalink
} = require('../../utils/emailSecurity');

test('Email Security - Normalization and Hashing', () => {
    const raw = '  User.Test+Filter@Example.COM ';
    const norm = normalizeEmail(raw);
    assert.equal(norm, 'user.test+filter@example.com');

    const hash1 = hashEmailHMAC(raw);
    const hash2 = hashEmailHMAC('user.test+filter@example.com');
    assert.equal(hash1, hash2, 'HMAC-SHA256 must be identical after normalization');
    assert.equal(hash1.length, 64, 'HMAC-SHA256 hex string must be 64 characters');
});

test('Email Security - Masking functionality', () => {
    assert.equal(maskEmail('omar.qahtani@example.com'), 'o***i@e***e.com');
    assert.equal(maskEmail('a@b.com'), 'a***@b***.com');
    assert.equal(maskEmail('invalid-text'), '***@***.***');
});

test('Email Security - Mask Evidence with negative controls', () => {
    const snippet = 'Contact author: ali@example.com or admin@example.com';
    const masked = maskEvidence(snippet, 'ali@example.com');
    assert.equal(masked, 'Contact author: [email removed] or admin@example.com');

    // Negative control: ali@example.co must NOT match ali@example.com
    const notMatched = maskEvidence('Email is ali@example.co', 'ali@example.com');
    assert.equal(notMatched, 'Email is ali@example.co');

    // Case-insensitivity
    const caseSnippet = 'Email: ALI@EXAMPLE.COM';
    assert.equal(maskEvidence(caseSnippet, 'ali@example.com'), 'Email: [email removed]');
});

test('Email Security - calculateLineNumber with literal matching', () => {
    const file = `// License header
const config = {
    owner: "john.doe@corp.org",
    version: "1.0.0"
};
module.exports = config;`;

    const line = calculateLineNumber(file, 'john.doe@corp.org');
    assert.equal(line, 3, 'Line number must be 3 (1-based index)');

    const notFound = calculateLineNumber(file, 'nonexistent@domain.com');
    assert.equal(notFound, -1);
});

test('Email Security - buildPermalink formats canonical GitHub URL', () => {
    const url = buildPermalink('facebook/react', 'c03c1a14', 'packages/react/index.js', 42);
    assert.equal(url, 'https://github.com/facebook/react/blob/c03c1a14/packages/react/index.js#L42');
});

test('Email Security - validateNoreplyEmail validates GitHub formats', () => {
    // Valid standard formats
    assert.ok(validateNoreplyEmail('octocat@users.noreply.github.com'));
    assert.ok(validateNoreplyEmail('123456+octocat@users.noreply.github.com'));
    assert.ok(validateNoreplyEmail('dev-user-99@users.noreply.github.com'));

    // Invalid formats
    assert.ok(!validateNoreplyEmail('octocat@github.com'));
    assert.ok(!validateNoreplyEmail('random@gmail.com'));
    assert.ok(!validateNoreplyEmail('octocat@other.noreply.github.com'));
});
