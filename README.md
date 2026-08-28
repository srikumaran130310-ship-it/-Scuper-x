# ⚡ SCUPER X - Daily Edge AI Predictor System

SCUPER X is a Daily Edge AI Predictor web application using a single permanent shared access key stored as a server environment variable (`ACCESS_KEY`).

---

## 📁 Project Structure

```
preduction/
├── user/
│   └── index.html          # Public User Portal & Verification Screen
├── server/
│   └── server.js           # Main Express HTTP Server & API Endpoints
├── package.json            # Node.js Project Dependencies & Scripts
├── .env                    # Environment Configuration File
└── README.md               # Operations & Deployment Guide
```

---

## 🚀 Quick Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create or verify `.env` file in the root directory:
```env
PORT=3000
NODE_ENV=production
ACCESS_KEY=DAILYEDGE2026
```

### 3. Start Server
```bash
npm start
```

---

## 🔑 Access Key System

- **Single Permanent Access Key**: Stored server-side in `ACCESS_KEY`.
- **Session Verification**: Key verified on backend via `/api/auth/verify-key`. Users stay verified for their browser session.
- **No Daily Expiry**: Permanent key does not automatically change or expire daily.
