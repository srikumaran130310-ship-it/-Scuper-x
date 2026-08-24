const express = require('express');
const path = require('path');
const fs = require('fs');

// Load environment variables if .env exists
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            if (key && !process.env[key]) {
                process.env[key] = val;
            }
        }
    });
}

const db = require('./database');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@Scuper2026';

app.use(express.json());

// Simple cookie parser helper
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(c => {
            const [k, v] = c.split('=');
            if (k && v) req.cookies[k.trim()] = v.trim();
        });
    }
    next();
});

// Initialize database & seed initial active key if none exists
db.initDb();
let activeKey = db.getActiveKey();
if (!activeKey) {
    const initialRawKey = auth.generateSecureKey();
    const keyHash = auth.hashString(initialRawKey);
    const expiresAt = new Date();
    expiresAt.setUTCHours(23, 59, 59, 999);
    activeKey = db.createKey(initialRawKey, keyHash, expiresAt.toISOString(), 'v1');
    console.log(`[SEED] Initialized new daily key: ${initialRawKey}`);
}

// Serve Static Portals
app.use('/user', express.static(path.join(__dirname, '../user')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Main Route: User Portal at /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../user/index.html'));
});

// Admin Route: Admin Portal at /admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// ════════════════════════════════════════════════════
//  API ENDPOINTS
// ════════════════════════════════════════════════════

/**
 * 1. User Key Verification
 * POST /api/auth/verify-key
 */
app.post('/api/auth/verify-key', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (auth.isRateLimited(ip, 10, 15 * 60 * 1000)) {
        return res.status(429).json({
            valid: false,
            message: 'Too many failed login attempts. Please try again in 15 minutes.'
        });
    }

    const { key } = req.body || {};
    if (!key || typeof key !== 'string') {
        auth.recordAttempt(ip);
        return res.status(400).json({ valid: false, message: 'Invalid or missing key' });
    }

    const submittedHash = auth.hashString(key);
    const active = db.getActiveKey();

    if (!active) {
        auth.recordAttempt(ip);
        return res.json({ valid: false, message: 'Invalid or expired key' });
    }

    if (active.key_hash === submittedHash) {
        auth.resetAttempts(ip);
        return res.json({
            valid: true,
            expiresAt: active.expires_at,
            message: 'Key verified'
        });
    } else {
        auth.recordAttempt(ip);
        return res.json({ valid: false, message: 'Invalid or expired key' });
    }
});

/**
 * 2. Admin Login
 * POST /api/admin/login
 */
app.post('/api/admin/login', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (auth.isRateLimited(`admin_${ip}`, 5, 15 * 60 * 1000)) {
        return res.status(429).json({
            success: false,
            message: 'Too many admin login attempts. Account temporarily locked.'
        });
    }

    const { username, password } = req.body || {};
    const inputUser = username || 'admin';

    if (inputUser === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        auth.resetAttempts(`admin_${ip}`);
        const token = auth.createAdminSession();
        
        const isProd = process.env.NODE_ENV === 'production';
        res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Path=/; SameSite=Strict${isProd ? '; Secure' : ''}`);

        return res.json({
            success: true,
            token,
            message: 'Admin authorized'
        });
    } else {
        auth.recordAttempt(`admin_${ip}`);
        return res.status(401).json({
            success: false,
            message: 'Invalid Admin Credentials'
        });
    }
});

/**
 * 3. Fetch Current Active Key (Admin Only)
 * GET /api/admin/current-key
 */
app.get('/api/admin/current-key', auth.adminAuthMiddleware, (req, res) => {
    const active = db.getActiveKey();
    const todayStr = new Date().toISOString().split('T')[0];

    if (!active) {
        return res.json({
            success: true,
            key: 'NO ACTIVE KEY',
            date: todayStr,
            status: 'REVOKED',
            createdAt: '--',
            expiresAt: '23:59:59 UTC',
            keyVersion: 'v1'
        });
    }

    return res.json({
        success: true,
        key: active.raw_key,
        date: active.created_at ? active.created_at.split('T')[0] : todayStr,
        status: active.status,
        createdAt: active.created_at ? active.created_at.replace('T', ' ').slice(0, 19) + ' UTC' : '--',
        expiresAt: active.expires_at ? active.expires_at.replace('T', ' ').slice(0, 19) + ' UTC' : '23:59:59 UTC',
        keyVersion: active.version || 'v1'
    });
});

/**
 * 4. Generate New Key (Admin Only)
 * POST /api/admin/generate-key
 */
app.post('/api/admin/generate-key', auth.adminAuthMiddleware, (req, res) => {
    const rawKey = auth.generateSecureKey();
    const keyHash = auth.hashString(rawKey);

    const expiresAt = new Date();
    expiresAt.setUTCHours(23, 59, 59, 999);

    const newRecord = db.createKey(rawKey, keyHash, expiresAt.toISOString(), 'v1');

    return res.json({
        success: true,
        message: 'New key generated and activated',
        key: rawKey,
        expiresAt: newRecord.expires_at.replace('T', ' ').slice(0, 19) + ' UTC'
    });
});

/**
 * 5. Revoke Key (Admin Only)
 * POST /api/admin/revoke-key
 */
app.post('/api/admin/revoke-key', auth.adminAuthMiddleware, (req, res) => {
    const success = db.revokeActiveKey();
    return res.json({
        success: true,
        message: success ? 'Current active key revoked' : 'No active key to revoke'
    });
});

/**
 * 6. Admin Logout
 * POST /api/admin/logout
 */
app.post('/api/admin/logout', (req, res) => {
    const token = req.adminSessionToken;
    if (token) auth.destroyAdminSession(token);
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return res.json({ success: true, message: 'Logged out successfully' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`
====================================================
 ⚡ SCUPER X Security & Key Management System ⚡
 User Portal:  http://localhost:${PORT}/
 Admin Portal: http://localhost:${PORT}/admin
====================================================
`);
});
