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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ── In-memory QR store (auto-purge expired) ── */
const qrStore = {};
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of Object.entries(qrStore))
    if (data.expiresAt < now) delete qrStore[token];
}, 60_000);

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function accountPath(username) {
  return path.join(DATA_DIR, `${username.toLowerCase()}.json`);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'payme_salt_2026').digest('hex');
}

function getAccount(username) {
  if (!username) return null;
  const p = accountPath(username);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`Error reading account for ${username}:`, err);
    return null; 
  }
}
function saveAccount(data) {
  fs.writeFileSync(accountPath(data.username), JSON.stringify(data, null, 2), 'utf8');
}

function generateUserId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'PAYME-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateTxnId() {
  return 'TXN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function getAccountByUserId(userId) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const acc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      if (acc.userId === userId) return acc;
    } catch {}
  }
  return null;
}

function appendGlobalPayment(txn) {
  let globalData = { payments: [] };
  if (fs.existsSync(PAYMENTS_FILE)) {
    try { globalData = JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8')); } catch {}
  }
  if (!Array.isArray(globalData.payments)) globalData.payments = [];
  globalData.payments.push(txn);
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(globalData, null, 2), 'utf8');
}

function fmtINR(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return '192.168.1.6'; // change this to your network
}

/* ══════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════ */

app.post('/auth/signup', (req, res) => {
  const { username, password, fullName, email } = req.body;
  if (!username || !password || !fullName || !email)
    return res.status(400).json({ error: 'All fields are required.' });

  const safe = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (safe.length < 3)
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (getAccount(safe))
    return res.status(409).json({ error: 'Username already taken.' });

  let userId, attempts = 0;
  do { userId = generateUserId(); attempts++; }
  while (getAccountByUserId(userId) && attempts < 100);

  const account = {
    username: safe, userId, fullName, email,
    passwordHash: hashPassword(password),
    balance: 600.00, currency: 'INR',
    createdAt: new Date().toISOString(),
    transactions: []
  };

  saveAccount(account);
  console.log(`✅  Signup: ${safe} | ${userId} | ${fullName}`);
  res.json({ success: true, username: safe, userId, fullName, balance: account.balance });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const account = getAccount(username.toLowerCase());
  if (!account || account.passwordHash !== hashPassword(password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  console.log(`🔑  Login: ${account.username} (${account.userId})`);
  res.json({
    success: true, username: account.username,
    userId: account.userId, fullName: account.fullName,
    balance: account.balance, currency: account.currency,
  });
});

app.get('/account/:username', (req, res) => {
  const account = getAccount(req.params.username);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  const { passwordHash, ...safe } = account;
  res.json(safe);
});

app.get('/user/lookup/:userId', (req, res) => {
  const account = getAccountByUserId(req.params.userId.toUpperCase());
  if (!account) return res.status(404).json({ error: 'User ID not found.' });
  res.json({ found: true, username: account.username, fullName: account.fullName, userId: account.userId });
});

/* ══════════════════════════════════════════
   PAYMENT ROUTES
══════════════════════════════════════════ */

app.post('/payment/send', (req, res) => {
  const { senderUsername, recipientUserId, amount, note } = req.body;

  if (!senderUsername || !recipientUserId || !amount || Number(amount) <= 0)
    return res.status(400).json({ error: 'Missing or invalid fields.' });

  const sender = getAccount(senderUsername);
  if (!sender) return res.status(404).json({ error: 'Sender not found.' });

  const recipient = getAccountByUserId(recipientUserId.toUpperCase());
  if (!recipient) return res.status(404).json({ error: 'Recipient User ID not found.' });

  if (sender.username === recipient.username)
    return res.status(400).json({ error: 'Cannot send money to yourself.' });

  const amt = parseFloat(parseFloat(amount).toFixed(2));
  if (sender.balance < amt)
    return res.status(400).json({ error: `Insufficient balance. Available: ${fmtINR(sender.balance)}` });

  const txnId = generateTxnId();
  const now   = new Date();
  const base  = {
    transaction_id: txnId,
    amount_inr: amt,
    amount_display: fmtINR(amt),
    status: 'success', method: 'user_id',
    note: note || '',
    paid_at: now.toISOString(),
    paid_at_local: now.toLocaleString('en-IN'),
  };

  sender.balance    = parseFloat((sender.balance - amt).toFixed(2));
  recipient.balance = parseFloat((recipient.balance + amt).toFixed(2));

  sender.transactions.unshift({
    ...base, type: 'debit',
    counterparty: recipient.fullName,
    counterparty_id: recipient.userId,
    payer_name: sender.fullName, payer_id: sender.userId,
    recipient_name: recipient.fullName, recipient_id: recipient.userId,
  });

  recipient.transactions.unshift({
    ...base, type: 'credit',
    counterparty: sender.fullName,
    counterparty_id: sender.userId,
    payer_name: sender.fullName, payer_id: sender.userId,
    recipient_name: recipient.fullName, recipient_id: recipient.userId,
  });

  saveAccount(sender);
  saveAccount(recipient);

  appendGlobalPayment({
    ...base, type: 'transfer',
    sender_username: sender.username, sender_id: sender.userId,
    recipient_username: recipient.username, recipient_id: recipient.userId,
  });

  console.log(`💸  ${sender.username} → ${recipient.username} | ${fmtINR(amt)} | ${txnId}`);

  res.json({
    success: true,
    transaction_id: txnId,
    amount: amt, amount_display: fmtINR(amt),
    recipient_name: recipient.fullName,
    recipient_id: recipient.userId,
    new_balance: sender.balance,
  });
});

app.get('/payments', (req, res) => {
  if (!fs.existsSync(PAYMENTS_FILE)) return res.json({ payments: [] });
  try { res.json(JSON.parse(fs.readFileSync(PAYMENTS_FILE, 'utf8'))); }
  catch { res.json({ payments: [] }); }
});

/* ══════════════════════════════════════════
   QR ROUTES
══════════════════════════════════════════ */

app.post('/qr/generate', (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount || Number(amount) <= 0)
    return res.status(400).json({ error: 'Username and valid amount required.' });

  const account = getAccount(username);
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  const token     = uuidv4();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  qrStore[token] = {
    username, userId: account.userId, fullName: account.fullName,
    amount: parseFloat(amount), expiresAt, used: false,
  };

  const payUrl = `http://${getLanIP()}:${PORT}/pay/${token}`;

  QRCode.toDataURL(payUrl, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } }, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'QR generation failed.' });
    console.log(`📱  QR: ${username} | ${fmtINR(amount)} | ${token.slice(0, 8)}…`);
    res.json({ success: true, token, qrDataUrl: dataUrl, payUrl, amount: parseFloat(amount), expiresAt, expiresIn: 300 });
  });
});

app.get('/qr/status/:token', (req, res) => {
  const data = qrStore[req.params.token];
  if (!data)               return res.json({ valid: false, reason: 'expired_or_invalid' });
  if (data.used)           return res.json({ valid: false, reason: 'already_used' });
  if (data.expiresAt < Date.now()) return res.json({ valid: false, reason: 'expired' });
  res.json({ valid: true, username: data.username, userId: data.userId, fullName: data.fullName, amount: data.amount, expiresAt: data.expiresAt });
});

app.get('/pay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'pay.html'));
});

app.post('/qr/pay', (req, res) => {
  const { token, payerName, senderUsername } = req.body;
  if (!token || !payerName)
    return res.status(400).json({ error: 'Token and payer name required.' });

  const data = qrStore[token];
  if (!data)                       return res.status(400).json({ error: 'QR code expired or invalid.' });
  if (data.used)                   return res.status(400).json({ error: 'QR code already used.' });
  if (data.expiresAt < Date.now()) return res.status(400).json({ error: 'QR code expired.' });

  qrStore[token].used = true;

  const recipient = getAccount(data.username);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found.' });

  const sender = senderUsername ? getAccount(senderUsername) : null;

  if (sender) {
    if (sender.username === recipient.username)
      return res.status(400).json({ error: 'Cannot pay yourself.' });
    if (sender.balance < data.amount)
      return res.status(400).json({ error: `Insufficient balance. Available: ${fmtINR(sender.balance)}` });
  }

  const txnId = generateTxnId();
  const now   = new Date();
  const base  = {
    transaction_id: txnId,
    amount_inr: data.amount, amount_display: fmtINR(data.amount),
    status: 'success', method: 'qr_scan', note: '',
    paid_at: now.toISOString(), paid_at_local: now.toLocaleString('en-IN'),
    qr_token: token,
  };

  if (sender) {
    sender.balance = parseFloat((sender.balance - data.amount).toFixed(2));
    sender.transactions.unshift({
      ...base, type: 'debit',
      counterparty: recipient.fullName,
      counterparty_id: recipient.userId,
      payer_name: sender.fullName, payer_id: sender.userId,
      recipient_name: recipient.fullName, recipient_id: recipient.userId,
    });
    saveAccount(sender);
  }

  recipient.balance = parseFloat((recipient.balance + data.amount).toFixed(2));
  recipient.transactions.unshift({
    ...base, type: 'credit',
    counterparty: sender ? sender.fullName : payerName,
    counterparty_id: sender ? sender.userId : null,
    payer_name: sender ? sender.fullName : payerName,
    payer_id: sender ? sender.userId : null,
    recipient_name: recipient.fullName, recipient_id: recipient.userId,
  });
  saveAccount(recipient);

  appendGlobalPayment({
    ...base, type: 'qr_payment',
    sender_username: senderUsername || '(external)',
    recipient_username: data.username,
  });

  console.log(`💰  QR Pay: ${payerName} → ${data.username} | ${fmtINR(data.amount)} | ${txnId}`);

  res.json({
    success: true, transaction_id: txnId,
    amount: data.amount, amount_display: fmtINR(data.amount),
    recipient: recipient.fullName,
    new_balance: sender ? sender.balance : null,
  });
});

/* ══════════════════════════════════════════
   START
══════════════════════════════════════════ */
app.listen(PORT, '0.0.0.0', () => {
  const lanIP = getLanIP();
  console.log('\n🚀  PayMe server started!\n');
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://${lanIP}:${PORT}\n`);
  console.log(`📁  Accounts: ${DATA_DIR}`);
  console.log(`📄  Payments: ${PAYMENTS_FILE}`);
  console.log('──────────────────────────────────────────────────');
});