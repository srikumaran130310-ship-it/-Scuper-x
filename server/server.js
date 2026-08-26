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

app.use(express.json());

// Cookie parser middleware
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

// Initialize DB & clear rate limit locks on startup
(async () => {
    try {
        await db.initDb();
        auth.clearAllRateLimits();
    } catch (err) {
        console.error('Database initialization error:', err);
    }
})();

// Serve Static Portals
app.use('/user', express.static(path.join(__dirname, '../user')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Main Route: User Portal at /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../user/index.html'));
});

// Admin Route: Admin Portal at /admin and /admin.html
app.get(['/admin', '/admin.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// Root HTML fallback
app.get('/⚡%20SCUPER%20X.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../user/index.html'));
});

// ════════════════════════════════════════════════════
//  API ENDPOINTS
// ════════════════════════════════════════════════════

/**
 * 1. User Key Verification
 * POST /api/auth/verify-key
 */
app.post('/api/auth/verify-key', async (req, res) => {
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
    const verification = await db.verifyCustomerKey(submittedHash);

    if (!verification.valid) {
        auth.recordAttempt(ip);
        return res.json({ 
            valid: false, 
            message: verification.message || 'Invalid access key.' 
        });
    }

    auth.resetAttempts(ip);
    return res.json({
        valid: true,
        expiresAt: verification.expiresAt,
        customerName: verification.customerName,
        message: 'Key verified'
    });
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

    if (inputUser === ADMIN_USERNAME && auth.verifyAdminPassword(password)) {
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
 * 3. Fetch All Customer Keys (Admin Only)
 * GET /api/admin/customer-keys
 */
app.get('/api/admin/customer-keys', auth.adminAuthMiddleware, async (req, res) => {
    const keys = await db.getAllCustomerKeys();
    return res.json({
        success: true,
        keys: keys
    });
});

/**
 * 4. Generate Customer Unique Key (Admin Only)
 * POST /api/admin/generate-customer-key
 */
app.post('/api/admin/generate-customer-key', auth.adminAuthMiddleware, async (req, res) => {
    const { customerName, customerId } = req.body || {};

    const rawKey = auth.generateSecureKey();
    const keyHash = auth.hashString(rawKey);

    // Default expiration: 23:59:59 IST of current day
    const expiresAt = db.getISTEndOfDayISO();

    const newRecord = await db.createCustomerKey(customerName, customerId, rawKey, keyHash, expiresAt, 'v1');

    return res.json({
        success: true,
        message: `Unique key created for ${newRecord.customer_name}`,
        keyRecord: newRecord
    });
});

/**
 * 5. Revoke Customer Key (Admin Only)
 * POST /api/admin/revoke-customer-key
 */
app.post('/api/admin/revoke-customer-key', auth.adminAuthMiddleware, async (req, res) => {
    const { keyId } = req.body || {};
    const success = await db.revokeKeyById(keyId);
    return res.json({
        success: success,
        message: success ? 'Customer key revoked successfully' : 'Key record not found or already inactive'
    });
});

/**
 * 6. Delete Customer Key (Admin Only)
 * POST /api/admin/delete-customer-key
 */
app.post('/api/admin/delete-customer-key', auth.adminAuthMiddleware, async (req, res) => {
    const { keyId } = req.body || {};
    const success = await db.deleteKeyById(keyId);
    return res.json({
        success: success,
        message: success ? 'Customer key deleted successfully' : 'Key record not found'
    });
});

// ════════════════════════════════════════════════════
//  BACKWARD COMPATIBILITY ALIASES
// ════════════════════════════════════════════════════
app.get('/api/admin/current-key', auth.adminAuthMiddleware, async (req, res) => {
    const active = await db.getActiveKey();
    const todayStr = new Date().toISOString().split('T')[0];

    if (!active) {
        return res.json({
            success: true,
            key: 'NO ACTIVE KEY',
            date: todayStr,
            status: 'REVOKED',
            createdAt: '--',
            expiresAt: '23:59:59 IST',
            keyVersion: 'v1'
        });
    }

    return res.json({
        success: true,
        key: active.raw_key,
        date: active.created_at ? active.created_at.split('T')[0] : todayStr,
        status: active.status,
        createdAt: active.created_at ? active.created_at.replace('T', ' ').slice(0, 19) + ' UTC' : '--',
        expiresAt: active.expires_at ? active.expires_at : '23:59:59 IST',
        keyVersion: active.version || 'v1'
    });
});

app.post('/api/admin/generate-key', auth.adminAuthMiddleware, async (req, res) => {
    const rawKey = auth.generateSecureKey();
    const keyHash = auth.hashString(rawKey);
    const expiresAt = db.getISTEndOfDayISO();
    const newRecord = await db.createCustomerKey('Quick Key', 'QUICK-1', rawKey, keyHash, expiresAt, 'v1');
    return res.json({
        success: true,
        message: 'New key generated and activated',
        key: rawKey,
        expiresAt: newRecord.expires_at
    });
});

app.post('/api/admin/revoke-key', auth.adminAuthMiddleware, async (req, res) => {
    const success = await db.revokeActiveKey();
    return res.json({
        success: true,
        message: success ? 'Current active key revoked' : 'No active key to revoke'
    });
});

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
 ⚡ SCUPER X Customer-Wise Key Management System ⚡
 User Portal:  http://localhost:${PORT}/
 Admin Portal: http://localhost:${PORT}/admin
====================================================
`);
});
