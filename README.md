# PayMe — Secure Local Payment Gateway

A self-hosted, LAN-based payment application with user accounts, real-time transfers, and QR code payments. Built with Node.js/Express on the backend and vanilla HTML/CSS/JS on the frontend.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [HTTPS Setup (mkcert)](#https-setup-mkcert)
- [Configuration](#configuration)
- [Running the Server](#running-the-server)
- [Usage Guide](#usage-guide)
- [API Reference](#api-reference)
- [Data Storage](#data-storage)
- [QR Code Workflow](#qr-code-workflow)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)

---

## Overview

PayMe is a local-network payment system designed for trusted environments such as small offices, events, or households. Users can sign up for accounts, send money to each other by PayMe ID, generate QR codes to receive payments, and scan QR codes to pay others — all over your local Wi-Fi network without any internet dependency.

---

## Features

- **User Accounts** — Sign up with a username, password, full name, and email. Each account gets a unique PayMe ID (e.g. `PAYME-A3Z9`) and a starting balance of ₹600.
- **Pay by ID** — Send money directly to another user by entering their PayMe ID. Includes live recipient lookup with validation before sending.
- **QR Code Payments** — Generate a QR code for a specific amount. Anyone on the network can scan it and pay instantly. QR codes expire after 5 minutes.
- **QR Scanner** — Built-in camera scanner using the native `BarcodeDetector` API with a `jsQR` fallback for broader browser support.
- **Transaction History** — Full per-user transaction log showing credits, debits, timestamps, payment method, and optional notes.
- **HTTPS on LAN** — Runs over HTTPS using locally trusted certificates (via mkcert), required for camera access on mobile browsers.
- **No Database Required** — All data is stored as JSON files on disk. Zero external dependencies beyond Node.js packages.

---

## Project Structure

```
payme/
├── server.js             # Express server — all API routes and HTTPS setup
├── index.html            # Main app (auth + dashboard + all payment modes)
├── pay.html              # QR payment landing page (opened from scanned link)
├── style.css             # Legacy stylesheet (superseded by inline styles in index.html)
├── script.js             # Legacy client script (superseded by inline JS in index.html)
├── server.json           # Global payments log (auto-created, append-only)
├── accounts/             # Per-user JSON account files (auto-created)
│   └── <username>.json
├── qrcode.py             # Utility script to generate a QR code PNG for the server URL
├── requirements.txt      # Python dependencies for qrcode.py
├── package.json          # Node.js dependencies
└── 192.168.1.4.pem       # TLS certificate (you generate this — see HTTPS Setup)
└── 192.168.1.4-key.pem   # TLS private key  (you generate this — see HTTPS Setup)
```

---

## Prerequisites

- **Node.js** v16 or higher
- **npm** v8 or higher
- **mkcert** (for generating locally trusted HTTPS certificates)
- **Python 3** (optional — only needed for `qrcode.py`)

---

## Installation

**1. Clone or download the project:**

```bash
git clone <your-repo-url>
cd payme
```

**2. Install Node.js dependencies:**

```bash
npm install
```

**3. (Optional) Install Python dependencies for the QR utility script:**

```bash
pip install -r requirements.txt
```

---

## HTTPS Setup (mkcert)

Camera access (required for the QR scanner) is blocked by browsers on non-HTTPS pages. You must generate a locally trusted certificate for your machine's LAN IP address.

**1. Install mkcert:**

```bash
# macOS
brew install mkcert

# Linux (Debian/Ubuntu)
sudo apt install libnss3-tools
curl -L https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v*-linux-amd64 -o mkcert
chmod +x mkcert && sudo mv mkcert /usr/local/bin/

# Windows — download from https://github.com/FiloSottile/mkcert/releases
```

**2. Install the local root CA (run once per machine):**

```bash
mkcert -install
```

**3. Find your LAN IP address:**

```bash
# Linux/macOS
ip addr show   # or: hostname -I

# Windows
ipconfig
```

**4. Generate the certificate for your IP:**

```bash
mkcert 192.168.1.4   # Replace with your actual LAN IP
```

This creates two files: `192.168.1.4.pem` and `192.168.1.4-key.pem`. Place them in the project root directory.

> **For other devices on the network (phones, tablets):** Install the mkcert root CA on each device. The CA file is located at the path shown by `mkcert -CAROOT`. Transfer `rootCA.pem` to each device and install it as a trusted certificate.

---

## Configuration

Open `server.js` and update the following values to match your setup:

```js
// Line ~12: path to your mkcert-generated certificate files
const HTTPS_OPTIONS = {
  key:  fs.readFileSync(path.join(__dirname, '192.168.1.4-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, '192.168.1.4.pem'))
};

// Line ~135: fallback IP if auto-detection fails
return '192.168.1.6'; // Change to your actual LAN IP
```

Open `index.html` and verify the server URL construction:

```js
// This is auto-derived from the browser's hostname, so no manual edit needed
// unless you're running on a non-standard port
const SERVER = `http://${location.hostname}:3000`;
```

> **Note:** `index.html` uses `http://` for the server URL because it's served from the same host. If you encounter mixed-content errors, change it to `https://`.

Also update `qrcode.py` if you use it:

```python
image = qrcode.make('http://192.168.1.5:3000/')  # Update to your server's IP
```

---

## Running the Server

```bash
npm start
# or
node server.js
```

You will see output like:

```
🚀  PayMe server started with HTTPS!

   Local:    https://localhost:3000
   Network:  https://192.168.1.4:3000

📁  Accounts: /path/to/payme/accounts
📄  Payments: /path/to/payme/server.json
```

Open `https://<your-LAN-IP>:3000` in your browser. You may need to accept a certificate warning on first visit if you haven't installed the mkcert root CA.

---

## Usage Guide

### Creating an Account

1. Open the app in your browser.
2. Click **Sign Up** and fill in your full name, email, username, and password (minimum 6 characters).
3. Your account is created with a starting balance of ₹600 and a unique PayMe ID.

### Paying by PayMe ID

1. Log in and ensure **Pay by ID** mode is selected (the default).
2. Enter the recipient's PayMe ID (e.g. `PAYME-A3Z9`) in the recipient field.
3. The app will look up and display the recipient's name in real time.
4. Enter the amount (or use the quick-select buttons) and an optional note.
5. Click **Send** to complete the transfer.

### Receiving via QR Code

1. Switch to the **My QR** tab.
2. Enter the amount you want to receive and click **Generate QR Code**.
3. A QR code is displayed with a 5-minute countdown timer.
4. Show or share the QR code. When scanned and paid, you'll be notified automatically and your balance will update.

### Paying by Scanning a QR Code

1. Switch to the **Scan QR** tab.
2. Click **Start Camera** and grant camera permissions.
3. Point the camera at a PayMe QR code.
4. Once detected, the recipient's name and amount are shown.
5. Enter your password to confirm, then click **Confirm & Pay**.

### Pay via Link (pay.html)

QR codes encode a URL of the form `https://<server-ip>:3000/pay/<token>`. Opening this URL in any browser on the network takes the user directly to a payment confirmation page where they enter their name and complete the payment — no account required for the payer.

---

## API Reference

All endpoints are served over HTTPS on port 3000.

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/signup` | Create a new account |
| `POST` | `/auth/login` | Authenticate and retrieve account info |
| `GET`  | `/account/:username` | Fetch account details (balance, transactions) |
| `GET`  | `/user/lookup/:userId` | Look up a user by their PayMe ID |

**Signup body:**
```json
{
  "username": "arjun_s",
  "password": "secret123",
  "fullName": "Arjun Sharma",
  "email": "arjun@example.com"
}
```

**Login body:**
```json
{ "username": "arjun_s", "password": "secret123" }
```

---

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/payment/send` | Transfer money between two accounts |
| `GET`  | `/payments` | Retrieve the global payments log |

**Send payment body:**
```json
{
  "senderUsername": "arjun_s",
  "recipientUserId": "PAYME-A3Z9",
  "amount": 500,
  "note": "Lunch split"
}
```

---

### QR Codes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/qr/generate` | Generate a QR code for a payment request |
| `GET`  | `/qr/status/:token` | Check if a QR token is valid / has been paid |
| `GET`  | `/pay/:token` | Serve the `pay.html` payment landing page |
| `POST` | `/qr/pay` | Complete a payment via QR token |

**Generate QR body:**
```json
{ "username": "arjun_s", "amount": 250 }
```

**QR pay body:**
```json
{
  "token": "uuid-token-here",
  "payerName": "Priya Kapoor",
  "senderUsername": "priya_k"   // optional — omit for guest payers
}
```

---

## Data Storage

### Account files (`accounts/<username>.json`)

Each user has a JSON file containing:

```json
{
  "username": "arjun_s",
  "userId": "PAYME-A3Z9",
  "fullName": "Arjun Sharma",
  "email": "arjun@example.com",
  "passwordHash": "<sha256 hex>",
  "balance": 350.00,
  "currency": "INR",
  "createdAt": "2026-05-15T10:00:00.000Z",
  "transactions": [ /* array of transaction objects, newest first */ ]
}
```

### Global log (`server.json`)

All completed payments are appended here in order:

```json
{
  "payments": [
    {
      "transaction_id": "TXN-ABC123XY",
      "type": "transfer",
      "amount_inr": 500,
      "amount_display": "₹500.00",
      "sender_username": "arjun_s",
      "recipient_username": "priya_k",
      "status": "success",
      "paid_at": "2026-05-15T10:05:00.000Z"
    }
  ]
}
```

---

## QR Code Workflow

```
Recipient generates QR  →  Token stored in memory (5 min TTL)
        ↓
QR encodes URL: https://<ip>:3000/pay/<token>
        ↓
Payer opens URL or scans QR  →  GET /qr/status/:token (validates)
        ↓
Payer submits name (+ optional account login)  →  POST /qr/pay
        ↓
Server: marks token used, updates balances, appends to logs
        ↓
Recipient's dashboard polls /qr/status  →  detects 'already_used'  →  balance refreshes
```

> QR tokens are stored in memory only and are cleared on server restart or after expiry. They are not persisted to disk.

---

## Security Notes

- **Passwords** are hashed with SHA-256 + a static salt before storage. For a production system, use bcrypt or Argon2.
- **Authentication** is stateless — there are no sessions or JWTs. The client re-sends credentials when needed (e.g. to confirm QR payments). This is acceptable for a trusted LAN but not suitable for public-facing deployments.
- **HTTPS** is enforced via mkcert-generated certificates. Without HTTPS, camera access for QR scanning will be blocked by browsers.
- **CORS** is open (`cors()` with no restrictions). Restrict this if deploying beyond a trusted local network.
- **This project is intended for use on a trusted local network only.** Do not expose it to the internet without significant hardening.

---

## Troubleshooting

**"Cannot reach server" error in the browser**
- Confirm `node server.js` is running and shows no errors.
- Check that the IP in `server.js` and your certificate filename match your actual LAN IP (`ip addr` or `ipconfig`).
- Ensure port 3000 is not blocked by a firewall.

**Camera not starting / QR scanner doesn't work**
- The page must be served over HTTPS. Confirm you're accessing via `https://`, not `http://`.
- On mobile, install the mkcert root CA certificate and trust it in your device settings.
- Grant camera permissions when prompted by the browser.

**Certificate error on first visit**
- If you see a browser warning, the mkcert root CA isn't installed on that device yet. Install `rootCA.pem` (found at `mkcert -CAROOT`) and mark it as trusted.

**QR code shows as expired immediately**
- The server clock and client clock may be out of sync. Ensure both devices are using NTP-synchronized time.

**`accounts/` directory is missing or empty**
- It is created automatically on first signup. If the server lacks write permissions to the project directory, create the folder manually: `mkdir accounts`.
