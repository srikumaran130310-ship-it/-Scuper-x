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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve User Portal Static Files
app.use(express.static(path.join(__dirname, '../user')));

// Main Route: User Portal at /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../user/index.html'));
});

// Root HTML fallback
app.get('/⚡%20SCUPER%20X.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../user/index.html'));
});

// ════════════════════════════════════════════════════
//  API ENDPOINTS
// ════════════════════════════════════════════════════

/**
 * Access Key Verification
 * POST /api/auth/verify-key
 */
app.post('/api/auth/verify-key', (req, res) => {
    const { key } = req.body || {};
    const permanentKey = process.env.ACCESS_KEY || 'DAILYEDGE2026';

    if (!key || typeof key !== 'string' || key.trim() !== permanentKey.trim()) {
        return res.status(400).json({
            valid: false,
            message: 'Invalid access key'
        });
    }

    return res.json({
        valid: true,
        message: 'Key verified'
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`
====================================================
 ⚡ SCUPER X Daily Edge AI Predictor System ⚡
 User Portal: http://localhost:${PORT}/
====================================================
`);
});
