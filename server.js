const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Joctan7777777';
const BONUS_AMOUNT = 10000;
const MIN_WITHDRAW = 5000;
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME || 'sendmoney_db', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'joctan' }
);
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, name TEXT, phone TEXT UNIQUE NOT NULL, country TEXT DEFAULT 'Burundi', channel TEXT DEFAULT 'Mobile Money', status TEXT DEFAULT 'pending', password TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE, balance NUMERIC DEFAULT 10000, bonus_locked BOOLEAN DEFAULT TRUE, airtime_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), from_country TEXT, to_country TEXT, receiver_phone TEXT, to_phone TEXT, amount NUMERIC, fee NUMERIC DEFAULT 0, agent_share NUMERIC DEFAULT 0, super_share NUMERIC DEFAULT 0, platform_share NUMERIC DEFAULT 0, code TEXT, payment_method TEXT, type TEXT DEFAULT 'transfer', status TEXT DEFAULT 'completed', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS airtime_purchases (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), phone TEXT, amount NUMERIC, operator TEXT DEFAULT 'Lumitel', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS agents (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, province TEXT, commission_rate NUMERIC DEFAULT 20, password TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS agent_wallets (id SERIAL PRIMARY KEY, agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE, balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS super_agents (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, province TEXT, balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0, password TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_type TEXT NOT NULL, user_id INTEGER NOT NULL, user_name TEXT, phone TEXT, amount NUMERIC NOT NULL, method TEXT DEFAULT 'Mobile Money', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance NUMERIC DEFAULT 0, total_earned NUMERIC DEFAULT 0, total_withdrawn NUMERIC DEFAULT 0);
    `);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name TEXT;`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Burundi';`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'Mobile Money';`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password TEXT;`);
    await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS password TEXT;`);
    await pool.query(`ALTER TABLE super_agents ADD COLUMN IF NOT EXISTS password TEXT;`);
    await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bonus_locked BOOLEAN DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS airtime_count INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS from_country TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS to_country TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receiver_phone TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS code TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS agent_share NUMERIC DEFAULT 0;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS super_share NUMERIC DEFAULT 0;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS platform_share NUMERIC DEFAULT 0;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_id INTEGER;`);
    await pool.query(`UPDATE customers SET full_name = name WHERE full_name IS NULL;`);
    await pool.query(`UPDATE customers SET name = full_name WHERE name IS NULL;`);
    await pool.query(`UPDATE customers SET status = LOWER(status);`);
    await pool.query(`UPDATE wallets SET balance = 10000 WHERE balance = 500000 AND airtime_count = 0;`);
    await pool.query(`INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;`);
    console.log('✅ Tables zikozwe / Bonus 10,000 / Password / Withdrawals / PostgreSQL ihujwe!');
  } catch(e){ console.log('❌ DB error:', e.message); }
}
initDB();
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/status', (req,res)=>res.json({message:'SendMoney irakora'}));
app.post('/api/customers', async (req,res)=>{
  const {full_name, name, phone, country, channel, password}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  if(!password || password.length < 4) return res.status(400).json({message:'Password igomba kuba nibura inyuguti 4!'});
  try{
    const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status, password) VALUES ($1,$1,$2,$3,$4,$5,$6) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'pending', password]);
    await pool.query('INSERT INTO wallets (customer_id, balance, bonus_locked, airtime_count) VALUES ($1, $2, TRUE, 0)',[r.rows[0].id, BONUS_AMOUNT]);
    res.json({message:'Kwiyandikisha vyagenze - Wakiriye Bonus 10,000 BIF! Banza ugure Unités inshuro 2 imbere yo kurungika.', customer:r.rows[0]});
  }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Iyi numero yaramaze kwiyandikisha'}); res.status(500).json({message:e.message}); }
});
app.get('/api/customers', async (req,res)=>{ try{ const r=await pool.query('SELECT c.*, w.balance, w.bonus_locked, w.airtime_count, LOWER(c.status) as status FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id ORDER BY c.created_at DESC'); res.json({customers:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.patch('/api/customers/:id/status', async (req,res)=>{
  const {status}=req.body;
  try{ await pool.query('UPDATE customers SET status=$1 WHERE id=$2',[String(status).toLowerCase(), req.params.id]); res.json({message:'Status yahindutse'}); }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/transactions', async (req,res)=>{
  const {fromCountry, toCountry, receiverPhone, to_phone, amount, paymentMethod, senderPhone, from_customer_id, customerId, customer_id}=req.body;
  const toPh = receiverPhone || to_phone;
  const amt = Number(amount);
  if(!amt||!toPh) return res.status(400).json({message:'Amount na numero birakenewe'});
  const senderId = from_customer_id || customerId || customer_id;
  if(senderId){
    try{
      const w = await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[senderId]);
      if(w.rows[0] && w.rows[0].bonus_locked) return res.status(403).json({message:`Bonus ntiyemerewe kurungikwa! Banza ugure Unités inshuro ${2-(w.rows[0].airtime_count||0)} zikurikira kugira Bonus ifunguke. Ushobora kugura Unités gusa ubu.`});
      if(w.rows[0] && Number(w.rows[0].balance) < amt) return res.status(400).json({message:'Balance ntihagije'});
    }catch(e){}
  }
  if(!senderId && !senderPhone) return res.status(403).json({message:'Banza winjire muri Compte yawe imbere yo kurungika! Kanda Injira.'});
  if(senderPhone){
    try{
      const c = await pool.query('SELECT id FROM customers WHERE phone=$1',[senderPhone]);
      if(c.rows.length>0){
        const w = await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[c.rows[0].id]);
        if(w.rows[0] && w.rows[0].bonus_locked) return res.status(403).json({message:`Bonus ntiyemerewe kurungikwa! Banza ugure Unités inshuro ${2-(w.rows[0].airtime_count||0)} zikurikira kugira Bonus ifunguke.`});
      }
    }catch(e){}
  }
  const fee = amt*0.02; const agent_share = fee*0.6; const super_share = fee*0.2; const platform_share = fee*0.2;
  const code = 'SM'+Math.floor(100000+Math.random()*900000);
  try{
    const r=await pool.query('INSERT INTO transactions (customer_id, from_country, to_country, receiver_phone, to_phone, amount, fee, agent_share, super_share, platform_share, code, payment_method, type) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[senderId||null, fromCountry||'Burundi', toCountry||'Burundi', toPh, amt, fee, agent_share, super_share, platform_share, code, paymentMethod||'Mobile Money', 'transfer']);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1, total_earned=total_earned+$1 WHERE id=1',[platform_share]);
    res.json({message:'Transaction vyagenze', transaction:r.rows[0]});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.get('/api/transactions', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC'); res.json({transactions:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/agents', async (req,res)=>{ try{ const r=await pool.query('SELECT a.*, COALESCE(w.balance,0) as wallet_balance, COALESCE(w.total_earned,0) as total_earned FROM agents a LEFT JOIN agent_wallets w ON w.agent_id=a.id ORDER BY a.created_at DESC'); res.json({agents:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/agents', async (req,res)=>{
  const {full_name, phone, province, password}=req.body;
  if(!full_name||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  if(!password || password.length < 4) return res.status(400).json({message:'Password igomba kuba nibura inyuguti 4!'});
  try{ const r=await pool.query('INSERT INTO agents (full_name, phone, province, password) VALUES ($1,$2,$3,$4) RETURNING *',[full_name, phone, province||'', password]); await pool.query('INSERT INTO agent_wallets (agent_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING',[r.rows[0].id]); res.json({message:'Agent yanditswe', agent:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Agent aramaze kubaho'}); res.status(500).json({message:e.message}); }
});
app.get('/api/super-agents', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM super_agents ORDER BY created_at DESC'); res.json({super_agents:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/super-agents', async (req,res)=>{
  const {full_name, phone, province, password}=req.body;
  if(!full_name||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  if(!password || password.length < 4) return res.status(400).json({message:'Password igomba kuba nibura inyuguti 4!'});
  try{ const r=await pool.query('INSERT INTO super_agents (full_name, phone, province, password) VALUES ($1,$2,$3,$4) RETURNING *',[full_name, phone, province||'', password]); res.json({message:'Super Agent yanditswe', super_agent:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Super Agent aramaze kubaho'}); res.status(500).json({message:e.message}); }
});
app.post('/api/login', async (req,res)=>{
  const {name, full_name, phone, password}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({message:'Uzuza izina na telefone'});
  if(!password) return res.status(400).json({message:'Uzuza Password!'});
  try{
    const c=await pool.query('SELECT * FROM customers WHERE (name=$1 OR full_name=$1) AND phone=$2 AND password=$3',[finalName, phone, password]);
    if(c.rows.length===0) return res.status(401).json({message:'Izina / Numero / Password nabi!'});
    if(String(c.rows[0].status).toLowerCase()!=='approved') return res.status(403).json({message:'Tegereza Admin yemeze'});
    const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[c.rows[0].id]);
    const t=await pool.query('SELECT * FROM transactions WHERE customer_id=$1 OR receiver_phone=$2 ORDER BY created_at DESC LIMIT 10',[c.rows[0].id, phone]);
    res.json({message:'Murakaza neza', customer:c.rows[0], wallet:w.rows[0], transactions:t.rows});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/agent/login', async (req,res)=>{
  const {phone, password}=req.body;
  if(!phone||!password) return res.status(400).json({message:'Uzuza Numero na Password'});
  try{
    const a=await pool.query('SELECT a.*, COALESCE(w.balance,0) as wallet_balance FROM agents a LEFT JOIN agent_wallets w ON w.agent_id=a.id WHERE a.phone=$1 AND a.password=$2',[phone, password]);
    if(a.rows.length===0) return res.status(401).json({message:'Numero / Password nabi!'});
    res.json({message:'Murakaza neza Agent', agent:a.rows[0]});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/super/login', async (req,res)=>{
  const {phone, password}=req.body;
  if(!phone||!password) return res.status(400).json({message:'Uzuza Numero na Password'});
  try{
    const s=await pool.query('SELECT * FROM super_agents WHERE phone=$1 AND password=$2',[phone, password]);
    if(s.rows.length===0) return res.status(401).json({message:'Numero / Password nabi!'});
    res.json({message:'Murakaza neza Super Agent', super_agent:s.rows[0]});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/register', async (req,res)=>{
  const {name, full_name, phone, country, channel, password}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({error:'Izina na telefone birakenewe'});
  if(!password || password.length < 4) return res.status(400).json({error:'Password igomba kuba nibura inyuguti 4!'});
  try{ const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status, password) VALUES ($1,$1,$2,$3,$4,$5,$6) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'pending', password]); await pool.query('INSERT INTO wallets (customer_id, balance, bonus_locked, airtime_count) VALUES ($1, $2, TRUE, 0)',[r.rows[0].id, BONUS_AMOUNT]); res.json({success:true, customer:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({error:'Iyi numero yaramaze kwiyandikisha'}); res.status(500).json({error:e.message}); }
});
app.get('/api/wallet/:customerId', async (req,res)=>{ try{ const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[req.params.customerId]); res.json({wallet:w.rows[0]}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/airtime', async (req,res)=>{
  const {customerId, customer_id, phone, amount, operator}=req.body;
  const cid = customerId || customer_id;
  if(!cid||!phone||!amount) return res.status(400).json({message:'Uzuza vyose'});
  try{
    const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[cid]);
    if(!w.rows[0]||Number(w.rows[0].balance)<Number(amount)) return res.status(400).json({message:'Balance ntihagije'});
    const newBal=Number(w.rows[0].balance)-Number(amount);
    const newCount=(w.rows[0].airtime_count||0)+1;
    const locked = newCount>=2 ? false : true;
    await pool.query('UPDATE wallets SET balance=$1, airtime_count=$2, bonus_locked=$3 WHERE customer_id=$4',[newBal, newCount, locked, cid]);
    await pool.query('INSERT INTO airtime_purchases (customer_id, phone, amount, operator) VALUES ($1,$2,$3,$4)',[cid, phone, amount, operator||'Lumitel']);
    await pool.query('INSERT INTO transactions (customer_id, from_country, to_phone, receiver_phone, amount, type, code) VALUES ($1,$2,$3,$3,$4,$5,$6)',[cid, 'Burundi', phone, amount, 'airtime', 'SM'+Math.floor(100000+Math.random()*900000)]);
    const msg = locked ? `Unités zaguzwe! Urakeneye kugura ${2-newCount} nshasha kugira Bonus ifunguke.` : 'Unités zaguzwe! Bonus yawe irafungutse - ushobora kurungika ubu!';
    res.json({message:msg, balance:newBal});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.get('/api/airtime/:customerId', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM airtime_purchases WHERE customer_id=$1 ORDER BY created_at DESC',[req.params.customerId]); res.json({purchases:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/admin/check', (req,res)=>{ if(req.body.password===ADMIN_PASSWORD) return res.json({success:true}); res.status(401).json({error:'Password nabi'}); });
app.get('/api/admin/customers', async (req,res)=>{ try{ const r=await pool.query('SELECT c.*, w.balance, w.bonus_locked, w.airtime_count, LOWER(c.status) as status FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id ORDER BY c.created_at DESC'); res.json({customers:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/admin/approve/:id', async (req,res)=>{ try{ await pool.query("UPDATE customers SET status='approved' WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/block/:id', async (req,res)=>{ try{ await pool.query("UPDATE customers SET status='blocked' WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/unblock/:id', async (req,res)=>{ try{ await pool.query("UPDATE customers SET status='approved' WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.delete('/api/customers/:id', async (req,res)=>{
  try{ await pool.query('DELETE FROM wallets WHERE customer_id=$1',[req.params.id]); await pool.query('DELETE FROM transactions WHERE customer_id=$1',[req.params.id]); await pool.query('DELETE FROM airtime_purchases WHERE customer_id=$1',[req.params.id]); await pool.query('DELETE FROM customers WHERE id=$1',[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/buy-airtime', async (req,res)=>{
  const {customerId, customer_id, phone, amount, operator}=req.body;
  const cid = customerId || customer_id;
  try{ const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[cid]); if(!w.rows[0]||Number(w.rows[0].balance)<Number(amount)) return res.status(400).json({error:'Balance ntihagije'}); const newBal=Number(w.rows[0].balance)-Number(amount); const newCount=(w.rows[0].airtime_count||0)+1; const locked=newCount>=2?false:true; await pool.query('UPDATE wallets SET balance=$1, airtime_count=$2, bonus_locked=$3 WHERE customer_id=$4',[newBal, newCount, locked, cid]); await pool.query('INSERT INTO airtime_purchases (customer_id, phone, amount, operator) VALUES ($1,$2,$3,$4)',[cid, phone, amount, operator||'Lumitel']); await pool.query('INSERT INTO transactions (customer_id, from_country, to_phone, receiver_phone, amount, type, code) VALUES ($1,$2,$3,$3,$4,$5,$6)',[cid, 'Burundi', phone, amount, 'airtime', 'SM'+Math.floor(100000+Math.random()*900000)]); res.json({success:true, balance:newBal}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/send', async (req,res)=>{
  const {from_customer_id, to_phone, amount}=req.body; const fee=Number(amount)*0.02; const total=Number(amount)+fee;
  try{
    const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[from_customer_id]);
    if(!w.rows[0]||Number(w.rows[0].balance)<total) return res.status(400).json({error:'Balance ntihagije + komisiyo'});
    if(w.rows[0].bonus_locked) return res.status(403).json({error:`Bonus ntiyemerewe kurungikwa! Banza ugure Unités inshuro ${2-(w.rows[0].airtime_count||0)} zikurikira.`});
    const newBal=Number(w.rows[0].balance)-total;
    await pool.query('UPDATE wallets SET balance=$1 WHERE customer_id=$2',[newBal, from_customer_id]);
    const agent_share=fee*0.6; const super_share=fee*0.2; const platform_share=fee*0.2;
    await pool.query('INSERT INTO transactions (customer_id, from_country, to_phone, receiver_phone, amount, fee, agent_share, super_share, platform_share, type, code) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)',[from_customer_id, 'Burundi', to_phone, amount, fee, agent_share, super_share, platform_share, 'send', 'SM'+Math.floor(100000+Math.random()*900000)]);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1, total_earned=total_earned+$1 WHERE id=1',[platform_share]);
    res.json({success:true, balance:newBal, fee});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/withdraw/agent', async (req,res)=>{
  const {agent_id, amount, method}=req.body;
  if(!agent_id||!amount) return res.status(400).json({message:'Uzuza vyose'});
  if(Number(amount)<MIN_WITHDRAW) return res.status(400).json({message:`Minimum yo kurotira ni ${MIN_WITHDRAW} BIF`});
  try{
    const w=await pool.query('SELECT * FROM agent_wallets WHERE agent_id=$1',[agent_id]);
    if(!w.rows[0]||Number(w.rows[0].balance)<Number(amount)) return res.status(400).json({message:'Balance ya komisiyo ntihagije'});
    const a=await pool.query('SELECT * FROM agents WHERE id=$1',[agent_id]);
    await pool.query('INSERT INTO withdrawals (user_type, user_id, user_name, phone, amount, method, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',['agent', agent_id, a.rows[0].full_name, a.rows[0].phone, amount, method||'Mobile Money', 'pending']);
    res.json({message:'Demande yo kurotira yoherejwe!'});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/withdraw/super', async (req,res)=>{
  const {super_id, amount, method}=req.body;
  if(!super_id||!amount) return res.status(400).json({message:'Uzuza vyose'});
  if(Number(amount)<MIN_WITHDRAW) return res.status(400).json({message:`Minimum yo kurotira ni ${MIN_WITHDRAW} BIF`});
  try{
    const s=await pool.query('SELECT * FROM super_agents WHERE id=$1',[super_id]);
    if(!s.rows[0]||Number(s.rows[0].balance)<Number(amount)) return res.status(400).json({message:'Balance ntihagije'});
    await pool.query('INSERT INTO withdrawals (user_type, user_id, user_name, phone, amount, method, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',['super', super_id, s.rows[0].full_name, s.rows[0].phone, amount, method||'Mobile Money', 'pending']);
    res.json({message:'Demande yoherejwe!'});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/withdraw/platform', async (req,res)=>{
  const {amount, method}=req.body;
  if(!amount) return res.status(400).json({message:'Uzuza amount'});
  if(Number(amount)<MIN_WITHDRAW) return res.status(400).json({message:`Minimum yo kurotira ni ${MIN_WITHDRAW} BIF`});
  try{
    const p=await pool.query('SELECT * FROM platform_wallet WHERE id=1');
    if(!p.rows[0]||Number(p.rows[0].balance)<Number(amount)) return res.status(400).json({message:'Balance ya Platform ntihagije'});
    await pool.query('INSERT INTO withdrawals (user_type, user_id, user_name, phone, amount, method, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',['platform', 1, 'Joctan Nyandwi - Platform', '', amount, method||'Mobile Money', 'pending']);
    res.json({message:'Demande ya Platform yoherejwe!'});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.get('/api/platform/balance', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM platform_wallet WHERE id=1'); res.json({wallet:r.rows[0]}); }catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/withdrawals', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC'); res.json({withdrawals:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/withdrawals/:id/approve', async (req,res)=>{
  try{
    const w=await pool.query('SELECT * FROM withdrawals WHERE id=$1',[req.params.id]);
    if(!w.rows[0]) return res.status(404).json({message:'Ntabonetse'});
    if(w.rows[0].status!=='pending') return res.status(400).json({message:'Yaramaze kwemezwa'});
    await pool.query("UPDATE withdrawals SET status='approved' WHERE id=$1",[req.params.id]);
    if(w.rows[0].user_type==='agent') await pool.query('UPDATE agent_wallets SET balance=balance-$1, total_withdrawn=total_withdrawn+$1 WHERE agent_id=$2',[w.rows[0].amount, w.rows[0].user_id]);
    else if(w.rows[0].user_type==='super') await pool.query('UPDATE super_agents SET balance=balance-$1, total_withdrawn=total_withdrawn+$1 WHERE id=$2',[w.rows[0].amount, w.rows[0].user_id]);
    else if(w.rows[0].user_type==='platform') await pool.query('UPDATE platform_wallet SET balance=balance-$1, total_withdrawn=total_withdrawn+$1 WHERE id=1',[w.rows[0].amount]);
    res.json({message:'Kurotira kwemejwe!'});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/withdrawals/:id/reject', async (req,res)=>{ try{ await pool.query("UPDATE withdrawals SET status='rejected' WHERE id=$1",[req.params.id]); res.json({message:'Demande yahakanywe'}); }catch(e){ res.status(500).json({error:e.message}); } });
app.listen(PORT, ()=>console.log(`🚀 Server kuri port ${PORT}`));
