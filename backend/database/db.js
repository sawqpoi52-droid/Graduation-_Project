const { Pool } = require('pg');
const dns = require('dns');
const { URL } = require('url');

const usePostgres = !!process.env.DATABASE_URL;
let pgPool;
let sqliteDb;

if (usePostgres) {
    console.log('[Database] Initializing PostgreSQL connection...');
    const dbUrl = process.env.DATABASE_URL;
    let poolConfig = {};
    try {
        if (dbUrl.startsWith('postgres') && dbUrl.includes('@')) {
            const parsed = new URL(dbUrl);
            poolConfig = {
                user: parsed.username,
                password: decodeURIComponent(parsed.password),
                host: parsed.hostname,
                port: parsed.port || 5432,
                database: parsed.pathname.substring(1).split('?')[0],
                ssl: {
                    rejectUnauthorized: false,
                    servername: parsed.hostname
                }
            };
            console.log('[Database] Config parsed successfully for host:', parsed.hostname);
        } else {
            poolConfig = {
                connectionString: dbUrl,
                ssl: { rejectUnauthorized: false }
            };
            console.log('[Database] Using raw connection string mode.');
        }
    } catch (e) {
        console.error('[Database] Connection string parse error:', e.message);
        poolConfig = { connectionString: dbUrl, ssl: { rejectUnauthorized: false } };
    }

    poolConfig.lookup = (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, (err, address, family) => {
            if (!err) {
                console.log(`[Database] IPv4 Force: ${hostname} -> ${address}`);
            }
            callback(err, address, family);
        });
    };

    poolConfig.connectionTimeoutMillis = 30000;
    poolConfig.idleTimeoutMillis = 30000;
    poolConfig.max = 10;

    pgPool = new Pool(poolConfig);

    pgPool.on('error', (err) => {
        console.error('[Database] PostgreSQL Pool unexpected error:', err.message);
    });
} else {
    console.log('[Database] Initializing SQLite connection...');
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'securecheck.sqlite');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('[Database] Failed to connect to SQLite:', err.message);
        } else {
            console.log('[Database] Connected to SQLite database at:', dbPath);
            sqliteDb.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
                if (pragmaErr) console.error('[Database] Failed to enable foreign keys:', pragmaErr.message);
                else console.log('[Database] Foreign keys enabled.');
            });
        }
    });
}

function query(text, params = []) {
    if (usePostgres) {
        return pgPool.query(text, params);
    } else {
        return new Promise((resolve, reject) => {
            let sqliteText = text;
            sqliteText = sqliteText.replace(/\$\d+/g, '?');
            sqliteText = sqliteText.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');

            const isSelect = sqliteText.trim().match(/^(SELECT|PRAGMA)/i);
            const hasReturning = sqliteText.toLowerCase().includes('returning');

            if (isSelect || hasReturning) {
                sqliteDb.all(sqliteText, params, (err, rows) => {
                    if (err) {
                        console.error('[Database SQLite Error]:', err.message, '\nQuery:', sqliteText);
                        reject(err);
                    } else {
                        if (rows && rows.length > 0) {
                            rows.forEach(row => {
                                for (const key in row) {
                                    if (key.toLowerCase() === 'count(*)') {
                                        row.count = row[key];
                                    }
                                }
                            });
                        }
                        resolve({ rows });
                    }
                });
            } else {
                sqliteDb.run(sqliteText, params, function (err) {
                    if (err) {
                        console.error('[Database SQLite Error]:', err.message, '\nQuery:', sqliteText);
                        reject(err);
                    } else {
                        resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
                    }
                });
            }
        });
    }
}

async function getClient() {
    if (usePostgres) {
        return await pgPool.connect();
    } else {
        // Mock getClient for SQLite (not fully used but to avoid crashes if called)
        return {
            query: async (text, params) => query(text, params),
            release: () => {}
        };
    }
}

module.exports = {
    query,
    getClient,
    pool: pgPool, // Only for PostgreSQL specific tasks, usually avoid using directly
    usePostgres
};
