require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const app = express();
app.use(cors()); 
app.use(express.json()); 
app.use(express.static(__dirname));

const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "sendmoney_db",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});

pool.connect().then(()=>console.log("✅ PostgreSQL ihujwe!")).catch(e=>console.error("❌ DB",e.message));

app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/api/status", (req,res)=>res.json({message:"SendMoney irakora"}));
app.get("/db-test", async (req,res)=>{ try{ const r=await pool.query("SELECT NOW()"); res.json({message:"Database ihuye neza",time:r.rows[0].now}); }catch(e){ res.status(500).json({message:e.message}); } });

app.all("/api/setup", async (req,res)=>{
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, full_name VARCHAR(150) NOT NULL, phone VARCHAR(30) UNIQUE NOT NULL, country VARCHAR(100) NOT NULL, channel VARCHAR(100) NOT NULL, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS agents (id SERIAL PRIMARY KEY, full_name VARCHAR(150) NOT NULL, phone VARCHAR(30) UNIQUE NOT NULL, province VARCHAR(100) NOT NULL, commission_rate INT DEFAULT 60, total_commission DECIMAL(15,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, code VARCHAR(20) UNIQUE NOT NULL, from_country VARCHAR(100), to_country VARCHAR(100), receiver_phone VARCHAR(30), amount DECIMAL(15,2) NOT NULL, fee DECIMAL(10,2) NOT NULL, agent_share DECIMAL(10,2), super_share DECIMAL(10,2), sendmoney_share DECIMAL(10,2), payment_method VARCHAR(50), status VARCHAR(20) DEFAULT 'SUCCESS', customer_id INT REFERENCES customers(id), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    `);
    res.json({message:"Tables zose zateguwe"});
  }catch(e){ res.status(500).json({message:e.message}); }
});

app.all("/api/setup-wallet", async (req,res)=>{
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, customer_id INT UNIQUE REFERENCES customers(id), balance DECIMAL(15,2) DEFAULT 500000, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS airtime_purchases (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), phone VARCHAR(30), amount DECIMAL(10,2), operator VARCHAR(50), status VARCHAR(20) DEFAULT 'SUCCESS', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    `);
    await pool.query(`INSERT INTO wallets (customer_id) SELECT id FROM customers ON CONFLICT (customer_id) DO NOTHING`);
    res.json({message:"Wallet na Airtime vyateguwe"});
  }catch(e){ res.status(500).json({message:e.message}); }
});

app.post("/api/admin/check", (req,res)=>{
  if(req.body.password === (process.env.ADMIN_PASSWORD || "Joctan2026!")) res.json({ok:true});
  else res.status(401).json({message:"Password nabi"});
});

app.post("/api/customers", async (req,res)=>{
  const {full_name,phone,country,channel}=req.body; if(!full_name||!phone||!country||!channel) return res.status(400).json({message:"Uzuza vyose"});
  try{ const r=await pool.query(`INSERT INTO customers (full_name,phone,country,channel) VALUES ($1,$2,$3,$4) RETURNING *`,[full_name.trim(),phone.trim(),country,channel]); await pool.query(`INSERT INTO wallets (customer_id) VALUES ($1) ON CONFLICT (customer_id) DO NOTHING`,[r.rows[0].id]); res.status(201).json({message:"Ubusabe bwakiriwe",customer:r.rows[0]}); }
  catch(e){ if(e.code==="23505") return res.status(409).json({message:"Numero isanzwe ihari"}); res.status(500).json({message:e.message}); }
});
app.get("/api/customers", async (req,res)=>{ const r=await pool.query(`SELECT * FROM customers ORDER BY id DESC`); res.json({customers:r.rows}); });
app.patch("/api/customers/:id/status", async (req,res)=>{ const r=await pool.query(`UPDATE customers SET status=$1 WHERE id=$2 RETURNING *`,[req.body.status,req.params.id]); res.json({customer:r.rows[0]}); });

app.post("/api/agents", async (req,res)=>{ const {full_name,phone,province}=req.body; const r=await pool.query(`INSERT INTO agents (full_name,phone,province) VALUES ($1,$2,$3) RETURNING *`,[full_name.trim(),phone.trim(),province.trim()]); res.json({message:"Agent yinjijwe",agent:r.rows[0]}); });
app.get("/api/agents", async (req,res)=>{ const r=await pool.query(`SELECT * FROM agents ORDER BY id DESC`); res.json({agents:r.rows}); });

app.post("/api/transactions", async (req,res)=>{
  const {fromCountry,toCountry,receiverPhone,amount,paymentMethod}=req.body;
  const fee=Math.max(500,Number(amount)*0.02); const code="SM-"+Math.random().toString(36).substring(2,10).toUpperCase();
  const r=await pool.query(`INSERT INTO transactions (code,from_country,to_country,receiver_phone,amount,fee,agent_share,super_share,sendmoney_share,payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[code,fromCountry,toCountry,receiverPhone,amount,fee,fee*0.6,fee*0.2,fee*0.2,paymentMethod]);
  res.json({message:"Kohereza vyagenze",transaction:r.rows[0]});
});
app.get("/api/transactions", async (req,res)=>{ const r=await pool.query(`SELECT * FROM transactions ORDER BY id DESC LIMIT 100`); res.json({transactions:r.rows}); });

app.post("/api/login", async (req,res)=>{
  const {phone,full_name}=req.body; const r=await pool.query(`SELECT * FROM customers WHERE phone=$1 AND full_name ILIKE $2`,[phone.trim(),full_name.trim()]);
  if(r.rows.length===0) return res.status(404).json({message:"Nta konti"}); const c=r.rows[0]; if(c.status!=='approved') return res.status(403).json({message:"Tegereza Admin yemeze"}); const t=await pool.query(`SELECT * FROM transactions WHERE receiver_phone=$1 OR customer_id=$2 ORDER BY id DESC`,[c.phone,c.id]); res.json({customer:c,transactions:t.rows});
});

app.get("/api/wallet/:customerId", async (req,res)=>{
  let r=await pool.query(`SELECT * FROM wallets WHERE customer_id=$1`,[req.params.customerId]);
  if(r.rows.length===0){ r=await pool.query(`INSERT INTO wallets (customer_id) VALUES ($1) RETURNING *`,[req.params.customerId]); }
  res.json({wallet:r.rows[0]});
});
app.post("/api/airtime", async (req,res)=>{
  const {customerId,phone,amount,operator}=req.body; if(!customerId||!phone||!amount) return res.status(400).json({message:"Uzuza vyose"}); if(Number(amount)<500) return res.status(400).json({message:"Min 500 BIF"});
  const w=await pool.query(`SELECT * FROM wallets WHERE customer_id=$1`,[customerId]);
  if(w.rows.length===0 || Number(w.rows[0].balance) < Number(amount)) return res.status(400).json({message:"Balance ntihagije: "+ (w.rows[0]?.balance||0)});
  await pool.query(`UPDATE wallets SET balance = balance - $1 WHERE customer_id=$2`,[amount,customerId]);
  const r=await pool.query(`INSERT INTO airtime_purchases (customer_id,phone,amount,operator) VALUES ($1,$2,$3,$4) RETURNING *`,[customerId,phone,amount,operator||"Lumitel"]);
  const newW=await pool.query(`SELECT * FROM wallets WHERE customer_id=$1`,[customerId]);
  res.json({message:`Unités ${amount} BIF kuri ${phone}`,purchase:r.rows[0],wallet:newW.rows[0]});
});
app.get("/api/airtime/:customerId", async (req,res)=>{ const r=await pool.query(`SELECT * FROM airtime_purchases WHERE customer_id=$1 ORDER BY id DESC LIMIT 50`,[req.params.customerId]); res.json({purchases:r.rows}); });

app.listen(process.env.PORT||3000, ()=>console.log(`🚀 http://localhost:${process.env.PORT||3000}`));