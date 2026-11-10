const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
const BONUS_AMOUNT = 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Joc7777777';
const FEE_RATE = 0.02;
const AGENT_SHARE = 0.6;
const SUPER_SHARE = 0.2;
const PLATFORM_SHARE = 0.2;
const MIN_WITHDRAW = 5000;
const MAX_SEND_ONE = 200000;
const MAX_SEND_PER_DAY = 500000;
const MAX_AGENT_COMMISSION_PER_DAY = 50000;
const MAX_SUPER_COMMISSION_PER_DAY = 30000;
const MAX_WITHDRAW_PER_DAY = 100000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/sendmoney', ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });
async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, country TEXT DEFAULT 'Burundi', channel TEXT DEFAULT 'Lumicash', password TEXT NOT NULL, status TEXT DEFAULT 'pending', balance NUMERIC DEFAULT 0, bonus_amount NUMERIC DEFAULT 0, bonus_locked BOOLEAN DEFAULT true, airtime_count INTEGER DEFAULT 0, blocked BOOLEAN DEFAULT false, failed_attempts INTEGER DEFAULT 0, blocked_until TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, customer_id INTEGER UNIQUE REFERENCES customers(id) ON DELETE CASCADE, balance NUMERIC DEFAULT 0, bonus_amount NUMERIC DEFAULT 0, bonus_locked BOOLEAN DEFAULT true, airtime_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, code TEXT, from_customer_id INTEGER, to_customer_id INTEGER, from_phone TEXT, to_phone TEXT, amount NUMERIC, fee NUMERIC, net_amount NUMERIC, type TEXT, method TEXT, channel TEXT DEFAULT 'Lumicash', status TEXT DEFAULT 'completed', agent_share NUMERIC DEFAULT 0, super_share NUMERIC DEFAULT 0, platform_share NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS airtime_purchases (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE, phone TEXT, amount NUMERIC, operator TEXT DEFAULT 'Lumicash', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS agents (id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, province TEXT DEFAULT 'Burundi', password TEXT, status TEXT DEFAULT 'pending', wallet_balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0, super_agent_id INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS super_agents (id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, province TEXT DEFAULT 'Burundi', password TEXT, status TEXT DEFAULT 'approved', balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_type TEXT, user_id INTEGER, user_name TEXT, amount NUMERIC, method TEXT DEFAULT 'Lumicash', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS reset_requests (id SERIAL PRIMARY KEY, customer_id INTEGER, full_name TEXT, phone TEXT, code TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), verified_call BOOLEAN DEFAULT false, verified_question BOOLEAN DEFAULT false)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`INSERT INTO platform_wallet (balance) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM platform_wallet)`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS bonus_locked BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS airtime_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMP`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS agent_share NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS super_share NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_share NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'Lumicash'`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS super_agent_id INTEGER`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_earned NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS total_withdrawn NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE super_agents ADD COLUMN IF NOT EXISTS total_earned NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE super_agents ADD COLUMN IF NOT EXISTS total_withdrawn NUMERIC DEFAULT 0`);
    console.log('DB ready - Lumicash / Ecocash');
  } catch (e) { console.log('DB error:', e.message); }
}
initDB();
function normPhone(p) { if (!p) return ''; let s = String(p).replace(/[\s\-]/g, ''); if (s.startsWith('0')) s = '+257' + s.slice(1); if (!s.startsWith('+')) s = '+' + s; return s; }
function genCode() { return 'SM' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100); }
function genResetCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
app.get('/api/health', async (req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'connected' }); } catch (e) { res.json({ ok: true, db: 'disconnected', error: e.message }); } });
app.post('/api/customers', async (req, res) => {
  try {
    const { full_name, phone, country, channel, password } = req.body;
    if (!full_name || !phone) return res.status(400).json({ message: 'Uzuza Izina, Amatazirano na telefone!' });
    if (!/^[0-9]{4}$/.test(password || '')) return res.status(400).json({ message: 'Password igomba kuba IBHARURO 4 GUSA!' });
    const p = normPhone(phone);
    const exist = await pool.query('SELECT id FROM customers WHERE phone=$1', [p]);
    if (exist.rows.length) return res.status(400).json({ message: 'Iyi numero yamaze kwiyandikisha!' });
    const r = await pool.query("INSERT INTO customers (full_name, phone, country, channel, password, status, balance, bonus_amount, bonus_locked, airtime_count) VALUES ($1,$2,$3,$4,$5,'pending',0,$6,true,0) RETURNING *", [full_name.trim(), p, country || 'Burundi', channel || 'Lumicash', password, BONUS_AMOUNT]);
    await pool.query('INSERT INTO wallets (customer_id, balance, bonus_amount, bonus_locked, airtime_count) VALUES ($1,0,$2,true,0)', [r.rows[0].id, BONUS_AMOUNT]);
    res.json({ message: 'Wiyandikishije neza! Tegereza Admin yemeze. Bonus ' + BONUS_AMOUNT + ' BIF izoherwa! Password = ' + password, customer: r.rows[0] });
  } catch (e) { res.status(500).json({ message: 'Habaye ikibazo: ' + e.message }); }
});
app.get('/api/customers', async (req, res) => {
  try {
    const r = await pool.query('SELECT c.*, COALESCE(w.balance, c.balance, 0) as balance, COALESCE(w.bonus_amount, c.bonus_amount, 0) as bonus_amount, COALESCE(w.bonus_locked, c.bonus_locked, true) as bonus_locked, COALESCE(w.airtime_count, c.airtime_count, 0) as airtime_count, c.password as user_password FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id ORDER BY c.created_at DESC');
    res.json({ customers: r.rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.patch('/api/customers/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const r = await pool.query('UPDATE customers SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (status === 'approved') { await pool.query('UPDATE customers SET balance = balance + $2 WHERE id=$1', [req.params.id, BONUS_AMOUNT]); await pool.query('UPDATE wallets SET balance = balance + $2 WHERE customer_id=$1', [req.params.id, BONUS_AMOUNT]); }
    res.json({ message: 'Status yahindutse: ' + status, customer: r.rows[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.delete('/api/customers/:id', async (req, res) => {
  try { await pool.query('DELETE FROM wallets WHERE customer_id=$1', [req.params.id]); await pool.query('DELETE FROM airtime_purchases WHERE customer_id=$1', [req.params.id]); await pool.query('DELETE FROM reset_requests WHERE customer_id=$1', [req.params.id]); await pool.query('DELETE FROM transactions WHERE from_customer_id=$1 OR to_customer_id=$1', [req.params.id]); await pool.query('DELETE FROM customers WHERE id=$1', [req.params.id]); res.json({ message: 'Umukiriya yafashwe burundu!' }); } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/block/:id', async (req, res) => { await pool.query('UPDATE customers SET blocked=true WHERE id=$1', [req.params.id]); res.json({ message: 'Umukiriya yahagaritswe!' }); });
app.post('/api/admin/unblock/:id', async (req, res) => { await pool.query('UPDATE customers SET blocked=false, failed_attempts=0, blocked_until=NULL WHERE id=$1', [req.params.id]); res.json({ message: 'Umukiriya yaramuriwe!' }); });
app.post('/api/admin/reset-password/:id', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!/^[0-9]{4}$/.test(newPassword || '')) return res.status(400).json({ message: 'Password = IBHARURO 4 GUSA!' });
    await pool.query('UPDATE customers SET password=$1 WHERE id=$2', [newPassword, req.params.id]);
    res.json({ message: 'Password yahindutse!' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/login', async (req, res) => {
  try {
    const { full_name, phone, password } = req.body;
    const p = normPhone(phone);
    const r = await pool.query('SELECT * FROM customers WHERE phone=$1', [p]);
    if (!r.rows.length) return res.status(400).json({ message: 'Numero ntabaho! Banza wiyandikishe.' });
    const c = r.rows[0];
    if (c.blocked) return res.status(403).json({ message: 'Compte yawe yahagaritswe na Admin!' });
    if (c.blocked_until && new Date(c.blocked_until) > new Date()) return res.status(403).json({ message: 'Compte yawe yahagaritswe amasaha 24! Garuka ejo.' });
    if ((c.full_name || '').toLowerCase().trim() !== (full_name || '').toLowerCase().trim()) return res.status(400).json({ message: 'Izina / Amatazirano nabi! Andika neza nkuko wiyandikishije.' });
    if (c.password !== password) {
      const fails = (c.failed_attempts || 0) + 1;
      if (fails >= 4) { await pool.query("UPDATE customers SET failed_attempts=$1, blocked_until=NOW() + INTERVAL '24 hours' WHERE id=$2", [fails, c.id]); return res.status(403).json({ message: 'Wagerageje inshuro 4! Compte yawe yahagaritswe amasaha 24! Garuka ejo.' }); }
      await pool.query('UPDATE customers SET failed_attempts=$1 WHERE id=$2', [fails, c.id]);
      return res.status(400).json({ message: 'Password nabi! Wasigaje inshuro ' + (4 - fails) + ' gusa! Niwakora ikosa 4, uzotegereza amasaha 24!' });
    }
    await pool.query('UPDATE customers SET failed_attempts=0, blocked_until=NULL WHERE id=$1', [c.id]);
    if (c.status !== 'approved') return res.status(403).json({ message: 'Compte yawe ntiremejwe na Admin. Tegereza!' });
    const w = await pool.query('SELECT * FROM wallets WHERE customer_id=$1', [c.id]);
    const tx = await pool.query('SELECT * FROM transactions WHERE from_customer_id=$1 OR to_customer_id=$1 ORDER BY created_at DESC LIMIT 50', [c.id]);
    const air = await pool.query('SELECT * FROM airtime_purchases WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 50', [c.id]);
    res.json({ customer: { ...c, user_password: c.password }, wallet: w.rows[0] || { balance: 0, bonus_amount: BONUS_AMOUNT, bonus_locked: true, airtime_count: 0 }, transactions: tx.rows, airtime: air.rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/forgot-password-request', async (req, res) => {
  try {
    const { full_name, phone } = req.body;
    const p = normPhone(phone);
    const r = await pool.query('SELECT * FROM customers WHERE phone=$1', [p]);
    if (!r.rows.length) return res.status(400).json({ message: 'Numero ntabaho!' });
    const c = r.rows[0];
    if ((c.full_name || '').toLowerCase().trim() !== (full_name || '').toLowerCase().trim()) return res.status(400).json({ message: 'Izina ntirihuye na numero!' });
    const code = genResetCode();
    await pool.query("INSERT INTO reset_requests (customer_id, full_name, phone, code, status) VALUES ($1,$2,$3,$4,'pending')", [c.id, c.full_name, p, code]);
    res.json({ message: 'Demande yoherejwe! Tegereza Admin aguhamagare. NTUKEMEZE ako kanya - Tegereza iminota 5! Admin azoguhamagara kuri ' + p });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/reset-password-confirm', async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    const p = normPhone(phone);
    if (!/^[0-9]{4}$/.test(newPassword || '')) return res.status(400).json({ message: 'Password nshasha = IBHARURO 4 GUSA!' });
    const r = await pool.query("SELECT * FROM reset_requests WHERE phone=$1 AND code=$2 AND status='approved' ORDER BY created_at DESC LIMIT 1", [p, code]);
    if (!r.rows.length) return res.status(400).json({ message: 'Code nabi canke ntiyemejwe na Admin! Banza usabe Admin.' });
    await pool.query('UPDATE customers SET password=$1 WHERE phone=$2', [newPassword, p]);
    await pool.query("UPDATE reset_requests SET status='used' WHERE id=$1", [r.rows[0].id]);
    res.json({ message: 'Password yahindutse neza! Injira na password nshasha.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/admin/reset-requests', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM reset_requests ORDER BY created_at DESC');
    const out = [];
    for (const x of r.rows) {
      const c = await pool.query('SELECT full_name, phone, balance, bonus_locked, airtime_count, created_at as registered_at FROM customers WHERE id=$1', [x.customer_id]);
      const tx = await pool.query('SELECT amount, to_phone, code, created_at FROM transactions WHERE from_customer_id=$1 ORDER BY created_at DESC LIMIT 2', [x.customer_id]);
      const air = await pool.query('SELECT amount, operator, created_at FROM airtime_purchases WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 2', [x.customer_id]);
      out.push({ ...x, customer: c.rows[0] || {}, last_transactions: tx.rows, last_airtime: air.rows });
    }
    res.json({ requests: out });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/reset-requests/:id/approve', async (req, res) => {
  try {
    const { verifiedCall, verifiedQuestion } = req.body;
    if (!verifiedCall || !verifiedQuestion) return res.status(400).json({ message: 'Banza UHAMAGARE uwusaba + UMUBAZE Ibibazo 5 vyHistorique! NTUKEMEZE ako kanya!' });
    const r = await pool.query('SELECT * FROM reset_requests WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: 'Demande ntabaho' });
    const created = new Date(r.rows[0].created_at);
    const diffMin = (Date.now() - created.getTime()) / 60000;
    if (diffMin < 5) return res.status(400).json({ message: 'TEGEREZA! Demande imaze iminota ' + Math.floor(diffMin) + ' gusa. Tegereza iminota 5! Umujura ashaka vuba!' });
    await pool.query("UPDATE reset_requests SET status='approved', verified_call=true, verified_question=true WHERE id=$1", [req.params.id]);
    res.json({ message: 'Yemerejwe! Bwira umukiriya Code: ' + r.rows[0].code + ' - KURI TELEPHONE GUSA!' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/admin/reset-requests/:id/reject', async (req, res) => { await pool.query("UPDATE reset_requests SET status='rejected' WHERE id=$1", [req.params.id]); res.json({ message: 'Demande yahakanye' }); });
app.post('/api/send', async (req, res) => {
  try {
    const { from_customer_id, to_phone, amount } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ message: 'Amount nabi!' });
    if (amt > MAX_SEND_ONE) return res.status(400).json({ message: 'LIMITE! Nturenza kurungika ' + MAX_SEND_ONE + ' BIF rimwe! Rungika mu nshuro 2.' });
    const today = await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE from_customer_id=$1 AND DATE(created_at)=CURRENT_DATE', [from_customer_id]);
    const todayTotal = Number(today.rows[0].total || 0);
    if (todayTotal + amt > MAX_SEND_PER_DAY) return res.status(400).json({ message: 'LIMITE KU MUSI! Urarungitse ' + todayTotal + ' BIF uyu musi. Usigaje ' + (MAX_SEND_PER_DAY - todayTotal) + ' BIF gusa! Maximum ku musi ni ' + MAX_SEND_PER_DAY + ' BIF.' });
    const sender = await pool.query('SELECT c.*, w.balance, w.bonus_locked, w.airtime_count FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id WHERE c.id=$1', [from_customer_id]);
    if (!sender.rows.length) return res.status(400).json({ message: 'Sender ntabaho' });
    const s = sender.rows[0];
    if (s.status !== 'approved') return res.status(403).json({ message: 'Compte yawe ntiremejwe!' });
    if (s.blocked) return res.status(403).json({ message: 'Compte yahagaritswe!' });
    if (s.bonus_locked) return res.status(400).json({ message: 'Bonus yawe ifunzwe! Gura Unites inshuro ' + (2 - (s.airtime_count || 0)) + ' zikurikira kugira ifunguke!' });
    const walletBal = Number(s.balance || 0);
    if (walletBal < amt) return res.status(400).json({ message: 'Balance ntabwo ihagije! Balance yawe: ' + walletBal + ' BIF' });
    const p = normPhone(to_phone);
    let receiver = await pool.query('SELECT * FROM customers WHERE phone=$1', [p]);
    let receiverId = null;
    if (!receiver.rows.length) {
      const nr = await pool.query("INSERT INTO customers (full_name, phone, country, channel, password, status, balance, bonus_amount, bonus_locked, airtime_count) VALUES ($1,$2,'Burundi','Lumicash','0000','pending',0,$3,true,0) RETURNING *", ['Client ' + p, p, BONUS_AMOUNT]);
      receiverId = nr.rows[0].id;
      await pool.query('INSERT INTO wallets (customer_id, balance, bonus_amount, bonus_locked, airtime_count) VALUES ($1,0,$2,true,0)', [receiverId, BONUS_AMOUNT]);
    } else receiverId = receiver.rows[0].id;
    const fee = Math.round(amt * FEE_RATE);
    const net = amt - fee;
    let agentShare = Math.round(fee * AGENT_SHARE);
    let superShare = Math.round(fee * SUPER_SHARE);
    let platShare = fee - agentShare - superShare;
    const code = genCode();
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE customer_id=$2', [amt, from_customer_id]);
    await pool.query('UPDATE customers SET balance = balance - $1 WHERE id=$2', [amt, from_customer_id]);
    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE customer_id=$2', [net, receiverId]);
    await pool.query('UPDATE customers SET balance = balance + $1 WHERE id=$2', [net, receiverId]);
    const agent = await pool.query("SELECT * FROM agents WHERE status='approved' ORDER BY id ASC LIMIT 1");
    if (agent.rows.length) {
      const agentToday = await pool.query('SELECT COALESCE(SUM(agent_share),0) as total FROM transactions WHERE DATE(created_at)=CURRENT_DATE');
      const agentTodayTotal = Number(agentToday.rows[0].total || 0);
      const agentRemaining = Math.max(0, MAX_AGENT_COMMISSION_PER_DAY - agentTodayTotal);
      if (agentShare > agentRemaining) { const excess = agentShare - agentRemaining; agentShare = agentRemaining; platShare += excess; }
      await pool.query('UPDATE agents SET wallet_balance = wallet_balance + $1, total_earned = total_earned + $1 WHERE id=$2', [agentShare, agent.rows[0].id]);
      if (agent.rows[0].super_agent_id) {
        const superToday = await pool.query('SELECT COALESCE(SUM(super_share),0) as total FROM transactions WHERE DATE(created_at)=CURRENT_DATE');
        const superTodayTotal = Number(superToday.rows[0].total || 0);
        const superRemaining = Math.max(0, MAX_SUPER_COMMISSION_PER_DAY - superTodayTotal);
        if (superShare > superRemaining) { const excess2 = superShare - superRemaining; superShare = superRemaining; platShare += excess2; }
        await pool.query('UPDATE super_agents SET balance = balance + $1, total_earned = total_earned + $1 WHERE id=$2', [superShare, agent.rows[0].super_agent_id]);
      } else { platShare += superShare; superShare = 0; }
      await pool.query('UPDATE platform_wallet SET balance = balance + $1, total_earned = total_earned + $1 WHERE id=1', [platShare]);
    } else {
      await pool.query('UPDATE platform_wallet SET balance = balance + $1, total_earned = total_earned + $1 WHERE id=1', [fee]);
      agentShare = 0; superShare = 0; platShare = fee;
    }
    await pool.query("INSERT INTO transactions (code, from_customer_id, to_customer_id, from_phone, to_phone, amount, fee, net_amount, type, method, channel, status, agent_share, super_share, platform_share) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'transfer','Lumicash','Lumicash','completed',$9,$10,$11)", [code, from_customer_id, receiverId, s.phone, p, amt, fee, net, agentShare, superShare, platShare]);
    let limitMsg = '';
    if (agentShare === 0 && fee > 0) limitMsg = ' Agent yageze kuri Limite 50,000 BIF uyu musi - Komisiyo yagiye muri Platform.';
    res.json({ message: 'Vyagenze! ' + amt + ' BIF yoherejwe. Fee: ' + fee + ' BIF. Uwakira yaronse ' + net + ' BIF. Code: ' + code + limitMsg, code, fee, net });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/airtime', async (req, res) => {
  try {
    const { customerId, phone, amount, operator } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ message: 'Amount nabi!' });
    if (amt > MAX_SEND_ONE) return res.status(400).json({ message: 'LIMITE! Nturenza kugura Unites ' + MAX_SEND_ONE + ' BIF rimwe!' });
    const op = operator || 'Lumicash';
    const r = await pool.query('SELECT c.*, w.balance, w.bonus_locked, w.airtime_count FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id WHERE c.id=$1', [customerId]);
    if (!r.rows.length) return res.status(400).json({ message: 'Client ntabaho' });
    const c = r.rows[0];
    if (c.status !== 'approved') return res.status(403).json({ message: 'Compte ntiremejwe!' });
    if (Number(c.balance || 0) < amt) return res.status(400).json({ message: 'Balance ntabwo ihagije!' });
    await pool.query('UPDATE wallets SET balance = balance - $1, airtime_count = airtime_count + 1 WHERE customer_id=$2', [amt, customerId]);
    await pool.query('UPDATE customers SET balance = balance - $1, airtime_count = airtime_count + 1 WHERE id=$2', [amt, customerId]);
    await pool.query('INSERT INTO airtime_purchases (customer_id, phone, amount, operator) VALUES ($1,$2,$3,$4)', [customerId, normPhone(phone), amt, op]);
    const after = await pool.query('SELECT airtime_count FROM wallets WHERE customer_id=$1', [customerId]);
    const cnt = after.rows[0] ? Number(after.rows[0].airtime_count) : 0;
    let msg = 'Unites ' + amt + ' BIF za ' + op + ' zaguzwe neza!';
    if (cnt >= 2 && c.bonus_locked) {
      await pool.query('UPDATE wallets SET bonus_locked=false WHERE customer_id=$1', [customerId]);
      await pool.query('UPDATE customers SET bonus_locked=false WHERE id=$1', [customerId]);
      msg += ' BONUS YAWE IRAFUNGUTSE! Ushobora kurungika ubu!';
    } else if (cnt < 2) { msg += ' Usigaje inshuro ' + (2 - cnt) + ' kugira Bonus ifunguke.'; }
    res.json({ message: msg });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/transactions', async (req, res) => { try { const r = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'); res.json({ transactions: r.rows }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/agents', async (req, res) => {
  try {
    const { full_name, phone, province, password } = req.body;
    if (!full_name || !phone) return res.status(400).json({ message: 'Uzuza Izina, Amatazirano na telefone!' });
    if (!/^[0-9]{4}$/.test(password || '')) return res.status(400).json({ message: 'Password = IBHARURO 4 GUSA!' });
    const p = normPhone(phone);
    const exist = await pool.query('SELECT id FROM agents WHERE phone=$1', [p]);
    if (exist.rows.length) return res.status(400).json({ message: 'Iyi numero yamaze kwiyandikisha nkAgent!' });
    const r = await pool.query("INSERT INTO agents (full_name, phone, province, password, status) VALUES ($1,$2,$3,$4,'pending') RETURNING *", [full_name.trim(), p, province || 'Burundi', password]);
    res.json({ message: 'Wiyandikishije nkAgent! Tegereza Joctan yemeze.', agent: r.rows[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/agents', async (req, res) => { try { const r = await pool.query('SELECT *, password as user_password FROM agents ORDER BY created_at DESC'); res.json({ agents: r.rows }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/agent/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const p = normPhone(phone);
    const r = await pool.query('SELECT * FROM agents WHERE phone=$1', [p]);
    if (!r.rows.length) return res.status(400).json({ message: 'Agent ntabaho!' });
    const a = r.rows[0];
    if (a.password !== password) return res.status(400).json({ message: 'Password nabi!' });
    if (a.status !== 'approved') return res.status(403).json({ message: 'Agent ntaremejwe na Joctan. Tegereza!' });
    res.json({ agent: a });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/agent/dashboard/:id', async (req, res) => {
  try {
    const a = await pool.query('SELECT * FROM agents WHERE id=$1', [req.params.id]);
    if (!a.rows.length) return res.status(404).json({ message: 'Agent ntabaho' });
    const tx = await pool.query('SELECT * FROM transactions WHERE agent_share > 0 ORDER BY created_at DESC LIMIT 50');
    const wd = await pool.query("SELECT * FROM withdrawals WHERE user_type='agent' AND user_id=$1 ORDER BY created_at DESC", [req.params.id]);
    res.json({ agent: a.rows[0], transactions: tx.rows, withdrawals: wd.rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/super-agents', async (req, res) => {
  try {
    const { full_name, phone, province, password } = req.body;
    if (!full_name || !phone) return res.status(400).json({ message: 'Uzuza Izina, Amatazirano na telefone!' });
    if (!/^[0-9]{4}$/.test(password || '')) return res.status(400).json({ message: 'Password = IBHARURO 4 GUSA!' });
    const p = normPhone(phone);
    const exist = await pool.query('SELECT id FROM super_agents WHERE phone=$1', [p]);
    if (exist.rows.length) return res.status(400).json({ message: 'Iyi numero yamaze kwiyandikisha nkSuper Agent!' });
    const r = await pool.query("INSERT INTO super_agents (full_name, phone, province, password, status) VALUES ($1,$2,$3,$4,'approved') RETURNING *", [full_name.trim(), p, province || 'Burundi', password]);
    res.json({ message: 'Super Agent yiyandikishije neza!', super_agent: r.rows[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/super-agents', async (req, res) => { try { const r = await pool.query('SELECT *, password as user_password FROM super_agents ORDER BY created_at DESC'); res.json({ super_agents: r.rows }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/super/login', async (req, res) => {
  try {
    const { full_name, phone, password } = req.body;
    const p = normPhone(phone);
    const r = await pool.query('SELECT * FROM super_agents WHERE phone=$1', [p]);
    if (!r.rows.length) return res.status(400).json({ message: 'Super Agent ntabaho!' });
    const s = r.rows[0];
    if ((s.full_name || '').toLowerCase().trim() !== (full_name || '').toLowerCase().trim()) return res.status(400).json({ message: 'Izina / Amatazirano nabi!' });
    if (s.password !== password) return res.status(400).json({ message: 'Password nabi!' });
    res.json({ super_agent: s });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/super/dashboard/:id', async (req, res) => {
  try {
    const s = await pool.query('SELECT * FROM super_agents WHERE id=$1', [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ message: 'Super Agent ntabaho' });
    const tx = await pool.query('SELECT * FROM transactions WHERE super_share > 0 ORDER BY created_at DESC LIMIT 50');
    const wd = await pool.query("SELECT * FROM withdrawals WHERE user_type='super' AND user_id=$1 ORDER BY created_at DESC", [req.params.id]);
    const ag = await pool.query('SELECT * FROM agents WHERE super_agent_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ super_agent: { ...s.rows[0], wallet_balance: s.rows[0].balance }, transactions: tx.rows, withdrawals: wd.rows, agents: ag.rows });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/withdraw/agent', async (req, res) => {
  try {
    const { agent_id, amount, method } = req.body;
    const amt = Number(amount);
    if (!amt || amt < MIN_WITHDRAW) return res.status(400).json({ message: 'Minimum ni ' + MIN_WITHDRAW + ' BIF!' });
    if (amt > MAX_WITHDRAW_PER_DAY) return res.status(400).json({ message: 'LIMITE! Nturenza kurotira ' + MAX_WITHDRAW_PER_DAY + ' BIF ku musi!' });
    const todayW = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE user_type='agent' AND user_id=$1 AND DATE(created_at)=CURRENT_DATE AND status!='rejected'", [agent_id]);
    if (Number(todayW.rows[0].total || 0) + amt > MAX_WITHDRAW_PER_DAY) return res.status(400).json({ message: 'LIMITE KU MUSI! Uraroiye ' + todayW.rows[0].total + ' BIF uyu musi. Usigaje ' + (MAX_WITHDRAW_PER_DAY - Number(todayW.rows[0].total || 0)) + ' BIF!' });
    const a = await pool.query('SELECT * FROM agents WHERE id=$1', [agent_id]);
    if (!a.rows.length) return res.status(404).json({ message: 'Agent ntabaho' });
    if (Number(a.rows[0].wallet_balance || 0) < amt) return res.status(400).json({ message: 'Balance ntabwo ihagije! Balance: ' + a.rows[0].wallet_balance + ' BIF' });
    await pool.query("INSERT INTO withdrawals (user_type, user_id, user_name, amount, method, status) VALUES ('agent',$1,$2,$3,$4,'pending')", [agent_id, a.rows[0].full_name, amt, method || 'Lumicash']);
    res.json({ message: 'Demande yo kurotira ' + amt + ' BIF yoherejwe! Tegereza Admin yemeze.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/withdraw/super', async (req, res) => {
  try {
    const { super_id, amount, method } = req.body;
    const amt = Number(amount);
    if (!amt || amt < MIN_WITHDRAW) return res.status(400).json({ message: 'Minimum ni ' + MIN_WITHDRAW + ' BIF!' });
    if (amt > MAX_WITHDRAW_PER_DAY) return res.status(400).json({ message: 'LIMITE! Nturenza kurotira ' + MAX_WITHDRAW_PER_DAY + ' BIF ku musi!' });
    const todayW = await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE user_type='super' AND user_id=$1 AND DATE(created_at)=CURRENT_DATE AND status!='rejected'", [super_id]);
    if (Number(todayW.rows[0].total || 0) + amt > MAX_WITHDRAW_PER_DAY) return res.status(400).json({ message: 'LIMITE KU MUSI! Uraroiye ' + todayW.rows[0].total + ' BIF uyu musi!' });
    const s = await pool.query('SELECT * FROM super_agents WHERE id=$1', [super_id]);
    if (!s.rows.length) return res.status(404).json({ message: 'Super Agent ntabaho' });
    if (Number(s.rows[0].balance || 0) < amt) return res.status(400).json({ message: 'Balance ntabwo ihagije! Balance: ' + s.rows[0].balance + ' BIF' });
    await pool.query("INSERT INTO withdrawals (user_type, user_id, user_name, amount, method, status) VALUES ('super',$1,$2,$3,$4,'pending')", [super_id, s.rows[0].full_name, amt, method || 'Lumicash']);
    res.json({ message: 'Demande yo kurotira ' + amt + ' BIF yoherejwe! Tegereza Admin yemeze.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/withdraw/platform', async (req, res) => {
  try {
    const { amount } = req.body;
    const amt = Number(amount);
    if (!amt || amt < MIN_WITHDRAW) return res.status(400).json({ message: 'Minimum ni ' + MIN_WITHDRAW + ' BIF!' });
    const p = await pool.query('SELECT * FROM platform_wallet WHERE id=1');
    if (Number(p.rows[0].balance || 0) < amt) return res.status(400).json({ message: 'Balance ntabwo ihagije!' });
    await pool.query('UPDATE platform_wallet SET balance = balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id=1', [amt]);
    await pool.query("INSERT INTO withdrawals (user_type, user_id, user_name, amount, method, status) VALUES ('platform',0,'Platform', $1, 'Lumicash', 'approved')", [amt]);
    res.json({ message: 'Platform yaroiye ' + amt + ' BIF!' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/withdrawals', async (req, res) => { try { const r = await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC'); res.json({ withdrawals: r.rows }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/withdrawals/:id/approve', async (req, res) => {
  try {
    const w = await pool.query('SELECT * FROM withdrawals WHERE id=$1', [req.params.id]);
    if (!w.rows.length) return res.status(404).json({ message: 'Demande ntabaho' });
    const x = w.rows[0];
    if (x.status !== 'pending') return res.status(400).json({ message: 'Demande yamaze gufatwako!' });
    if (x.user_type === 'agent') { await pool.query('UPDATE agents SET wallet_balance = wallet_balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id=$2', [x.amount, x.user_id]); }
    if (x.user_type === 'super') { await pool.query('UPDATE super_agents SET balance = balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id=$2', [x.amount, x.user_id]); }
    await pool.query("UPDATE withdrawals SET status='approved' WHERE id=$1", [req.params.id]);
    res.json({ message: 'Kurotira kwemejwe!' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});
app.post('/api/withdrawals/:id/reject', async (req, res) => { await pool.query("UPDATE withdrawals SET status='rejected' WHERE id=$1", [req.params.id]); res.json({ message: 'Kurotira kwahakanye' }); });
app.get('/api/platform/balance', async (req, res) => { try { const r = await pool.query('SELECT * FROM platform_wallet WHERE id=1'); res.json({ wallet: r.rows[0] }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/admin/check', async (req, res) => { const { password } = req.body; if (password === ADMIN_PASSWORD) return res.json({ ok: true, message: 'Murakaza neza, Joctan!' }); res.status(401).json({ message: 'Password nabi!' }); });
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/client.html', (req, res) => res.sendFile(path.join(__dirname, 'client.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'admin-login.html')));
app.get('/agent.html', (req, res) => res.sendFile(path.join(__dirname, 'agent.html')));
app.get('/super-agent.html', (req, res) => res.sendFile(path.join(__dirname, 'super-agent.html')));
app.listen(PORT, () => console.log('SendMoney running on port ' + PORT));
