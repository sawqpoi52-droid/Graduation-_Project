const axios = require('axios');

const GITHUB_API_BASE = 'https://api.github.com';

// Sequential write queue to avoid GitHub secondary rate limits
let writeQueue = Promise.resolve();

function queueWriteOperation(fn) {
    const res = writeQueue.then(async () => {
        // Minimum delay between write calls: 800ms
        await new Promise(r => setTimeout(r, 800));
        return fn();
    });
    // Keep chain going even if one fails
    writeQueue = res.catch(() => {});
    return res;
}

/**
 * Creates an authorized GitHub API client.
 */
function createGithubClient(token) {
    const client = axios.create({
        baseURL: GITHUB_API_BASE,
        timeout: 15000,
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'SecureCheck-Remediation-Agent/2.0',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
    });

    /**
     * Executes request with rate-limit and backoff handling.
     */
    async function requestWithRetry(config, maxRetries = 2) {
        let attempt = 0;
        while (attempt <= maxRetries) {
            try {
                const response = await client(config);
                return response;
            } catch (err) {
                const status = err.response?.status;
                const retryAfter = err.response?.headers?.['retry-after'];

                // Handle primary / secondary rate limits (403 with rate limit message or 429)
                const isRateLimit = status === 429 || (status === 403 && (
                    err.response?.data?.message?.toLowerCase().includes('rate limit') ||
                    err.response?.data?.message?.toLowerCase().includes('secondary')
                ));

                if (isRateLimit && attempt < maxRetries) {
                    attempt++;
                    const waitTimeSec = retryAfter ? parseInt(retryAfter, 10) : (attempt * 3);
                    console.warn(`[GitHub Client] Rate limit hit. Backing off for ${waitTimeSec} seconds (attempt ${attempt}/${maxRetries})...`);
                    await new Promise(r => setTimeout(r, waitTimeSec * 1000));
                    continue;
                }

                throw err;
            }
        }
    }

    return {
        get: (url, config = {}) => requestWithRetry({ ...config, method: 'GET', url }),
        post: (url, data, config = {}) => queueWriteOperation(() => requestWithRetry({ ...config, method: 'POST', url, data })),
        put: (url, data, config = {}) => queueWriteOperation(() => requestWithRetry({ ...config, method: 'PUT', url, data })),
        patch: (url, data, config = {}) => queueWriteOperation(() => requestWithRetry({ ...config, method: 'PATCH', url, data })),
        delete: (url, config = {}) => queueWriteOperation(() => requestWithRetry({ ...config, method: 'DELETE', url }))
    };
}

module.exports = {
    createGithubClient,
    queueWriteOperation
};
