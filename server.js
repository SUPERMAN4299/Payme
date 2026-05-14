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

// In-memory QR store
const qrStore = {};

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

// Generate a unique User ID like PAYME-7X3K
function generateUserId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'PAYME-';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Find account by userId
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

  // Ensure unique userId
  let userId;
  let attempts = 0;
  do {
    userId = generateUserId();
    attempts++;
  } while (getAccountByUserId(userId) && attempts < 100);

  const account = {
    username    : usernameSafe,
    userId,
    fullName,
    email,
    passwordHash: hashPassword(password),
    balance     : 600.00,
    currency    : 'INR',
    createdAt   : new Date().toISOString(),
    transactions: []
  };

  saveAccount(account);
  console.log(`✅  New account: ${usernameSafe} | UserID: ${userId} | ${fullName}`);

  res.json({ success: true, username: usernameSafe, userId, fullName, balance: account.balance });
});

// Log In
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const account = getAccount(username.toLowerCase());
  if (!account || account.passwordHash !== hashPassword(password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  console.log(`🔑  Login: ${account.username} (${account.userId})`);
  res.json({
    success : true,
    username: account.username,
    userId  : account.userId,
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

// Lookup user by userId (to validate before paying)
app.get('/user/lookup/:userId', (req, res) => {
  const account = getAccountByUserId(req.params.userId.toUpperCase());
  if (!account) return res.status(404).json({ error: 'User ID not found.' });
  res.json({ found: true, username: account.username, fullName: account.fullName, userId: account.userId });
});

// Send money by User ID
app.post('/payment/send', (req, res) => {
  const { senderUsername, recipientUserId, amount, note } = req.body;
  if (!senderUsername || !recipientUserId || !amount || amount <= 0)
    return res.status(400).json({ error: 'Missing required fields.' });

  const sender = getAccount(senderUsername);
  if (!sender) return res.status(404).json({ error: 'Sender account not found.' });

  const recipient = getAccountByUserId(recipientUserId.toUpperCase());
  if (!recipient) return res.status(404).json({ error: 'Recipient User ID not found.' });

  if (sender.username === recipient.username)
    return res.status(400).json({ error: 'Cannot send money to yourself.' });

  if (sender.balance < amount)
    return res.status(400).json({ error: 'Insufficient balance.' });

  const txnId = 'TXN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
  const now   = new Date();

  const senderTxn = {
    transaction_id: txnId,
    type          : 'debit',
    payer_name    : sender.fullName,
    recipient_name: recipient.fullName,
    recipient_id  : recipientUserId.toUpperCase(),
    amount_inr    : parseFloat(amount),
    amount_display: '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    status        : 'success',
    note          : note || '',
    paid_at       : now.toISOString(),
    paid_at_local : now.toLocaleString('en-IN'),
  };

  const recipientTxn = {
    ...senderTxn,
    type: 'credit',
  };

  // Deduct from sender
  sender.balance = parseFloat((sender.balance - parseFloat(amount)).toFixed(2));
  sender.transactions.unshift(senderTxn);
  saveAccount(sender);

  // Add to recipient
  recipient.balance = parseFloat((recipient.balance + parseFloat(amount)).toFixed(2));
  recipient.transactions.unshift(recipientTxn);
  saveAccount(recipient);

  appendGlobalPayment({ ...senderTxn, sender: sender.username, recipient: recipient.username });

  console.log(`💸  Transfer: ${sender.username} → ${recipient.username} | ₹${amount} | ${txnId}`);
  res.json({
    success       : true,
    transaction_id: txnId,
    amount        : parseFloat(amount),
    recipient_name: recipient.fullName,
    new_balance   : sender.balance,
  });
});

// Generate QR code for payment
app.post('/qr/generate', (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount || amount <= 0)
    return res.status(400).json({ error: 'Username and valid amount required.' });

  const account = getAccount(username);
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  const token     = uuidv4();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  qrStore[token] = { username, amount: parseFloat(amount), expiresAt, used: false };

  const payUrl = `http://${getLanIP()}:${PORT}/pay/${token}`;

  QRCode.toDataURL(payUrl, {
    width  : 300,
    margin : 2,
    color  : { dark: '#0d0d0d', light: '#f5f1eb' }
  }, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: 'QR generation failed.' });

    console.log(`📱  QR for ${username}: ₹${amount} | ${token.slice(0,8)}…`);
    res.json({
      success   : true,
      token,
      qrDataUrl : dataUrl,
      payUrl,
      amount    : parseFloat(amount),
      expiresAt,
      expiresIn : 300
    });
  });
});

// Get QR status
app.get('/qr/status/:token', (req, res) => {
  const data = qrStore[req.params.token];
  if (!data) return res.json({ valid: false, reason: 'expired_or_invalid' });
  if (data.used) return res.json({ valid: false, reason: 'already_used' });
  if (data.expiresAt < Date.now()) return res.json({ valid: false, reason: 'expired' });
  res.json({ valid: true, username: data.username, amount: data.amount, expiresAt: data.expiresAt });
});

// Serve payer page
app.get('/pay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'pay.html'));
});

// Process QR payment (from scanned QR — deducts from sender's balance)
app.post('/qr/pay', (req, res) => {
  const { token, payerName, senderUsername } = req.body;
  if (!token || !payerName)
    return res.status(400).json({ error: 'Token and payer name required.' });

  const data = qrStore[token];
  if (!data) return res.status(400).json({ error: 'QR code expired or invalid.' });
  if (data.used) return res.status(400).json({ error: 'QR code already used.' });
  if (data.expiresAt < Date.now()) return res.status(400).json({ error: 'QR code expired.' });

  qrStore[token].used = true;

  const recipient = getAccount(data.username);
  if (!recipient) return res.status(404).json({ error: 'Recipient account not found.' });

  const txnId = 'TXN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
  const now   = new Date();

  // If sender is a logged-in user, deduct from their balance too
  let sender = senderUsername ? getAccount(senderUsername) : null;
  if (sender) {
    if (sender.username === recipient.username)
      return res.status(400).json({ error: 'Cannot pay yourself.' });
    if (sender.balance < data.amount)
      return res.status(400).json({ error: 'Insufficient balance.' });

    const senderTxn = {
      transaction_id: txnId,
      type          : 'debit',
      payer_name    : sender.fullName,
      recipient_name: recipient.fullName,
      amount_inr    : data.amount,
      amount_display: '₹' + Number(data.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      status        : 'success',
      paid_at       : now.toISOString(),
      paid_at_local : now.toLocaleString('en-IN'),
      qr_token      : token,
    };
    sender.balance = parseFloat((sender.balance - data.amount).toFixed(2));
    sender.transactions.unshift(senderTxn);
    saveAccount(sender);
  }

  const recipientTxn = {
    transaction_id: txnId,
    type          : 'credit',
    payer_name    : sender ? sender.fullName : payerName,
    amount_inr    : data.amount,
    amount_display: '₹' + Number(data.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    status        : 'success',
    paid_at       : now.toISOString(),
    paid_at_local : now.toLocaleString('en-IN'),
    qr_token      : token,
  };

  recipient.balance = parseFloat((recipient.balance + data.amount).toFixed(2));
  recipient.transactions.unshift(recipientTxn);
  saveAccount(recipient);

  appendGlobalPayment({
    ...recipientTxn,
    recipient : data.username,
    sender    : senderUsername || '(external)',
  });

  console.log(`💰  QR Pay: ${payerName} → ${data.username} | ₹${data.amount} | ${txnId}`);
  res.json({
    success       : true,
    transaction_id: txnId,
    amount        : data.amount,
    recipient     : recipient.fullName,
    new_balance   : sender ? sender.balance : null,
  });
});

// Standard payment (legacy manual flow)
app.post('/payment', (req, res) => {
  const { id, payer_name, amount_inr, amount_display, status, paid_at, paid_at_local } = req.body;
  if (!id || !payer_name || !amount_inr)
    return res.status(400).json({ error: 'Missing required payment fields.' });

  appendGlobalPayment({ transaction_id: id, payer_name, amount_inr, amount_display, status: status || 'success', paid_at, paid_at_local });
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
  console.log(`📁  Accounts: ${DATA_DIR}`);
  console.log(`📄  Payments: server.json`);
  console.log('--------------------------------------------------');
});