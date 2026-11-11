app.post('/api/withdraw', async (req,res)=>{
  const {phone,amount,channel,password,role}=req.body; const rle=role||'client';
  if(amount>100000) return res.status(400).json({message:'Max 100,000 / jour!'});
  // 🔒 AGENT + SUPER AGENT: Withdraw gusa 1-5 buri kwezi, Commission y'ukwezi guheze
  if(rle==='agent' || rle==='super_agent'){
    const today=new Date(); const day=today.getDate();
    if(day<1 || day>5){
      return res.status(400).json({message:'⏳ Withdraw ya Commission ifungurwa gusa ku wa 1 - 5 buri kwezi! Ubu turi ku wa '+day+'. Tegereza ukwezi gutaha. Commission yawe irabikwa.'});
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
