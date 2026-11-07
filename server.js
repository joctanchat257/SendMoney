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
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME || 'sendmoney_db', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'joctan' }
);
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, name TEXT, phone TEXT UNIQUE NOT NULL, country TEXT DEFAULT 'Burundi', channel TEXT DEFAULT 'Mobile Money', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE, balance NUMERIC DEFAULT 10000, bonus_locked BOOLEAN DEFAULT TRUE, airtime_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), from_country TEXT, to_country TEXT, receiver_phone TEXT, to_phone TEXT, amount NUMERIC, fee NUMERIC DEFAULT 0, agent_share NUMERIC DEFAULT 0, super_share NUMERIC DEFAULT 0, platform_share NUMERIC DEFAULT 0, code TEXT, payment_method TEXT, type TEXT DEFAULT 'transfer', status TEXT DEFAULT 'completed', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS airtime_purchases (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), phone TEXT, amount NUMERIC, operator TEXT DEFAULT 'Lumitel', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS agents (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, province TEXT, commission_rate NUMERIC DEFAULT 20, created_at TIMESTAMP DEFAULT NOW());
    `);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name TEXT;`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Burundi';`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'Mobile Money';`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';`);
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
    console.log('✅ Tables zikozwe / Bonus 10,000 BIF / PostgreSQL ihujwe!');
  } catch(e){ console.log('❌ DB error:', e.message); }
}
initDB();
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/status', (req,res)=>res.json({message:'SendMoney irakora'}));
app.get('/db-test', async (req,res)=>{ try{ const r=await pool.query('SELECT NOW()'); res.json({message:'Database ihuye neza', time:r.rows[0].now}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/customers', async (req,res)=>{
  const {full_name, name, phone, country, channel}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  try{
    const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status) VALUES ($1,$1,$2,$3,$4,$5) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'pending']);
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
  const {fromCountry, toCountry, receiverPhone, to_phone, amount, paymentMethod}=req.body;
  const toPh = receiverPhone || to_phone;
  const amt = Number(amount);
  if(!amt||!toPh) return res.status(400).json({message:'Amount na numero birakenewe'});
  const fee = amt*0.02;
  const agent_share = fee*0.6;
  const super_share = fee*0.2;
  const platform_share = fee*0.2;
  const code = 'SM'+Math.floor(100000+Math.random()*900000);
  try{
    const r=await pool.query('INSERT INTO transactions (from_country, to_country, receiver_phone, to_phone, amount, fee, agent_share, super_share, platform_share, code, payment_method, type) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[fromCountry||'Burundi', toCountry||'Burundi', toPh, amt, fee, agent_share, super_share, platform_share, code, paymentMethod||'Mobile Money', 'transfer']);
    res.json({message:'Transaction vyagenze', transaction:r.rows[0]});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.get('/api/transactions', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC'); res.json({transactions:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/agents', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json({agents:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/agents', async (req,res)=>{
  const {full_name, phone, province}=req.body;
  if(!full_name||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  try{ const r=await pool.query('INSERT INTO agents (full_name, phone, province) VALUES ($1,$2,$3) RETURNING *',[full_name, phone, province||'']); res.json({message:'Agent yanditswe', agent:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Agent aramaze kubaho'}); res.status(500).json({message:e.message}); }
});
app.post('/api/login', async (req,res)=>{
  const {name, full_name, phone}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({message:'Uzuza izina na telefone'});
  try{
    const c=await pool.query('SELECT * FROM customers WHERE (name=$1 OR full_name=$1) AND phone=$2',[finalName, phone]);
    if(c.rows.length===0) return res.status(404).json({message:'Nta mukiriya abonetse'});
    if(String(c.rows[0].status).toLowerCase()!=='approved') return res.status(403).json({message:'Tegereza Admin yemeze'});
    const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[c.rows[0].id]);
    const t=await pool.query('SELECT * FROM transactions WHERE customer_id=$1 OR receiver_phone=$2 ORDER BY created_at DESC LIMIT 10',[c.rows[0].id, phone]);
    res.json({message:'Murakaza neza', customer:c.rows[0], wallet:w.rows[0], transactions:t.rows});
  }catch(e){ res.status(500).json({message:e.message}); }
});
app.post('/api/register', async (req,res)=>{
  const {name, full_name, phone, country, channel}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({error:'Izina na telefone birakenewe'});
  try{ const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status) VALUES ($1,$1,$2,$3,$4,$5) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'pending']); await pool.query('INSERT INTO wallets (customer_id, balance, bonus_locked, airtime_count) VALUES ($1, $2, TRUE, 0)',[r.rows[0].id, BONUS_AMOUNT]); res.json({success:true, customer:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({error:'Iyi numero yaramaze kwiyandikisha'}); res.status(500).json({error:e.message}); }
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
    if(w.rows[0].bonus_locked){
      return res.status(403).json({error:`Bonus ntiyemerewe kurungikwa! Banza ugure Unités inshuro ${2-(w.rows[0].airtime_count||0)} zikurikira kugira Bonus ifunguke. Ushobora kugura Unités gusa ubu.`});
    }
    const newBal=Number(w.rows[0].balance)-total;
    await pool.query('UPDATE wallets SET balance=$1 WHERE customer_id=$2',[newBal, from_customer_id]);
    await pool.query('INSERT INTO transactions (customer_id, from_country, to_phone, receiver_phone, amount, fee, type, code) VALUES ($1,$2,$3,$3,$4,$5,$6,$7)',[from_customer_id, 'Burundi', to_phone, amount, fee, 'send', 'SM'+Math.floor(100000+Math.random()*900000)]);
    res.json({success:true, balance:newBal, fee});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.listen(PORT, ()=>console.log(`🚀 Server kuri port ${PORT}`));
