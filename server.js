const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

function safeNum(v){ const n = Number(v||0); return isNaN(n)?0:n; }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function genCode(){ return 'SM' + Math.floor(100000 + Math.random()*900000); }

let clients = [];
let agents = [];
let superAgents = [];
let transactions = [];
let withdrawals = [];
let failedLogins = {};

let adminUser = {
  phone: '+25767899429',
  password: '7777',
  full_name: 'Admin',
  commission: 0,
  role: 'admin',
  status: 'approved'
};

function findByPhone(phone){
  if(phone===adminUser.phone) return adminUser;
  return clients.find(x=>x.phone===phone) || agents.find(x=>x.phone===phone) || superAgents.find(x=>x.phone===phone);
}
function getTodayWithdrawTotal(phone){
  return withdrawals.filter(w=>w.phone===phone && w.date===todayStr() && w.status!=='rejected').reduce((s,w)=>s+safeNum(w.amount),0);
}
function getTodaySendTotal(phone){
  return transactions.filter(t=>t.sender_phone===phone && t.date===todayStr()).reduce((s,t)=>s+safeNum(t.amount),0);
}

app.post('/api/register', (req,res)=>{
  const {izina, amatazirano, phone, password, country, channel, referral_code} = req.body;
  if(!izina || !amatazirano || !phone || !password) return res.json({success:false, message:'Uzuza vyose!'});
  if(findByPhone(phone)) return res.json({success:false, message:'Uyo numero yamaze kwiyandikisha!'});
  const user = {full_name: izina+' '+amatazirano, izina, amatazirano, phone, password, country: country||'Burundi', channel: channel||'Lumicash', balance:0, bonus:10000, airtime_count:0, referral_code: referral_code||'', status:'pending', role:'client', created: todayStr()};
  clients.push(user);
  if(referral_code){
    const inviter = findByPhone(referral_code);
    if(inviter && inviter.role==='client') inviter.balance = safeNum(inviter.balance)+200;
  }
  res.json({success:true, message:'Wiyandikishije! Tegereza Admin akwemere.'});
});

app.post('/api/agents', (req,res)=>{
  const {izina, amatazirano, phone, password, province} = req.body;
  if(!izina || !amatazirano || !phone || !password) return res.json({success:false, message:'Uzuza vyose!'});
  if(findByPhone(phone)) return res.json({success:false, message:'Uyo numero yamaze kwiyandikisha!'});
  agents.push({full_name: izina+' '+amatazirano, izina, amatazirano, phone, password, province: province||'Bujumbura', commission:0, status:'pending', role:'agent', created: todayStr()});
  res.json({success:true, message:'Agent yiyandikishije! Tegereza Admin.'});
});

app.post('/api/admin/create-super', (req,res)=>{
  const {izina, amatazirano, phone, password} = req.body;
  if(findByPhone(phone)) return res.json({success:false, message:'Yamaze kubaho!'});
  superAgents.push({full_name: izina+' '+amatazirano, izina, amatazirano, phone, password, commission:0, status:'approved', role:'super_agent', created: todayStr()});
  res.json({success:true, message:'Super Agent yaremwe!'});
});

app.post('/api/login', (req,res)=>{
  const {phone, password, role} = req.body;
  const f = failedLogins[phone] || {count:0, until:0};
  if(Date.now() < f.until) return res.json({success:false, message:'Warafunzwe. Gerageza hanyuma.'});
  let user = null;
  if(role==='client') user = clients.find(x=>x.phone===phone);
  if(role==='agent') user = agents.find(x=>x.phone===phone);
  if(role==='super_agent') user = superAgents.find(x=>x.phone===phone);
  if(!user) return res.json({success:false, message:'Ntawe aboneka!'});
  if(user.password !== password){
    f.count++; if(f.count>=4){ f.until = Date.now()+24*60*60*1000; f.count=0; }
    failedLogins[phone]=f;
    return res.json({success:false, message:'Password si yo!'});
  }
  if(user.status!=='approved') return res.json({success:false, message:'Tegereza Admin akwemere!'});
  failedLogins[phone]={count:0, until:0};
  res.json({success:true, message:'Murakaza neza!', user});
});

app.post('/api/admin/login', (req,res)=>{
  const {phone, password, code2fa} = req.body;
  const f = failedLogins['ADMIN_'+phone] || {count:0, until:0};
  if(Date.now() < f.until) return res.json({success:false, message:'Admin yafunzwe iminota 30.'});
  if(phone!==adminUser.phone || password!==adminUser.password){
    f.count++; if(f.count>=4){ f.until = Date.now()+30*60*1000; f.count=0; }
    failedLogins['ADMIN_'+phone]=f;
    return res.json({success:false, message:'Admin login si yo!'});
  }
  if(code2fa!=='123456') return res.json({success:false, message:'Code 2FA si yo!'});
  failedLogins['ADMIN_'+phone]={count:0, until:0};
  res.json({success:true, message:'Murakaza neza Admin!', user: adminUser});
});

app.post('/api/send', (req,res)=>{
  const {sender_phone, receiver_phone, amount, password} = req.body;
  const amt = safeNum(amount);
  const sender = clients.find(x=>x.phone===sender_phone);
  if(!sender) return res.json({message:'Sender ntaboneka!'});
  if(sender.password!==password) return res.json({message:'PIN si yo!'});
  if(amt<=0) return res.json({message:'Andika Amafaranga!'});
  if(amt>200000) return res.json({message:'Max rimwe ni 200,000!'});
  if(getTodaySendTotal(sender_phone)+amt>500000) return res.json({message:'Warengeje 500,000 ku musi!'});
  const fee = Math.round(amt*0.02);
  const total = amt+fee;
  if(safeNum(sender.balance) < total) return res.json({message:'Balance ntihagije! Ukeneye '+total.toLocaleString()});
  let receiver = clients.find(x=>x.phone===receiver_phone);
  if(!receiver) return res.json({message:'Uwo urungikira ntiyiyandikishije! Amaze kwiyandikisha ubanza.'});
  sender.balance = safeNum(sender.balance)-total;
  receiver.balance = safeNum(receiver.balance)+amt;
  const agentComm = Math.round(fee*0.60);
  const superComm = Math.round(fee*0.20);
  const adminComm = fee - agentComm - superComm;
  if(agents.length>0) agents[0].commission = safeNum(agents[0].commission)+agentComm;
  if(superAgents.length>0) superAgents[0].commission = safeNum(superAgents[0].commission)+superComm;
  adminUser.commission = safeNum(adminUser.commission)+adminComm;
  transactions.push({code: genCode(), sender_phone, receiver_phone, amount: amt, fee, agent_comm: agentComm, super_comm: superComm, admin_comm: adminComm, status:'done', date: todayStr()});
  res.json({message:'Wurungitse '+amt.toLocaleString()+' BIF! Fee '+fee+' BIF'});
});

app.post('/api/airtime', (req,res)=>{
  const {phone, airtime_phone, amount, password} = req.body;
  const amt = safeNum(amount);
  const user = clients.find(x=>x.phone===phone);
  if(!user) return res.json({message:'Ntaboneka!'});
  if(user.password!==password) return res.json({message:'PIN si yo!'});
  if(safeNum(user.balance) < amt) return res.json({message:'Balance ntihagije!'});
  user.balance = safeNum(user.balance)-amt;
  user.airtime_count = safeNum(user.airtime_count)+1;
  if(user.airtime_count>=2 && safeNum(user.bonus)>0){
    user.balance = safeNum(user.balance)+safeNum(user.bonus);
    user.bonus = 0;
  }
  transactions.push({code: genCode(), sender_phone: phone, receiver_phone: airtime_phone||phone, amount: amt, fee:0, status:'airtime', date: todayStr()});
  res.json({message:'Waguze Airtime '+amt.toLocaleString()+'!'});
});

app.post('/api/withdraw', (req,res)=>{
  const {phone, amount, channel, destination_phone, password, role} = req.body;
  const amt = safeNum(amount);
  if(!channel) return res.json({message:'Hitamo umuhora!'});
  if(!destination_phone) return res.json({message:'Andika numero ushaka kurotirirako!'});
  if(amt<5000) return res.json({message:'Min ni 5,000 BIF!'});
  // ADMIN - LIMITE KU NCURO, ATARI KU MUSI
  if(role==='admin'){
    if(amt>100000) return res.json({message:'Max ku ncuro imwe ni 100,000 BIF! Kora incuro 2 niba ushaka 200,000.'});
    if(adminUser.password!==password) return res.json({message:'PIN si yo!'});
    if(safeNum(adminUser.commission) < amt) return res.json({message:'Commission ntihagije!'});
    adminUser.commission = safeNum(adminUser.commission)-amt;
    withdrawals.push({id: Date.now().toString(), phone, role, amount: amt, channel, destination_phone, status:'done', date: todayStr()});
    return res.json({message:'Admin Withdraw yakozwe: '+amt.toLocaleString()+' BIF -> '+destination_phone});
  }
  // CLIENT / AGENT / SUPER AGENT - LIMITE KU MUSI
  if(amt>100000) return res.json({message:'Max ku musi ni 100,000 BIF!'});
  if(getTodayWithdrawTotal(phone)+amt>100000) return res.json({message:'Warengeje 100,000 ku musi!'});
  if(role==='agent' || role==='super_agent'){
    const d = new Date().getDate();
    if(d<1 || d>5) return res.json({message:'Withdraw ya Commission ifungurwa gusa ku wa 1-5 buri kwezi!'});
  }
  let user = null;
  if(role==='client') user = clients.find(x=>x.phone===phone);
  if(role==='agent') user = agents.find(x=>x.phone===phone);
  if(role==='super_agent') user = superAgents.find(x=>x.phone===phone);
  if(!user) return res.json({message:'Ntaboneka!'});
  if(user.password!==password) return res.json({message:'PIN si yo!'});
  if(role==='client'){
    if(safeNum(user.balance) < amt) return res.json({message:'Balance ntihagije!'});
    user.balance = safeNum(user.balance)-amt;
  } else {
    if(safeNum(user.commission) < amt) return res.json({message:'Commission ntihagije!'});
    user.commission = safeNum(user.commission)-amt;
  }
  withdrawals.push({id: Date.now().toString(), phone, role, amount: amt, channel, destination_phone, status:'done', date: todayStr()});
  res.json({message:'Withdraw yakozwe: '+amt.toLocaleString()+' BIF -> '+destination_phone});
});

app.post('/api/reset-request', (req,res)=>{ res.json({message:'Ibibazo vyakiriwe! Tegereza Admin.'}); });

app.get('/api/admin/clients', (req,res)=> res.json(clients));
app.get('/api/admin/agents', (req,res)=> res.json(agents));
app.get('/api/admin/super-agents', (req,res)=> res.json(superAgents));
app.get('/api/admin/pending', (req,res)=> res.json([...clients.filter(x=>x.status==='pending'), ...agents.filter(x=>x.status==='pending')]));
app.get('/api/admin/operations', (req,res)=> res.json(transactions));
app.get('/api/admin/withdrawals', (req,res)=> res.json(withdrawals));
app.get('/api/admin/commissions', (req,res)=> res.json({agent_total: agents.reduce((s,x)=>s+safeNum(x.commission),0), super_total: superAgents.reduce((s,x)=>s+safeNum(x.commission),0), admin_total: safeNum(adminUser.commission)}));
app.get('/api/admin/stats', (req,res)=> res.json({admin_commission: safeNum(adminUser.commission), clients: clients.length, agents: agents.length, transactions: transactions.length}));
app.get('/api/client/transactions', (req,res)=>{ const p=req.query.phone; res.json(transactions.filter(t=>t.sender_phone===p || t.receiver_phone===p)); });
app.get('/api/agent/transactions', (req,res)=> res.json(transactions));
app.get('/api/super/transactions', (req,res)=> res.json(transactions));
app.get('/api/super/agents', (req,res)=> res.json(agents));
app.get('/api/withdrawals', (req,res)=>{ const p=req.query.phone; res.json(withdrawals.filter(w=>w.phone===p)); });

app.post('/api/admin/approve', (req,res)=>{
  const {phone, role} = req.body;
  let u = null;
  if(role==='client') u = clients.find(x=>x.phone===phone);
  if(role==='agent') u = agents.find(x=>x.phone===phone);
  if(u) u.status='approved';
  res.json({message:'Yemewe!'});
});
app.post('/api/admin/withdraw-approve', (req,res)=> res.json({message:'Withdraw yemewe!'}));
app.post('/api/admin/withdraw-reject', (req,res)=> res.json({message:'Withdraw yansewe!'}));

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('SendMoney kuri '+PORT));
