const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            keys: [],
            lastId: 0
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}

function readDb() {
    initDb();
    try {
        const content = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed.keys)) parsed.keys = [];
        return parsed;
    } catch (err) {
        console.error('Error reading db.json:', err);
        return { keys: [], lastId: 0 };
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing to db.json:', err);
        return false;
    }
}

/**
 * Returns all customer keys, updating any expired key statuses automatically
 */
function getAllCustomerKeys() {
    const db = readDb();
    const now = new Date();
    let modified = false;

    db.keys.forEach(k => {
        if (k.status === 'ACTIVE' && k.expires_at) {
            if (now > new Date(k.expires_at)) {
                k.status = 'EXPIRED';
                modified = true;
            }
        }
    });

    if (modified) writeDb(db);
    return db.keys;
}

/**
 * Creates a unique key for a specific customer
 */
function createCustomerKey(customerName, customerId, rawKey, keyHash, expiresAt, version = 'v1') {
    const db = readDb();
    db.lastId = (db.lastId || 0) + 1;

    const nameStr = customerName ? customerName.trim() : 'Customer';
    const idStr = customerId && customerId.trim() ? customerId.trim() : `CUST-${String(db.lastId).padStart(3, '0')}`;

    const newRecord = {
        id: db.lastId,
        customer_name: nameStr,
        customer_id: idStr,
        raw_key: rawKey,
        key_hash: keyHash,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        status: 'ACTIVE',
        version: version
    };

    db.keys.unshift(newRecord); // Place newest key first
    writeDb(db);
    return newRecord;
}

/**
 * Verifies a customer key against the persistent database
 */
function verifyCustomerKey(keyHash) {
    const db = readDb();
    const now = new Date();
    let modified = false;

    const record = db.keys.find(k => k.key_hash === keyHash);
    if (!record) {
        return { status: 'NOT_FOUND', message: 'Invalid access key.' };
    }

    if (record.status === 'REVOKED') {
        return { status: 'REVOKED', message: 'Your access key has been deactivated.' };
    }

    if (record.expires_at && now > new Date(record.expires_at)) {
        if (record.status === 'ACTIVE') {
            record.status = 'EXPIRED';
            modified = true;
        }
        if (modified) writeDb(db);
        return { status: 'EXPIRED', message: 'Your access key has expired.' };
    }

    if (record.status === 'EXPIRED') {
        return { status: 'EXPIRED', message: 'Your access key has expired.' };
    }

    if (record.status === 'ACTIVE') {
        return { 
            status: 'ACTIVE', 
            valid: true,
            customerName: record.customer_name,
            expiresAt: record.expires_at,
            record: record 
        };
    }

    return { status: 'NOT_FOUND', message: 'Invalid access key.' };
}

/**
 * Finds key by SHA-256 hash
 */
function findActiveKeyByHash(keyHash) {
    const result = verifyCustomerKey(keyHash);
    if (result.status === 'ACTIVE') return result.record;
    return null;
}

/**
 * Revokes a key by ID
 */
function revokeKeyById(keyId) {
    const db = readDb();
    const record = db.keys.find(k => String(k.id) === String(keyId));
    if (record && record.status === 'ACTIVE') {
        record.status = 'REVOKED';
        writeDb(db);
        return true;
    }
    return false;
}

/**
 * Deletes a key record by ID
 */
function deleteKeyById(keyId) {
    const db = readDb();
    const initialLen = db.keys.length;
    db.keys = db.keys.filter(k => String(k.id) !== String(keyId));
    if (db.keys.length !== initialLen) {
        writeDb(db);
        return true;
    }
    return false;
}

/**
 * Helper: Get active keys
 */
function getActiveKey() {
    const activeKeys = getAllCustomerKeys().filter(k => k.status === 'ACTIVE');
    return activeKeys.length > 0 ? activeKeys[0] : null;
}

module.exports = {
    initDb,
    readDb,
    writeDb,
    getAllCustomerKeys,
    createCustomerKey,
    verifyCustomerKey,
    findActiveKeyByHash,
    revokeKeyById,
    deleteKeyById,
    getActiveKey
};

