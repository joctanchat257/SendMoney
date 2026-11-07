const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Joctan2026!';
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME || 'sendmoney_db', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'joctan' }
);
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, name TEXT, phone TEXT UNIQUE NOT NULL, country TEXT DEFAULT 'Burundi', channel TEXT DEFAULT 'Mobile Money', status TEXT DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE, balance NUMERIC DEFAULT 500000, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), from_country TEXT, to_country TEXT, receiver_phone TEXT, to_phone TEXT, amount NUMERIC, fee NUMERIC DEFAULT 0, agent_share NUMERIC DEFAULT 0, super_share NUMERIC DEFAULT 0, platform_share NUMERIC DEFAULT 0, code TEXT, payment_method TEXT, type TEXT DEFAULT 'transfer', status TEXT DEFAULT 'completed', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS airtime_purchases (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), phone TEXT, amount NUMERIC, operator TEXT DEFAULT 'Lumitel', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS agents (id SERIAL PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, province TEXT, commission_rate NUMERIC DEFAULT 20, created_at TIMESTAMP DEFAULT NOW());
    `);
    console.log('✅ Tables zikozwe / PostgreSQL ihujwe!');
  } catch(e){ console.log('❌ DB error:', e.message); }
}
initDB();
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/status', (req,res)=>res.json({message:'SendMoney irakora'}));
app.get('/db-test', async (req,res)=>{ try{ const r=await pool.query('SELECT NOW()'); res.json({message:'Database ihuye neza', time:r.rows[0].now}); }catch(e){ res.status(500).json({error:e.message}); } });

// --- FRONTEND script.js ihuye ---
app.post('/api/customers', async (req,res)=>{
  const {full_name, name, phone, country, channel}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  try{
    const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status) VALUES ($1,$1,$2,$3,$4,$5) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'PENDING']);
    await pool.query('INSERT INTO wallets (customer_id, balance) VALUES ($1, 500000)',[r.rows[0].id]);
    res.json({message:'Kwiyandikisha vyagenze', customer:r.rows[0]});
  }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Iyi numero yaramaze kwiyandikisha'}); res.status(500).json({message:e.message}); }
});
app.get('/api/customers', async (req,res)=>{ try{ const r=await pool.query('SELECT c.*, w.balance FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id ORDER BY c.created_at DESC'); res.json(r.rows); }catch(e){ res.status(500).json({message:e.message}); } });
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
app.get('/api/transactions', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC'); res.json(r.rows); }catch(e){ res.status(500).json({message:e.message}); } });
app.get('/api/agents', async (req,res)=>{ try{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json({agents:r.rows}); }catch(e){ res.status(500).json({message:e.message}); } });
app.post('/api/agents', async (req,res)=>{
  const {full_name, phone, province}=req.body;
  if(!full_name||!phone) return res.status(400).json({message:'Izina na telefone birakenewe'});
  try{ const r=await pool.query('INSERT INTO agents (full_name, phone, province) VALUES ($1,$2,$3) RETURNING *',[full_name, phone, province||'']); res.json({message:'Agent yanditswe', agent:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({message:'Agent aramaze kubaho'}); res.status(500).json({message:e.message}); }
});

// --- ADMIN / CLIENT ya kera ---
app.post('/api/register', async (req,res)=>{
  const {name, full_name, phone, country, channel}=req.body;
  const finalName = full_name || name;
  if(!finalName||!phone) return res.status(400).json({error:'Izina na telefone birakenewe'});
  try{ const r=await pool.query('INSERT INTO customers (full_name, name, phone, country, channel, status) VALUES ($1,$1,$2,$3,$4,$5) RETURNING *',[finalName, phone, country||'Burundi', channel||'Mobile Money', 'PENDING']); await pool.query('INSERT INTO wallets (customer_id, balance) VALUES ($1, 500000)',[r.rows[0].id]); res.json({success:true, customer:r.rows[0]}); }catch(e){ if(e.code==='23505') return res.status(400).json({error:'Iyi numero yaramaze kwiyandikisha'}); res.status(500).json({error:e.message}); }
});
app.post('/api/login', async (req,res)=>{
  const {name, phone}=req.body;
  try{ const c=await pool.query('SELECT * FROM customers WHERE (name=$1 OR full_name=$1) AND phone=$2',[name, phone]); if(c.rows.length===0) return res.status(404).json({error:'Nta mukiriya abonetse'}); if(c.rows[0].status!=='APPROVED') return res.status(403).json({error:'Tegereza Admin yemeze'}); const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[c.rows[0].id]); res.json({success:true, customer:c.rows[0], wallet:w.rows[0]}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/wallet/:customerId', async (req,res)=>{ try{ const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[req.params.customerId]); res.json(w.rows[0]); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/check', (req,res)=>{ if(req.body.password===ADMIN_PASSWORD) return res.json({success:true}); res.status(401).json({error:'Password nabi'}); });
app.get('/api/admin/customers', async (req,res)=>{ try{ const r=await pool.query('SELECT c.*, w.balance FROM customers c LEFT JOIN wallets w ON w.customer_id=c.id ORDER BY c.created_at DESC'); res.json(r.rows); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/approve/:id', async (req,res)=>{ try{ await pool.query("UPDATE customers SET status='APPROVED' WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/buy-airtime', async (req,res)=>{
  const {customer_id, phone, amount, operator}=req.body;
  try{ const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[customer_id]); if(!w.rows[0]||Number(w.rows[0].balance)<Number(amount)) return res.status(400).json({error:'Balance ntihagije'}); const newBal=Number(w.rows[0].balance)-Number(amount); await pool.query('UPDATE wallets SET balance=$1 WHERE customer_id=$2',[newBal, customer_id]); await pool.query('INSERT INTO airtime_purchases (customer_id, phone, amount, operator) VALUES ($1,$2,$3,$4)',[customer_id, phone, amount, operator||'Lumitel']); await pool.query('INSERT INTO transactions (from_country, to_phone, receiver_phone, amount, type) VALUES ($1,$2,$2,$3,$4)',['Burundi', phone, amount, 'airtime']); res.json({success:true, balance:newBal}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/send', async (req,res)=>{
  const {from_customer_id, to_phone, amount}=req.body; const fee=Number(amount)*0.02; const total=Number(amount)+fee;
  try{ const w=await pool.query('SELECT * FROM wallets WHERE customer_id=$1',[from_customer_id]); if(!w.rows[0]||Number(w.rows[0].balance)<total) return res.status(400).json({error:'Balance ntihagije + komisiyo'}); const newBal=Number(w.rows[0].balance)-total; await pool.query('UPDATE wallets SET balance=$1 WHERE customer_id=$2',[newBal, from_customer_id]); await pool.query('INSERT INTO transactions (from_country, to_phone, receiver_phone, amount, fee, type) VALUES ($1,$2,$2,$3,$4,$5)',['Burundi', to_phone, amount, fee, 'send']); res.json({success:true, balance:newBal, fee}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.listen(PORT, ()=>console.log(`🚀 Server kuri port ${PORT}`));
