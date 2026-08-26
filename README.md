# ⚡ SCUPER X - Customer-Wise Unique Key Management System

SCUPER X is an AI Predictor web application featuring complete separation between the public **User Portal** and the secure **Admin Control Panel**, now supporting **Customer-Wise Unique Key Management**.

---

## 📁 Project Structure

```
SCUPER-X/
├── user/
│   └── index.html          # Public User Portal (Predictor, History, Stats, Profile, Telegram channel link)
│
├── admin/
│   └── index.html          # Isolated Admin Panel (Customer Unique Key Management)
│
├── server/
│   ├── server.js           # Main Express HTTP Server & REST API Endpoints
│   ├── auth.js             # Security, SHA-256 Hashing, Session & Rate Limiting
│   └── database.js         # JSON Database Persistence Layer (`db.json`)
│
├── package.json            # Node.js Project Dependencies & Scripts
├── .env                    # Environment Configuration File (Secret keys & passwords)
└── README.md               # Operations & Deployment Guide
```

---

## 🚀 Quick Setup & Installation

### 1. Install Dependencies
Run the installation command in your project directory:
```bash
npm install
```

### 2. Configure Environment Variables
Create or verify `.env` file in the root directory:
```env
PORT=3000
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_admin_password
SESSION_SECRET=your_random_64_char_session_secret
```

### 3. Start Server
Run the production start command:
```bash
npm start
```

---

## 🔗 Portals & URLs

- **User Portal**: `http://localhost:3000/` (or `https://YOUR-DOMAIN.com/`)
- **Admin Control Panel**: `http://localhost:3000/admin` (or `https://YOUR-DOMAIN.com/admin`)

> **Note**: The Admin Portal URL is private and known only to the administrator. No admin links, buttons, or password hints exist in the user portal.

---

## 🔑 Key Management Operations

### How to Generate a Customer Unique Key
1. Open the Admin Control Panel at `http://localhost:3000/admin`.
2. Enter your Admin Username and Password (configured in your `.env`).
3. Under **GENERATE UNIQUE CUSTOMER KEY**:
   - Enter Customer Name (e.g. `John Doe`)
   - Enter optional Customer ID / Username (e.g. `CUST-101`)
   - Click **`[ 🎲 GENERATE UNIQUE KEY FOR CUSTOMER ]`**.
4. The system will:
   - Generate a cryptographically secure 16-character key (`SCX-XXXX-XXXX-XXXX`).
   - Store the SHA-256 hash and customer metadata in `server/db.json`.
   - Display the new key in the **CUSTOMER ACCESS KEYS** table with options to Copy, Revoke, or Delete.
   - Expire automatically at `23:59:59 UTC`.

---

## 🌐 Production Deployment Instructions

### Deploying to Render / Railway / VPS
1. Upload/Push the repository to GitHub.
2. Set Environment Variables on your hosting provider:
   - `PORT` = `3000` (or dynamic port provided by cloud provider)
   - `ADMIN_USERNAME` = your chosen admin ID
   - `ADMIN_PASSWORD` = your strong admin password
   - `SESSION_SECRET` = your secret key
3. Build Command: `npm install`
4. Start Command: `npm start`
