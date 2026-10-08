const cron = require('node-cron');
const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');

// OSINT Web Crawler Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Target: collect at least 1000 leaked emails
const TARGET_LEAKED_EMAILS = 10000;

// Multiple diverse search queries to maximize email discovery
const GITHUB_SEARCH_QUERIES = [
    'update', 'fix', 'merge', 'add', 'remove', 'refactor', 'deploy', 'release',
    'feature', 'bug', 'hotfix', 'patch', 'improve', 'clean', 'test',
    'build', 'config', 'docs', 'setup', 'init', 'migration', 'upgrade',
    'security', 'performance', 'optimize', 'style', 'lint', 'format',
    'chore', 'ci', 'readme', 'changelog', 'version', 'bump', 'revert',
    'api', 'database', 'server', 'client', 'frontend', 'backend',
    'auth', 'login', 'signup', 'register', 'user', 'account', 'profile',
    'data', 'model', 'schema', 'query', 'route', 'controller', 'service'
];

const REDDIT_SOURCES = [
    'https://www.reddit.com/r/cybersecurity/new.json?limit=100',
    'https://www.reddit.com/r/technology/new.json?limit=100',
    'https://www.reddit.com/r/netsec/new.json?limit=100',
    'https://www.reddit.com/r/programming/new.json?limit=100',
    'https://www.reddit.com/r/webdev/new.json?limit=100',
    'https://www.reddit.com/r/sysadmin/new.json?limit=100',
    'https://www.reddit.com/r/devops/new.json?limit=100'
];

// Regex for finding emails in text
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Emails to exclude (bots, noreply, etc.)
const EXCLUDED_PATTERNS = ['noreply', 'no-reply', 'github.com', 'users.noreply', 'localhost', 'example.com', 'test.com'];

/**
 * Check current leaked email count
 */
async function getLeakedCount() {
    const result = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
    return parseInt(result.rows[0].count) || 0;
}

/**
 * Fetch emails from a single GitHub search query
 */
async function fetchGitHubEmails(query, page = 1) {
    let rawText = '';
    try {
        const url = `https://api.github.com/search/commits?q=${encodeURIComponent(query)}+author-date:>2023-01-01&sort=author-date&order=desc&per_page=100&page=${page}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'SecureCheck-OSINT-Crawler/1.0',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.cloak-preview'
            },
            timeout: 15000
        });

        const items = response.data.items;
        if (items) {
            items.forEach(item => {
                if (item.commit) {
                    rawText += item.commit.message + ' ';
                    if (item.commit.author && item.commit.author.email) {
                        rawText += item.commit.author.email + ' ';
                    }
                    if (item.commit.committer && item.commit.committer.email) {
                        rawText += item.commit.committer.email + ' ';
                    }
                }
                // Also grab author info from the top-level
                if (item.author && item.author.login) {
                    rawText += item.author.login + ' ';
                }
            });
        }
    } catch (error) {
        // Silently handle rate limits
    }
    return rawText;
}

/**
 * Fetch emails from Reddit
 */
async function fetchRedditEmails(url) {
    let rawText = '';
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'SecureCheck-OSINT-Crawler/1.0' },
            timeout: 10000
        });
        const posts = response.data.data.children;
        posts.forEach(post => {
            rawText += post.data.title + ' ' + post.data.selftext + ' ';
            // Check comments URL for more data
            if (post.data.url) rawText += post.data.url + ' ';
            if (post.data.author) rawText += post.data.author + ' ';
        });
    } catch (error) {
        // Silently handle errors
    }
    return rawText;
}

/**
 * Filter out bot/invalid emails
 */
function filterEmails(emails) {
    return emails.filter(email => {
        const lower = email.toLowerCase();
        // Exclude bot/noreply emails
        if (EXCLUDED_PATTERNS.some(p => lower.includes(p))) return false;
        // Must have a valid domain with at least 2 chars TLD
        if (!/\.[a-z]{2,}$/.test(lower)) return false;
        // Must not be too short or too long
        if (lower.length < 6 || lower.length > 100) return false;
        return true;
    });
}

/**
 * Store emails in database - returns count of new entries
 */
async function storeEmails(emails) {
    let newCount = 0;
    const uniqueEmails = [...new Set(emails.map(e => e.toLowerCase().trim()))];
    
    for (const email of uniqueEmails) {
        // HASHING DISABLED FOR PRESENTATION - STORE PLAINTEXT EMAIL
        try {
            await db.query('INSERT INTO leaked_emails (email_hash) VALUES (?)', [email]);
            newCount++;
        } catch (error) {
            // Duplicate - ignore
        }
    }
    return newCount;
}

/**
 * Standard crawler cycle (used after reaching target)
 */
async function runCrawlerCycle() {
    console.log('====================================================');
    console.log('[OSINT Crawler] Starting Scheduled 24-Hour Cycle...');
    
    const currentCount = await getLeakedCount();
    console.log(`[OSINT Crawler] Current DB count: ${currentCount} / ${TARGET_LEAKED_EMAILS}`);
    
    let rawText = '';
    
    // Fetch from Reddit
    console.log('[OSINT Crawler] Fetching from Reddit...');
    for (const url of REDDIT_SOURCES.slice(0, 2)) {
        rawText += await fetchRedditEmails(url);
        await sleep(1000);
    }
    
    // Fetch from GitHub (2 random queries)
    const randomQueries = shuffleArray([...GITHUB_SEARCH_QUERIES]).slice(0, 3);
    for (const q of randomQueries) {
        console.log(`[OSINT Crawler] GitHub search: "${q}"...`);
        rawText += await fetchGitHubEmails(q);
        await sleep(2000); // Rate limit respect
    }
    
    // Extract and store
    const foundEmails = rawText.match(emailRegex);
    if (!foundEmails || foundEmails.length === 0) {
        console.log('[OSINT Crawler] No emails discovered in this cycle.');
        console.log('====================================================');
        return;
    }
    
    const filtered = filterEmails([...new Set(foundEmails)]);
    console.log(`[OSINT Crawler] Extracted ${filtered.length} unique valid emails.`);
    
    const newCount = await storeEmails(filtered);
    const totalNow = await getLeakedCount();
    console.log(`[OSINT Crawler] Cycle Complete. Added ${newCount} NEW. Total: ${totalNow}`);
    console.log('====================================================');
}

/**
 * INTENSIVE MODE: Runs continuously until we reach TARGET_LEAKED_EMAILS
 */
async function runIntensiveCrawler() {
    let currentCount = await getLeakedCount();
    
    if (currentCount >= TARGET_LEAKED_EMAILS) {
        console.log(`[OSINT Crawler] ✅ Target already reached! (${currentCount}/${TARGET_LEAKED_EMAILS})`);
        console.log('[OSINT Crawler] Switching to normal 24-hour schedule.');
        return;
    }
    
    console.log('╔══════════════════════════════════════════════════╗');
    console.log(`║  🔥 INTENSIVE CRAWL MODE ACTIVATED               ║`);
    console.log(`║  Target: ${TARGET_LEAKED_EMAILS} leaked emails                      ║`);
    console.log(`║  Current: ${currentCount} emails in database              ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    
    let cycleNumber = 0;
    const queryPool = shuffleArray([...GITHUB_SEARCH_QUERIES]);
    let queryIndex = 0;
    
    while (currentCount < TARGET_LEAKED_EMAILS) {
        cycleNumber++;
        console.log(`\n[INTENSIVE #${cycleNumber}] Starting... (${currentCount}/${TARGET_LEAKED_EMAILS})`);
        
        let rawText = '';
        
        // Each cycle: grab from 2 GitHub queries + 1 Reddit source
        for (let i = 0; i < 3; i++) {
            const query = queryPool[queryIndex % queryPool.length];
            queryIndex++;
            
            // Try multiple pages for each query
            for (let page = 1; page <= 3; page++) {
                rawText += await fetchGitHubEmails(query, page);
                await sleep(1500); // Respect rate limits
            }
        }
        
        // Also fetch from Reddit (rotate sources)
        const redditUrl = REDDIT_SOURCES[cycleNumber % REDDIT_SOURCES.length];
        rawText += await fetchRedditEmails(redditUrl);
        
        // Extract, filter, store
        const foundEmails = rawText.match(emailRegex);
        if (foundEmails && foundEmails.length > 0) {
            const filtered = filterEmails([...new Set(foundEmails)]);
            const newCount = await storeEmails(filtered);
            currentCount = await getLeakedCount();
            
            const progress = ((currentCount / TARGET_LEAKED_EMAILS) * 100).toFixed(1);
            console.log(`[INTENSIVE #${cycleNumber}] +${newCount} new | Total: ${currentCount}/${TARGET_LEAKED_EMAILS} (${progress}%)`);
        } else {
            console.log(`[INTENSIVE #${cycleNumber}] No emails found this cycle.`);
        }
        
        // Wait between cycles to avoid rate limits (10 seconds)
        if (currentCount < TARGET_LEAKED_EMAILS) {
            console.log(`[INTENSIVE] Waiting 10s before next cycle...`);
            await sleep(10000);
        }
    }
    
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log(`║  ✅ TARGET REACHED! ${currentCount} leaked emails collected  ║`);
    console.log('║  Switching to normal 24-hour schedule...         ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
}

/**
 * Utility functions
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Start the OSINT Crawler
 */
function startOSINTCrawler() {
    console.log('[OSINT Crawler] Initialized.');
    
    // Start intensive mode after 5 seconds
    setTimeout(async () => {
        await runIntensiveCrawler();
        
        // After intensive mode completes (or target already met), schedule normal 24h cycle
        cron.schedule('0 0 * * *', () => {
            runCrawlerCycle();
        });
        console.log('[OSINT Crawler] Normal 24-hour schedule active.');
    }, 5000);
}

module.exports = {
    startOSINTCrawler,
    runCrawlerCycle,
    runIntensiveCrawler
};
