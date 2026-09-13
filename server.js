require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const QRCode = require('qrcode');
const { db, initDb } = require('./db/database');

initDb();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use(['/login','/register','/admin/login'], authLimiter);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,10)}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = ['image/jpeg','image/png','image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG or WEBP images are allowed.'), ok);
  }
});

function settingsMap() {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key,r.value]));
}
function currency(value) {
  const s = settingsMap();
  return `${s.currency || 'PKR'} ${Number(value).toLocaleString('en-PK')}`;
}
function setFlash(req, type, message) { req.session.flash = { type, message }; }
function requireAuth(req,res,next){ if(!req.session.user) return res.redirect('/login?next='+encodeURIComponent(req.originalUrl)); next(); }
function requireAdmin(req,res,next){ if(!req.session.user || req.session.user.role!=='admin') return res.redirect('/admin/login'); next(); }
function requireClient(req,res,next){ if(!req.session.user) return res.redirect('/login'); if(req.session.user.role==='admin') return res.redirect('/admin'); next(); }
function orderNo(){ return `SN-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2,5).toUpperCase()}`; }

app.use((req,res,next)=>{
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.settings = settingsMap();
  res.locals.currency = currency;
  res.locals.currentPath = req.path;
  next();
});

app.get('/', (req,res)=>{
  const plans = db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY featured DESC, id DESC LIMIT 6').all();
  const countries = db.prepare('SELECT country, COUNT(*) c FROM plans WHERE active=1 GROUP BY country ORDER BY c DESC, country LIMIT 8').all();
  res.render('shop/home',{plans,countries,title:'SimNova — Travel eSIMs'});
});
app.get('/plans',(req,res)=>{
  const q=(req.query.q||'').trim();
  const region=(req.query.region||'').trim();
  let sql='SELECT * FROM plans WHERE active=1'; const params=[];
  if(q){ sql+=' AND (title LIKE ? OR country LIKE ? OR coverage LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if(region){ sql+=' AND region=?'; params.push(region); }
  sql+=' ORDER BY featured DESC,id DESC';
  const plans=db.prepare(sql).all(...params);
  const regions=db.prepare("SELECT DISTINCT region FROM plans WHERE active=1 AND region IS NOT NULL ORDER BY region").all();
  res.render('shop/plans',{plans,regions,q,region,title:'eSIM Plans'});
});
app.get('/plans/:id',(req,res)=>{
  const plan=db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(req.params.id);
  if(!plan) return res.status(404).render('shop/message',{title:'Plan not found',message:'This eSIM plan is not available.'});
  res.render('shop/plan',{plan,title:plan.title});
});

app.get('/register',(req,res)=>res.render('auth/register',{title:'Create account',next:req.query.next||''}));
app.post('/register',(req,res)=>{
  const {name,email,phone,password,next}=req.body;
  if(!name||!email||!password||password.length<8){ setFlash(req,'error','Enter your name, email and a password of at least 8 characters.'); return res.redirect('/register'); }
  try{
    const hash=bcrypt.hashSync(password,12);
    const info=db.prepare("INSERT INTO users(name,email,phone,password_hash,role) VALUES (?,?,?,?, 'client')").run(name.trim(),email.trim().toLowerCase(),phone?.trim()||'',hash);
    req.session.user={id:info.lastInsertRowid,name:name.trim(),email:email.trim().toLowerCase(),role:'client'};
    setFlash(req,'success','Welcome to SimNova. Your account is ready.');
    res.redirect(next && next.startsWith('/') ? next : '/account');
  }catch(e){ setFlash(req,'error',e.code==='SQLITE_CONSTRAINT_UNIQUE'?'An account with this email already exists.':'Could not create account.'); res.redirect('/register'); }
});
app.get('/login',(req,res)=>res.render('auth/login',{title:'Sign in',next:req.query.next||''}));
app.post('/login',(req,res)=>{
  const email=(req.body.email||'').trim().toLowerCase();
  const user=db.prepare("SELECT * FROM users WHERE email=? AND role='client'").get(email);
  if(!user||user.status!=='active'||!bcrypt.compareSync(req.body.password||'',user.password_hash)){ setFlash(req,'error','Incorrect email or password.'); return res.redirect('/login'); }
  req.session.user={id:user.id,name:user.name,email:user.email,role:user.role};
  res.redirect(req.body.next && req.body.next.startsWith('/') ? req.body.next : '/account');
});
app.post('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.get('/checkout/:planId',requireClient,(req,res)=>{
  const plan=db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(req.params.planId);
  if(!plan) return res.redirect('/plans');
  const methods=db.prepare('SELECT * FROM payment_methods WHERE active=1 ORDER BY sort_order,id').all();
  res.render('shop/checkout',{plan,methods,title:'Checkout'});
});
app.post('/checkout/:planId',requireClient,(req,res)=>{
  const plan=db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(req.params.planId);
  const pm=db.prepare('SELECT * FROM payment_methods WHERE id=? AND active=1').get(req.body.payment_method_id);
  if(!plan||!pm){ setFlash(req,'error','Please select a valid plan and payment method.'); return res.redirect('/plans'); }
  const no=orderNo();
  db.prepare(`INSERT INTO orders(order_no,user_id,plan_id,payment_method_id,amount,currency,status) VALUES (?,?,?,?,?,?, 'pending_payment')`)
    .run(no,req.session.user.id,plan.id,pm.id,plan.price,settingsMap().currency||'PKR');
  res.redirect(`/account/orders/${no}/payment`);
});

app.get('/account',requireClient,(req,res)=>{
  const stats={
    orders:db.prepare('SELECT COUNT(*) c FROM orders WHERE user_id=?').get(req.session.user.id).c,
    active:db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status IN ('paid','processing','delivered')").get(req.session.user.id).c,
    delivered:db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='delivered'").get(req.session.user.id).c
  };
  const orders=db.prepare(`SELECT o.*,p.title,p.country FROM orders o JOIN plans p ON p.id=o.plan_id WHERE o.user_id=? ORDER BY o.id DESC LIMIT 5`).all(req.session.user.id);
  res.render('account/dashboard',{stats,orders,title:'My account'});
});
app.get('/account/orders',requireClient,(req,res)=>{
  const orders=db.prepare(`SELECT o.*,p.title,p.country FROM orders o JOIN plans p ON p.id=o.plan_id WHERE o.user_id=? ORDER BY o.id DESC`).all(req.session.user.id);
  res.render('account/orders',{orders,title:'My orders'});
});
app.get('/account/orders/:orderNo',requireClient,(req,res)=>{
  const order=db.prepare(`SELECT o.*,p.title,p.country,p.data_amount,p.validity_days,pm.name payment_method_name,pm.account_title,pm.account_number,pm.instructions FROM orders o JOIN plans p ON p.id=o.plan_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.order_no=? AND o.user_id=?`).get(req.params.orderNo,req.session.user.id);
  if(!order) return res.status(404).render('shop/message',{title:'Order not found',message:'We could not find this order.'});
  res.render('account/order',{order,title:`Order ${order.order_no}`});
});
app.get('/account/orders/:orderNo/payment',requireClient,(req,res)=>{
  const order=db.prepare(`SELECT o.*,p.title,p.country,p.data_amount,p.validity_days,pm.name payment_method_name,pm.account_title,pm.account_number,pm.instructions FROM orders o JOIN plans p ON p.id=o.plan_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.order_no=? AND o.user_id=?`).get(req.params.orderNo,req.session.user.id);
  if(!order) return res.redirect('/account/orders');
  res.render('account/payment',{order,title:'Submit payment'});
});
app.post('/account/orders/:orderNo/payment',requireClient,upload.single('payment_screenshot'),(req,res)=>{
  const order=db.prepare('SELECT * FROM orders WHERE order_no=? AND user_id=?').get(req.params.orderNo,req.session.user.id);
  if(!order) return res.redirect('/account/orders');
  if(!req.file){ setFlash(req,'error','Please upload a payment screenshot.'); return res.redirect(`/account/orders/${req.params.orderNo}/payment`); }
  db.prepare(`UPDATE orders SET payment_reference=?,payment_screenshot=?,status='payment_submitted',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run((req.body.payment_reference||'').trim(),req.file.filename,order.id);
  setFlash(req,'success','Payment proof submitted. We will verify it from the admin panel.');
  res.redirect(`/account/orders/${req.params.orderNo}`);
});
app.get('/account/profile',requireClient,(req,res)=>{
  const profile=db.prepare('SELECT id,name,email,phone,created_at FROM users WHERE id=?').get(req.session.user.id);
  res.render('account/profile',{profile,title:'Profile'});
});
app.post('/account/profile',requireClient,(req,res)=>{
  db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run((req.body.name||'').trim(),(req.body.phone||'').trim(),req.session.user.id);
  req.session.user.name=(req.body.name||'').trim(); setFlash(req,'success','Profile updated.'); res.redirect('/account/profile');
});

app.get('/admin/login',(req,res)=>res.render('auth/admin-login',{title:'Admin sign in'}));
app.post('/admin/login',(req,res)=>{
  const emailOrName=(req.body.username||'').trim();
  const user=db.prepare("SELECT * FROM users WHERE role='admin' AND (email=? OR name=?) LIMIT 1").get(emailOrName.toLowerCase(),emailOrName);
  if(!user||!bcrypt.compareSync(req.body.password||'',user.password_hash)){ setFlash(req,'error','Invalid admin credentials.'); return res.redirect('/admin/login'); }
  req.session.user={id:user.id,name:user.name,email:user.email,role:'admin'}; res.redirect('/admin');
});
app.post('/admin/logout',(req,res)=>req.session.destroy(()=>res.redirect('/admin/login')));

app.get('/admin',requireAdmin,(req,res)=>{
  const stats={
    orders:db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    pending:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='payment_submitted'").get().c,
    customers:db.prepare("SELECT COUNT(*) c FROM users WHERE role='client'").get().c,
    revenue:db.prepare("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status IN ('paid','processing','delivered')").get().s
  };
  const orders=db.prepare(`SELECT o.*,u.name customer,p.title FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id ORDER BY o.id DESC LIMIT 8`).all();
  res.render('admin/dashboard',{stats,orders,title:'Admin dashboard'});
});
app.get('/admin/orders',requireAdmin,(req,res)=>{
  const status=(req.query.status||'').trim();
  let sql=`SELECT o.*,u.name customer,u.email,p.title FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id`;
  const params=[]; if(status){sql+=' WHERE o.status=?';params.push(status);} sql+=' ORDER BY o.id DESC';
  res.render('admin/orders',{orders:db.prepare(sql).all(...params),status,title:'Orders'});
});
app.get('/admin/orders/:id',requireAdmin,(req,res)=>{
  const order=db.prepare(`SELECT o.*,u.name customer,u.email,u.phone,p.title,p.country,p.data_amount,p.validity_days,pm.name payment_method_name FROM orders o JOIN users u ON u.id=o.user_id JOIN plans p ON p.id=o.plan_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.id=?`).get(req.params.id);
  if(!order) return res.redirect('/admin/orders');
  res.render('admin/order',{order,title:`Manage ${order.order_no}`});
});
app.post('/admin/orders/:id/status',requireAdmin,(req,res)=>{
  const allowed=['pending_payment','payment_submitted','paid','processing','delivered','rejected','cancelled'];
  if(!allowed.includes(req.body.status)) return res.redirect(`/admin/orders/${req.params.id}`);
  db.prepare('UPDATE orders SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status,(req.body.admin_note||'').trim(),req.params.id);
  setFlash(req,'success','Order status updated.'); res.redirect(`/admin/orders/${req.params.id}`);
});
app.post('/admin/orders/:id/esim',requireAdmin,async(req,res)=>{
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id); if(!order) return res.redirect('/admin/orders');
  const smdp=(req.body.esim_smdp||'').trim(); const code=(req.body.esim_activation_code||'').trim(); const iccid=(req.body.esim_iccid||'').trim();
  const qrText=(req.body.esim_qr_text||'').trim() || (smdp&&code ? `LPA:1$${smdp}$${code}` : '');
  if(!qrText){ setFlash(req,'error','Enter QR/LPA text or SM-DP+ address and activation code.'); return res.redirect(`/admin/orders/${req.params.id}`); }
  const file=`esim-${order.order_no}.png`; await QRCode.toFile(path.join(uploadsDir,file),qrText,{width:500,margin:2});
  db.prepare(`UPDATE orders SET esim_qr_text=?,esim_qr_image=?,esim_iccid=?,esim_smdp=?,esim_activation_code=?,status='delivered',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(qrText,file,iccid,smdp,code,order.id);
  setFlash(req,'success','eSIM activation details generated and delivered to the client account.'); res.redirect(`/admin/orders/${order.id}`);
});

app.get('/admin/plans',requireAdmin,(req,res)=>res.render('admin/plans',{plans:db.prepare('SELECT * FROM plans ORDER BY id DESC').all(),title:'Plans'}));
app.get('/admin/plans/new',requireAdmin,(req,res)=>res.render('admin/plan-form',{plan:null,title:'Add plan'}));
app.get('/admin/plans/:id/edit',requireAdmin,(req,res)=>res.render('admin/plan-form',{plan:db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id),title:'Edit plan'}));
function savePlanBody(b){ return [b.title,b.country,b.region||'',b.data_amount,Number(b.validity_days),Number(b.price),b.old_price?Number(b.old_price):null,b.network||'',b.speed||'4G/5G',b.coverage||'',b.description||'',b.featured?1:0,b.active?1:0]; }
app.post('/admin/plans',requireAdmin,(req,res)=>{ db.prepare(`INSERT INTO plans(title,country,region,data_amount,validity_days,price,old_price,network,speed,coverage,description,featured,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...savePlanBody(req.body)); setFlash(req,'success','Plan added.'); res.redirect('/admin/plans'); });
app.post('/admin/plans/:id',requireAdmin,(req,res)=>{ db.prepare(`UPDATE plans SET title=?,country=?,region=?,data_amount=?,validity_days=?,price=?,old_price=?,network=?,speed=?,coverage=?,description=?,featured=?,active=? WHERE id=?`).run(...savePlanBody(req.body),req.params.id); setFlash(req,'success','Plan updated.'); res.redirect('/admin/plans'); });
app.post('/admin/plans/:id/delete',requireAdmin,(req,res)=>{ try{db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);setFlash(req,'success','Plan deleted.');}catch{db.prepare('UPDATE plans SET active=0 WHERE id=?').run(req.params.id);setFlash(req,'success','Plan archived because it is linked to an order.');} res.redirect('/admin/plans'); });

app.get('/admin/payments',requireAdmin,(req,res)=>res.render('admin/payments',{methods:db.prepare('SELECT * FROM payment_methods ORDER BY sort_order,id').all(),title:'Payment methods'}));
app.post('/admin/payments',requireAdmin,(req,res)=>{ const b=req.body; db.prepare('INSERT INTO payment_methods(name,account_title,account_number,instructions,icon,active,sort_order) VALUES (?,?,?,?,?,?,?)').run(b.name,b.account_title||'',b.account_number||'',b.instructions||'',b.icon||'bank',b.active?1:0,Number(b.sort_order||0)); setFlash(req,'success','Payment method added.'); res.redirect('/admin/payments'); });
app.post('/admin/payments/:id',requireAdmin,(req,res)=>{ const b=req.body; db.prepare('UPDATE payment_methods SET name=?,account_title=?,account_number=?,instructions=?,icon=?,active=?,sort_order=? WHERE id=?').run(b.name,b.account_title||'',b.account_number||'',b.instructions||'',b.icon||'bank',b.active?1:0,Number(b.sort_order||0),req.params.id); setFlash(req,'success','Payment method updated.'); res.redirect('/admin/payments'); });
app.post('/admin/payments/:id/delete',requireAdmin,(req,res)=>{ db.prepare('DELETE FROM payment_methods WHERE id=?').run(req.params.id); setFlash(req,'success','Payment method removed.'); res.redirect('/admin/payments'); });

app.get('/admin/customers',requireAdmin,(req,res)=>res.render('admin/customers',{customers:db.prepare("SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) order_count FROM users u WHERE role='client' ORDER BY id DESC").all(),title:'Customers'}));
app.post('/admin/customers/:id/status',requireAdmin,(req,res)=>{ const status=req.body.status==='blocked'?'blocked':'active'; db.prepare("UPDATE users SET status=? WHERE id=? AND role='client'").run(status,req.params.id); setFlash(req,'success','Customer status updated.'); res.redirect('/admin/customers'); });

app.get('/admin/settings',requireAdmin,(req,res)=>res.render('admin/settings',{allSettings:settingsMap(),title:'Store settings'}));
app.post('/admin/settings',requireAdmin,(req,res)=>{ const allowed=['store_name','currency','hero_title','hero_subtitle','support_whatsapp','support_email']; const up=db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'); const trx=db.transaction(()=>allowed.forEach(k=>up.run(k,(req.body[k]||'').trim()))); trx(); setFlash(req,'success','Store settings saved.'); res.redirect('/admin/settings'); });
app.get('/admin/security',requireAdmin,(req,res)=>res.render('admin/security',{title:'Admin security'}));
app.post('/admin/security/password',requireAdmin,(req,res)=>{ const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id); if(!bcrypt.compareSync(req.body.current_password||'',user.password_hash)){setFlash(req,'error','Current password is incorrect.');return res.redirect('/admin/security');} if((req.body.new_password||'').length<10){setFlash(req,'error','Use a new password of at least 10 characters.');return res.redirect('/admin/security');} db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.new_password,12),user.id); setFlash(req,'success','Admin password changed.'); res.redirect('/admin/security'); });

app.use((err,req,res,next)=>{ console.error(err); setFlash(req,'error',err.message||'Something went wrong.'); res.redirect(req.get('referer')||'/'); });
app.use((req,res)=>res.status(404).render('shop/message',{title:'Page not found',message:'The page you requested does not exist.'}));

app.listen(PORT,()=>console.log(`SimNova Pro running at http://localhost:${PORT}`));
