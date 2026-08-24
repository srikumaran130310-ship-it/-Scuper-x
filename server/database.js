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
        return JSON.parse(content);
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
 * Returns current ACTIVE key record if valid & unexpired
 */
function getActiveKey() {
    const db = readDb();
    const now = new Date();
    
    // Find active key
    const activeKey = db.keys.find(k => k.status === 'ACTIVE');
    if (!activeKey) return null;

    // Check expiration against server time
    const expiresDate = new Date(activeKey.expires_at);
    if (now > expiresDate) {
        activeKey.status = 'EXPIRED';
        writeDb(db);
        return null;
    }

    return activeKey;
}

/**
 * Creates a new active key, revoking any prior active key
 */
function createKey(rawKey, keyHash, expiresAt, version = 'v1') {
    const db = readDb();

    // 1. Revoke existing active key
    db.keys.forEach(k => {
        if (k.status === 'ACTIVE') {
            k.status = 'REVOKED';
        }
    });

    // 2. Insert new active key record
    db.lastId = (db.lastId || 0) + 1;
    const newRecord = {
        id: db.lastId,
        raw_key: rawKey,
        key_hash: keyHash,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        status: 'ACTIVE',
        version: version
    };

    db.keys.push(newRecord);
    writeDb(db);
    return newRecord;
}

/**
 * Revokes current active key
 */
function revokeActiveKey() {
    const db = readDb();
    let revokedCount = 0;
    db.keys.forEach(k => {
        if (k.status === 'ACTIVE') {
            k.status = 'REVOKED';
            revokedCount++;
        }
    });
    if (revokedCount > 0) writeDb(db);
    return revokedCount > 0;
}

/**
 * Finds key by SHA-256 hash
 */
function findKeyByHash(keyHash) {
    const db = readDb();
    return db.keys.find(k => k.key_hash === keyHash);
}

module.exports = {
    initDb,
    readDb,
    writeDb,
    getActiveKey,
    createKey,
    revokeActiveKey,
    findKeyByHash
};
