const db = require('./db');
const crypto = require('crypto');

async function seedExposures() {
    const testEmail = 'saigfc26@gmail.com';
    const hash = crypto.createHash('sha256').update(testEmail.toLowerCase().trim()).digest('hex');

    const records = [
        {
            email_hash: testEmail,
            source_type: 'github_commit',
            source_url: 'https://github.com/torvalds/linux/commit/c03c1a14507dfaf8b856c2608f9ac216021fc222',
            source_context: 'Public contributor activity and commit author exposure',
            content_owner: 'torvalds',
            file_path: 'Makefile',
            repo_name: 'torvalds/linux',
            remediation_status: 'discovered'
        },
        {
            email_hash: testEmail,
            source_type: 'github_file',
            source_url: 'https://github.com/facebook/react/blob/main/packages/react-dom/src/client/ReactDOMRoot.js',
            source_context: 'Hardcoded contributor email in test configuration',
            content_owner: 'gaearon',
            file_path: 'packages/react-dom/src/client/ReactDOMRoot.js',
            repo_name: 'facebook/react',
            remediation_status: 'removal_requested'
        },
        {
            email_hash: testEmail,
            source_type: 'hackernews_comment',
            source_url: 'https://news.ycombinator.com/item?id=39120485',
            source_context: 'Discussion on security breach investigation & leaks',
            content_owner: 'dang',
            file_path: null,
            repo_name: null,
            remediation_status: 'discovered'
        }
    ];

    for (const r of records) {
        try {
            await db.query(
                'INSERT INTO exposure_locations (email_hash, source_type, source_url, source_context, content_owner, file_path, repo_name, remediation_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [r.email_hash, r.source_type, r.source_url, r.source_context, r.content_owner, r.file_path, r.repo_name, r.remediation_status]
            );
        } catch(e) {
            console.log('Insert note (raw):', e.message);
        }
        try {
            await db.query(
                'INSERT INTO exposure_locations (email_hash, source_type, source_url, source_context, content_owner, file_path, repo_name, remediation_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [hash, r.source_type, r.source_url, r.source_context, r.content_owner, r.file_path, r.repo_name, r.remediation_status]
            );
        } catch(e) {
            console.log('Insert note (hash):', e.message);
        }
    }
    console.log('[Seed Exposures] Seeded sample exposure records for:', testEmail);
}

seedExposures().then(() => process.exit(0)).catch(console.error);
