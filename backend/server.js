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
    // HASHING DISABLED FOR PRESENTATION: Queries against plaintext email directly
    const result = await db.query('SELECT * FROM leaked_emails WHERE email_hash = $1', [plainEmail]);
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

function buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId, breachCount }) {
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    const align = lang === 'ar' ? 'right' : 'left';
    const helloText = lang === 'ar' ? 'مرحباً،' : 'Hello,';
    const borderColor = risk.color === 'red' ? '#ef4444' : (risk.color === 'yellow' ? '#f59e0b' : '#10b981');
    const countLine = breachCount != null
        ? `<p style="margin: 5px 0 0; color: #475569;">${lang === 'ar' ? `إجمالي التسريبات: ${breachCount}` : `Total Breaches: ${breachCount}`}</p>`
        : '';
    return `
        <div dir="${dir}" style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; text-align: ${align};">
            <h2 style="color: #2563eb;">${t.reportSubject}</h2>
            <p>${helloText}</p>
            <p>${bodyText}</p>
            <div style="border-left: 4px solid ${borderColor}; padding: 15px; background: #f8fafc; margin: 20px 0;">
                <h3 style="margin: 0; color: #1e293b;">${t.overallStatus}: ${statusLabel}</h3>
                ${countLine}
            </div>
            <p style="color: #64748b; font-size: 0.8rem; border-top: 1px solid #eee; padding-top: 20px;">${t.userId}: ${anonymousId}</p>
        </div>
    `;
}
async function generateReportPDF(email, breaches, anonymousId, lang = 'en') {
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

// 3.5 Password Check Proxy (To avoid CORS issues in production)
app.get('/api/check-password', async (req, res) => {
    const { hash } = req.query;
    if (!hash || hash.length < 5) return res.status(400).json({ error: 'Valid hash prefix required' });

    try {
        const prefix = hash.substring(0, 5).toUpperCase();
        const result = await db.query("SELECT password_hash, exposure_count FROM leaked_passwords WHERE password_hash LIKE $1", [prefix + '%']);
        
        let responseText = '';
        if (result.rows && result.rows.length > 0) {
            responseText = result.rows.map(row => {
                const suffix = row.password_hash.substring(5).toUpperCase();
                return `${suffix}:${row.exposure_count}`;
            }).join('\n');
        }
        res.type('text/plain').send(responseText);
    } catch (error) {
        console.error('Password API Error:', error.message);
        res.status(500).json({ error: 'Failed to check password database' });
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
            let email = '[فشل فك التشفير]';
            try {
                const [content, tag] = row.encrypted_email.split(':');
                email = privacy.decryptPII(content, row.email_iv, tag);
            } catch (e) {
                console.error('Decryption failed for user:', row.user_id);
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
        const encrypted = privacy.encryptPII(email);

        await db.query(
            `INSERT INTO users (user_id, anonymous_id, encrypted_email, email_iv, lang) VALUES ($1, $2, $3, $4, $5)`,
            [userId, anonymousId, encrypted.content + ':' + encrypted.tag, encrypted.iv, lang]
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

        let attachments = [];
        try {
            console.log(`[Report] Starting PDF generation for ${email}...`);
            const pdfBuffer = await generateReportPDF(email, breaches, anonymousId, lang);
            console.log(`[Report] PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
            attachments = [{ filename: `SecureCheck_Report_${new Date().toISOString().split('T')[0]}.pdf`, content: pdfBuffer }];
        } catch (pdfErr) {
            console.error('[PDF Error] Failed to generate PDF attachment:', pdfErr.message);
        }

        const statusLabel = getStatusLabel(risk, t);
        const bodyText = lang === 'ar'
            ? "هذا هو التقرير الأمني الخاص ببريدك الإلكتروني، مرفق معه ملف PDF شامل يحتوي على كافة تفاصيل التسريبات المكتشفة ومعلماتها بناءً على خياراتك."
            : "This is the security report for your email address. Attached is a comprehensive PDF file containing all details of detected leaks and their information based on your preferences.";
        const reportHtml = buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId, breachCount: breaches.length });

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

    if (isNewBreach) {
        bodyText = lang === 'ar'
            ? `تنبيه أمني: لقد تم رصد تسريبات جديدة لبياناتك! زاد عدد التسريبات من ${lastCount} إلى ${breaches.length}. تجد مرفقاً تقريراً كاملاً بالـ PDF.`
            : `Security Alert: New breaches detected! Your leak count increased from ${lastCount} to ${breaches.length}. A full PDF report is attached for details.`;

        const pdfBuffer = await generateReportPDF(email, breaches, anonymousId, lang);
        attachments.push({ filename: `SecureCheck_Alert_${new Date().toISOString().split('T')[0]}.pdf`, content: pdfBuffer });
    } else {
        bodyText = lang === 'ar'
            ? `تحديث الحالة: لم يتم رصد أي تسريبات جديدة لبريدك الإلكتروني منذ آخر تقرير. عدد التسريبات المكتشفة حالياً هو ${breaches.length}.`
            : `Status Update: No new data breaches detected since your last report. Your total leak count remains at ${breaches.length}.`;
    }

    const statusLabel = getStatusLabel(risk, t);
    const reportHtml = buildReportHtml({ t, lang, bodyText, statusLabel, risk, anonymousId });

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

        // Seed with Free Plan if empty
        const plans = await db.query('SELECT count(*) as count FROM subscription_plans');
        if (parseInt(plans.rows[0].count) === 0) {
            await db.query(`INSERT INTO subscription_plans (name, price_cents, check_limit_monthly) VALUES ('Free', 0, 999999)`);
            console.log('[Init] Seeded "Free" subscription plan with Unlimited limits.');
        }

        console.log('[Init] PostgreSQL Database ready.');
    } catch (err) {
        console.error('[Init] PostgreSQL initialization failed:', err.message);
    }
}


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
