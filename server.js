const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS customers(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, password TEXT, country TEXT, channel TEXT, balance NUMERIC DEFAULT 0, bonus NUMERIC DEFAULT 0, referral_code TEXT, invited_by TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agents(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, password TEXT, province TEXT, commission NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS super_agents(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, password TEXT, commission NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS transactions(id SERIAL PRIMARY KEY, code TEXT, sender_phone TEXT, receiver_phone TEXT, amount NUMERIC, fee NUMERIC, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS withdrawals(id SERIAL PRIMARY KEY, phone TEXT, amount NUMERIC, channel TEXT, role TEXT DEFAULT 'client', full_name TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'client'`);
  await pool.query(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''`);
  console.log('DB ready - Lumicash / Ecocash');
}
initDB().catch(e=>console.log(e));

// ---- LOGIN ----
app.post('/api/login', async (req,res)=>{
  const {phone,password,role}=req.body;
  let table='customers'; if(role==='agent') table='agents'; if(role==='super_agent') table='super_agents';
  const r=await pool.query(`SELECT * FROM ${table} WHERE phone=$1`,[phone]);
  if(!r.rows.length) return res.status(400).json({message:'Ntabaho!'});
  if(r.rows[0].password!==password) return res.status(400).json({message:'Password si yo!'});
  if(r.rows[0].status==='blocked') return res.status(400).json({message:'Wahagaritswe! Vugana na Admin.'});
  if(r.rows[0].status==='pending' && role!=='super_agent') return res.status(400).json({message:'Tegereza Admin akweemeze!'});
  res.json({message:'Urakaza neza!',user:r.rows[0]});
});

// ---- REGISTER ----
app.post('/api/register', async (req,res)=>{
  const {full_name,phone,password,country,channel,referral_code}=req.body;
  if(!/^[0-9]{4}$/.test(password||'')) return res.status(400).json({message:'Password = 4 chiffres GUSA!'});
  try{
    const code='SM'+Math.floor(1000+Math.random()*9000);
    const r=await pool.query('INSERT INTO customers(full_name,phone,password,country,channel,referral_code,invited_by,bonus) VALUES($1,$2,$3,$4,$5,$6,$7,10000) RETURNING *',[full_name,phone,password,country,channel,code,referral_code||null]);
    res.json({message:'Wiyandikishije! Bonus 10,000 BIF. Tegereza Admin.',user:r.rows[0]});
  }catch(e){ res.status(400).json({message:'Iyi numero yamaze kwiyandikisha!'}); }
});
app.post('/api/agents', async (req,res)=>{
  const {full_name,phone,password,province}=req.body;
  if(!/^[0-9]{4}$/.test(password||'')) return res.status(400).json({message:'Password = 4 GUSA!'});
  try{ const r=await pool.query('INSERT INTO agents(full_name,phone,password,province) VALUES($1,$2,$3,$4) RETURNING *',[full_name,phone,password,province]); res.json({message:'Wiyandikishije nka Agent!',user:r.rows[0]});}catch(e){ res.status(400).json({message:'Iyi numero yamaze kwiyandikisha!'}); }
});
app.post('/api/super-agents', async (req,res)=>{
  const {full_name,phone,password}=req.body;
  if(!/^[0-9]{4}$/.test(password||'')) return res.status(400).json({message:'Password = 4 GUSA!'});
  try{ const r=await pool.query('INSERT INTO super_agents(full_name,phone,password) VALUES($1,$2,$3) RETURNING *',[full_name,phone,password]); res.json({message:'Wiyandikishije nka Super Agent!',user:r.rows[0]});}catch(e){ res.status(400).json({message:'Iyi numero yamaze kwiyandikisha!'}); }
});

// ---- SEND ----
app.post('/api/send', async (req,res)=>{
  const {sender_phone,receiver_phone,amount,pin}=req.body;
  const s=await pool.query('SELECT * FROM customers WHERE phone=$1',[sender_phone]);
  if(!s.rows.length) return res.status(400).json({message:'Sender ntabaho!'});
  if(s.rows[0].password!==pin) return res.status(400).json({message:'PIN si yo!'});
  const amt=Number(amount); const fee=Math.round(amt*0.02);
  if(Number(s.rows[0].balance)<amt+fee) return res.status(400).json({message:'Balance ntihagije!'});
  const code='SM'+Date.now().toString().slice(-6);
  await pool.query('UPDATE customers SET balance=balance-$1 WHERE phone=$2',[amt+fee,sender_phone]);
  await pool.query('INSERT INTO customers(full_name,phone,password,country,channel,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (phone) DO UPDATE SET balance=customers.balance+$7',[ 'Receiver',receiver_phone,'0000','Burundi','Lumicash','approved',amt]);
  await pool.query('INSERT INTO transactions(code,sender_phone,receiver_phone,amount,fee) VALUES($1,$2,$3,$4,$5)',[code,sender_phone,receiver_phone,amt,fee]);
  // Commission: Agent 60% / Super 20% / Platform 20%
  await pool.query('UPDATE agents SET commission=commission+$1 WHERE status=$2 ORDER BY id LIMIT 1',[(fee*0.6),'approved']).catch(()=>{});
  await pool.query('UPDATE super_agents SET commission=commission+$1 WHERE status=$2 ORDER BY id LIMIT 1',[(fee*0.2),'approved']).catch(()=>{});
  res.json({message:'Vyarungitswe!',code});
});

// ---- WITHDRAW - 1-5 KWEZI, KIRETSE ADMIN/CLIENT ----
app.post('/api/withdraw', async (req,res)=>{
  const {phone,amount,channel,password,role}=req.body; const rle=role||'client';
  if(amount>100000) return res.status(400).json({message:'Max 100,000 / jour!'});
  if(rle==='agent' || rle==='super_agent'){
    const day=new Date().getDate();
    if(day<1 || day>5){
      return res.status(400).json({message:'Withdraw ya Commission ifungurwa gusa ku wa 1 - 5 buri kwezi! Ubu turi ku wa '+day+'. Tegereza ukwezi gutaha.'});
    }
  }
  let table='customers'; if(rle==='agent') table='agents'; if(rle==='super_agent') table='super_agents';
  const u=await pool.query(`SELECT * FROM ${table} WHERE phone=$1`,[phone]);
  if(!u.rows.length) return res.status(400).json({message:'Ntabaho!'});
  if(password && u.rows[0].password!==password) return res.status(400).json({message:'PIN si yo!'});
  if(rle==='client'){ if(Number(u.rows[0].balance||0)<amount) return res.status(400).json({message:'Balance ntihagije!'}); }
  else { if(Number(u.rows[0].commission||0)<amount) return res.status(400).json({message:'Commission ntihagije! Ufise '+Number(u.rows[0].commission||0).toLocaleString()+' BIF'}); }
  const d=await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE phone=$1 AND created_at::date=CURRENT_DATE AND status!='rejected'",[phone]);
  if(Number(d.rows[0].t)+Number(amount)>100000) return res.status(400).json({message:'Max 100,000 ku musi!'});
  await pool.query('INSERT INTO withdrawals(phone,amount,channel,role,full_name) VALUES($1,$2,$3,$4,$5)',[phone,amount,channel,rle,u.rows[0].full_name||'']);
  res.json({message:'Saba ryohererejwe kuri Admin! Tegereza ayemeze.'});
});
app.get('/api/withdrawals', async (req,res)=>{
  const {phone,role}=req.query;
  let q='SELECT * FROM withdrawals WHERE phone=$1'; let p=[phone];
  if(role){ q+=' AND role=$2'; p.push(role); }
  q+=' ORDER BY created_at DESC LIMIT 50';
  const r=await pool.query(q,p); res.json(r.rows);
});

// ---- ADMIN ----
app.get('/api/admin/customers', async (req,res)=>{ const r=await pool.query('SELECT * FROM customers ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/admin/agents', async (req,res)=>{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/admin/super-agents', async (req,res)=>{ const r=await pool.query('SELECT * FROM super_agents ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/admin/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200'); res.json(r.rows); });
app.get('/api/admin/withdrawals', async (req,res)=>{ const r=await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 200'); res.json(r.rows); });
app.post('/api/admin/customers/:id/:action', async (req,res)=>{
  const {id,action}=req.params;
  if(action==='approve') await pool.query("UPDATE customers SET status='approved' WHERE id=$1",[id]);
  if(action==='block') await pool.query("UPDATE customers SET status='blocked' WHERE id=$1",[id]);
  if(action==='unblock') await pool.query("UPDATE customers SET status='approved' WHERE id=$1",[id]);
  if(action==='delete') await pool.query('DELETE FROM customers WHERE id=$1',[id]);
  res.json({message:'Vyagenze!'});
});
app.post('/api/admin/agents/:id/:action', async (req,res)=>{
  const {id,action}=req.params;
  if(action==='approve') await pool.query("UPDATE agents SET status='approved' WHERE id=$1",[id]);
  if(action==='block') await pool.query("UPDATE agents SET status='blocked' WHERE id=$1",[id]);
  if(action==='unblock') await pool.query("UPDATE agents SET status='approved' WHERE id=$1",[id]);
  res.json({message:'Vyagenze!'});
});
app.post('/api/admin/super-agents/:id/:action', async (req,res)=>{
  const {id,action}=req.params;
  if(action==='approve') await pool.query("UPDATE super_agents SET status='approved' WHERE id=$1",[id]);
  if(action==='block') await pool.query("UPDATE super_agents SET status='blocked' WHERE id=$1",[id]);
  if(action==='unblock') await pool.query("UPDATE super_agents SET status='approved' WHERE id=$1",[id]);
  if(action==='delete') await pool.query('DELETE FROM super_agents WHERE id=$1',[id]);
  res.json({message:'Vyagenze!'});
});
app.post('/api/admin/withdrawals/:id/:action', async (req,res)=>{
  const {id,action}=req.params;
  const w=await pool.query('SELECT * FROM withdrawals WHERE id=$1',[id]);
  if(!w.rows.length) return res.status(404).json({message:'Ntabaho!'});
  const wd=w.rows[0];
  if(action==='approve'){
    await pool.query("UPDATE withdrawals SET status='approved' WHERE id=$1",[id]);
    if(wd.role==='client'){ await pool.query('UPDATE customers SET balance=balance-$1 WHERE phone=$2',[wd.amount,wd.phone]); }
    if(wd.role==='agent'){ await pool.query('UPDATE agents SET commission=commission-$1 WHERE phone=$2',[wd.amount,wd.phone]); }
    if(wd.role==='super_agent'){ await pool.query('UPDATE super_agents SET commission=commission-$1 WHERE phone=$2',[wd.amount,wd.phone]); }
  }
  if(action==='reject') await pool.query("UPDATE withdrawals SET status='rejected' WHERE id=$1",[id]);
  res.json({message:'Vyagenze!'});
});
app.post('/api/admin/reset-password', async (req,res)=>{
  const {phone,new_password}=req.body;
  let done=false;
  for(const t of ['customers','agents','super_agents']){ const r=await pool.query(`UPDATE ${t} SET password=$1 WHERE phone=$2 RETURNING *`,[new_password,phone]); if(r.rows.length) done=true; }
  if(!done) return res.status(404).json({message:'Numero ntabaho!'});
  res.json({message:'Password yahindutse!'});
});
app.get('/api/agent/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'); res.json(r.rows); });
app.get('/api/super/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'); res.json(r.rows); });
app.get('/api/super/agents', async (req,res)=>{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json(r.rows); });

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log('Server kuri '+PORT));
