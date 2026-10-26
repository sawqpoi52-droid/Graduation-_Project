const axios = require('axios');
const db = require('../database/db');
const { calculateLineNumber, maskEvidence, buildPermalink, hashEmailHMAC, maskEmail } = require('./emailSecurity');
const { classifyOccurrence } = require('../services/classifier');
const { createGithubClient } = require('./githubClient');

/**
 * Discovers exposures for a specific, cryptographically verified user email.
 * Strictly prevents free-form unverified scanning.
 * Verifies every candidate against real content before saving to DB.
 */
async function scanVerifiedEmail({ email, userEmailId, token, userId = null }) {
    if (!email || typeof email !== 'string') {
        throw new Error('Valid email required for discovery scan');
    }

    const normEmail = email.trim().toLowerCase();
    const client = createGithubClient(token);
    const discoveredOccurrences = [];

    console.log(`[Discovery] Initiating verified scan for: ${normEmail.replace(/^(.).*@/, '$1***@')}`);

    // Fetch user login to determine repo permissions and authorship
    let currentUserLogin = null;
    if (token) {
        try {
            const userRes = await client.get('/user');
            currentUserLogin = userRes.data?.login || null;
        } catch (_) {}
    }

    // 1. DISCOVERY: Search Commits (Author and Committer)
    try {
        const commitQueries = [
            `author-email:${normEmail}`,
            `committer-email:${normEmail}`
        ];

        for (const q of commitQueries) {
            try {
                const res = await client.get(`/search/commits?q=${encodeURIComponent(q)}&sort=author-date&order=desc&per_page=15`, {
                    headers: { 'Accept': 'application/vnd.github.cloak-preview+json' }
                });

                if (res.data?.items && Array.isArray(res.data.items)) {
                    for (const item of res.data.items) {
                        const repoFullName = item.repository?.full_name;
                        const sha = item.sha;
                        if (!repoFullName || !sha) continue;

                        // Double check candidate by fetching commit content
                        try {
                            const commitDetail = await client.get(`/repos/${repoFullName}/commits/${sha}`);
                            const authorEmail = commitDetail.data?.commit?.author?.email?.toLowerCase();
                            const committerEmail = commitDetail.data?.commit?.committer?.email?.toLowerCase();

                            if (authorEmail === normEmail || committerEmail === normEmail) {
                                const commitMsg = commitDetail.data?.commit?.message || '';
                                const permalink = `https://github.com/${repoFullName}/commit/${sha}`;

                                discoveredOccurrences.push({
                                    type: 'COMMIT_METADATA',
                                    repo_full_name: repoFullName,
                                    default_branch: item.repository?.default_branch || 'main',
                                    commit_sha: sha,
                                    file_path: null,
                                    line_number: null,
                                    comment_id: null,
                                    html_url: item.html_url || permalink,
                                    permalink,
                                    evidence_masked: maskEvidence(commitMsg.split('\n')[0].substring(0, 200), normEmail),
                                    detected_via: 'search/commits',
                                    itemAuthorLogin: commitDetail.data?.author?.login || commitDetail.data?.committer?.login || null
                                });
                            }
                        } catch (_) {
                            // Candidate fetch failed or inaccessible
                        }
                    }
                }
            } catch (err) {
                console.warn(`[Discovery] Search commits (${q}) note:`, err.message);
            }
        }
    } catch (e) {
        console.warn('[Discovery] Commit search error:', e.message);
    }

    // 2. DISCOVERY: Search Code (File Contents)
    try {
        const codeRes = await client.get(`/search/code?q="${encodeURIComponent(normEmail)}"&per_page=15`);
        if (codeRes.data?.items && Array.isArray(codeRes.data.items)) {
            for (const item of codeRes.data.items) {
                const repoFullName = item.repository?.full_name;
                const path = item.path;
                const sha = item.sha;
                if (!repoFullName || !path) continue;

                // Verify file content via Contents API & calculate literal line number
                try {
                    const contentRes = await client.get(`/repos/${repoFullName}/contents/${encodeURIComponent(path)}`);
                    if (contentRes.data?.content && contentRes.data?.encoding === 'base64') {
                        const rawText = Buffer.from(contentRes.data.content, 'base64').toString('utf8');
                        const line = calculateLineNumber(rawText, normEmail);

                        if (line > 0) {
                            const lines = rawText.split(/\r?\n/);
                            const matchedLineText = lines[line - 1] || '';
                            const permalink = buildPermalink(repoFullName, sha || 'main', path, line);

                            discoveredOccurrences.push({
                                type: 'FILE_CONTENT',
                                repo_full_name: repoFullName,
                                default_branch: item.repository?.default_branch || 'main',
                                commit_sha: sha || null,
                                file_path: path,
                                line_number: line,
                                comment_id: null,
                                html_url: item.html_url || permalink,
                                permalink,
                                evidence_masked: maskEvidence(matchedLineText.trim().substring(0, 250), normEmail),
                                detected_via: 'search/code',
                                itemAuthorLogin: null
                            });
                        }
                    }
                } catch (_) {
                    // Ignored if candidate doesn't match or cannot be fetched
                }
            }
        }
    } catch (e) {
        console.warn('[Discovery] Code search note:', e.message);
    }

    // 3. DISCOVERY: Search Comments (Issues & PRs)
    try {
        const issuesRes = await client.get(`/search/issues?q="${encodeURIComponent(normEmail)}" in:comments&per_page=15`);
        if (issuesRes.data?.items && Array.isArray(issuesRes.data.items)) {
            for (const item of issuesRes.data.items) {
                const repoFullName = item.repository_url ? item.repository_url.replace('https://api.github.com/repos/', '') : null;
                const issueNumber = item.number;
                if (!repoFullName || !issueNumber) continue;

                try {
                    const commentsRes = await client.get(`/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=50`);
                    if (Array.isArray(commentsRes.data)) {
                        for (const comment of commentsRes.data) {
                            const body = comment.body || '';
                            if (body.toLowerCase().includes(normEmail)) {
                                discoveredOccurrences.push({
                                    type: 'ISSUE_COMMENT',
                                    repo_full_name: repoFullName,
                                    default_branch: 'main',
                                    commit_sha: null,
                                    file_path: null,
                                    line_number: null,
                                    comment_id: String(comment.id),
                                    html_url: comment.html_url,
                                    permalink: comment.html_url,
                                    evidence_masked: maskEvidence(body.substring(0, 250), normEmail),
                                    detected_via: 'search/issues/comments',
                                    itemAuthorLogin: comment.user?.login || null
                                });
                            }
                        }
                    }
                } catch (_) {}
            }
        }
    } catch (e) {
        console.warn('[Discovery] Comments search note:', e.message);
    }

    // 4. DISCOVERY: Hacker News Algolia Search (Discovery only - Lane C)
    try {
        const hnRes = await axios.get(`https://hn.algolia.com/api/v1/search?query="${encodeURIComponent(normEmail)}"&hitsPerPage=15`, {
            timeout: 6000
        });

        if (hnRes.data?.hits && Array.isArray(hnRes.data.hits)) {
            for (const hit of hnRes.data.hits) {
                const rawHit = JSON.stringify(hit).toLowerCase();
                if (rawHit.includes(normEmail)) {
                    const permalink = `https://news.ycombinator.com/item?id=${hit.objectID}`;
                    discoveredOccurrences.push({
                        type: 'HN_ITEM',
                        repo_full_name: null,
                        default_branch: null,
                        commit_sha: null,
                        file_path: null,
                        line_number: null,
                        comment_id: String(hit.objectID),
                        html_url: permalink,
                        permalink,
                        evidence_masked: maskEvidence((hit.comment_text || hit.story_text || hit.title || '').substring(0, 250), normEmail),
                        detected_via: 'hn_algolia',
                        itemAuthorLogin: hit.author || null
                    });
                }
            }
        }
    } catch (e) {
        console.warn('[Discovery] Hacker News search note:', e.message);
    }

    // 5. Deduplicate and Save to Database
    let savedCount = 0;
    for (const occ of discoveredOccurrences) {
        // Check if repository permissions can be queried for classification
        let repoPermissions = {};
        if (occ.repo_full_name && token) {
            try {
                const repoInfo = await client.get(`/repos/${occ.repo_full_name}`);
                repoPermissions = repoInfo.data?.permissions || {};
            } catch (_) {}
        }

        // Compute viewer relation
        let viewerRelation = 'none';
        if (repoPermissions.admin) viewerRelation = 'owner';
        else if (repoPermissions.push) viewerRelation = 'writer';
        else if (currentUserLogin && occ.itemAuthorLogin && currentUserLogin.toLowerCase() === occ.itemAuthorLogin.toLowerCase()) {
            viewerRelation = 'comment_author';
        }

        const classification = classifyOccurrence({
            type: occ.type,
            repoFullName: occ.repo_full_name,
            viewerRelation,
            repoPermissions,
            currentUserLogin,
            itemAuthorLogin: occ.itemAuthorLogin
        });

        // 6. Insert Exposure
        const isHn = occ.type === 'HN_ITEM';
        const source = isHn ? 'hn' : 'github';
        
        // Avoid duplicate insertion for identical permalink
        const dupCheck = await db.query(
            'SELECT occurrence_id FROM occurrences WHERE permalink = $1',
            [occ.permalink]
        );

        if (!dupCheck.rows || dupCheck.rows.length === 0) {
            const expIns = await db.query(`
                INSERT INTO exposures (user_email_id, source, data_origin, status, status_reason, lane)
                VALUES ($1, $2, 'live', 'Detected', 'Verified live crawler discovery', $3)
            `, [userEmailId || null, source, classification.lane]);

            const exposureId = expIns.lastID || (await db.query('SELECT MAX(exposure_id) as id FROM exposures')).rows[0].id;

            await db.query(`
                INSERT INTO occurrences (
                    exposure_id, type, repo_full_name, default_branch, commit_sha,
                    file_path, line_number, comment_id, html_url, permalink,
                    evidence_masked, viewer_relation, detected_via
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                exposureId,
                occ.type,
                occ.repo_full_name,
                occ.default_branch,
                occ.commit_sha,
                occ.file_path,
                occ.line_number,
                occ.comment_id,
                occ.html_url,
                occ.permalink,
                occ.evidence_masked,
                viewerRelation,
                occ.detected_via
            ]);

            savedCount++;
        }
    }

    console.log(`[Discovery] Scan complete. Found: ${discoveredOccurrences.length} occurrences | New saved: ${savedCount}`);
    return {
        scannedEmail: normEmail,
        totalFound: discoveredOccurrences.length,
        newSaved: savedCount
    };
}

/**
 * Seeds controlled test data tagged explicitly with data_origin='seeded_test'.
 * Used for automated verification tests and demo evaluation.
 */
async function seedTestDataForEmail({ email, userEmailId, repoFullName = 'test-org/securecheck-test' }) {
    console.log(`[Discovery] Seeding controlled test data for: ${email}`);
    const normEmail = email.trim().toLowerCase();

    if (!userEmailId && email) {
        const emailHash = hashEmailHMAC(normEmail);
        const masked = maskEmail(normEmail);
        const existingEmail = await db.query('SELECT id FROM user_emails WHERE email_hash = $1', [emailHash]);
        if (existingEmail.rows && existingEmail.rows.length > 0) {
            userEmailId = existingEmail.rows[0].id;
        } else {
            const insEmail = await db.query(`
                INSERT INTO user_emails (user_id, email_hash, email_masked, verified_at)
                VALUES ('dev_developer', $1, $2, CURRENT_TIMESTAMP)
            `, [emailHash, masked]);
            userEmailId = insEmail.lastID || (await db.query('SELECT MAX(id) as id FROM user_emails')).rows[0].id;
        }
    }

    const realRepo = 'sawqpoi52-droid/Graduation-_Project';
    const realCommit = 'bc96d363d8c2d5cfb9a178e7d343a9816c8a4c08';

    const sampleRecords = [
        {
            type: 'FILE_CONTENT',
            repo: realRepo,
            file_path: 'package.json',
            line: 4,
            sha: realCommit,
            html_url: `https://github.com/${realRepo}/blob/main/package.json#L4`,
            permalink: `https://github.com/${realRepo}/blob/main/package.json#L4`,
            evidence_masked: `"author": "sawqpoi52-droid <${maskEmail(normEmail)}>"`,
            lane: 'A',
            viewer_relation: 'owner'
        },
        {
            type: 'COMMIT_METADATA',
            repo: realRepo,
            file_path: null,
            line: null,
            sha: realCommit,
            html_url: `https://github.com/${realRepo}/commit/${realCommit}`,
            permalink: `https://github.com/${realRepo}/commit/${realCommit}`,
            evidence_masked: `Commit author: sawqpoi52-droid <${maskEmail(normEmail)}>`,
            lane: 'A',
            viewer_relation: 'owner'
        },
        {
            type: 'ISSUE_COMMENT',
            repo: realRepo,
            file_path: null,
            line: null,
            sha: null,
            comment_id: '192837465',
            html_url: `https://github.com/${realRepo}/issues`,
            permalink: `https://github.com/${realRepo}/issues`,
            evidence_masked: `Comment on Issue #1: "You can contact me at ${maskEmail(normEmail)}"`,
            lane: 'A',
            viewer_relation: 'comment_author'
        },
        {
            type: 'FILE_CONTENT',
            repo: 'octocat/Hello-World',
            file_path: 'README',
            line: 1,
            sha: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
            html_url: 'https://github.com/octocat/Hello-World/blob/master/README#L1',
            permalink: 'https://github.com/octocat/Hello-World/blob/master/README#L1',
            evidence_masked: `Contact contributor: ${maskEmail(normEmail)}`,
            lane: 'B',
            viewer_relation: 'none'
        },
        {
            type: 'HN_ITEM',
            repo: null,
            file_path: null,
            line: null,
            sha: null,
            comment_id: '39120485',
            html_url: 'https://news.ycombinator.com/item?id=39120485',
            permalink: 'https://news.ycombinator.com/item?id=39120485',
            evidence_masked: `Discussion thread on security leaks: ${maskEmail(normEmail)}`,
            lane: 'C',
            viewer_relation: 'none'
        }
    ];

    for (const rec of sampleRecords) {
        const isHn = rec.type === 'HN_ITEM';
        const source = isHn ? 'hn' : 'github';
        const permalink = rec.permalink || (isHn
            ? `https://news.ycombinator.com/item?id=${rec.comment_id}`
            : (rec.file_path ? buildPermalink(rec.repo, rec.sha, rec.file_path, rec.line) : `https://github.com/${rec.repo}/commit/${rec.sha}`));
        const htmlUrl = rec.html_url || permalink;

        const expIns = await db.query(`
            INSERT INTO exposures (user_email_id, source, data_origin, status, status_reason, lane)
            VALUES ($1, $2, 'seeded_test', 'Detected', 'Controlled Seeded Test Data', $3)
        `, [userEmailId || null, source, rec.lane]);

        const exposureId = expIns.lastID || (await db.query('SELECT MAX(exposure_id) as id FROM exposures')).rows[0].id;

        await db.query(`
            INSERT INTO occurrences (
                exposure_id, type, repo_full_name, default_branch, commit_sha,
                file_path, line_number, comment_id, html_url, permalink,
                evidence_masked, viewer_relation, detected_via
            ) VALUES ($1, $2, $3, 'main', $4, $5, $6, $7, $8, $9, $10, $11, 'seeded_test')
        `, [
            exposureId,
            rec.type,
            rec.repo,
            rec.sha,
            rec.file_path,
            rec.line,
            rec.comment_id || null,
            htmlUrl,
            permalink,
            rec.evidence_masked,
            rec.viewer_relation
        ]);
    }

    console.log(`[Discovery] Seeded ${sampleRecords.length} controlled test occurrences with data_origin='seeded_test'.`);
}

// Backward-compatible stubs for server.js legacy endpoints
async function startOSINTCrawler() {
    console.log('[Crawler] Legacy OSINT crawler disabled. Use verified email scanning via /api/scan.');
}

async function runCrawlerCycle() {
    console.log('[Crawler] Legacy crawler cycle skipped. Use verified email scanning.');
    return { added: 0, before: 0, after: 0 };
}

async function runIntensiveCrawler() {
    console.log('[Crawler] Legacy intensive crawler skipped. Use verified email scanning.');
}

module.exports = {
    scanVerifiedEmail,
    seedTestDataForEmail,
    // Legacy stubs for backward compatibility with server.js
    startOSINTCrawler,
    runCrawlerCycle,
    runIntensiveCrawler
};
