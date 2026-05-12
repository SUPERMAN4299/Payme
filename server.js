const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const os      = require('os');

const app        = express();
const PORT       = 3000;
const JSON_FILE  = path.join(__dirname, 'server.json');

app.use(cors());
app.use(express.json());

// Serve payment-gateway.html as the root page
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment-gateway.html'));
});

// ── POST /payment ─────────────────────────────────────────────────
app.post('/payment', (req, res) => {
  const { id, payer_name, amount_inr, amount_display, status, paid_at, paid_at_local } = req.body;

  if (!id || !payer_name || !amount_inr) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  let data = { payments: [] };
  if (fs.existsSync(JSON_FILE)) {
    try {
      const raw = fs.readFileSync(JSON_FILE, 'utf8');
      data = JSON.parse(raw);
      if (!Array.isArray(data.payments)) data.payments = [];
    } catch {
      data = { payments: [] };
    }
  }

  const newEntry = {
    transaction_id : id,
    payer_name,
    amount_inr,
    amount_display,
    status         : status || 'success',
    paid_at,
    paid_at_local,
  };

  data.payments.push(newEntry);
  fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log(`✅  Payment saved → ${id}  |  ${payer_name}  |  ${amount_display}`);
  res.json({ success: true, transaction_id: id });
});

// ── GET /payments ─────────────────────────────────────────────────
app.get('/payments', (req, res) => {
  if (!fs.existsSync(JSON_FILE)) return res.json({ payments: [] });
  try {
    const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.json({ payments: [] });
  }
});

// ── Get local LAN IP ──────────────────────────────────────────────
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// ── Listen on ALL interfaces (0.0.0.0) ───────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const lanIP = getLanIP();
  console.log('\n🚀  PayMe server started!\n');
  //console.log(`   Local:    http://localhost:${PORT}`);
  //console.log(`   Network:  http://${lanIP}:${PORT}  <- open this on other devices\n`);
  console.log(`📄  Payments will be saved to server.json`);
  console.log('--------------------------------------------------');
});