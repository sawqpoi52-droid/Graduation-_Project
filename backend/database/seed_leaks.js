const db = require('./db');
const crypto = require('crypto');

async function seedLeaks() {
    try {
        console.log('[Seed] Starting database initialization...');
        
        // Ensure connection/tables exist
        await db.query(`
            CREATE TABLE IF NOT EXISTS leaked_emails (
                email_hash CHAR(64) PRIMARY KEY,
                discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS leaked_passwords (
                password_hash CHAR(40) PRIMARY KEY,
                exposure_count INTEGER DEFAULT 1
            )
        `);

        console.log('[Seed] Tables checked. Seeding OSINT data...');

        // Seed Emails
        const targetEmail = 'saigfc26@gmail.com';
        const targetHash = crypto.createHash('sha256').update(targetEmail.toLowerCase().trim()).digest('hex');

        // We will mock 10,000 emails, but since doing 10,000 inserts is slow, we'll just insert a few real ones
        // for demonstration, plus a batch of random ones.
        const emailsToSeed = [
            targetHash,
            crypto.createHash('sha256').update('admin@example.com').digest('hex'),
            crypto.createHash('sha256').update('test@test.com').digest('hex'),
        ];

        // Generate some fake hashes to simulate a large database
        for (let i = 0; i < 5000; i++) {
            emailsToSeed.push(crypto.createHash('sha256').update(`fake_user_${i}@mock.com`).digest('hex'));
        }

        let insertedEmails = 0;
        for (const hash of emailsToSeed) {
            try {
                // Ignore duplicates
                await db.query(`
                    INSERT INTO leaked_emails (email_hash) 
                    VALUES ($1) 
                    ON CONFLICT(email_hash) DO NOTHING
                `, [hash]);
                insertedEmails++;
            } catch (err) {
                // SQLite uses INSERT OR IGNORE, PostgreSQL uses ON CONFLICT DO NOTHING
                // Let's use standard insert and catch duplicate error to be engine agnostic
                try {
                     await db.query(`INSERT INTO leaked_emails (email_hash) VALUES ($1)`, [hash]);
                     insertedEmails++;
                } catch(dupErr) {
                     // ignore dup
                }
            }
        }
        console.log(`[Seed] Seeded ${insertedEmails} emails successfully. Target email included: ${targetEmail}`);

        // Seed Passwords (SHA-1)
        const passwordsToSeed = [
            { pass: '123456', count: 23597311 },
            { pass: 'password', count: 3611669 },
            { pass: '12345678', count: 1219602 },
            { pass: 'qwerty', count: 1042735 },
            { pass: '123456789', count: 981146 }
        ];

        let insertedPasswords = 0;
        for (const p of passwordsToSeed) {
            const hash = crypto.createHash('sha1').update(p.pass).digest('hex').toUpperCase();
            try {
                await db.query(`INSERT INTO leaked_passwords (password_hash, exposure_count) VALUES ($1, $2)`, [hash, p.count]);
                insertedPasswords++;
            } catch (err) {
                // ignore dup
            }
        }
        console.log(`[Seed] Seeded ${insertedPasswords} passwords successfully.`);

        console.log('[Seed] Database seed complete!');
    } catch (err) {
        console.error('[Seed] Error during seeding:', err);
    }
}

seedLeaks();
