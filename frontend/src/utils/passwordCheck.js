import axios from 'axios';

/**
 * Hash a string using SHA-1 (Web Crypto API)
 * @param {string} message 
 * @returns {Promise<string>} Hex string of the hash (uppercase)
 */
async function sha1(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Check if a password has been exposed in a data breach using k-Anonymity.
 * Only the first 5 characters of the SHA-1 hash are sent to the API.
 * 
 * @param {string} password 
 * @returns {Promise<number>} The number of times the password has been exposed (0 if safe).
 */
export async function checkPassword(password) {
    if (!password) return 0;

    try {
        const hash = await sha1(password);
        const prefix = hash.substring(0, 5);
        const suffix = hash.substring(5);

        const response = await axios.get(`/api/check-password?hash=${hash}`);
        const text = response.data;

        // The API returns a list of suffixes and counts, e.g.:
        // 0018A45C4D1DEF81644B54AB7F969B88D65:1
        // ...

        const lines = text.split('\n');
        const match = lines.find(line => line.startsWith(suffix));

        if (match) {
            const [, count] = match.split(':');
            return parseInt(count, 10);
        }

        return 0;
    } catch (error) {
        console.error("Error checking password:", error);
        throw new Error("Failed to check password.");
    }
}
