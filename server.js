const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors()); app.use(express.json()); app.use(express.static(path.join(__dirname)));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon') ? { rejectUnauthorized: false } : false });
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Joc7777777';
const ADMIN_2FA = process.env.ADMIN_2FA_CODE || '1357';
let adminFails = 0, adminBlockedUntil = 0;
let loginFails = {};
async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS customers(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, country TEXT, channel TEXT, password TEXT, balance NUMERIC DEFAULT 0, bonus NUMERIC DEFAULT 10000, bonus_unlocked BOOLEAN DEFAULT false, airtime_count INT DEFAULT 0, referral_code TEXT, referred_by TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agents(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, province TEXT, password TEXT, commission NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS super_agents(id SERIAL PRIMARY KEY, full_name TEXT, phone TEXT UNIQUE, password TEXT, commission NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS transactions(id SERIAL PRIMARY KEY, code TEXT, sender_phone TEXT, receiver_phone TEXT, amount NUMERIC, fee NUMERIC, channel TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS withdrawals(id SERIAL PRIMARY KEY, phone TEXT, amount NUMERIC, channel TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reset_requests(id SERIAL PRIMARY KEY, phone TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  console.log('DB ready - Lumicash / Ecocash');
}
initDB().catch(e=>console.error(e));
app.get('/api/health', async (req,res)=>{ try{ await pool.query('SELECT 1'); res.json({ok:true,db:'connected'});}catch(e){ res.json({ok:false,db:'error'});} });
function genCode(prefix){ return prefix + Math.floor(1000+Math.random()*9000); }
function genRef(){ return 'SM'+Math.floor(1000+Math.random()*9000); }
app.post('/api/customers', async (req,res)=>{
  const {full_name,phone,country,channel,password,referral_code}=req.body;
  if(!/^[0-9]{4}$/.test(password||'')) return res.status(400).json({message:'Password = IBHARURO 4 GUSA!'});
  try{ const ref=genRef(); const r=await pool.query('INSERT INTO customers(full_name,phone,country,channel,password,referral_code,referred_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[full_name,phone,country,channel,password,ref,referral_code||null]); res.json({message:'Wiyandikishije neza! Tegereza Admin yemeze. Bonus 10,000 BIF!',user:r.rows[0]});}catch(e){ res.status(400).json({message:'Iyi numero yamaze kwiyandikisha!'}); }
});
app.post('/api/agents', async (req,res)=>{
  const {full_name,phone,province,password}=req.body;
  if(!/^[0-9]{4}$/.test(password||'')) return res.status(400).json({message:'Password = 4 GUSA!'});
  try{ const r=await pool.query('INSERT INTO agents(full_name,phone,province,password) VALUES($1,$2,$3,$4) RETURNING *',[full_name,phone,province,password]); res.json({message:'Wiyandikishije nkAgent!',user:r.rows[0]});}catch(e){ res.status(400).json({message:'Iyi numero yamaze kwiyandikisha!'}); }
});
app.post('/api/login', async (req,res)=>{
  const {phone,password,role}=req.body; const table=role==='agent'?'agents':role==='super_agent'?'super_agents':'customers';
  const key=phone+role; const now=Date.now();
  if(loginFails[key] && loginFails[key].blockedUntil>now) return res.status(403).json({message:'Compte yahagaritswe 24h - Gerageza ejo!'});
  const r=await pool.query(`SELECT * FROM ${table} WHERE phone=$1`,[phone]);
  if(!r.rows.length || r.rows[0].password!==password){
    loginFails[key]=loginFails[key]||{count:0}; loginFails[key].count++;
    if(loginFails[key].count>=4){ loginFails[key].blockedUntil=now+24*60*60*1000; loginFails[key].count=0; return res.status(403).json({message:'Wakose 4x - Compte yahagaritswe 24h!'}); }
    return res.status(400).json({message:'Numero canke Password si vyo! ('+(4-loginFails[key].count)+' bisigaye)'});
  }
  if(r.rows[0].status==='pending') return res.status(403).json({message:'Tegereza Admin yemeze!'});
  if(r.rows[0].status==='blocked') return res.status(403).json({message:'Compte yawe yahagaritswe! Hamagara SendMoney.'});
  loginFails[key]={count:0}; res.json({message:'Murakaza neza!',user:r.rows[0]});
});
app.get('/api/lookup', async (req,res)=>{ const r=await pool.query('SELECT full_name,phone FROM customers WHERE phone=$1',[req.query.phone]); if(!r.rows.length) return res.json({message:'Nta muntu afise iyi numero - Saba yiyandikishe!'}); res.json(r.rows[0]); });
app.post('/api/send', async (req,res)=>{
  const {sender_phone,receiver_phone,amount,channel,password}=req.body;
  if(amount>200000) return res.status(400).json({message:'Max 200,000 BIF rimwe!'});
  const s=await pool.query('SELECT * FROM customers WHERE phone=$1',[sender_phone]); if(!s.rows.length) return res.status(400).json({message:'Sender ntabaho!'});
  if(s.rows[0].password!==password) return res.status(400).json({message:'PIN si yo!'});
  const day=await pool.query("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE sender_phone=$1 AND created_at::date=CURRENT_DATE",[sender_phone]);
  if(Number(day.rows[0].total)+Number(amount)>500000) return res.status(400).json({message:'Max 500,000 BIF ku musi!'});
  const r=await pool.query('SELECT * FROM customers WHERE phone=$1',[receiver_phone]); if(!r.rows.length) return res.status(400).json({message:'Uwakira ntarandikwa!'});
  const fee=Math.round(amount*0.02); const net=amount-fee;
  const code='SM'+Date.now().toString().slice(-8);
  await pool.query('UPDATE customers SET balance=balance-$1 WHERE phone=$2',[amount,sender_phone]);
  await pool.query('UPDATE customers SET balance=balance+$1 WHERE phone=$2',[net,receiver_phone]);
  await pool.query('INSERT INTO transactions(code,sender_phone,receiver_phone,amount,fee,channel) VALUES($1,$2,$3,$4,$5,$6)',[code,sender_phone,receiver_phone,amount,fee,channel]);
  // Commission: Agent 60% / Super 20% / Platform 20% with daily caps
  const agentFee=fee*0.6, superFee=fee*0.2;
  const agToday=await pool.query("SELECT COALESCE(SUM(fee),0) as t FROM transactions WHERE created_at::date=CURRENT_DATE"); // simplified
  await pool.query('UPDATE agents SET commission=commission+$1 WHERE id=(SELECT id FROM agents ORDER BY id LIMIT 1)',[Math.min(agentFee,50000)]);
  await pool.query('UPDATE super_agents SET commission=commission+$1 WHERE id=(SELECT id FROM super_agents ORDER BY id LIMIT 1)',[Math.min(superFee,30000)]);
  // Referral 200 BIF first use
  const sender=s.rows[0];
  if(sender.referred_by){ const inv=await pool.query('SELECT * FROM customers WHERE referral_code=$1',[sender.referred_by]); if(inv.rows.length){ const cnt=await pool.query('SELECT COUNT(*) FROM transactions WHERE sender_phone=$1',[sender_phone]); if(Number(cnt.rows[0].count)===1){ await pool.query('UPDATE customers SET balance=balance+200 WHERE referral_code=$1',[sender.referred_by]); } } }
  res.json({message:'Vyoherejwe neza! Code: '+code,code});
});
app.post('/api/airtime', async (req,res)=>{
  const {phone,operator,amount,password}=req.body;
  const u=await pool.query('SELECT * FROM customers WHERE phone=$1',[phone]); if(!u.rows.length||u.rows[0].password!==password) return res.status(400).json({message:'PIN si yo!'});
  await pool.query('UPDATE customers SET airtime_count=airtime_count+1 WHERE phone=$1',[phone]);
  const after=await pool.query('SELECT * FROM customers WHERE phone=$1',[phone]);
  if(after.rows[0].airtime_count>=2 && !after.rows[0].bonus_unlocked){ await pool.query('UPDATE customers SET bonus_unlocked=true, balance=balance+bonus WHERE phone=$1',[phone]); return res.json({message:'Unites zaguze! Bonus 10,000 BIF YAFUNGUTSE! 🎉'}); }
  res.json({message:'Unites zaguze! Uguze '+after.rows[0].airtime_count+'x - Gura 2x ufungure Bonus!'});
});
app.post('/api/withdraw', async (req,res)=>{
  const {phone,amount,channel}=req.body; if(amount>100000) return res.status(400).json({message:'Max 100,000 / jour!'});
  const d=await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE phone=$1 AND created_at::date=CURRENT_DATE AND status!='rejected'",[phone]);
  if(Number(d.rows[0].t)+Number(amount)>100000) return res.status(400).json({message:'Max 100,000 ku musi!'});
  await pool.query('INSERT INTO withdrawals(phone,amount,channel) VALUES($1,$2,$3)',[phone,amount,channel]); res.json({message:'Saba ryohererejwe kuri Admin!'});
});
app.get('/api/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions WHERE sender_phone=$1 OR receiver_phone=$1 ORDER BY created_at DESC LIMIT 100',[req.query.phone]); res.json(r.rows); });
app.get('/api/agent/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'); res.json(r.rows); });
app.get('/api/super/agents', async (req,res)=>{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/super/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 100'); res.json(r.rows); });
app.post('/api/request-reset', async (req,res)=>{ await pool.query('INSERT INTO reset_requests(phone) VALUES($1)',[req.body.phone]); res.json({message:'Saba ryohererejwe! Admin azoguhamagara abaze ibibazo 5.'}); });
app.post('/api/admin/login', async (req,res)=>{
  const {password,code2fa}=req.body; const now=Date.now();
  if(adminBlockedUntil>now) return res.status(403).json({message:'Admin yahagaritswe - Gerageza nyuma y\'iminota 30!'});
  if(password!==ADMIN_PASSWORD || code2fa!==ADMIN_2FA){ adminFails++; if(adminFails>=4){ adminBlockedUntil=now+30*60*1000; adminFails=0; return res.status(403).json({message:'Wakose 4x - Gara 30 min!'}); } return res.status(400).json({message:'Password canke 2FA si vyo! ('+(4-adminFails)+' bisigaye)'}); }
  adminFails=0; res.json({message:'Murakaza neza Admin!'});
});
app.get('/api/admin/customers', async (req,res)=>{ const r=await pool.query('SELECT * FROM customers ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/admin/agents', async (req,res)=>{ const r=await pool.query('SELECT * FROM agents ORDER BY created_at DESC'); res.json(r.rows); });
app.get('/api/admin/transactions', async (req,res)=>{ const r=await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200'); res.json(r.rows); });
app.get('/api/admin/withdrawals', async (req,res)=>{ const r=await pool.query("SELECT * FROM withdrawals WHERE status='pending' ORDER BY created_at DESC"); res.json(r.rows); });
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
app.post('/api/admin/withdrawals/:id/:action', async (req,res)=>{
  const {id,action}=req.params;
  if(action==='approve') await pool.query("UPDATE withdrawals SET status='approved' WHERE id=$1",[id]);
  if(action==='reject') await pool.query("UPDATE withdrawals SET status='rejected' WHERE id=$1",[id]);
  res.json({message:'Vyagenze!'});
});
app.post('/api/admin/reset-password', async (req,res)=>{
  const {phone,new_password}=req.body; await pool.query('UPDATE customers SET password=$1 WHERE phone=$2',[new_password,phone]); await pool.query('UPDATE agents SET password=$1 WHERE phone=$2',[new_password,phone]); res.json({message:'Password yahinduwe!'});
});
const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log('SendMoney on '+PORT));
