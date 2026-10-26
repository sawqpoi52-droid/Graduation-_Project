const fs = require('fs');
const path = require('path');
const db = require('./database/db');
const { hashEmailHMAC } = require('./utils/emailSecurity');

async function resetDemo() {
    console.log('[Reset Demo] Setting up demo baseline for sawqpoi52@gmail.com...');

    // 1. Reset package.json to include exposed email on line 4
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const content = `{
    "name": "securecheck-project",
    "version": "1.0.0",
    "author": "sawqpoi52-droid <sawqpoi52@gmail.com>",
    "private": true,
    "scripts": {
        "start": "node backend/server.js",
        "build": "cd frontend && npm install && npm run build && cd ../backend && npm install",
        "postinstall": "cd backend && npm install && cd ../frontend && npm install"
    }
}
`;
    fs.writeFileSync(packageJsonPath, content, 'utf8');
    console.log('[Reset Demo] package.json restored with sawqpoi52@gmail.com on Line 4.');

    // 2. Reset database occurrences and exposures for sawqpoi52@gmail.com to 'Detected'
    const email = 'sawqpoi52@gmail.com';
    const emailHash = hashEmailHMAC(email);

    await db.query(`
        UPDATE exposures
        SET status = 'Detected', status_reason = 'EXPOSURE_DETECTED_SEEDED'
        WHERE user_email_id IN (
            SELECT id FROM user_emails WHERE email_hash = $1 OR email_hash = $2 OR email_hash = $3
        )
    `, [emailHash, email, require('crypto').createHash('sha256').update(email).digest('hex')]);

    console.log('[Reset Demo] Database exposure statuses reset to "Detected".');
    console.log('[Reset Demo] Ready for demonstration!');
    process.exit(0);
}

resetDemo().catch(err => {
    console.error('Reset failed:', err);
    process.exit(1);
});
