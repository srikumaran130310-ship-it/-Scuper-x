const crypto = require('crypto');

// In-memory active admin sessions
const activeSessions = new Map();

// Rate limiter memory store
const attemptsMap = new Map();

/**
 * Hash string with SHA-256
 */
function hashString(str) {
    return crypto.createHash('sha256').update(str.trim()).digest('hex');
}

/**
 * Generate cryptographically secure random 16-character SCX key
 * Format: SCX-XXXX-XXXX-XXXX
 */
function generateSecureKey() {
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(12);
    let raw = '';
    for (let i = 0; i < bytes.length; i++) {
        raw += charset[bytes[i] % charset.length];
    }
    return `SCX-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/**
 * Creates admin session token
 */
function createAdminSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    activeSessions.set(token, { expiresAt, createdAt: Date.now() });
    return token;
}

/**
 * Validates admin session token
 */
function isValidAdminSession(token) {
    if (!token) return false;
    const session = activeSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return false;
    }
    return true;
}

/**
 * Destroys admin session token
 */
function destroyAdminSession(token) {
    if (token) activeSessions.delete(token);
}

/**
 * Rate limiter helper per IP
 */
function isRateLimited(ip, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    let record = attemptsMap.get(ip);
    if (!record || now > record.resetTime) {
        record = { count: 0, resetTime: now + windowMs };
        attemptsMap.set(ip, record);
    }
    return record.count >= maxAttempts;
}

function recordAttempt(ip, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    let record = attemptsMap.get(ip);
    if (!record || now > record.resetTime) {
        record = { count: 1, resetTime: now + windowMs };
    } else {
        record.count++;
    }
    attemptsMap.set(ip, record);
}

function resetAttempts(ip) {
    attemptsMap.delete(ip);
}

/**
 * Express Middleware for Admin Route Authorization
 */
function adminAuthMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.admin_session) {
        token = req.cookies.admin_session;
    }

    if (!token || !isValidAdminSession(token)) {
        return res.status(401).json({ success: false, message: 'Unauthorized admin access' });
    }

    req.adminSessionToken = token;
    next();
}

module.exports = {
    hashString,
    generateSecureKey,
    createAdminSession,
    isValidAdminSession,
    destroyAdminSession,
    isRateLimited,
    recordAttempt,
    resetAttempts,
    adminAuthMiddleware
};
