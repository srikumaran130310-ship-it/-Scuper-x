const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(__dirname, 'db.json');
const PERSIST_FILE = path.join(DATA_DIR, 'customer_keys.json');
const BACKUP_FILE = path.join(__dirname, 'db.json.bak');

let dbDriver = 'FILE'; // 'FILE' | 'MONGO' | 'POSTGRES'
let pgPool = null;
let MongoModel = null;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

/**
 * Calculates end of day ISO string in Asia/Kolkata timezone (23:59:59.999 IST)
 */
function getISTEndOfDayISO(dateObj = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(dateObj);
    let year, month, day;
    for (const part of parts) {
        if (part.type === 'year') year = part.value;
        if (part.type === 'month') month = part.value;
        if (part.type === 'day') day = part.value;
    }
    const istEndStr = `${year}-${month}-${day}T23:59:59.999+05:30`;
    return new Date(istEndStr).toISOString();
}

/**
 * Safe local file reader with auto-repair
 */
function readLocalFile() {
    let targetPath = fs.existsSync(PERSIST_FILE) ? PERSIST_FILE : DB_FILE;
    if (!fs.existsSync(targetPath)) {
        return { keys: [], lastId: 0 };
    }
    try {
        const content = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed.keys)) parsed.keys = [];
        return parsed;
    } catch (err) {
        console.error('Error reading file database:', err);
        if (fs.existsSync(BACKUP_FILE)) {
            try {
                const bakContent = fs.readFileSync(BACKUP_FILE, 'utf8');
                const parsed = JSON.parse(bakContent);
                if (!Array.isArray(parsed.keys)) parsed.keys = [];
                return parsed;
            } catch (e) {}
        }
        return { keys: [], lastId: 0 };
    }
}

/**
 * Safe atomic file write
 */
function writeLocalFile(data) {
    try {
        const jsonStr = JSON.stringify(data, null, 2);
        const tmpPath = path.join(DATA_DIR, `.tmp_${Date.now()}.json`);
        
        fs.writeFileSync(tmpPath, jsonStr, 'utf8');
        fs.writeFileSync(PERSIST_FILE, jsonStr, 'utf8');
        fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
        try { fs.unlinkSync(tmpPath); } catch (e) {}
        return true;
    } catch (err) {
        console.error('Error writing to persistent storage:', err);
        return false;
    }
}

/**
 * Create a safe backup of existing db.json records
 */
function backupExistingData() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const content = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(content);
            if (parsed && Array.isArray(parsed.keys) && parsed.keys.length > 0) {
                fs.writeFileSync(BACKUP_FILE, content, 'utf8');
                fs.writeFileSync(path.join(DATA_DIR, 'db.json.bak'), content, 'utf8');
                console.log(`[Database] Safe backup created with ${parsed.keys.length} existing record(s).`);
            }
        }
    } catch (err) {
        console.error('[Database] Backup warning:', err.message);
    }
}

/**
 * Initialize persistent database & perform auto-migration
 */
async function initDb() {
    backupExistingData();
    const initialData = readLocalFile();

    // Migration helper: Set 23:59:59 IST expiration on any key missing proper expiry
    initialData.keys.forEach(k => {
        if (!k.expires_at) {
            const created = k.created_at ? new Date(k.created_at) : new Date();
            k.expires_at = getISTEndOfDayISO(created);
        }
    });
    writeLocalFile(initialData);

    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
    const pgUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    // 1. Try MongoDB Connection if URI configured
    if (mongoUri) {
        try {
            console.log('[Database] MONGODB_URI detected. Connecting to MongoDB...');
            await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
            
            const KeySchema = new mongoose.Schema({
                id: { type: Number, required: true, unique: true },
                customer_name: { type: String, required: true },
                customer_id: { type: String, required: true },
                raw_key: { type: String, required: true },
                key_hash: { type: String, required: true },
                created_at: { type: String, required: true },
                expires_at: { type: String, required: true },
                status: { type: String, default: 'ACTIVE' },
                version: { type: String, default: 'v1' }
            });

            MongoModel = mongoose.models.CustomerKey || mongoose.model('CustomerKey', KeySchema);
            dbDriver = 'MONGO';
            console.log('[Database] Connected to MongoDB successfully.');

            // Migrate local keys to MongoDB
            for (const key of initialData.keys) {
                const exists = await MongoModel.findOne({ id: key.id });
                if (!exists) {
                    await MongoModel.create(key);
                    console.log(`[Database] Migrated customer key ID ${key.id} (${key.customer_name}) to MongoDB.`);
                }
            }
            return;
        } catch (err) {
            console.error('[Database] MongoDB connection failed. Falling back to next driver.', err.message);
        }
    }

    // 2. Try PostgreSQL Connection if URL configured
    if (pgUrl) {
        try {
            console.log('[Database] DATABASE_URL detected. Connecting to PostgreSQL...');
            pgPool = new Pool({
                connectionString: pgUrl,
                ssl: pgUrl.includes('localhost') ? false : { rejectUnauthorized: false }
            });

            await pgPool.query(`
                CREATE TABLE IF NOT EXISTS customer_keys (
                    id INT PRIMARY KEY,
                    customer_name TEXT NOT NULL,
                    customer_id TEXT NOT NULL,
                    raw_key TEXT NOT NULL,
                    key_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    version TEXT DEFAULT 'v1'
                );
            `);

            dbDriver = 'POSTGRES';
            console.log('[Database] Connected to PostgreSQL successfully.');

            // Migrate local keys to PostgreSQL
            for (const k of initialData.keys) {
                await pgPool.query(`
                    INSERT INTO customer_keys (id, customer_name, customer_id, raw_key, key_hash, created_at, expires_at, status, version)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (id) DO NOTHING;
                `, [k.id, k.customer_name, k.customer_id, k.raw_key, k.key_hash, k.created_at, k.expires_at, k.status, k.version || 'v1']);
            }
            return;
        } catch (err) {
            console.error('[Database] PostgreSQL connection failed. Falling back to local store.', err.message);
        }
    }

    // 3. Fallback: Local Persistent File Driver
    dbDriver = 'FILE';
    console.log('[Database] Using Local Persistent Storage (server/data/customer_keys.json).');
}

/**
 * Returns all customer keys, automatically updating status of keys past 23:59:59 IST
 */
async function getAllCustomerKeys() {
    const now = new Date();

    if (dbDriver === 'MONGO' && MongoModel) {
        try {
            const records = await MongoModel.find({}).sort({ id: -1 }).lean();
            for (const k of records) {
                if (k.status === 'ACTIVE' && k.expires_at) {
                    if (now > new Date(k.expires_at)) {
                        await MongoModel.updateOne({ id: k.id }, { status: 'EXPIRED' });
                        k.status = 'EXPIRED';
                    }
                }
            }
            return records;
        } catch (err) {
            console.error('[Database] MongoDB getAllCustomerKeys error:', err.message);
        }
    }

    if (dbDriver === 'POSTGRES' && pgPool) {
        try {
            const res = await pgPool.query('SELECT * FROM customer_keys ORDER BY id DESC;');
            const records = res.rows;
            for (const k of records) {
                if (k.status === 'ACTIVE' && k.expires_at) {
                    if (now > new Date(k.expires_at)) {
                        await pgPool.query('UPDATE customer_keys SET status = $1 WHERE id = $2;', ['EXPIRED', k.id]);
                        k.status = 'EXPIRED';
                    }
                }
            }
            return records;
        } catch (err) {
            console.error('[Database] PostgreSQL getAllCustomerKeys error:', err.message);
        }
    }

    // Local file fallback
    const dbData = readLocalFile();
    let modified = false;

    dbData.keys.forEach(k => {
        if (k.status === 'ACTIVE' && k.expires_at) {
            if (now > new Date(k.expires_at)) {
                k.status = 'EXPIRED';
                modified = true;
            }
        }
    });

    if (modified) writeLocalFile(dbData);
    return dbData.keys;
}

/**
 * Creates a unique key for a specific customer.
 * Key expires automatically at 23:59:59 IST of the day it is created.
 */
async function createCustomerKey(customerName, customerId, rawKey, keyHash, expiresAt, version = 'v1') {
    const allKeys = await getAllCustomerKeys();
    let maxId = 0;
    allKeys.forEach(k => {
        if (Number(k.id) > maxId) maxId = Number(k.id);
    });
    const newId = maxId + 1;

    const nameStr = customerName ? customerName.trim() : 'Customer';
    const idStr = customerId && customerId.trim() ? customerId.trim() : `CUST-${String(newId).padStart(3, '0')}`;

    // Default expiration: 23:59:59 IST of current day
    const finalExpiresAt = expiresAt || getISTEndOfDayISO();

    const newRecord = {
        id: newId,
        customer_name: nameStr,
        customer_id: idStr,
        raw_key: rawKey,
        key_hash: keyHash,
        created_at: new Date().toISOString(),
        expires_at: finalExpiresAt,
        status: 'ACTIVE',
        version: version
    };

    if (dbDriver === 'MONGO' && MongoModel) {
        try {
            await MongoModel.create(newRecord);
            return newRecord;
        } catch (err) {
            console.error('[Database] MongoDB createCustomerKey error:', err.message);
        }
    }

    if (dbDriver === 'POSTGRES' && pgPool) {
        try {
            await pgPool.query(`
                INSERT INTO customer_keys (id, customer_name, customer_id, raw_key, key_hash, created_at, expires_at, status, version)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
            `, [newRecord.id, newRecord.customer_name, newRecord.customer_id, newRecord.raw_key, newRecord.key_hash, newRecord.created_at, newRecord.expires_at, newRecord.status, newRecord.version]);
            return newRecord;
        } catch (err) {
            console.error('[Database] PostgreSQL createCustomerKey error:', err.message);
        }
    }

    // Local file fallback
    const dbData = readLocalFile();
    dbData.lastId = newId;
    dbData.keys.unshift(newRecord);
    writeLocalFile(dbData);
    return newRecord;
}

/**
 * Verifies a customer key against persistent database
 */
async function verifyCustomerKey(keyHash) {
    const keys = await getAllCustomerKeys();
    const now = new Date();

    const record = keys.find(k => k.key_hash === keyHash);
    if (!record) {
        return { status: 'NOT_FOUND', valid: false, message: 'Invalid access key.' };
    }

    if (record.status === 'REVOKED' || record.status === 'DEACTIVATED') {
        return { status: 'REVOKED', valid: false, message: 'Your access key has been deactivated.' };
    }

    if (record.expires_at && now > new Date(record.expires_at)) {
        if (record.status === 'ACTIVE') {
            record.status = 'EXPIRED';
            await getAllCustomerKeys();
        }
        return { status: 'EXPIRED', valid: false, message: 'Your access key has expired.' };
    }

    if (record.status === 'EXPIRED') {
        return { status: 'EXPIRED', valid: false, message: 'Your access key has expired.' };
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

    return { status: 'NOT_FOUND', valid: false, message: 'Invalid access key.' };
}

/**
 * Finds active key by SHA-256 hash
 */
async function findActiveKeyByHash(keyHash) {
    const result = await verifyCustomerKey(keyHash);
    if (result.status === 'ACTIVE') return result.record;
    return null;
}

/**
 * Revokes a key by ID
 */
async function revokeKeyById(keyId) {
    if (dbDriver === 'MONGO' && MongoModel) {
        try {
            const res = await MongoModel.updateOne({ id: Number(keyId), status: 'ACTIVE' }, { status: 'REVOKED' });
            return res.modifiedCount > 0;
        } catch (err) {
            console.error('[Database] MongoDB revokeKeyById error:', err.message);
        }
    }

    if (dbDriver === 'POSTGRES' && pgPool) {
        try {
            const res = await pgPool.query('UPDATE customer_keys SET status = $1 WHERE id = $2 AND status = $3;', ['REVOKED', Number(keyId), 'ACTIVE']);
            return res.rowCount > 0;
        } catch (err) {
            console.error('[Database] PostgreSQL revokeKeyById error:', err.message);
        }
    }

    // Local file fallback
    const dbData = readLocalFile();
    const record = dbData.keys.find(k => String(k.id) === String(keyId));
    if (record && record.status === 'ACTIVE') {
        record.status = 'REVOKED';
        writeLocalFile(dbData);
        return true;
    }
    return false;
}

/**
 * Deletes a key record by ID
 */
async function deleteKeyById(keyId) {
    if (dbDriver === 'MONGO' && MongoModel) {
        try {
            const res = await MongoModel.deleteOne({ id: Number(keyId) });
            return res.deletedCount > 0;
        } catch (err) {
            console.error('[Database] MongoDB deleteKeyById error:', err.message);
        }
    }

    if (dbDriver === 'POSTGRES' && pgPool) {
        try {
            const res = await pgPool.query('DELETE FROM customer_keys WHERE id = $1;', [Number(keyId)]);
            return res.rowCount > 0;
        } catch (err) {
            console.error('[Database] PostgreSQL deleteKeyById error:', err.message);
        }
    }

    // Local file fallback
    const dbData = readLocalFile();
    const initialLen = dbData.keys.length;
    dbData.keys = dbData.keys.filter(k => String(k.id) !== String(keyId));
    if (dbData.keys.length !== initialLen) {
        writeLocalFile(dbData);
        return true;
    }
    return false;
}

/**
 * Helper: Get active keys
 */
async function getActiveKey() {
    const keys = await getAllCustomerKeys();
    const activeKeys = keys.filter(k => k.status === 'ACTIVE');
    return activeKeys.length > 0 ? activeKeys[0] : null;
}

/**
 * Helper: Revoke active key
 */
async function revokeActiveKey() {
    const active = await getActiveKey();
    if (active) {
        return await revokeKeyById(active.id);
    }
    return false;
}

module.exports = {
    getISTEndOfDayISO,
    initDb,
    getAllCustomerKeys,
    createCustomerKey,
    verifyCustomerKey,
    findActiveKeyByHash,
    revokeKeyById,
    deleteKeyById,
    getActiveKey,
    revokeActiveKey
};
