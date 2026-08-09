require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const fs = require("fs");
const QRCode = require("qrcode");
const path = require("path");

async function main(){
const SQL = await initSqlJs();
const app = express();

class DB {
  constructor(file){
    this.file=file;
    this.raw=fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  }
  save(){ fs.writeFileSync(this.file, Buffer.from(this.raw.export())); }
  pragma(){ return; }
  exec(sql){ this.raw.exec(sql); this.save(); }
  prepare(sql){
    const self=this;
    return {
      get(...args){
        const st=self.raw.prepare(sql);
        st.bind(args);
        const row=st.step()?st.getAsObject():undefined;
        st.free();
        return row;
      },
      all(...args){
        const st=self.raw.prepare(sql), out=[];
        st.bind(args);
        while(st.step()) out.push(st.getAsObject());
        st.free();
        return out;
      },
      run(...args){
        const st=self.raw.prepare(sql);
        st.bind(args);
        while(st.step()){}
        st.free();
        const r=self.raw.exec("SELECT last_insert_rowid() AS id");
        self.save();
        return {lastInsertRowid:r[0]?.values?.[0]?.[0]||0};
      }
    };
  }
  transaction(fn){
    const self=this;
    return function(){
      self.raw.exec("BEGIN");
      try { const r=fn(); self.raw.exec("COMMIT"); self.save(); return r; }
      catch(e){ self.raw.exec("ROLLBACK"); throw e; }
    };
  }
}

const db = new DB("socialhub.db");
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:1000*60*60*8}
}));
app.use(express.static(path.join(__dirname,"public")));

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 balance INTEGER NOT NULL DEFAULT 0,
 role TEXT NOT NULL DEFAULT 'user',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS services(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 category TEXT NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 price INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deposits(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 amount INTEGER NOT NULL,
 transfer_code TEXT UNIQUE NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 service_id INTEGER NOT NULL,
 price INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(service_id) REFERENCES services(id)
);
CREATE TABLE IF NOT EXISTS transactions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 type TEXT NOT NULL,
 amount INTEGER NOT NULL,
 note TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

function seed(){
  const count = db.prepare("SELECT COUNT(*) c FROM services").get().c;
  if(count===0){
    const ins=db.prepare("INSERT INTO services(category,name,description,price) VALUES(?,?,?,?)");
    [
      ["TikTok","TikTok Premium","Phân tích hồ sơ, nội dung và đề xuất cải thiện.",199000],
      ["TikTok","Quản lý nội dung TikTok","Lập lịch và hỗ trợ nội dung theo gói.",299000],
      ["Facebook","Quản lý Fanpage","Hỗ trợ nội dung và chăm sóc trang.",499000],
      ["Facebook","Thiết kế social post","Thiết kế bài đăng theo nhận diện thương hiệu.",149000],
      ["Zalo","Tối ưu Zalo OA","Tối ưu hồ sơ và nội dung Zalo Official Account.",249000],
      ["Zalo","Thiết kế nội dung Zalo","Thiết kế nội dung quảng bá theo yêu cầu.",179000]
    ].forEach(x=>ins.run(...x));
  }
  const adminEmail=process.env.ADMIN_EMAIL;
  const adminPassword=process.env.ADMIN_PASSWORD;
  if(adminEmail && adminPassword){
    const existing=db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail);
    if(!existing){
      db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')")
        .run("Administrator",adminEmail,bcrypt.hashSync(adminPassword,12));
    }
  }
}
seed();

function auth(req,res,next){ if(!req.session.userId) return res.status(401).json({error:"Bạn cần đăng nhập."}); next(); }
function admin(req,res,next){
  const u=req.session.userId && db.prepare("SELECT id,role FROM users WHERE id=?").get(req.session.userId);
  if(!u || u.role!=="admin") return res.status(403).json({error:"Không có quyền."});
  next();
}
function publicUser(id){ return db.prepare("SELECT id,name,email,balance,role,created_at FROM users WHERE id=?").get(id); }
function okAmount(n){ return Number.isInteger(n) && n>=10000 && n<=100000000; }

app.get("/api/config",(req,res)=>{
  res.json({bankConfigured:!!(process.env.BANK_ID && process.env.ACCOUNT_NO), accountName:process.env.ACCOUNT_NAME||"SOCIALHUB"});
});
app.get("/api/me",(req,res)=>res.json({user:req.session.userId?publicUser(req.session.userId):null}));

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body;
  if(!name || !email || !password || password.length<8) return res.status(400).json({error:"Tên, email và mật khẩu (tối thiểu 8 ký tự) là bắt buộc."});
  try{
    const hash=bcrypt.hashSync(password,12);
    const r=db.prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)").run(name.trim(),email.trim().toLowerCase(),hash);
    req.session.userId=Number(r.lastInsertRowid);
    res.json({user:publicUser(req.session.userId)});
  }catch(e){res.status(400).json({error:"Email đã được sử dụng."});}
});
app.post("/api/login",(req,res)=>{
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(req.body.email||"").trim().toLowerCase());
  if(!u || !bcrypt.compareSync(req.body.password||"",u.password)) return res.status(401).json({error:"Email hoặc mật khẩu không đúng."});
  req.session.userId=u.id; res.json({user:publicUser(u.id)});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/services",(req,res)=>{
  res.json(db.prepare("SELECT id,category,name,description,price FROM services WHERE active=1 ORDER BY id DESC").all());
});

app.post("/api/deposits",auth,(req,res)=>{
  const amount=Number(req.body.amount);
  if(!okAmount(amount)) return res.status(400).json({error:"Số tiền nạp không hợp lệ."});
  const code="SH"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
  db.prepare("INSERT INTO deposits(user_id,amount,transfer_code) VALUES(?,?,?)").run(req.session.userId,amount,code);
  res.json({ok:true,amount,transferCode:code});
});
app.get("/api/deposits",auth,(req,res)=>{
  res.json(db.prepare("SELECT id,amount,transfer_code transferCode,status,created_at createdAt FROM deposits WHERE user_id=? ORDER BY id DESC").all(req.session.userId));
});

app.get("/api/orders",auth,(req,res)=>{
  res.json(db.prepare(`SELECT o.id,o.price,o.status,o.created_at createdAt,s.name service
    FROM orders o JOIN services s ON s.id=o.service_id WHERE o.user_id=? ORDER BY o.id DESC`).all(req.session.userId));
});
app.post("/api/orders",auth,(req,res)=>{
  const service=db.prepare("SELECT * FROM services WHERE id=? AND active=1").get(Number(req.body.serviceId));
  if(!service) return res.status(404).json({error:"Dịch vụ không tồn tại."});
  const tx=db.transaction(()=>{
    const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.session.userId);
    if(u.balance<service.price) throw new Error("INSUFFICIENT");
    db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(service.price,req.session.userId);
    const r=db.prepare("INSERT INTO orders(user_id,service_id,price) VALUES(?,?,?)").run(req.session.userId,service.id,service.price);
    db.prepare("INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)")
      .run(req.session.userId,"purchase",-service.price,"Mua "+service.name);
    return r.lastInsertRowid;
  });
  try{ const id=tx(); res.json({ok:true,orderId:id,user:publicUser(req.session.userId)}); }
  catch(e){ if(e.message==="INSUFFICIENT") return res.status(400).json({error:"Số dư không đủ."}); throw e; }
});

app.get("/api/transactions",auth,(req,res)=>{
  res.json(db.prepare("SELECT id,type,amount,note,created_at createdAt FROM transactions WHERE user_id=? ORDER BY id DESC").all(req.session.userId));
});

app.get("/api/admin/summary",admin,(req,res)=>{
  res.json({
    users:db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
    pendingDeposits:db.prepare("SELECT COUNT(*) c FROM deposits WHERE status='pending'").get().c,
    pendingOrders:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='pending'").get().c,
    revenue:db.prepare("SELECT COALESCE(SUM(price),0) n FROM orders WHERE status!='cancelled'").get().n
  });
});
app.get("/api/admin/deposits",admin,(req,res)=>{
  res.json(db.prepare(`SELECT d.id,d.amount,d.transfer_code transferCode,d.status,d.created_at createdAt,
    u.name,u.email FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC`).all());
});
app.post("/api/admin/deposits/:id/approve",admin,(req,res)=>{
  const d=db.prepare("SELECT * FROM deposits WHERE id=?").get(Number(req.params.id));
  if(!d || d.status!=="pending") return res.status(400).json({error:"Giao dịch không hợp lệ."});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE deposits SET status='approved' WHERE id=?").run(d.id);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(d.amount,d.user_id);
    db.prepare("INSERT INTO transactions(user_id,type,amount,note) VALUES(?,?,?,?)")
      .run(d.user_id,"deposit",d.amount,"Nạp tiền • "+d.transfer_code);
  });
  tx(); res.json({ok:true});
});
app.post("/api/admin/deposits/:id/reject",admin,(req,res)=>{
  db.prepare("UPDATE deposits SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
  res.json({ok:true});
});
app.get("/api/admin/orders",admin,(req,res)=>{
  res.json(db.prepare(`SELECT o.id,o.price,o.status,o.created_at createdAt,u.name,u.email,s.name service
    FROM orders o JOIN users u ON u.id=o.user_id JOIN services s ON s.id=o.service_id ORDER BY o.id DESC`).all());
});
app.post("/api/admin/orders/:id/status",admin,(req,res)=>{
  const allowed=["pending","processing","completed","cancelled"];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Trạng thái không hợp lệ."});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,Number(req.params.id));
  res.json({ok:true});
});
app.get("/api/admin/users",admin,(req,res)=>{
  res.json(db.prepare("SELECT id,name,email,balance,role,created_at createdAt FROM users ORDER BY id DESC").all());
});
app.post("/api/admin/services",admin,(req,res)=>{
  const {category,name,description,price}=req.body;
  if(!category||!name||!description||!okAmount(Number(price))) return res.status(400).json({error:"Thông tin dịch vụ không hợp lệ."});
  const r=db.prepare("INSERT INTO services(category,name,description,price) VALUES(?,?,?,?)").run(category,name,description,Number(price));
  res.json({id:r.lastInsertRowid});
});

app.get("/api/qr/:amount/:code",auth,async(req,res)=>{
  const amount=Number(req.params.amount);
  const code=String(req.params.code||"");
  if(!okAmount(amount) || !/^SH[A-Z0-9]+$/.test(code)) return res.status(400).json({error:"Thông tin QR không hợp lệ."});
  const deposit=db.prepare("SELECT id,amount,transfer_code FROM deposits WHERE user_id=? AND transfer_code=?").get(req.session.userId,code);
  if(!deposit || deposit.amount!==amount) return res.status(404).json({error:"Không tìm thấy yêu cầu nạp."});
  const bank=process.env.BANK_ID, acc=process.env.ACCOUNT_NO, name=process.env.ACCOUNT_NAME||"SOCIALHUB";
  if(!bank||!acc) return res.status(503).json({error:"Chưa cấu hình ngân hàng trong .env."});
  const qrData=`https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(acc)}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(name)}`;
  res.json({qrUrl:qrData,transferCode:code,accountName:name,accountNo:acc,bank});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`SocialHub running at http://localhost:${PORT}`));
}
main().catch(e=>{ console.error(e); process.exit(1); });
