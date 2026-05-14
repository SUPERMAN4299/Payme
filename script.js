/* ── NoSQL "database" using IndexedDB ── */
const DB_NAME = 'PayMe';
const STORE   = 'transactions';
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = () => rej(req.error);
  });
}

function saveTransaction(txn) {
  return new Promise((res, rej) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.add(txn).onsuccess = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function getAllTransactions() {
  return new Promise((res, rej) => {
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req   = store.index('timestamp').getAll();
    req.onsuccess = () => res(req.result.reverse());
    req.onerror   = () => rej(req.error);
  });
}

/* ── Helpers ── */
function generateTxnId() {
  return 'TXN-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
}

function formatINR(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

function setAmount(val) {
  document.getElementById('amount-input').value = val;
  updateBtnAmount();
}

document.getElementById('amount-input').addEventListener('input', updateBtnAmount);

function updateBtnAmount() {
  const v = parseFloat(document.getElementById('amount-input').value) || 0;
  document.getElementById('btn-amount').textContent = formatINR(v);
}

/* ── Validation ── */
function clearErrors() {
  ['amount', 'payer-name'].forEach(f => {
    const el = document.getElementById(f + '-error');
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.form-control,.amount-display').forEach(el => el.classList.remove('error'));
}

function showError(field, msg) {
  const inputId = field === 'amount' ? 'amount-display-wrap' : field;
  const input = document.getElementById(inputId);
  if (input) input.classList.add('error');
  const err = document.getElementById(field + '-error');
  if (err) { err.textContent = msg; err.style.display = 'block'; }
}

function validate() {
  clearErrors();
  let ok = true;
  const name = document.getElementById('payer-name').value.trim();
  if (!name) { showError('payer-name', 'Please enter your name.'); ok = false; }
  const amount = parseFloat(document.getElementById('amount-input').value);
  if (!amount || amount <= 0) { showError('amount','Please enter a valid amount.'); ok = false; }
  return ok;
}

/* ── Payment processing ── */
async function processPayment() {
  if (!validate()) return;

  const btn = document.getElementById('pay-btn');
  btn.classList.add('loading');
  btn.innerHTML = '<div class="spinner"></div> Processing…';

  // Simulate network delay
  await new Promise(r => setTimeout(r, 2000));

  const amount = parseFloat(document.getElementById('amount-input').value);
  const payerName = document.getElementById('payer-name').value.trim();

  const txn = {
    id        : generateTxnId(),
    amount    : amount,
    name      : payerName,
    cardLast4 : '----',
    expiry    : '',
    timestamp : Date.now(),
    status    : 'success'
  };

  try {
    await saveTransaction(txn);          // IndexedDB (local history panel)
    await savePaymentToServer(txn);      // → writes to server.json
    showSuccess(txn);
    renderTransactions();
  } catch (e) {
    console.error(e);
    showToast('Could not reach server. Is server.js running?', 'error');
    btn.classList.remove('loading');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Pay <span class="btn-amount">${formatINR(amount)}</span>`;
  }
}

/* ── Save payment to server.json via local Express server ── */
async function savePaymentToServer(txn) {
  const payload = {
    id            : txn.id,
    payer_name    : txn.name,
    amount_inr    : txn.amount,
    amount_display: formatINR(txn.amount),
    status        : txn.status,
    paid_at       : new Date(txn.timestamp).toISOString(),
    paid_at_local : new Date(txn.timestamp).toLocaleString('en-IN'),
  };

  const serverURL = `http://${window.location.hostname}:3000`;
  const res = await fetch(`${serverURL}/payment`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload),
  });

  if (!res.ok) throw new Error('Server responded with ' + res.status);
  return res.json();
}

function showSuccess(txn) {
  document.getElementById('success-amount').textContent = formatINR(txn.amount);
  document.getElementById('txn-id-display').textContent = txn.id;
  document.getElementById('success-overlay').classList.add('active');
}

function resetForm() {
  document.getElementById('success-overlay').classList.remove('active');
  document.getElementById('amount-input').value = '';
  document.getElementById('payer-name').value = '';
  document.getElementById('btn-amount').textContent = '₹0.00';
  const btn = document.getElementById('pay-btn');
  btn.classList.remove('loading');
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Pay <span class="btn-amount" id="btn-amount">₹0.00</span>`;
  clearErrors();
  showToast('Ready for next payment ✓');
}

/* ── Render transactions ── */
async function renderTransactions() {
  const list = document.getElementById('txn-list');
  const txns = await getAllTransactions();
  document.getElementById('txn-count').textContent = txns.length + (txns.length === 1 ? ' payment' : ' payments');

  if (txns.length === 0) {
    list.innerHTML = '<div class="txn-empty">No transactions yet</div>';
    return;
  }

  list.innerHTML = txns.slice(0, 5).map((t, i) => `
    <div class="txn-item" style="animation-delay:${i*0.05}s">
      <div class="txn-left">
        <div class="txn-name">${escHtml(t.name)}</div>
        <div class="txn-meta">•••• ${t.cardLast4} · ${new Date(t.timestamp).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'})}</div>
      </div>
      <div class="txn-amount">${formatINR(t.amount)}</div>
    </div>
  `).join('');
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ── Init ── */
(async () => {
  await openDB();
  await renderTransactions();
})();