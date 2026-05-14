const express  = require('express');
const fs        = require('fs');
const path      = require('path');
const cors      = require('cors');
const os        = require('os');
const crypto    = require('crypto');
const QRCode    = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app       = express();
const PORT      = 3000;
const DATA_DIR  = path.join(__dirname, 'accounts');
const PAYMENTS_FILE = path.join(__dirname, 'server.json');

// Ensure accounts directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// In-memory QR store: { token -> { username, amount, expiresAt, used } }
const qrStore = {};

// Clean expired QR codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of Object.entries(qrStore)) {
    if (data.expiresAt < now) delete qrStore[token];
  }
}, 60_000);

/* ── Helpers ── */
function accountPath(username) {
  return path.join(DATA_DIR, `${username.toLowerCase()}.json`);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'payme_salt_2026').digest('hex');
}

function getAccount(username) {
  const p = accountPath(username);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveAccount(data) {
  fs.writeFileSync(accountPath(data.username), JSON.stringify(data, null, 2), 'utf8');
}

/* ── Routes ── */

// Sign Up
app.post('/auth/signup', (req, res) => {
  const { username, password, fullName, email } = req.body;
  if (!username || !password || !fullName || !email)
    return res.status(400).json({ error: 'All fields are required.' });

  const usernameSafe = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (usernameSafe.length < 3)
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });

  if (getAccount(usernameSafe))
    return res.status(409).json({ error: 'Username already taken.' });

  const account = {
    username    : usernameSafe,
    fullName,
    email,
    passwordHash: hashPassword(password),
    balance     : 600.00,
    currency    : 'INR',
    createdAt   : new Date().toISOString(),
    transactions: []
  };

  saveAccount(account);
  console.log(`✅  New account created: ${usernameSafe} (${fullName})`);

  res.json({ success: true, username: usernameSafe, fullName, balance: account.balance });
});

// Log In
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const account = getAccount(username.toLowerCase());
  if (!account || account.passwordHash !== hashPassword(password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  console.log(`🔑  Login: ${account.username}`);
  res.json({
    success : true,
    username: account.username,
    fullName: account.fullName,
    balance : account.balance,
    currency: account.currency,
  });
});

// Get account info
app.get('/account/:username', (req, res) => {
  const account = getAccount(req.params.username);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  const { passwordHash, ...safe } = account;
  res.json(safe);
});

// Generate QR code for payment
app.post('/qr/generate', (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount || amount <= 0)
    return res.status(400).json({ error: 'Username and valid amount required.' });

  const account = getAccount(username);
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  // Each QR is unique: username + amount + random uuid + timestamp
  const token     = uuidv4();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  qrStore[token] = { username, amount: parseFloat(amount), expiresAt, used: false };

  // QR encodes a URL that can be opened by payer
  const payUrl = `http://${getLanIP()}:${PORT}/pay/${token}`;

  QRCode.toDataURL(payUrl, {
    width  : 300,
    margin : 2,
    color  : { dark: '#0d0d0d', light: '#f5f1eb' }
  }, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'QR generation failed.' });

    console.log(`📱  QR generated for ${username}: ₹${amount} | token: ${token.slice(0,8)}…`);
    res.json({
      success   : true,
      token,
      qrDataUrl : dataUrl,
      payUrl,
      amount    : parseFloat(amount),
      expiresAt,
      expiresIn : 300 // seconds
    });
  });
});

// Get QR status (check if still valid)
app.get('/qr/status/:token', (req, res) => {
  const data = qrStore[req.params.token];
  if (!data) return res.json({ valid: false, reason: 'expired_or_invalid' });
  if (data.used) return res.json({ valid: false, reason: 'already_used' });
  if (data.expiresAt < Date.now()) return res.json({ valid: false, reason: 'expired' });
  res.json({ valid: true, username: data.username, amount: data.amount, expiresAt: data.expiresAt });
});

// Serve payer page (when someone scans QR)
app.get('/pay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'pay.html'));
});

// Process QR payment (called by payer after scanning)
app.post('/qr/pay', (req, res) => {
  const { token, payerName } = req.body;
  if (!token || !payerName)
    return res.status(400).json({ error: 'Token and payer name required.' });

  const data = qrStore[token];
  if (!data) return res.status(400).json({ error: 'QR code expired or invalid.' });
  if (data.used) return res.status(400).json({ error: 'QR code already used.' });
  if (data.expiresAt < Date.now()) return res.status(400).json({ error: 'QR code expired.' });

  // Mark QR as used
  qrStore[token].used = true;

  const account = getAccount(data.username);
  if (!account) return res.status(404).json({ error: 'Recipient account not found.' });

  const txnId = 'TXN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
  const txn   = {
    transaction_id: txnId,
    payer_name    : payerName,
    amount_inr    : data.amount,
    amount_display: '₹' + Number(data.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    status        : 'success',
    paid_at       : new Date().toISOString(),
    paid_at_local : new Date().toLocaleString('en-IN'),
    qr_token      : token
  };

  // Add to recipient's account transactions + update balance
  account.balance = parseFloat((account.balance + data.amount).toFixed(2));
  account.transactions.unshift(txn);
  saveAccount(account);

  // Also append to global server.json
  let globalData = { payments: [] };
  if (fs.existsSync(PAYMENTS_FILE)) {
    try { globalData = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8')); }
    catch { globalData = { payments: [] }; }
  }
  if (!Array.isArray(globalData.payments)) globalData.payments = [];
  globalData.payments.push({ ...txn, recipient: data.username });
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(globalData, null, 2), 'utf8');

  console.log(`💰  Payment: ${payerName} → ${data.username} | ₹${data.amount} | ${txnId}`);
  res.json({ success: true, transaction_id: txnId, amount: data.amount, recipient: account.fullName });
});

// Standard payment (manual, from original flow)
app.post('/payment', (req, res) => {
  const { id, payer_name, amount_inr, amount_display, status, paid_at, paid_at_local } = req.body;
  if (!id || !payer_name || !amount_inr)
    return res.status(400).json({ error: 'Missing required payment fields.' });

  let data = { payments: [] };
  if (fs.existsSync(PAYMENTS_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'));
      if (!Array.isArray(data.payments)) data.payments = [];
    } catch { data = { payments: [] }; }
  }
  data.payments.push({ transaction_id: id, payer_name, amount_inr, amount_display, status: status || 'success', paid_at, paid_at_local });
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅  Payment saved → ${id} | ${payer_name} | ${amount_display}`);
  res.json({ success: true, transaction_id: id });
});

app.get('/payments', (req, res) => {
  if (!fs.existsSync(PAYMENTS_FILE)) return res.json({ payments: [] });
  try { res.json(JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'))); }
  catch { res.json({ payments: [] }); }
});

function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const lanIP = getLanIP();
  console.log('\n🚀  PayMe server started!\n');
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://${lanIP}:${PORT}\n`);
  console.log(`📁  Account files saved in: ${DATA_DIR}`);
  console.log(`📄  Global payments log:    server.json`);
  console.log('--------------------------------------------------');
});