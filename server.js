/**
 * SCUPER X - Backend Server & Secure Key Management System
 * 
 * Endpoints:
 * - GET  /                             -> Serves SCUPER X User Portal
 * - GET  /admin                        -> Serves SCUPER X Admin Portal
 * - POST /api/auth/verify-key          -> Verifies user security key (Rate Limited)
 * - POST /api/admin/login              -> Authenticates admin & generates session token
 * - GET  /api/admin/current-key        -> Returns active daily key & status (Admin Only)
 * - POST /api/admin/generate-key       -> Generates & activates 16-char key SCX-XXXX-XXXX-XXXX (Admin Only)
 * - POST /api/admin/revoke-key         -> Revokes active key (Admin Only)
 * - POST /api/admin/logout             -> Terminates admin session (Admin Only)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@Scuper2026';

// Server-side Sessions & Rate Limiter
const activeAdminSessions = new Set();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 mins

// Key Storage (In-memory secure store)
// Record schema: { id, date, rawKey, hash, createdAt, expiresAt, status, version }
let keyStore = [];
let keyVersionCounter = 1;

/**
 * Get current UTC date string YYYY-MM-DD
 */
function getUtcDateString(offsetDays = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

/**
 * Get end of today's UTC date ISO string (23:59:59 UTC)
 */
function getUtcExpirationString() {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    return end.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Generate cryptographically secure 16-character key: SCX-XXXX-XXXX-XXXX
 */
function generateSecureRandomKey() {
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous chars 0,O,1,I
    const bytes = crypto.randomBytes(12);
    let chars = '';
    for (let i = 0; i < 12; i++) {
        chars += charset[bytes[i] % charset.length];
    }
    // Format as SCX-XXXX-XXXX-XXXX (16 alphanumeric chars + dashes)
    return `SCX-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/**
 * SHA-256 Hash of key string for secure storage & constant-time comparison
 */
function hashKeyString(key) {
    return crypto.createHash('sha256').update(key.trim().toUpperCase()).digest('hex');
}

/**
 * Ensure today has an active daily key upon startup or date rollover
 */
function ensureActiveKeyForToday() {
    const todayStr = getUtcDateString();
    
    // Check if there is an active key for today
    const activeKey = keyStore.find(k => k.date === todayStr && k.status === 'ACTIVE');
    if (!activeKey) {
        // Auto-generate fresh key for today
        createNewKey(todayStr);
    }
}

/**
 * Create, hash, and store a new key, revoking previous active key
 */
function createNewKey(dateStr = getUtcDateString()) {
    // Revoke previous active keys
    keyStore.forEach(k => {
        if (k.status === 'ACTIVE') {
            k.status = 'REVOKED';
        }
    });

    const rawKey = generateSecureRandomKey();
    const keyHash = hashKeyString(rawKey);
    const createdAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const expiresAt = getUtcExpirationString();

    const newRecord = {
        id: crypto.randomBytes(8).toString('hex'),
        date: dateStr,
        rawKey: rawKey,
        hash: keyHash,
        prefix: rawKey.slice(0, 8) + '-****',
        createdAt: createdAt,
        expiresAt: expiresAt,
        status: 'ACTIVE',
        version: `v${keyVersionCounter++}`
    };

    keyStore.unshift(newRecord);
    return newRecord;
}

/**
 * Rate Limiting helper
 */
function checkRateLimit(ip) {
    const now = Date.now();
    let attempts = (loginAttempts.get(ip) || []).filter(t => now - t < WINDOW_MS);
    loginAttempts.set(ip, attempts);
    
    if (attempts.length >= MAX_ATTEMPTS) {
        const resetMinutes = Math.ceil((WINDOW_MS - (now - attempts[0])) / 60000);
        return { isLimited: true, resetMinutes };
    }
    return { isLimited: false };
}

function recordLoginAttempt(ip) {
    const attempts = loginAttempts.get(ip) || [];
    attempts.push(Date.now());
    loginAttempts.set(ip, attempts);
}

/**
 * Verify Admin Bearer Token
 */
function isAuthorizedAdmin(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    return token && activeAdminSessions.has(token);
}

// Initial Key Generation
ensureActiveKeyForToday();

// HTTP Server
const server = http.createServer((req, meRes) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    // CORS Headers
    meRes.setHeader('Access-Control-Allow-Origin', '*');
    meRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    meRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        meRes.writeHead(204);
        meRes.end();
        return;
    }

    const sendJson = (statusCode, payload) => {
        meRes.writeHead(statusCode, { 'Content-Type': 'application/json' });
        meRes.end(JSON.stringify(payload));
    };

    // -------------------------------------------------------------
    // POST /api/auth/verify-key (User Key Verification)
    // -------------------------------------------------------------
    if (req.method === 'POST' && (pathname === '/api/auth/verify-key' || pathname === '/api/login')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { key = '' } = JSON.parse(body || '{}');
                const userKey = key.trim().toUpperCase();

                if (!userKey) {
                    return sendJson(400, { valid: false, message: 'Please enter your security key' });
                }

                // Rate limiting
                const rateCheck = checkRateLimit(clientIp);
                if (rateCheck.isLimited) {
                    return sendJson(429, { 
                        valid: false, 
                        message: `Too many failed attempts. Please try again in ${rateCheck.resetMinutes} minutes.` 
                    });
                }

                ensureActiveKeyForToday();
                const submittedHash = hashKeyString(userKey);
                const todayStr = getUtcDateString();

                // Find active key record matching submitted hash
                const activeRecord = keyStore.find(k => k.status === 'ACTIVE' && k.date === todayStr);

                if (activeRecord && activeRecord.hash === submittedHash) {
                    return sendJson(200, {
                        valid: true,
                        expiresAt: activeRecord.expiresAt,
                        message: 'Key verified'
                    });
                } else {
                    recordLoginAttempt(clientIp);
                    return sendJson(401, {
                        valid: false,
                        message: 'Invalid or expired key'
                    });
                }

            } catch (err) {
                return sendJson(400, { valid: false, message: 'Invalid request payload' });
            }
        });
        return;
    }

    // -------------------------------------------------------------
    // POST /api/admin/login
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/admin/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { password = '' } = JSON.parse(body || '{}');
                if (password === ADMIN_PASSWORD) {
                    const token = crypto.randomBytes(32).toString('hex');
                    activeAdminSessions.add(token);
                    return sendJson(200, { success: true, token, message: 'Admin authorized' });
                } else {
                    return sendJson(401, { success: false, message: 'Invalid admin password' });
                }
            } catch (e) {
                return sendJson(400, { success: false, message: 'Bad request' });
            }
        });
        return;
    }

    // -------------------------------------------------------------
    // POST /api/admin/logout
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/admin/logout') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        activeAdminSessions.delete(token);
        return sendJson(200, { success: true, message: 'Logged out' });
    }

    // -------------------------------------------------------------
    // GET /api/admin/current-key (Protected Admin Route)
    // -------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/admin/current-key') {
        if (!isAuthorizedAdmin(req)) {
            return sendJson(401, { success: false, message: 'Unauthorized admin access' });
        }

        ensureActiveKeyForToday();
        const activeRecord = keyStore.find(k => k.status === 'ACTIVE') || keyStore[0];

        return sendJson(200, {
            success: true,
            key: activeRecord ? activeRecord.rawKey : 'SCX-NONE',
            date: activeRecord ? activeRecord.date : getUtcDateString(),
            status: activeRecord ? activeRecord.status : 'REVOKED',
            createdAt: activeRecord ? activeRecord.createdAt : '--',
            expiresAt: activeRecord ? activeRecord.expiresAt : getUtcExpirationString(),
            keyVersion: activeRecord ? activeRecord.version : 'v0'
        });
    }

    // -------------------------------------------------------------
    // POST /api/admin/generate-key (Protected Admin Route)
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/admin/generate-key') {
        if (!isAuthorizedAdmin(req)) {
            return sendJson(401, { success: false, message: 'Unauthorized admin access' });
        }

        const newRecord = createNewKey();
        return sendJson(200, {
            success: true,
            message: 'New key generated and activated',
            key: newRecord.rawKey,
            expiresAt: newRecord.expiresAt
        });
    }

    // -------------------------------------------------------------
    // POST /api/admin/revoke-key (Protected Admin Route)
    // -------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/admin/revoke-key') {
        if (!isAuthorizedAdmin(req)) {
            return sendJson(401, { success: false, message: 'Unauthorized admin access' });
        }

        keyStore.forEach(k => { if (k.status === 'ACTIVE') k.status = 'REVOKED'; });
        return sendJson(200, { success: true, message: 'Active key revoked successfully' });
    }

    // -------------------------------------------------------------
    // Serve Static HTML Files (/ and /admin)
    // -------------------------------------------------------------
    let targetFile = '⚡ SCUPER X.html';
    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
        targetFile = 'admin.html';
    } else if (pathname !== '/' && pathname !== '') {
        targetFile = decodeURIComponent(pathname.substring(1));
    }

    const filePath = path.join(__dirname, targetFile);

    fs.readFile(filePath, (err, content) => {
        if (err) {
            meRes.writeHead(404, { 'Content-Type': 'text/plain' });
            meRes.end('404 Page Not Found');
        } else {
            const ext = path.extname(filePath);
            const contentType = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/plain';
            meRes.writeHead(200, { 'Content-Type': contentType });
            meRes.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` ⚡ SCUPER X Security & Key Management System ⚡`);
    console.log(` User Portal:  http://localhost:${PORT}/`);
    console.log(` Admin Portal: http://localhost:${PORT}/admin`);
    console.log(` Date:         ${getUtcDateString()}`);
    console.log(` Active Key:   ${keyStore[0] ? keyStore[0].rawKey : 'NONE'}`);
    console.log(` Admin Pass:   ${ADMIN_PASSWORD}`);
    console.log(`====================================================`);
});
