# ⚡ SCUPER X - Production Portal System

SCUPER X is an AI Predictor web application featuring a complete separation between the public **User Portal** and the secure **Admin Control Panel**.

---

## 📁 Final Folder Structure

```
SCUPER-X/
├── user/
│   └── index.html          # Public User Portal (Login, Predictor, History, Stats, Profile, Telegram link)
│
├── admin/
│   └── index.html          # Isolated Admin Portal (Password Auth, Single Active Key Card)
│
├── server/
│   ├── server.js           # Main Express HTTP Server & REST API Endpoints
│   ├── auth.js             # Security, Hashing (SHA-256), Session & Rate Limiting
│   └── database.js         # JSON Database Persistence Layer (`db.json`)
│
├── package.json            # Node.js Project Dependencies & Scripts
├── .env                    # Environment Configuration File
└── README.md               # Project Deployment & Operations Manual
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
ADMIN_PASSWORD=Admin@Scuper2026
SESSION_SECRET=scuper_x_secret_session_key_2026
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

### How to Generate a New Daily Key
1. Open the Admin Control Panel at `http://localhost:3000/admin`.
2. Enter your Admin Username (`srikumaran`) and Password (`srikumaran1307).
3. Click **`[ 🎲 GENERATE NEW KEY ]`**.
4. The system will:
   - Revoke the previously active key.
   - Generate a cryptographically secure 16-character key (`SCX-XXXX-XXXX-XXXX`).
   - Store the SHA-256 hash in `server/db.json`.
   - Display the new key in your admin card.
   - Expire automatically at `23:59:59 UTC`.

---

## 🌐 Production Deployment Instructions

### Deploying to Render / Railway / Heroku / VPS
1. Upload/Push the repository to GitHub.
2. Set Environment Variables on your hosting provider:
   - `PORT` = `3000` (or dynamic port provided by cloud provider)
   - `ADMIN_USERNAME` = your chosen admin ID
   - `ADMIN_PASSWORD` = your strong admin password
   - `SESSION_SECRET` = your secret key
3. Build Command: `npm install`
4. Start Command: `npm start`
