const db = require('./db');
const { hashEmailHMAC, maskEmail } = require('../utils/emailSecurity');

/**
 * Executes database migrations for GitHub Automated Exposure Remediation.
 * Supports both SQLite and PostgreSQL.
 */
async function runMigrations() {
    console.log('[Migration] Running remediation schema migrations...');

    const isPg = db.usePostgres;
    const pkDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

    // 1. Extend users table for GitHub OAuth if needed
    try {
        const usersTableInfo = await db.query(
            isPg 
                ? "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
                : "PRAGMA table_info(users)"
        );
        const userCols = usersTableInfo.rows.map(r => (r.column_name || r.name || '').toLowerCase());
        
        const alterCols = [
            { name: 'github_id', type: 'TEXT' },
            { name: 'login', type: 'TEXT' },
            { name: 'token_enc', type: 'TEXT' },
            { name: 'token_iv', type: 'TEXT' },
            { name: 'token_tag', type: 'TEXT' },
            { name: 'scopes', type: 'TEXT' },
            { name: 'updated_at', type: 'TIMESTAMP' }
        ];

        for (const col of alterCols) {
            if (!userCols.includes(col.name)) {
                try {
                    await db.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`[Migration] Added column ${col.name} to users table.`);
                } catch (e) {
                    // Column may already exist
                }
            }
        }
    } catch (e) {
        console.warn('[Migration] Note on users table check:', e.message);
    }

    // 2. Table: user_emails
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_emails (
            id ${pkDef},
            user_id TEXT,
            email_hash TEXT NOT NULL UNIQUE,
            email_masked TEXT NOT NULL,
            verified_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 3. Table: exposures
    await db.query(`
        CREATE TABLE IF NOT EXISTS exposures (
            exposure_id ${pkDef},
            user_email_id INTEGER,
            source TEXT NOT NULL,
            data_origin TEXT DEFAULT 'live',
            status TEXT NOT NULL DEFAULT 'Detected',
            status_reason TEXT,
            lane TEXT,
            first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_checked_at TIMESTAMP
        )
    `);

    // 4. Table: occurrences
    await db.query(`
        CREATE TABLE IF NOT EXISTS occurrences (
            occurrence_id ${pkDef},
            exposure_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            repo_full_name TEXT,
            default_branch TEXT,
            commit_sha TEXT,
            file_path TEXT,
            line_number INTEGER,
            comment_id TEXT,
            html_url TEXT,
            permalink TEXT,
            evidence_masked TEXT,
            viewer_relation TEXT DEFAULT 'none',
            detected_via TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 5. Table: actions
    await db.query(`
        CREATE TABLE IF NOT EXISTS actions (
            action_id ${pkDef},
            occurrence_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            consent_at TIMESTAMP,
            started_at TIMESTAMP,
            finished_at TIMESTAMP,
            result TEXT,
            github_ref TEXT,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 6. Table: verifications
    await db.query(`
        CREATE TABLE IF NOT EXISTS verifications (
            verification_id ${pkDef},
            occurrence_id INTEGER NOT NULL,
            method TEXT NOT NULL,
            http_status INTEGER,
            checked_target TEXT,
            is_conclusive INTEGER DEFAULT 0,
            result_status TEXT NOT NULL,
            reason_code TEXT,
            details TEXT,
            verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 7. Table: evidence_packages
    await db.query(`
        CREATE TABLE IF NOT EXISTS evidence_packages (
            package_id ${pkDef},
            occurrence_id INTEGER NOT NULL,
            content_md TEXT NOT NULL,
            submitted_confirmed_at TIMESTAMP,
            ticket_ref TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 8. Table: remediation_audit_log
    await db.query(`
        CREATE TABLE IF NOT EXISTS remediation_audit_log (
            log_id ${pkDef},
            action TEXT NOT NULL,
            actor_id TEXT,
            occurrence_id INTEGER,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 9. Migrate legacy data from exposure_locations
    await migrateLegacyExposures();

    console.log('[Migration] All migrations completed successfully.');
}

/**
 * Safely copies old records from exposure_locations into the new relational model,
 * marking them with data_origin = 'legacy_unknown'.
 */
async function migrateLegacyExposures() {
    try {
        const check = await db.query(
            db.usePostgres
                ? "SELECT to_regclass('public.exposure_locations')"
                : "SELECT name FROM sqlite_master WHERE type='table' AND name='exposure_locations'"
        );
        if (!check.rows || check.rows.length === 0 || (db.usePostgres && !check.rows[0].to_regclass)) {
            return;
        }

        const legacyRows = await db.query('SELECT * FROM exposure_locations');
        if (!legacyRows.rows || legacyRows.rows.length === 0) return;

        // Check if already migrated
        const existingLegacy = await db.query("SELECT COUNT(*) as count FROM exposures WHERE data_origin = 'legacy_unknown'");
        const count = parseInt(existingLegacy.rows[0].count) || 0;
        if (count > 0) {
            return; // Already backfilled
        }

        console.log(`[Migration] Migrating ${legacyRows.rows.length} legacy exposure locations to new schema (fast transaction mode)...`);

        if (!db.usePostgres) {
            await db.query('BEGIN TRANSACTION');
        }

        // Cache email hashes to avoid redundant lookups
        const emailMap = new Map();
        const existingEmails = await db.query('SELECT id, email_hash FROM user_emails');
        for (const row of existingEmails.rows) {
            emailMap.set(row.email_hash, row.id);
        }

        for (const leg of legacyRows.rows) {
            const rawEmailOrHash = leg.email_hash || 'unknown@legacy.local';
            const emailHash = rawEmailOrHash.includes('@') ? hashEmailHMAC(rawEmailOrHash) : rawEmailOrHash;
            const emailMasked = rawEmailOrHash.includes('@') ? maskEmail(rawEmailOrHash) : 'u***@l***.local';

            let userEmailId = emailMap.get(emailHash);
            if (!userEmailId) {
                const ins = await db.query(
                    'INSERT OR IGNORE INTO user_emails (email_hash, email_masked) VALUES ($1, $2)',
                    [emailHash, emailMasked]
                );
                userEmailId = ins.lastID;
                if (!userEmailId) {
                    const found = await db.query('SELECT id FROM user_emails WHERE email_hash = $1', [emailHash]);
                    userEmailId = found.rows[0]?.id;
                }
                if (userEmailId) {
                    emailMap.set(emailHash, userEmailId);
                }
            }

            const isHn = (leg.source_type || '').includes('hackernews') || (leg.source_type || '').includes('hn');
            const source = isHn ? 'hn' : 'github';
            const lane = isHn ? 'C' : 'A';
            let occurrenceType = 'COMMIT_METADATA';
            if (isHn) occurrenceType = 'HN_ITEM';
            else if ((leg.source_type || '').includes('file')) occurrenceType = 'FILE_CONTENT';
            else if ((leg.source_type || '').includes('issue')) occurrenceType = 'ISSUE_COMMENT';

            const expIns = await db.query(
                `INSERT INTO exposures (user_email_id, source, data_origin, status, status_reason, lane)
                 VALUES ($1, $2, 'legacy_unknown', 'Detected', 'Migrated from legacy database', $3)`,
                [userEmailId || null, source, lane]
            );
            const exposureId = expIns.lastID;

            await db.query(
                `INSERT INTO occurrences (exposure_id, type, repo_full_name, file_path, html_url, permalink, evidence_masked, viewer_relation, detected_via)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'none', 'legacy_migration')`,
                [
                    exposureId,
                    occurrenceType,
                    leg.repo_name || null,
                    leg.file_path || null,
                    leg.source_url || null,
                    leg.source_url || null,
                    leg.source_context || '[legacy context]',
                ]
            );
        }

        if (!db.usePostgres) {
            await db.query('COMMIT');
        }

        console.log('[Migration] Legacy exposures successfully backfilled with data_origin="legacy_unknown".');
    } catch (err) {
        if (!db.usePostgres) {
            try { await db.query('ROLLBACK'); } catch (_) {}
        }
        console.error('[Migration] Warning during legacy migration:', err.message);
    }
}

module.exports = {
    runMigrations
};
