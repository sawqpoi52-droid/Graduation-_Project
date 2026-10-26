require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');

const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const db = require('./database/db');
const privacy = require('./utils/crypto');

let pdfProxy;
let nodemailer;
try {
    pdfProxy = require('./pdf-proxy');
} catch (e) {
    console.error('CRITICAL: pdf-proxy.js or pdfmake-rtl is NOT installed. PDF reports will not be generated.');
}

try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.error('CRITICAL: nodemailer is NOT installed. Emails will not be sent.');
}

let cron;
try {
    cron = require('node-cron');
} catch (e) {
    console.error('CRITICAL: node-cron is NOT installed. Scheduled reports will not work.');
}


function translateDataClasses(classes, lang) {
    if (lang !== 'ar') return classes.join(', ');
    const dict = {
        'Email addresses': 'عناوين البريد الإلكتروني',
        'Passwords': 'كلمات المرور',
        'Usernames': 'أسماء المستخدمين',
        'IP addresses': 'عنوان IP',
        'Phone numbers': 'أرقام الهواتف',
        'Names': 'الأسماء',
        'Dates of birth': 'تاريخ الميلاد',
        'Physical addresses': 'العنوان السكني',
        'Gender': 'الجنس',
        'Job titles': 'المسميات الوظيفية',
        'Social media profiles': 'حسابات التواصل الاجتماعي'
    };
    return classes.map(c => dict[c] || c).join('، ');
}

async function fetchBreaches(email) {
    const plainEmail = email.toLowerCase().trim();
    const emailHash = crypto.createHash('sha256').update(plainEmail).digest('hex');
    const result = await db.query('SELECT * FROM leaked_emails WHERE email_hash = $1 OR email_hash = $2', [plainEmail, emailHash]);
    if (result.rows && result.rows.length > 0) {
        return [{
            Name: "OSINT_Web_Crawler",
            Title: "OSINT Web Crawler Local Database",
            BreachDate: new Date(result.rows[0].discovered_at || new Date()).toISOString().split('T')[0],
            DataClasses: ["Email addresses"],
            IsSensitive: false
        }];
    }
    return [];
}

function getStatusLabel(risk, t) {
    return risk.level === 'red' ? t.danger : (risk.level === 'yellow' ? t.warning : t.safe);
}

function buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId, breachCount, exposures = [] }) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const align = lang === 'ar' ? 'right' : 'left';
    const helloText = lang === 'ar' ? 'مرحباً،' : 'Hello,';
    const borderColor = risk.color === 'red' ? '#ef4444' : (risk.color === 'yellow' ? '#f59e0b' : '#10b981');
    const countLine = breachCount != null
        ? `<p style="margin: 5px 0 0; color: #475569;">${lang === 'ar' ? `إجمالي التسريبات: ${breachCount}` : `Total Breaches: ${breachCount}`}</p>`
        : '';

    let exposuresHtml = '';
    if (exposures && exposures.length > 0) {
        const expItems = exposures.map(exp => {
            const sourceUrl = exp.source_url || '';
            const sourceLabel = exp.source_type?.includes('commit')
                ? (lang === 'ar' ? 'GitHub (سجل التضمينات Commit)' : 'GitHub (Commit History)')
                : exp.source_type?.includes('file')
                ? (lang === 'ar' ? 'GitHub (ملف برمجي)' : 'GitHub (Source File)')
                : exp.source_type?.includes('hackernews')
                ? (lang === 'ar' ? 'Hacker News (نقاش عام)' : 'Hacker News (Public Discussion)')
                : (exp.source_type || (lang === 'ar' ? 'مصدر عام' : 'Public Source'));

            const repoContext = exp.repo_name || exp.source_context || '';

            return `
                <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; margin-bottom: 12px; text-align: ${align};">
                    <div style="font-size: 14px; font-weight: bold; color: #0f172a; margin-bottom: 4px;">
                        📌 ${sourceLabel} ${repoContext ? `<span style="color: #64748b; font-size: 12px; font-weight: normal;">— ${repoContext}</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: #475569; margin-bottom: 8px;">
                        ${lang === 'ar' ? 'رابط الموضع الفعلي الذي يحتوي على التسريب:' : 'Direct link to the source containing the leak:'}
                    </div>
                    ${sourceUrl ? `
                    <div style="margin: 8px 0;">
                        <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-bottom: 6px;">
                            ${lang === 'ar' ? 'الانتقال إلى مصدر التسريب مباشرة ↗' : 'View Leak Source Directly ↗'}
                        </a>
                        ${(exp.source_type?.includes('commit') || sourceUrl.includes('/commit/')) ? `
                        <a href="${sourceUrl.endsWith('.patch') ? sourceUrl : sourceUrl + '.patch'}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #d97706; color: #ffffff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-bottom: 6px; margin-inline-start: 6px;">
                            ${lang === 'ar' ? 'رابط التسريب ↗' : 'Leak Link ↗'}
                        </a>
                        ` : ''}
                    </div>
                    <div style="font-size: 11px; color: #64748b; word-break: break-all; font-family: monospace; direction: ltr; text-align: left;">
                        ${sourceUrl}
                    </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        exposuresHtml = `
            <div style="margin: 25px 0; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                <h3 style="margin: 0 0 12px; color: #0f172a; font-size: 16px;">
                    ${lang === 'ar' ? '🔗 روابط المصادر التي تحتوي على التسريب الفعلي:' : '🔗 Direct Links to Detected Leak Sources:'}
                </h3>
                ${expItems}
                <p style="margin: 8px 0 0; font-size: 12px; color: #64748b;">
                    ${lang === 'ar' 
                        ? 'تنبيه: يقود هذا الرابط مباشرة إلى المصدر الحقيقي الذي تم رصد بريدك الإلكتروني فيه لتتمكن من مراجعته وإزالته.' 
                        : 'Notice: This link leads directly to the actual source where your email was detected.'}
                </p>
            </div>
        `;
    }

    return `
        <div dir="${dir}" style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; text-align: ${align};">
            <h2 style="color: #2563eb;">${t.reportSubject}</h2>
            <p>${helloText}</p>
            <p>${bodyText}</p>
            <div style="border-left: 4px solid ${borderColor}; padding: 15px; background: #f8fafc; margin: 20px 0;">
                <h3 style="margin: 0; color: #1e293b;">${t.overallStatus}: ${statusLabel}</h3>
                ${countLine}
            </div>
            ${exposuresHtml}
            <p style="color: #64748b; font-size: 0.8rem; border-top: 1px solid #eee; padding-top: 20px;">${t.userId}: ${anonymousId}</p>
        </div>
    `;
}
async function generateReportPDF(email, breaches, anonymousId, lang = 'en', exposures = []) {
    const t = getT(lang);
    const isAr = lang === 'ar';

    if (!pdfProxy) throw new Error('pdf-proxy is not initialized');

    const risk = analyzeRisk(breaches);
    const statusLabel = risk.level === 'red' ? t.danger : (risk.level === 'yellow' ? t.warning : t.safe);
    const statusColor = risk.color === 'red' ? '#e11d48' : (risk.color === 'yellow' ? '#d97706' : '#059669');

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 80],
        defaultStyle: {
            font: 'Cairo',
            alignment: isAr ? 'right' : 'left'
        },
        background: function (currentPage, pageSize) {
            return [
                {
                    canvas: [
                        {
                            type: 'rect',
                            x: 0,
                            y: 0,
                            w: pageSize.width,
                            h: 140,
                            color: '#1e293b'
                        }
                    ]
                }
            ];
        },
        content: [
            {
                text: 'SecureCheck',
                style: 'headerLogo',
                margin: [0, 40, 0, 0]
            },
            {
                text: t.reportTitle,
                style: 'headerSubtitle',
                margin: [0, 5, 0, 30]
            },
            {
                columns: [
                    {
                        stack: [
                            { text: `${t.userId}:`, style: 'infoLabel' },
                            { text: anonymousId, style: 'infoValue' },
                            { text: `${t.targetEmail}:`, style: 'infoLabel', margin: [0, 15, 0, 0] },
                            { text: email, style: 'infoValue' }
                        ],
                        width: '*'
                    }
                ],
                margin: [0, 20, 0, 30]
            },
            {
                stack: [
                    {
                        columns: [
                            {
                                text: statusLabel,
                                width: 100,
                                margin: [0, 5, 0, 5],
                                alignment: 'center',
                                fillColor: statusColor,
                                color: 'white',
                                bold: true
                            }
                        ],
                        margin: isAr ? [415, 0, 0, 0] : [0, 0, 0, 0]
                    },
                    {
                        text: t.overallStatus,
                        style: 'statusTitle',
                        margin: [0, 10, 0, 0],
                        alignment: 'center'
                    },
                    {
                        text: `${t.breachesFound}: ${breaches.length}`,
                        style: 'statusCount',
                        alignment: 'center'
                    }
                ],
                margin: [0, 0, 0, 30],
                color: '#1e293b'
            }
        ],
        footer: function (currentPage, pageCount) {
            return {
                stack: [
                    {
                        canvas: [
                            {
                                type: 'rect',
                                x: 0,
                                y: 0,
                                w: 595,
                                h: 32,
                                color: '#f8fafc'
                            }
                        ]
                    },
                    {
                        text: `${t.pdfFooter} | Page ${currentPage} of ${pageCount}`,
                        alignment: 'center',
                        margin: [0, -22, 0, 0],
                        style: 'footerStyle'
                    }
                ]
            };
        },
        styles: {
            headerLogo: {
                fontSize: 32,
                bold: true,
                color: '#3b82f6',
                alignment: 'center'
            },
            headerSubtitle: {
                fontSize: 14,
                color: '#94a3b8',
                alignment: 'center'
            },
            infoLabel: {
                fontSize: 10,
                color: '#475569'
            },
            infoValue: {
                fontSize: 11,
                color: '#1e293b',
                bold: true
            },
            statusTitle: {
                fontSize: 18,
                bold: true
            },
            statusCount: {
                fontSize: 13,
                color: '#64748b'
            },
            breachTitle: {
                fontSize: 14,
                bold: true,
                color: '#111827'
            },
            breachMeta: {
                fontSize: 10,
                color: '#ef4444'
            },
            breachLabel: {
                fontSize: 10,
                color: '#4b5563'
            },
            breachData: {
                fontSize: 9,
                color: '#1f2937'
            },
            footerStyle: {
                fontSize: 10,
                color: '#64748b'
            }
        }
    };

    if (breaches.length > 0) {
        docDefinition.content.push({
            text: t.breachDetails,
            fontSize: 20,
            bold: true,
            decoration: 'underline',
            margin: [0, 0, 0, 20]
        });

        breaches.forEach((breach, index) => {
            docDefinition.content.push({
                stack: [
                    {
                        columns: [
                            {
                                width: 15,
                                canvas: [{ type: 'rect', x: 0, y: 0, w: 15, h: 100, color: '#3b82f6' }]
                            },
                            {
                                stack: [
                                    { text: `${index + 1}. ${breach.Title}`, style: 'breachTitle' },
                                    { text: `${t.dateLabel}: ${breach.BreachDate}`, style: 'breachMeta', margin: [0, 5, 0, 0] },
                                    { text: `${t.dataLabel}:`, style: 'breachLabel', margin: [0, 10, 0, 0] },
                                    { text: translateDataClasses(breach.DataClasses, lang), style: 'breachData' }
                                ],
                                margin: [15, 0, 0, 0]
                            }
                        ]
                    }
                ],
                margin: [0, 0, 0, 20],
                unbreakable: true
            });
        });
    } else {
        docDefinition.content.push({
            text: t.noBreaches,
            fontSize: 16,
            color: '#059669',
            alignment: 'center',
            margin: [0, 20, 0, 0]
        });
    }

    if (exposures && exposures.length > 0) {
        docDefinition.content.push({
            text: isAr ? 'مصادر التسريب المكتشفة:' : 'Detected Leak Sources:',
            fontSize: 16,
            bold: true,
            margin: [0, 15, 0, 10]
        });

        exposures.forEach((exp, idx) => {
            const expSource = exp.source_type?.includes('github') ? 'GitHub' : (exp.source_type?.includes('hackernews') ? 'Hacker News' : 'Source');
            const items = [
                { text: `${idx + 1}. ${expSource} ${exp.repo_name ? `(${exp.repo_name})` : ''}`, bold: true, fontSize: 11, color: '#1e293b' }
            ];
            if (exp.source_url) {
                items.push({
                    text: `${isAr ? 'رابط المصدر' : 'Source Link'}: ${exp.source_url}`,
                    link: exp.source_url,
                    color: '#2563eb',
                    fontSize: 9,
                    margin: [0, 3, 0, 0]
                });
            }
            docDefinition.content.push({
                stack: items,
                margin: [0, 0, 0, 10]
            });
        });
    }

    const fonts = {
        Cairo: {
            normal: path.join(__dirname, 'node_modules', 'pdfmake-rtl', 'fonts', 'Cairo', 'Cairo-Regular.ttf'),
            bold: path.join(__dirname, 'node_modules', 'pdfmake-rtl', 'fonts', 'Cairo', 'Cairo-Bold.ttf'),
            italics: path.join(__dirname, 'node_modules', 'pdfmake-rtl', 'fonts', 'Cairo', 'Cairo-Regular.ttf'), // Falls back to regular
            bolditalics: path.join(__dirname, 'node_modules', 'pdfmake-rtl', 'fonts', 'Cairo', 'Cairo-Bold.ttf')
        }
    };

    return await pdfProxy.generatePDFBuffer(fonts, docDefinition);
}

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    'http://localhost:5173', 
    'http://localhost:5000', 
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5000',
    'https://securecheck-yn7d.onrender.com'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true
}));
app.use(express.json());

// 1. Security Headers (Helmet)
app.use(helmet({
    contentSecurityPolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Lightweight cookie parsing middleware
app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie;
    req.cookies = {};
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                req.cookies[parts[0].trim()] = decodeURIComponent((parts.slice(1).join('=') || '').trim());
            }
        });
    }
    next();
});

// Mount Remediation & OAuth Routes
const authRouter = require('./routes/auth');
const remediationRouter = require('./routes/remediation');
app.use('/api/auth', authRouter);
app.use('/api', remediationRouter);

// 1.1 Permissions Policy
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    next();
});

// 2. Global Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 1000, // Limit each IP per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use(globalLimiter);

// 3. Strict Rate Limiting for Security Checks & Subscriptions
const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 500, // Relaxed for smooth testing and demonstration
    message: { error: 'تم تجاوز الحد المسموح للفحص في هذه الساعة. يرجى الانتظار قليلاً.' }
});
app.use('/api/check', strictLimiter);
app.use('/api/check-password', strictLimiter);
app.use('/api/subscribe', strictLimiter);
app.use('/api/send-report-now', strictLimiter);

// 3.5 Password Check Proxy (k-Anonymity model: sends only 5-hex prefix)
app.get('/api/check-password', async (req, res) => {
    const { hash } = req.query;
    if (!hash || hash.length < 5) return res.status(400).json({ error: 'Valid hash prefix required' });

    const prefix = hash.substring(0, 5).toUpperCase();

    // 1. Primary: Global k-Anonymity Passwords Database (Free, no API key, >1 Billion real passwords)
    try {
        const response = await axios.get(`https://api.pwnedpasswords.com/range/${prefix}`, {
            headers: { 'User-Agent': 'SecureCheck-App' },
            timeout: 5000
        });
        return res.type('text/plain').send(response.data);
    } catch (apiError) {
        // 2. Offline Fallback: Local database
        try {
            const result = await db.query("SELECT password_hash, exposure_count FROM leaked_passwords WHERE password_hash LIKE $1", [prefix + '%']);
            let responseText = '';
            if (result.rows && result.rows.length > 0) {
                responseText = result.rows.map(row => {
                    const suffix = row.password_hash.substring(5).toUpperCase();
                    return `${suffix}:${row.exposure_count}`;
                }).join('\n');
            }
            return res.type('text/plain').send(responseText);
        } catch (dbError) {
            console.error('Password Check Error:', dbError.message);
            return res.status(500).json({ error: 'Failed to check password database' });
        }
    }
});

// 4. Serve Static Frontend Files (Production Only)
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_PATH)) {
    app.use(express.static(FRONTEND_PATH));
    console.log('[Init] Serving Frontend Static Files from:', FRONTEND_PATH);
}

// Nodemailer transporter configuration
let transporter;
if (nodemailer && process.env.EMAIL_HOST) {
    console.log('[Email] Configuring SMTP transporter...');
    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT) || 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: { rejectUnauthorized: false }
    });

    transporter.verify((error) => {
        if (error) console.warn('[Email] SMTP connection issue:', error.message);
        else console.log('[Email] SMTP transporter is ready. Sending from:', process.env.EMAIL_USER);
    });
} else {
    console.log('[Email] SMTP not configured. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASS in .env');
}

async function sendNotificationEmail(to, subject, htmlContent, attachments = [], lang = 'en') {
    const fromEmail = (process.env.EMAIL_USER || 'securecheck.reports@proton.me').trim();
    const fromName = 'SecureCheck';
    
    // Privacy-First Logging
    const logId = privacy.generateAnonymousId(to);

    console.log(`[Email Attempt] Targeting User: ${logId} | From: ${fromEmail} | Lang: ${lang}`);

    // 1. TRY NODEMAILER/SMTP (PRIMARY - Internal, no external dependency)
    if (nodemailer && transporter) {
        try {
            console.log(`[Email] Attempting SMTP (Primary - Internal)...`);
            await transporter.sendMail({
                from: `"${fromName}" <${fromEmail}>`,
                to: to,
                subject: subject,
                html: htmlContent,
                attachments: attachments
            });
            console.log(`[Email Success] SMTP delivered successfully from ${fromEmail}`);
            return { success: true };
        } catch (error) {
            console.warn(`[Email Warning (SMTP)] SMTP failed:`, error.message);
            return { success: false, error: error.message };
        }
    }

    return { success: false, error: 'Email transporter not configured. Check SMTP credentials in .env' };
}

// Debug endpoint to check SMTP
app.get('/api/subscriber-count', async (req, res) => {
    try {
        const result = await db.query('SELECT count(*) FROM subscriptions WHERE status = $1', ['active']);
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (err) {
        console.error('Count Error:', err);
        res.status(500).json({ count: 0 });
    }
});

/**
 * Privacy-First Check Endpoint
 * - Non-subscribers: NO EMAIL DATA IS STORED.
 * - Subscribers: Session and breach counts are logged for history.
 */
app.get('/api/check', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const clientIp = req.ip;
    const anonymizedIp = privacy.anonymizeIP(clientIp);
    const anonymousId = privacy.generateAnonymousId(email);

    try {
        const breaches = await fetchBreaches(email);

        const analysis = analyzeRisk(breaches);

        // 2. Privacy Logic: Log the scan session for analytics, but only link user data if they are a subscriber
        try {
            const userCheck = await db.query('SELECT user_id FROM users WHERE anonymous_id = $1', [anonymousId]);
            let userId = null;
            if (userCheck.rows.length > 0) {
                userId = userCheck.rows[0].user_id;
            }

            // Record scan session for BOTH guests and subscribers (user_id is null for guests)
            const session = await db.query(
                'INSERT INTO scan_sessions (user_id, scan_type, risk_score, breach_count, anonymized_ip) VALUES ($1, $2, $3, $4, $5) RETURNING session_id',
                [userId, 'email', analysis.level === 'red' ? 100 : (analysis.level === 'yellow' ? 50 : 0), breaches.length, anonymizedIp]
            );
            const sessionId = session.rows[0].session_id;

            // Store detailed historical breach data ONLY for subscribers
            if (userId !== null) {
                if (breaches.length > 0) {
                    for (const breach of breaches) {
                        await db.query(
                            'INSERT INTO breach_details (session_id, external_breach_id, title, breach_date, data_classes, is_sensitive) VALUES ($1, $2, $3, $4, $5, $6)',
                            [sessionId, breach.Name, breach.Title, breach.BreachDate, JSON.stringify(breach.DataClasses), breach.IsSensitive ? 1 : 0]
                        );
                    }
                }
                await db.query("UPDATE users SET last_checked = NOW(), last_breach_count = $1 WHERE user_id = $2", [breaches.length, userId]);
            }
            // IF GUEST: Only generic anonymous analytics are stored.
        } catch (dbErr) {
            console.warn('[Database] Optional logging failed, search results being returned anyway:', dbErr.message);
        }

        res.json({ safe: breaches.length === 0, breaches, analysis });

    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({ error: 'Failed to check breaches' });
    }
});

// Endpoint to get the total number of leaked emails
app.get('/api/leaks-count', async (req, res) => {
    try {
        const result = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        res.json({ count: parseInt(result.rows[0].count) || 0 });
    } catch (err) {
        console.error('Failed to get leaks count:', err);
        res.status(500).json({ count: 0 });
    }
});

// Crawler state tracking
let crawlerState = { running: false, startedAt: null, beforeCount: 0, currentCount: 0 };

// Manual trigger for the OSINT Crawler (waits for completion)
app.get('/api/trigger-crawler', async (req, res) => {
    if (crawlerState.running) {
        return res.json({ status: 'already_running', message: 'الزحف يعمل حالياً...' });
    }
    
    try {
        const { runCrawlerCycle } = require('./utils/crawler');
        
        // Get count BEFORE crawling
        const beforeResult = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        const beforeCount = parseInt(beforeResult.rows[0].count) || 0;
        
        crawlerState = { running: true, startedAt: Date.now(), beforeCount, currentCount: beforeCount };
        
        // Run the crawler and WAIT for it to finish
        await runCrawlerCycle();
        
        // Get count AFTER crawling
        const afterResult = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        const afterCount = parseInt(afterResult.rows[0].count) || 0;
        const newEmails = afterCount - beforeCount;
        
        crawlerState = { running: false, startedAt: null, beforeCount, currentCount: afterCount };
        
        res.json({
            status: 'completed',
            before: beforeCount,
            after: afterCount,
            new_emails: newEmails,
            message: `تم الانتهاء! تم اكتشاف ${newEmails} إيميل جديد.`
        });
    } catch (err) {
        crawlerState.running = false;
        console.error('Crawler trigger error:', err);
        res.status(500).json({ status: 'error', error: 'فشل تشغيل الزحف' });
    }
});

// Crawler live status (for polling)
app.get('/api/crawler-status', async (req, res) => {
    try {
        const countResult = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        const currentCount = parseInt(countResult.rows[0].count) || 0;
        res.json({
            running: crawlerState.running,
            before: crawlerState.beforeCount,
            current: currentCount,
            new_so_far: currentCount - crawlerState.beforeCount,
            elapsed: crawlerState.running ? Math.floor((Date.now() - crawlerState.startedAt) / 1000) : 0
        });
    } catch (err) {
        res.status(500).json({ running: false });
    }
});

// ============================= ADMIN DATABASE VIEWER API =============================

// Serve the admin page
app.get(['/admin', '/admin/'], (req, res) => {
    const adminPath = path.join(__dirname, '..', 'frontend', 'admin.html');
    if (fs.existsSync(adminPath)) {
        return res.sendFile(adminPath);
    }
    const distAdmin = path.join(__dirname, '..', 'frontend', 'dist', 'admin.html');
    return res.sendFile(distAdmin);
});

// Get all subscribers (decrypted for admin view)
app.get('/api/admin/subscribers', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.user_id, u.encrypted_email, u.email_iv, u.lang, u.is_active, u.last_breach_count, u.last_checked, u.created_at, 
                    s.frequency, s.status as sub_status
             FROM users u 
             LEFT JOIN subscriptions s ON u.user_id = s.user_id
             ORDER BY u.created_at DESC`
        );
        
        const subscribers = result.rows.map(row => {
            let email = row.encrypted_email || '';
            if (email.includes('@')) {
                email = email.split(':')[0];
            } else {
                try {
                    const [content, tag] = (row.encrypted_email || '').split(':');
                    email = privacy.decryptPII(content, row.email_iv, tag);
                } catch (e) {
                    email = row.encrypted_email || '';
                }
            }
            return {
                user_id: row.user_id,
                email: email,
                lang: row.lang,
                is_active: row.is_active,
                frequency: row.frequency || 'N/A',
                sub_status: row.sub_status || 'N/A',
                last_breach_count: row.last_breach_count || 0,
                last_checked: row.last_checked,
                created_at: row.created_at
            };
        });
        
        res.json({ subscribers });
    } catch (err) {
        console.error('Admin subscribers error:', err);
        res.status(500).json({ error: 'Failed to fetch subscribers' });
    }
});

// Get leaked emails (paginated)
app.get('/api/admin/leaked-emails', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        const countResult = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        const totalCount = parseInt(countResult.rows[0].count) || 0;
        
        const result = await db.query(
            `SELECT email_hash, discovered_at FROM leaked_emails ORDER BY discovered_at DESC LIMIT ${limit} OFFSET ${offset}`
        );
        
        res.json({
            leaked_emails: result.rows,
            total: totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit)
        });
    } catch (err) {
        console.error('Admin leaked emails error:', err);
        res.status(500).json({ error: 'Failed to fetch leaked emails' });
    }
});

// Get database stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
        const subsCount = await db.query('SELECT COUNT(*) as count FROM subscriptions WHERE status = $1', ['active']);
        const leaksCount = await db.query('SELECT COUNT(*) as count FROM leaked_emails');
        const passwordsCount = await db.query('SELECT COUNT(*) as count FROM leaked_passwords');
        const reportsCount = await db.query('SELECT COUNT(*) as count FROM reports');
        const scansCount = await db.query('SELECT COUNT(*) as count FROM scan_sessions');
        
        res.json({
            total_users: parseInt(usersCount.rows[0].count) || 0,
            active_subscribers: parseInt(subsCount.rows[0].count) || 0,
            leaked_emails: parseInt(leaksCount.rows[0].count) || 0,
            leaked_passwords: parseInt(passwordsCount.rows[0].count) || 0,
            total_reports: parseInt(reportsCount.rows[0].count) || 0,
            total_scans: parseInt(scansCount.rows[0].count) || 0
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

const TRANSLATIONS = {
    en: {
        welcomeSubject: 'Welcome to SecureCheck Notifications',
        reportSubject: 'SecureCheck: Your Real-Time Security Report',
        subSuccess: 'Success',
        unsubSuccess: 'Unsubscribed successfully',
        overallStatus: 'Overall Status',
        breachesFound: 'Breaches Found',
        reportTitle: 'SecureCheck Security Report',
        userId: 'User ID',
        targetEmail: 'Target Email',
        generatedOn: 'Generated on',
        breachDetails: 'Breach Details',
        noBreaches: 'Great news! No data breaches were found associated with this email address.',
        safe: 'SAFE',
        warning: 'WARNING',
        danger: 'DANGER',
        emailFooter: 'This is an automated security notification.',
        pdfFooter: 'SecureCheck © 2026',
        dateLabel: 'Date',
        dataLabel: 'Exposed Data',
        emailAlreadySubscribed: 'This email is already subscribed.',
        subUpdated: 'Subscription type updated successfully.',
        noSubscriptionFound: 'No subscription found for this account.',
        noNewBreachesInReport: 'Status update: No new data breaches detected since your last report.'
    },
    ar: {
        welcomeSubject: 'مرحباً بك في تنبيهات SecureCheck',
        reportSubject: 'SecureCheck: تقريرك الأمني المباشر',
        subSuccess: 'تم الاشتراك بنجاح',
        unsubSuccess: 'تم إلغاء الاشتراك بنجاح',
        overallStatus: 'الحالة العامة',
        breachesFound: 'التسريبات المكتشفة',
        reportTitle: 'تقرير SecureCheck الأمني',
        userId: 'معرف المستخدم',
        targetEmail: 'البريد المستهدف',
        generatedOn: 'تم الإنشاء في',
        breachDetails: 'تفاصيل التسريبات',
        noBreaches: 'أخبار رائعة! لم يتم العثور على أي تسريبات بيانات مرتبطة بهذا البريد الإلكتروني.',
        safe: 'آمن',
        warning: 'تحذير',
        danger: 'خطر',
        emailFooter: 'هذا تنبيه أمني آلي.',
        pdfFooter: 'SecureCheck © 2026',
        dateLabel: 'التاريخ',
        dataLabel: 'البيانات المكشوفة',
        emailAlreadySubscribed: 'هذا الايميل موجود مسبقا',
        subUpdated: 'تم تغيير نوع الاشتراك بنجاح.',
        noSubscriptionFound: 'لا يوجد اشتراك لهذا الحساب',
        noNewBreachesInReport: 'تحديث الحالة: لم يتم اكتشاف أي تسريبات بيانات جديدة منذ آخر تقرير لك.'
    }
};

function getT(lang) {
    return TRANSLATIONS[lang] || TRANSLATIONS.en;
}

// Subscription endpoint
app.post('/api/subscribe', async (req, res) => {
    const { email, frequency, lang = 'en' } = req.body;
    const t = getT(lang);
    if (!email || !frequency) return res.status(400).json({ error: 'Email/frequency required' });

    try {
        const anonymousId = privacy.generateAnonymousId(email);

        // 1. Check if user already exists
        const existingSub = await db.query(
            'SELECT s.frequency, s.status, u.user_id FROM subscriptions s JOIN users u ON s.user_id = u.user_id WHERE u.anonymous_id = $1',
            [anonymousId]
        );

        if (existingSub.rows.length > 0) {
            const current = existingSub.rows[0];
            const userId = current.user_id;

            if (current.status === 'active' && current.frequency === frequency) {
                return res.status(200).json({ message: t.emailAlreadySubscribed, id: anonymousId });
            }

            // Update existing subscription
            await db.query('UPDATE subscriptions SET frequency = $1, status = $2, lang = $3 WHERE user_id = $4', [frequency, 'active', lang, userId]);
            await db.query('UPDATE users SET lang = $1 WHERE user_id = $2', [lang, userId]);


            return res.json({ message: t.subUpdated, id: anonymousId });
        }

        // 2. New Subscriber
        const userId = crypto.randomUUID();
        const plainEmail = email.toLowerCase().trim();

        await db.query(
            `INSERT INTO users (user_id, anonymous_id, encrypted_email, email_iv, lang) VALUES ($1, $2, $3, $4, $5)`,
            [userId, anonymousId, plainEmail, '', lang]
        );

        await db.query(
            `INSERT INTO subscriptions (user_id, plan_id, frequency, status, lang) 
             VALUES ($1, (SELECT plan_id FROM subscription_plans WHERE name = 'Free' LIMIT 1), $2, 'active', $3)`,
            [userId, frequency, lang]
        );


        // Set Initial Baseline
        let initialCount = 0;
        try {
            const breaches = await fetchBreaches(email);
            initialCount = breaches.length;
        } catch (e) { }

        // Store subscriber in local file (doctor's requirement)
        try {
            fs.appendFileSync(path.join(__dirname, 'subscribers.txt'), email + '\n');
        } catch (err) {
            console.error('Failed to append to subscribers.txt:', err.message);
        }

        await db.query("UPDATE users SET last_breach_count = $1, last_checked = NOW() WHERE user_id = $2", [initialCount, userId]);

        // Audit Log
        await db.query(
            'INSERT INTO system_audit_log (action, actor_id, metadata) VALUES ($1, $2, $3)',
            ['subscription_created', userId, JSON.stringify({ frequency, lang })]
        );


        // Send Welcome Email (Removed baseline count as requested)
        const welcomeText = lang === 'ar' ? 'شكراً لاشتراكك في خدمة التنبيهات الأمنية. سنقوم بمراقبة بريدك الإلكتروني وإرسال تقارير دورية.' : "Thank you for subscribing to our security alerts. We will monitor your email and send periodic reports.";
        const emailHtml = `<div dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><h2>${t.welcomeSubject}</h2><p>${welcomeText}</p></div>`;
        await sendNotificationEmail(email, t.welcomeSubject, emailHtml, [], lang);

        res.json({ message: t.subSuccess, id: anonymousId });
    } catch (err) {
        console.error('Subscribe Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Unsubscription endpoint
app.post('/api/unsubscribe', async (req, res) => {
    const { email, lang = 'en' } = req.body;
    const t = getT(lang);
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const anonymousId = privacy.generateAnonymousId(email);
        const user = await db.query('SELECT user_id FROM users WHERE anonymous_id = $1', [anonymousId]);

        if (user.rows.length === 0) return res.status(400).json({ error: t.noSubscriptionFound });

        const userId = user.rows[0].user_id;

        // Privacy First: DELETE everything about this user
        // Due to CASCADE defined in initDatabase, this will also delete subscriptions, sessions, breach details, etc.
        await db.query('DELETE FROM users WHERE user_id = $1', [userId]);

        // Remove from local subscribers.txt
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, 'subscribers.txt');
            if (fs.existsSync(filePath)) {
                let emails = fs.readFileSync(filePath, 'utf8').split('\n');
                emails = emails.filter(e => e.trim() !== email.trim());
                fs.writeFileSync(filePath, emails.join('\n'));
            }
        } catch (err) {
            console.error('Failed to remove from subscribers.txt:', err.message);
        }

        console.log(`[Unsubscribe] All data for user ${userId} has been purged.`);
        res.json({ message: t.unsubSuccess });
    } catch (err) {
        console.error('Unsubscribe Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Immediate test report trigger
app.post('/api/send-report-now', async (req, res) => {
    const { email, lang = 'en' } = req.body;
    const t = getT(lang);
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const anonymousId = privacy.generateAnonymousId(email);
        const breaches = await fetchBreaches(email);
        const risk = analyzeRisk(breaches);

        const userSub = await db.query('SELECT user_id, last_breach_count FROM users WHERE anonymous_id = $1', [anonymousId]);
        if (userSub.rows.length > 0) {
            await db.query("UPDATE users SET last_breach_count = $1, last_checked = NOW() WHERE user_id = $2", [breaches.length, userSub.rows[0].user_id]);
        }

        // Fetch verified leak exposure locations for this email
        const plainEmail = email.toLowerCase().trim();
        const emailHash = crypto.createHash('sha256').update(plainEmail).digest('hex');
        let exposures = [];
        try {
            const expRes = await db.query(
                'SELECT * FROM exposure_locations WHERE email_hash = $1 OR email_hash = $2 ORDER BY exposure_id ASC LIMIT 5',
                [plainEmail, emailHash]
            );
            exposures = expRes.rows || [];
        } catch (expErr) {
            console.warn('[Report] Could not fetch exposure locations:', expErr.message);
        }

        let attachments = [];
        try {
            console.log(`[Report] Starting PDF generation for ${email}...`);
            const pdfBuffer = await generateReportPDF(email, breaches, anonymousId, lang, exposures);
            console.log(`[Report] PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
            attachments = [{ filename: `SecureCheck_Report_${new Date().toISOString().split('T')[0]}.pdf`, content: pdfBuffer }];
        } catch (pdfErr) {
            console.error('[PDF Error] Failed to generate PDF attachment:', pdfErr.message);
        }

        const statusLabel = getStatusLabel(risk, t);
        const bodyText = lang === 'ar'
            ? "هذا هو التقرير الأمني الخاص ببريدك الإلكتروني، مرفق معه ملف PDF شامل يحتوي على كافة تفاصيل التسريبات المكتشفة ومعلماتها بناءً على خياراتك."
            : "This is the security report for your email address. Attached is a comprehensive PDF file containing all details of detected leaks and their information based on your preferences.";
        const reportHtml = buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId, breachCount: breaches.length, exposures });

        const emailResult = await sendNotificationEmail(email, t.reportSubject, reportHtml, attachments, lang);

        // Store report metadata
        if (userSub.rows.length > 0) {
            await db.query(
                'INSERT INTO reports (user_id, format, lang, status) VALUES ($1, $2, $3, $4)',
                [userSub.rows[0].user_id, 'PDF', lang, emailResult.success ? 'sent' : 'failed']
            );
        }

        if (emailResult.success) {
            res.json({ message: lang === 'ar' ? 'تم إرسال التقرير لبريدك.' : 'Success! Report sent to your email.' });
        } else if (emailResult.mode === 'fallback') {
            res.status(200).json({
                message: 'Simulation successful, but NO EMAIL was sent because dependencies are missing.',
                details: 'Please run: npm install nodemailer pdfkit'
            });
        } else {
            res.status(500).json({
                error: 'Failed to send email',
                details: emailResult.error
            });
        }
    } catch (err) {
        console.error('Test Report Error:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

const FINANCIAL_KEYWORDS = ['bank', 'payment', 'credit card', 'finance', 'money', 'billing', 'purchase'];

function analyzeRisk(breaches) {
    if (!breaches || breaches.length === 0) return { level: 'safe', color: 'green' };
    return { level: 'red', hasFinancial: false, hasRecent: true, color: 'red' };
}

// --- Scheduled Reports Logic ---
async function runScheduledReports(frequency) {
    try {
        const result = await db.query(
            `SELECT u.user_id, u.encrypted_email, u.email_iv, u.anonymous_id, u.lang 
             FROM users u
             JOIN subscriptions s ON u.user_id = s.user_id
             WHERE s.frequency = $1 AND s.status = 'active'`,
            [frequency]
        );

        const relevantSubscribers = result.rows;

        if (relevantSubscribers.length === 0) return;

        console.log(`\n[Cron ${frequency}] Sending scheduled reports to ${relevantSubscribers.length} users...`);

        for (const sub of relevantSubscribers) {
            try {
                // Add a heavy 4000ms delay AT THE START of the loop to severely throttle requests globally across all users
                await new Promise(resolve => setTimeout(resolve, 4000));
                
                // Decrypt email for sending
                const [content, tag] = sub.encrypted_email.split(':');
                const rawEmail = privacy.decryptPII(content, sub.email_iv, tag);

                await sendReportForUser(rawEmail, sub.lang, sub.anonymous_id, sub.user_id);
            } catch (err) {
                console.error(`Failed to send ${frequency} report to user ${sub.user_id}:`, err.message);
            }
        }
    } catch (err) {
        console.error(`Scheduled Reports Error (${frequency}):`, err.message);
    }
}

async function sendReportForUser(email, lang, anonymousId, userId) {
    const t = getT(lang);
    const breaches = await fetchBreaches(email, { retry: true });
    const risk = analyzeRisk(breaches);

    const userRes = await db.query('SELECT last_breach_count FROM users WHERE user_id = $1', [userId]);
    const lastCount = userRes.rows[0].last_breach_count || 0;
    const isNewBreach = breaches.length > lastCount;

    await db.query("UPDATE users SET last_checked = NOW(), last_breach_count = $1 WHERE user_id = $2", [breaches.length, userId]);

    let bodyText = "";
    let attachments = [];

    const plainEmail = email.toLowerCase().trim();
    const emailHash = crypto.createHash('sha256').update(plainEmail).digest('hex');
    let exposures = [];
    try {
        const expRes = await db.query(
            'SELECT * FROM exposure_locations WHERE email_hash = $1 OR email_hash = $2 ORDER BY exposure_id ASC LIMIT 5',
            [plainEmail, emailHash]
        );
        exposures = expRes.rows || [];
    } catch (expErr) {
        console.warn('[Scheduled Report] Could not fetch exposure locations:', expErr.message);
    }

    if (isNewBreach) {
        bodyText = lang === 'ar'
            ? `تنبيه أمني: لقد تم رصد تسريبات جديدة لبياناتك! زاد عدد التسريبات من ${lastCount} إلى ${breaches.length}. تجد مرفقاً تقريراً كاملاً بالـ PDF.`
            : `Security Alert: New breaches detected! Your leak count increased from ${lastCount} to ${breaches.length}. A full PDF report is attached for details.`;

        const pdfBuffer = await generateReportPDF(email, breaches, anonymousId, lang, exposures);
        attachments.push({ filename: `SecureCheck_Alert_${new Date().toISOString().split('T')[0]}.pdf`, content: pdfBuffer });
    } else {
        bodyText = lang === 'ar'
            ? `تحديث الحالة: لم يتم رصد أي تسريبات جديدة لبريدك الإلكتروني منذ آخر تقرير. عدد التسريبات المكتشفة حالياً هو ${breaches.length}.`
            : `Status Update: No new data breaches detected since your last report. Your total leak count remains at ${breaches.length}.`;
    }

    const statusLabel = getStatusLabel(risk, t);
    const reportHtml = buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId, exposures });

    const emailResult = await sendNotificationEmail(email, t.reportSubject, reportHtml, attachments, lang);

    await db.query(
        'INSERT INTO reports (user_id, format, lang, status) VALUES ($1, $2, $3, $4)',
        [userId, attachments.length > 0 ? 'PDF' : 'HTML', lang, emailResult.success ? 'sent' : 'failed']
    );
}

// --- External Webhook for Scheduled Reports (Render Sleep Workaround) ---
app.post('/api/trigger-reports', async (req, res) => {
    // We expect a secret token in the Headers or Body to prevent unauthorized access
    const clientToken = req.headers['x-cron-token'] || req.body.token;
    const serverToken = process.env.CRON_SECRET_TOKEN || 'securecheck_super_secret_token_123';

    if (clientToken !== serverToken) {
        console.warn(`[Cron Webhook] Unauthorized attempt blocked. Invalid token.`);
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const frequency = req.body.frequency || 'daily';
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
        return res.status(400).json({ error: 'Invalid frequency' });
    }

    console.log(`[Cron Webhook] Authorized request received to trigger ${frequency} reports.`);
    
    // Start in background to not timeout the webhook request
    runScheduledReports(frequency).catch(err => console.error('Background Report Error:', err));

    res.status(200).json({ message: `Triggered ${frequency} reports successfully.` });
});

// 1. Internal Scheduled Reports Logic
if (cron && process.env.USE_INTERNAL_CRON === 'true') {
    const cronOptions = { timezone: "Asia/Riyadh" };

    cron.schedule('59 23 * * *', () => runScheduledReports('daily'), cronOptions);

    // 2. Weekly Report: 23:59 every Thursday (Thursday = 4)
    cron.schedule('59 23 * * 4', () => runScheduledReports('weekly'), cronOptions);

    // 3. Monthly Report: 07:00 on the 1st of every month
    cron.schedule('0 7 1 * *', () => runScheduledReports('monthly'), cronOptions);

    console.log(` [Scheduler] Internal Jobs engaged: Daily (23:59), Weekly (Thu 23:59), Monthly (M1 07:00) [Timezone: Asia/Riyadh]`);
} else {
    console.log(` [Scheduler] Internal Cron disabled. Waiting for External Webhook on /api/trigger-reports`);
}

// --- Database Auto-Initialize (PostgreSQL Optimized) ---
async function initDatabase() {
    try {
        console.log('[Init] Checking PostgreSQL database structure...');

        // 1. Plans
        await db.query(`
            CREATE TABLE IF NOT EXISTS subscription_plans (
                plan_id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                price_cents INTEGER NOT NULL DEFAULT 0,
                check_limit_monthly INTEGER NOT NULL,
                features TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Users
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY, 
                anonymous_id TEXT UNIQUE NOT NULL,
                encrypted_email TEXT NOT NULL,
                email_iv TEXT NOT NULL,
                lang TEXT DEFAULT 'en',
                is_active INTEGER DEFAULT 1,
                last_breach_count INTEGER DEFAULT 0,
                last_checked TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. Subscriptions
        await db.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                subscription_id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                plan_id INTEGER REFERENCES subscription_plans(plan_id),
                frequency TEXT DEFAULT 'daily',
                status TEXT DEFAULT 'active',
                lang TEXT DEFAULT 'en',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            )
        `);

        // 4. Scan Sessions (History)
        await db.query(`
            CREATE TABLE IF NOT EXISTS scan_sessions (
                session_id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
                scan_type TEXT,
                risk_score INTEGER,
                breach_count INTEGER,
                anonymized_ip TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 5. Breach Details
        await db.query(`
            CREATE TABLE IF NOT EXISTS breach_details (
                breach_id SERIAL PRIMARY KEY,
                session_id INTEGER REFERENCES scan_sessions(session_id) ON DELETE CASCADE,
                external_breach_id TEXT,
                title TEXT,
                breach_date TEXT,
                data_classes TEXT,
                is_sensitive INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 6. Reports History
        await db.query(`
            CREATE TABLE IF NOT EXISTS reports (
                report_id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
                format TEXT,
                lang TEXT,
                status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 7. Audit Log
        await db.query(`
            CREATE TABLE IF NOT EXISTS system_audit_log (
                log_id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                actor_id TEXT,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 8. Leaked Emails (OSINT Local DB)
        await db.query(`
            CREATE TABLE IF NOT EXISTS leaked_emails (
                email_hash CHAR(64) PRIMARY KEY,
                discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 9. Leaked Passwords (Local Dictionary)
        await db.query(`
            CREATE TABLE IF NOT EXISTS leaked_passwords (
                password_hash CHAR(40) PRIMARY KEY,
                exposure_count INTEGER DEFAULT 1
            )
        `);

        // 10. Exposure Locations (Exposure Removal Assistant)
        await db.query(`
            CREATE TABLE IF NOT EXISTS exposure_locations (
                exposure_id SERIAL PRIMARY KEY,
                email_hash CHAR(64) NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT,
                source_context TEXT,
                content_owner TEXT,
                file_path TEXT,
                repo_name TEXT,
                remediation_status TEXT DEFAULT 'discovered',
                remediation_notes TEXT,
                last_verified_at TIMESTAMP,
                discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(email_hash, source_type, source_url)
            )
        `);

        // Seed with Free Plan if empty
        const plans = await db.query('SELECT count(*) as count FROM subscription_plans');
        if (parseInt(plans.rows[0].count) === 0) {
            await db.query(`INSERT INTO subscription_plans (name, price_cents, check_limit_monthly) VALUES ('Free', 0, 999999)`);
            console.log('[Init] Seeded "Free" subscription plan with Unlimited limits.');
        }

        const { runMigrations } = require('./database/migration');
        await runMigrations();
        console.log('[Init] PostgreSQL Database ready.');
    } catch (err) {
        console.error('[Init] PostgreSQL initialization failed:', err.message);
    }
}


// ============================= EXPOSURE REMOVAL ASSISTANT (Hidden Feature) =============================
const EXPOSURE_ASSISTANT_ENABLED = process.env.ENABLE_EXPOSURE_ASSISTANT !== 'false';

function exposureGuard(req, res, next) {
    if (!EXPOSURE_ASSISTANT_ENABLED) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
}

// 5. Feature Flags (public endpoint so frontend knows what is enabled)
app.get('/api/feature-flags', (req, res) => {
    res.json({ exposureAssistant: EXPOSURE_ASSISTANT_ENABLED });
});

// 1. Get exposure locations for an email
app.get('/api/exposures', exposureGuard, async (req, res) => {
    try {
        const email = req.query.email;
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email query parameter is required' });
        }

        const plainEmail = email.toLowerCase().trim();
        const emailHash = crypto.createHash('sha256').update(plainEmail).digest('hex');

        const result = await db.query(
            'SELECT * FROM exposure_locations WHERE email_hash = $1 OR email_hash = $2 ORDER BY discovered_at DESC',
            [plainEmail, emailHash]
        );

        res.json({ exposures: result.rows || [] });
    } catch (err) {
        console.error('[Exposure Assistant] Error fetching exposures:', err.message);
        res.status(500).json({ error: 'Failed to retrieve exposures' });
    }
});

// 2. Update exposure remediation status and notes
app.post('/api/exposures/:exposureId/status', exposureGuard, async (req, res) => {
    try {
        const { exposureId } = req.params;
        const { status, notes } = req.body;

        const validStatuses = [
            'discovered',
            'removal_requested',
            'removal_in_progress',
            'removed',
            'verified_removed',
            'cannot_remove'
        ];

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const result = await db.query(
            'UPDATE exposure_locations SET remediation_status = $1, remediation_notes = COALESCE($2, remediation_notes) WHERE exposure_id = $3 RETURNING *',
            [status, notes !== undefined ? notes : null, exposureId]
        );

        if (!result.rows || result.rows.length === 0) {
            // In case RETURNING was not returned or id not found, check existing
            const check = await db.query('SELECT * FROM exposure_locations WHERE exposure_id = $1', [exposureId]);
            if (!check.rows || check.rows.length === 0) {
                return res.status(404).json({ error: 'Exposure not found' });
            }
            return res.json({ success: true, exposure: check.rows[0] });
        }

        res.json({ success: true, exposure: result.rows[0] });
    } catch (err) {
        console.error('[Exposure Assistant] Error updating status:', err.message);
        res.status(500).json({ error: 'Failed to update exposure status' });
    }
});

// 3. Verify exposure URL status (REAL live verification - never trusts user input)
app.post('/api/exposures/:exposureId/verify', exposureGuard, async (req, res) => {
    try {
        const { exposureId } = req.params;
        const result = await db.query('SELECT * FROM exposure_locations WHERE exposure_id = $1', [exposureId]);

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ error: 'Exposure not found' });
        }

        const exposure = result.rows[0];
        const sourceUrl = exposure.source_url;
        const sourceType = exposure.source_type || '';

        let verifiedRemoved = false;
        let httpStatus = null;
        let checkReason = '';
        let message = '';

        if (sourceUrl) {
            try {
                let targetUrl = sourceUrl;

                // For Hacker News, check via public Algolia items API to avoid Cloudflare 419 block
                if (sourceType.includes('hackernews') && sourceUrl.includes('id=')) {
                    const hnIdMatch = sourceUrl.match(/id=(\d+)/);
                    if (hnIdMatch && hnIdMatch[1]) {
                        targetUrl = `https://hn.algolia.com/api/v1/items/${hnIdMatch[1]}`;
                    }
                }

                const response = await axios.get(targetUrl, {
                    timeout: 8000,
                    maxRedirects: 5,
                    validateStatus: () => true,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                httpStatus = response.status;

                // REAL INDEPENDENT CHECK:
                // 1. If 404 Not Found or 410 Gone: The content is permanently deleted from source!
                if (httpStatus === 404 || httpStatus === 410) {
                    verifiedRemoved = true;
                    checkReason = 'url_deleted';
                    message = `تم التحقق بنجاح: تم فحص الرابط مباشرة على الخادم وتأكيد حذفه نهائياً (كود الاستجابة: ${httpStatus} Not Found).`;
                } 
                // 2. If 200 OK: The content is STILL live and accessible!
                else if (httpStatus === 200 || httpStatus === 301 || httpStatus === 302) {
                    verifiedRemoved = false;
                    checkReason = 'content_still_online';
                    message = `تنبيه: تم فحص الرابط مباشرة على الخادم وتبيّن أن المحتوى لا يزال متاحاً وقابلاً للوصول علناً (كود الاستجابة: ${httpStatus} OK). لم يتم حذفه من المصدر بعد!`;
                }
                // 3. If 403 Forbidden or 401 Unauthorized: The repository/page was made private!
                else if (httpStatus === 403 || httpStatus === 401) {
                    verifiedRemoved = true;
                    checkReason = 'made_private';
                    message = `تم التحقق: تم تغيير صلاحيات الرابط وأصبح خاصاً وغير متاح للعامة (كود الاستجابة: ${httpStatus}).`;
                }
                // 4. Any other status
                else {
                    verifiedRemoved = false;
                    checkReason = 'unknown_status';
                    message = `حالة المصدر غير مؤكدة (كود الاستجابة: ${httpStatus}).`;
                }
            } catch (netErr) {
                if (netErr.code === 'ENOTFOUND' || netErr.code === 'ECONNREFUSED') {
                    verifiedRemoved = true;
                    httpStatus = 404;
                    checkReason = 'domain_unreachable';
                    message = 'تم التحقق: خادم المصدر لم يعد متاحاً أو تم حذفه بالكامل.';
                } else {
                    verifiedRemoved = false;
                    message = `تعذر الوصول للمصدر للتحقق: ${netErr.message}`;
                }
            }
        } else {
            verifiedRemoved = false;
            message = 'لا يوجد رابط مصدر مسجل لهذا الموضع.';
        }

        const now = new Date();
        
        // CRITICAL: NEVER trust the user's manual dropdown status!
        // The remediation status in DB must strictly reflect the REAL verification result:
        let newStatus;
        if (verifiedRemoved) {
            newStatus = 'verified_removed';
        } else {
            // If the user falsely selected 'verified_removed' or 'removed', correct it back to 'removal_in_progress'
            if (exposure.remediation_status === 'verified_removed' || exposure.remediation_status === 'removed') {
                newStatus = 'removal_in_progress';
            } else {
                newStatus = exposure.remediation_status;
            }
        }

        await db.query(
            'UPDATE exposure_locations SET remediation_status = $1, last_verified_at = $2 WHERE exposure_id = $3',
            [newStatus, now, exposureId]
        );

        const updated = await db.query('SELECT * FROM exposure_locations WHERE exposure_id = $1', [exposureId]);

        res.json({
            success: true,
            verifiedRemoved,
            httpStatus,
            checkReason,
            message,
            exposure: updated.rows[0]
        });
    } catch (err) {
        console.error('[Exposure Assistant] Error verifying exposure:', err.message);
        res.status(500).json({ error: 'Failed to verify exposure' });
    }
});

// 4. Removal instructions guidance (Bilingual: ar & en)
app.get('/api/exposure-instructions', exposureGuard, (req, res) => {
    const { source_type, lang = 'en' } = req.query;
    const isAr = lang === 'ar';

    const guidanceCatalog = {
        github_commit: {
            title: isAr ? 'إزالة البريد الإلكتروني من سجل الالتزامات (Git Commits)' : 'Remove Email from Git Commit History',
            owner_instructions: {
                title: isAr ? 'إذا كنت أنت صاحب المستودع (أو تملك صلاحية التعديل عليه)' : 'If You Own the Repository (or have write access)',
                steps: isAr ? [
                    'استنسخ المستودع محلياً على جهازك بواسطة أمر git clone.',
                    'استخدم أداة git-filter-repo الرسمية لتنقيح تاريخ Git بالكامل واستبدال بريدك الإلكتروني ببريد بديل أو عنوان noreply التابع لـ GitHub عبر تنفيذ الأمر التالي:',
                    'قم برفع التعديلات بالقوة لتحديث كافة الفروع والوسوم في المستودع البعيد:',
                    'تواصل مع الدعم الفني لـ GitHub لمسح الذاكرة المؤقتة للتضمينات (Cached Commits) وأرقام الـ SHA المعزولة لضمان حذفها نهائياً من خوادم GitHub.',
                    'قم بتفعيل خيار "Keep my email addresses private" وخيار "Block command line pushes that expose my email" من إعدادات حسابك على GitHub لمنع تكرار التسريب مستقبلاً.'
                ] : [
                    'Clone a fresh copy of the repository to your local machine using git clone.',
                    'Use the official git-filter-repo tool to rewrite Git history and replace your exposed email with a noreply address:',
                    'Force push the rewritten branches and tags to the remote repository:',
                    'Contact GitHub Support to purge unreachable cached commit objects and commit SHAs.',
                    'Enable "Keep my email addresses private" and "Block command line pushes that expose my email" in GitHub Settings.'
                ],
                commands: [
                    'git filter-repo --email-callback "return email.replace(b\'YOUR_EMAIL\', b\'noreply@users.noreply.github.com\')"',
                    'git push origin --force --all && git push origin --force --tags'
                ]
            },
            third_party_instructions: {
                title: isAr ? 'إذا كان المستودع مملوكاً لشخص آخر (لست صاحب المستودع)' : 'If the Repository Belongs to Someone Else',
                steps: isAr ? [
                    'تواصل أولاً مع مالك المستودع عبر فتح Issue أو مراسلته على بريده المعلن في ملف التعريف واطلب منه تنقيح بريدك بلباقة.',
                    'يمكنك نسخ نموذج المراسلة الجاهز أدناه وإرساله لمالك المستودع مباشرة.',
                    'في حال لم يتجاوب المالك خلال 48 ساعة أو رفض التعاون، قم بتقديم طلب رسمي ومباشر لإدارة GitHub لحذف بياناتك الشخصية عبر نموذج انتهاك الخصوصية الرسمي (GitHub Private Information Removal).'
                ] : [
                    'Contact the repository maintainer by opening a GitHub Issue or emailing them requesting redaction.',
                    'You can use the ready-made message template below to send to the repository maintainer.',
                    'If the maintainer does not respond within 48 hours, submit an official takedown request directly to GitHub using the Private Information Removal form.'
                ],
                template_message: isAr
                    ? 'مرحباً، لقد لاحظت ظهور بريدي الإلكتروني الشخصي منشوراً في سجل هذا المستودع. أرجو منكم التكرم بإزالته أو تنقيحه حفاظاً على الخصوصية. شاكراً ومقدراً حسن تعاونكم.'
                    : 'Hello, I noticed that my personal email address is exposed in this repository history. Could you please redact or remove it for privacy reasons? Thank you for your assistance.',
                official_form_url: 'https://support.github.com/contact/private-information-removal'
            }
        },
        github_file: {
            title: isAr ? 'إزالة البريد الإلكتروني من ملف داخل المستودع' : 'Remove Email from a Repository File',
            owner_instructions: {
                title: isAr ? 'إذا كنت أنت صاحب المستودع' : 'If You Own the Repository',
                steps: isAr ? [
                    'افتح الملف المعني في محرر الأكواد أو عبر واجهة GitHub مباشرة بالضغط على أيقونة التعديل (Edit).',
                    'احذف بريدك الإلكتروني أو استبدله بمتغير بيئة عام (Environment Variable).',
                    'احفظ التعديلات وقم بعمل Commit جديد لتحديث الملف في المستودع.',
                    'تحقق من تاريخ التعديلات (Commit History) للتأكد من عدم بقاء البريد في النسخ القديمة؛ وإذا وُجد استخدم أداة git-filter-repo لحذفه من السجل.'
                ] : [
                    'Open the file locally or in GitHub web interface and click Edit.',
                    'Remove your email address or replace it with a placeholder/environment variable.',
                    'Commit the changes to update the file on the main branch.',
                    'Check previous revisions to ensure the email is not retained in old commits; if it is, use git-filter-repo.'
                ]
            },
            third_party_instructions: {
                title: isAr ? 'إذا كان المستودع مملوكاً لشخص آخر (لست صاحب المستودع)' : 'If the Repository Belongs to Someone Else',
                steps: isAr ? [
                    'قم بإنشاء طلب سحب (Pull Request) لحذف البريد من الملف مباشرة، أو افتح Issue لطلب الحذف من المشرفين.',
                    'استخدم نموذج الطلب المكتوب أدناه لتسهيل التواصل مع مالك المستودع.',
                    'إذا لم يستجب المالك، توجه لنموذج انتهاك الخصوصية لدى GitHub لطلب الحذف الإجباري للبيانات الشخصية.'
                ] : [
                    'Submit a Pull Request editing out your email, or open an Issue requesting maintainers to remove it.',
                    'Use the ready-made message template below to request removal.',
                    'If the owner is unresponsive, submit a Private Information Removal Request to GitHub Support.'
                ],
                template_message: isAr
                    ? 'السلام عليكم، أرجو التكرم بحذف بريدي الإلكتروني المذكور في هذا الملف نظراً لاحتوائه على معلومات شخصية خاصة بي. شاكراً لكم تفهمكم.'
                    : 'Hi, please remove or redact my personal email address listed in this file as it is private information. Thank you for your support.',
                official_form_url: 'https://support.github.com/contact/private-information-removal'
            }
        },
        github_issue: {
            title: isAr ? 'إزالة البريد الإلكتروني من تذكرة أو نقاش (Issue / PR)' : 'Remove Email from GitHub Issue or Discussion',
            owner_instructions: {
                title: isAr ? 'إذا كنت أنت كاتب المنشور أو صاحب المستودع' : 'If You Wrote the Comment or Own the Repo',
                steps: isAr ? [
                    'انقر على قائمة الخيارات الثلاثية (...) في الزاوية العلوية لمنشورك أو تعليقك واضغط على Edit.',
                    'احذف بريدك الإلكتروني بالكامل ثم اضغط على حفظ التعديل (Update comment).',
                    'اضغط على كلمة (edited) بجانب اسمك لفتح سجل التعديلات، ثم اختر "Delete revision from history" لمنع أي زائر من قراءة النص الأصلي السابق.'
                ] : [
                    'Click the three dots (...) menu on the top right of your comment and select Edit.',
                    'Delete your email address and click Update comment.',
                    'Open the (edited) revision history dropdown and click "Delete revision from history" to prevent viewing previous versions.'
                ]
            },
            third_party_instructions: {
                title: isAr ? 'إذا كان التعليق مكتوباً بواسطة شخص آخر' : 'If Written by Another User',
                steps: isAr ? [
                    'اضغط على القائمة الثلاثية (...) في أعلى التعليق واختر "Report content" للإبلاغ عن انتهاك الخصوصية.',
                    'تواصل مع المشرفين عبر نموذج المراسلة الجاهز أدناه لطلب حذف التعليق وسجل مراجعته.',
                    'في حال عدم التجاوب، قدّم بلاغاً مباشراً عبر نموذج انتهاك الخصوصية لـ GitHub.'
                ] : [
                    'Click the three dots (...) menu on the comment and choose "Report content".',
                    'Reach out to repository maintainers with the template message below.',
                    'If not resolved, escalate directly via the GitHub Private Information Removal form.'
                ],
                template_message: isAr
                    ? 'مرحباً، أرجو حذف التعليق أو تنقيح بريدي الإلكتروني الوارد فيه لمنع تسريب بياناتي الشخصية. شكراً جزيلاً.'
                    : 'Hello, please remove or redact my email address from this comment to protect my personal privacy. Thank you.',
                official_form_url: 'https://support.github.com/contact/private-information-removal'
            }
        },
        hackernews_comment: {
            title: isAr ? 'إزالة تعليق في Hacker News' : 'Remove Hacker News Comment Exposure',
            owner_instructions: {
                title: isAr ? 'إذا كان التعليق منشوراً من حسابك' : 'If Posted from Your Account',
                steps: isAr ? [
                    'إذا نُشر التعليق خلال أقل من ساعتين، اضغط مباشرة على زر "edit" أو "delete" أسفل التعليق لحذفه فوراً.',
                    'إذا انقضت مهلة الساعتين، تواصل مباشرة مع مشرفي Hacker News عبر إرسال بريد إلكتروني إلى: hn@ycombinator.com من بريدك المسجل واطلب حذفه لحماية الخصوصية.'
                ] : [
                    'If posted within 2 hours, click "edit" or "delete" directly under the comment to remove it.',
                    'If the 2-hour window has expired, email the Hacker News moderators at hn@ycombinator.com from your registered address requesting removal.'
                ]
            },
            third_party_instructions: {
                title: isAr ? 'إذا نُشر التعليق بواسطة مستخدم آخر' : 'If Posted by Someone Else',
                steps: isAr ? [
                    'أرسل رسالة فورية إلى مشرفي Hacker News عبر البريد الإلكتروني: hn@ycombinator.com.',
                    'قم بتضمين الرابط المباشر للتعليق واذكر بريدك الإلكتروني المسرب واطلب حذفه لانتهاك الخصوصية.',
                    'مشرفو Y Combinator يتعاونون بسرعة ويحذفون البيانات الشخصية الحساسة لحماية المستخدمين.'
                ] : [
                    'Email the Hacker News moderators at hn@ycombinator.com.',
                    'Include the direct comment URL, specify your exposed email, and request redaction for privacy reasons.',
                    'Y Combinator staff will review and assist with personal data removal.'
                ],
                template_message: isAr
                    ? 'السادة مشرفو Hacker News، لقد تم نشر بريدي الإلكتروني الشخصي في هذا التعليق دون إذن، أرجو التكرم بحذفه أو تنقيحه حفاظاً على الخصوصية. شكراً لكم.'
                    : 'Hello Hacker News Moderators, my personal email address was published in this comment without consent. Please remove or redact it for privacy protection. Thank you.',
                official_form_url: 'mailto:hn@ycombinator.com'
            }
        },
        hackernews_post: {
            title: isAr ? 'إزالة منشور في Hacker News' : 'Remove Hacker News Post Exposure',
            owner_instructions: {
                title: isAr ? 'إذا كان المنشور من حسابك' : 'If Submitted from Your Account',
                steps: isAr ? [
                    'إذا كان المنشور حديثاً وبدون ردود، اضغط على زر "delete" أسفل العنوان لحذفه فوراً.',
                    'إذا كانت هناك تعليقات أو مضى وقت، راسل المشرفين على: hn@ycombinator.com لحذف المنشور أو إخفاء بياناتك.'
                ] : [
                    'If submitted recently with no comments, click "delete" directly under the submission.',
                    'If it has comments or is past the grace period, email moderators at hn@ycombinator.com to redact or delete it.'
                ]
            },
            third_party_instructions: {
                title: isAr ? 'إذا نُشر المنشور بواسطة شخص آخر' : 'If Submitted by Someone Else',
                steps: isAr ? [
                    'راسل المشرفين فوراً على: hn@ycombinator.com.',
                    'أرفق رابط المنشور واشرح تفاصيل طلب الحذف لحماية خصوصيتك الشخصية.',
                    'اطلب إخفاء المحتوى أو حذف الرابط المسرب.'
                ] : [
                    'Email hn@ycombinator.com with the submission URL.',
                    'Explain the privacy concern and personal data removal request.',
                    'Request post redaction or deletion.'
                ],
                template_message: isAr
                    ? 'السادة مشرفو Hacker News، يحتوي هذا المنشور على بريدي الإلكتروني الشخصي. أرجو حذفه لحماية الخصوصية. شكراً لكم.'
                    : 'Hello Hacker News Moderators, this post exposes my personal email address. I kindly request its removal to safeguard my privacy. Thank you.',
                official_form_url: 'mailto:hn@ycombinator.com'
            }
        }
    };

    if (source_type) {
        const item = guidanceCatalog[source_type];
        if (!item) {
            return res.status(404).json({ error: `No instructions found for source_type: ${source_type}` });
        }
        return res.json({ source_type, ...item });
    }

    res.json({ instructions: guidanceCatalog });
});

// Final catch-all for SPA
if (fs.existsSync(FRONTEND_PATH)) {
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/admin')) {
            res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
        }
    });
}

app.listen(PORT, async () => {
    await initDatabase();
    
    // Start OSINT Web Crawler
    try {
        const { startOSINTCrawler } = require('./utils/crawler');
        startOSINTCrawler();
    } catch(err) {
        console.error('[OSINT Crawler] Failed to initialize:', err);
    }

    console.log(`====================================================`);
    console.log(` SecureCheck Server: Running on Port ${PORT}`);
    console.log(` Email Mode: ${nodemailer ? 'REAL (Nodemailer)' : 'FALLBACK (Console)'}`);
    console.log(` DB Status: SQLite Professional Privacy-First`);
    console.log(` PDF Engine: READY (pdfmake-rtl + Cairo Fonts)`);
    console.log(`====================================================`);
});
