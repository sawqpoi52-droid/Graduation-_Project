const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../database/db');
const { encryptToken, hashEmailHMAC, maskEmail } = require('../utils/emailSecurity');
const { logAudit } = require('../services/auditLogger');

const router = express.Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || 'http://localhost:5000/api/auth/github/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5000';

// In-memory OAuth state cache with 10-minute TTL
const stateCache = new Map();

/**
 * 1. Initiate GitHub OAuth Login
 */
router.get('/github/login', (req, res) => {
    // Generate secure state
    const state = crypto.randomBytes(24).toString('hex');
    stateCache.set(state, { createdAt: Date.now() });

    // Clean up expired states (> 10 mins)
    for (const [st, val] of stateCache.entries()) {
        if (Date.now() - val.createdAt > 600000) {
            stateCache.delete(st);
        }
    }

    if (!GITHUB_CLIENT_ID) {
        // Return information if OAuth credentials not yet configured
        return res.json({
            configured: false,
            message: 'GitHub OAuth is not configured with GITHUB_CLIENT_ID in .env. Use developer test mode or configure OAuth App.',
            devModeAvailable: true
        });
    }

    // Minimal scopes: user:email and public_repo
    const scope = encodeURIComponent('user:email public_repo');
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_CALLBACK_URL)}&scope=${scope}&state=${state}`;

    res.json({
        configured: true,
        authUrl,
        state
    });
});

/**
 * 2. OAuth Callback
 */
router.get('/github/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!state || !stateCache.has(state)) {
        return res.status(400).send('OAuth security verification failed: invalid or expired state parameter.');
    }
    stateCache.delete(state);

    if (!code) {
        return res.status(400).send('Authorization code missing.');
    }

    try {
        // Exchange code for access token
        const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: GITHUB_CALLBACK_URL
        }, {
            headers: { 'Accept': 'application/json' }
        });

        const accessToken = tokenRes.data?.access_token;
        const scopes = tokenRes.data?.scope || 'user:email,public_repo';

        if (!accessToken) {
            return res.status(401).send('Failed to obtain access token from GitHub.');
        }

        // Fetch User Profile
        const userRes = await axios.get('https://api.github.com/user', {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'SecureCheck-App' }
        });
        const ghUser = userRes.data;

        // Fetch Verified Emails ONLY
        const emailsRes = await axios.get('https://api.github.com/user/emails', {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'SecureCheck-App' }
        });
        const verifiedEmails = (emailsRes.data || []).filter(e => e.verified === true);

        // Encrypt OAuth Token via AES-256-GCM (NEVER stored unencrypted)
        const encResult = encryptToken(accessToken);

        // Upsert User in DB
        const userId = `gh_${ghUser.id}`;
        const existingUser = await db.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);

        if (existingUser.rows && existingUser.rows.length > 0) {
            await db.query(`
                UPDATE users 
                SET login = $1, github_id = $2, token_enc = $3, token_iv = $4, token_tag = $5, scopes = $6, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $7
            `, [ghUser.login, String(ghUser.id), encResult.content, encResult.iv, encResult.tag, scopes, userId]);
        } else {
            await db.query(`
                INSERT INTO users (user_id, anonymous_id, encrypted_email, email_iv, login, github_id, token_enc, token_iv, token_tag, scopes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                userId,
                crypto.createHash('sha256').update(userId).digest('hex'),
                encResult.content,
                encResult.iv,
                ghUser.login,
                String(ghUser.id),
                encResult.content,
                encResult.iv,
                encResult.tag,
                scopes
            ]);
        }

        // Save verified emails to user_emails
        for (const ve of verifiedEmails) {
            const emailHash = hashEmailHMAC(ve.email);
            const masked = maskEmail(ve.email);

            await db.query(`
                INSERT INTO user_emails (user_id, email_hash, email_masked, verified_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (email_hash) DO UPDATE 
                SET user_id = $4, verified_at = CURRENT_TIMESTAMP
            `, [userId, emailHash, masked, userId]);
        }

        await logAudit({
            action: 'USER_GITHUB_OAUTH_LOGIN',
            actorId: userId,
            details: { login: ghUser.login, verifiedEmailsCount: verifiedEmails.length }
        });

        // Set session cookie
        res.cookie('sc_session', userId, {
            httpOnly: true,
            secure: false, // Local dev
            sameSite: 'lax',
            maxAge: 7 * 24 * 3600 * 1000
        });

        // Redirect back to frontend
        res.redirect(`${FRONTEND_URL}/?auth=success`);
    } catch (err) {
        console.error('[OAuth Callback Error]', err.message);
        res.status(500).send(`Authentication error: ${err.message}`);
    }
});

/**
 * 3. Logout (Wipes encrypted token immediately from DB)
 */
router.post('/logout', async (req, res) => {
    const userId = req.cookies?.sc_session || req.headers['x-user-id'];

    if (userId) {
        // Clear token completely from DB
        await db.query(`
            UPDATE users 
            SET token_enc = NULL, token_iv = NULL, token_tag = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
        `, [userId]);

        await logAudit({
            action: 'USER_LOGOUT_TOKEN_WIPED',
            actorId: userId,
            details: { message: 'Encrypted OAuth token deleted from database.' }
        });
    }

    res.clearCookie('sc_session');
    res.json({ success: true, message: 'Logged out and encrypted tokens purged.' });
});

/**
 * 4. Current User & Verified Emails
 */
router.get('/me', async (req, res) => {
    const userId = req.cookies?.sc_session || req.headers['x-user-id'];

    if (!userId) {
        return res.status(401).json({ authenticated: false });
    }

    const userRes = await db.query(
        'SELECT user_id, login, github_id, scopes, created_at FROM users WHERE user_id = $1',
        [userId]
    );

    if (!userRes.rows || userRes.rows.length === 0) {
        return res.status(401).json({ authenticated: false });
    }

    const emailsRes = await db.query(
        'SELECT id, email_masked, verified_at FROM user_emails WHERE user_id = $1',
        [userId]
    );

    res.json({
        authenticated: true,
        user: userRes.rows[0],
        verifiedEmails: emailsRes.rows || []
    });
});

/**
 * 5. Developer Test Login (For running offline tests and automated suites)
 */
router.post('/dev-login', async (req, res) => {
    const { login = 'dev-user', email = 'test.dev@example.com', mockToken = 'mock_gh_token_dev' } = req.body;
    const userId = `dev_${login}`;

    const encResult = encryptToken(mockToken);
    const emailHash = hashEmailHMAC(email);
    const masked = maskEmail(email);

    await db.query(`
        INSERT INTO users (user_id, anonymous_id, encrypted_email, email_iv, login, github_id, token_enc, token_iv, token_tag, scopes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE
        SET login = $11, token_enc = $12, token_iv = $13, token_tag = $14
    `, [
        userId,
        crypto.createHash('sha256').update(userId).digest('hex'),
        encResult.content,
        encResult.iv,
        login,
        '12345678',
        encResult.content,
        encResult.iv,
        encResult.tag,
        'user:email,public_repo',
        login,
        encResult.content,
        encResult.iv,
        encResult.tag
    ]);

    await db.query(`
        INSERT INTO user_emails (user_id, email_hash, email_masked, verified_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (email_hash) DO UPDATE
        SET user_id = $4, verified_at = CURRENT_TIMESTAMP
    `, [userId, emailHash, masked, userId]);

    res.cookie('sc_session', userId, { httpOnly: true });
    res.json({
        success: true,
        userId,
        login,
        verifiedEmail: masked
    });
});

module.exports = router;
