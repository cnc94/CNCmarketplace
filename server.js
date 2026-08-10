const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "storage", "data.json");
const UPLOADS = path.join(__dirname, "storage", "designs");
const IMAGES = path.join(__dirname, "storage", "images");
fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@cncmarketplace.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123!";

if (!fs.existsSync(DATA)) {
  fs.writeFileSync(DATA, JSON.stringify({users:[], products:[], downloads:[]}, null, 2));
}
const db = () => JSON.parse(fs.readFileSync(DATA, "utf8"));
const save = d => fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
const id = () => crypto.randomUUID();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "replace-this-secret",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true, sameSite:"lax", maxAge:1000*60*60*24*7}
}));
app.use(express.static(__dirname));
app.use("/uploads/images", express.static(IMAGES));

const designStorage = multer.diskStorage({
  destination: (_,__,cb)=>cb(null, UPLOADS),
  filename: (_,file,cb)=>cb(null, Date.now()+"-"+crypto.randomBytes(5).toString("hex")+"-"+file.originalname.replace(/[^a-zA-Z0-9._-]/g,"_"))
});
const imageStorage = multer.diskStorage({
  destination: (_,__,cb)=>cb(null, IMAGES),
  filename: (_,file,cb)=>{
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now()+"-"+crypto.randomBytes(5).toString("hex")+ext);
  }
});
const upload = multer({storage:designStorage, limits:{fileSize:200*1024*1024}});
const imageUpload = multer({
  storage:imageStorage,
  limits:{fileSize:10*1024*1024},
  fileFilter: (_,file,cb)=>{
    const ok=["image/jpeg","image/png","image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Preview image must be JPG, PNG or WEBP"), ok);
  }
});

function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:"Login required"}); next(); }
function admin(req,res,next){ if(!req.session.admin) return res.status(403).json({error:"Admin access required"}); next(); }

app.get("/api/products",(req,res)=>{
  const d=db();
  res.json(d.products.map(p=>({...p, file:undefined})));
});

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body;
  if(!name || !email || !password || password.length<6) return res.status(400).json({error:"Name, email and 6+ character password required"});
  const d=db(), e=email.toLowerCase().trim();
  if(d.users.some(u=>u.email===e)) return res.status(409).json({error:"Email already registered"});
  const user={id:id(),name,email:e,passwordHash:crypto.createHash("sha256").update(password).digest("hex"),createdAt:new Date().toISOString()};
  d.users.push(user); save(d);
  req.session.user={id:user.id,name:user.name,email:user.email};
  res.json({user:req.session.user});
});

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body, d=db(), e=(email||"").toLowerCase().trim();
  const hash=crypto.createHash("sha256").update(password||"").digest("hex");
  const u=d.users.find(x=>x.email===e && x.passwordHash===hash);
  if(!u) return res.status(401).json({error:"Invalid email or password"});
  req.session.user={id:u.id,name:u.name,email:u.email};
  res.json({user:req.session.user});
});

app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null,admin:!!req.session.admin}));

app.get("/api/products/:id",(req,res)=>{
  const p=db().products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:"Design not found"});
  const {file,...safe}=p; res.json(safe);
});

app.get("/api/download/:id",auth,(req,res)=>{
  const d=db(), p=d.products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).send("Design not found");
  if(p.premium){
    return res.status(402).json({error:"Premium design. Connect your payment provider before enabling paid downloads."});
  }
  if(!p.file || !fs.existsSync(p.file)) return res.status(404).send("File unavailable");
  d.downloads.push({id:id(),userId:req.session.user.id,productId:p.id,at:new Date().toISOString()}); save(d);
  res.download(p.file,p.originalName || path.basename(p.file));
});

app.post("/api/admin/login",(req,res)=>{
  if(req.body.email===ADMIN_EMAIL && req.body.password===ADMIN_PASSWORD){
    req.session.admin=true; return res.json({ok:true});
  }
  res.status(401).json({error:"Invalid admin credentials"});
});
app.post("/api/admin/logout",(req,res)=>{req.session.admin=false;res.json({ok:true})});

app.get("/api/admin/stats",admin,(req,res)=>{
  const d=db();
  res.json({users:d.users.length,products:d.products.length,downloads:d.downloads.length,premium:d.products.filter(p=>p.premium).length});
});

app.post("/api/admin/products", admin, upload.fields([
  {name:"image", maxCount:1},
  {name:"file", maxCount:1}
]), (req,res)=>{
  const imageFile = req.files && req.files.image ? req.files.image[0] : null;
  const designFile = req.files && req.files.file ? req.files.file[0] : null;
  const {name,description,category,format,price,premium}=req.body;
  if(!name || !designFile) return res.status(400).json({error:"Name and design file are required"});
  const d=db();
  const product={
    id:id(),name,description:description||"",category:category||"Other",
    format:format||path.extname(designFile.originalname).slice(1).toUpperCase(),
    price:Number(price||0),premium:premium==="true",
    file:designFile.path,originalName:designFile.originalname,
    size:designFile.size,createdAt:new Date().toISOString(),
    imageUrl:imageFile ? `/uploads/images/${imageFile.filename}` : null
  };
  d.products.unshift(product); save(d);
  const {file,...safe}=product; res.json(safe);
});

app.delete("/api/admin/products/:id",admin,(req,res)=>{
  const d=db(), i=d.products.findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({error:"Not found"});
  const p=d.products[i];
  if(p.file && fs.existsSync(p.file)) fs.unlinkSync(p.file);
  if(p.imageUrl){
    const imagePath=path.join(__dirname,p.imageUrl.replace(/^\//,""));
    if(fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
  d.products.splice(i,1); save(d); res.json({ok:true});
});

app.get("/api/admin/products",admin,(req,res)=>res.json(db().products.map(({file,...p})=>p)));

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

app.use((err,req,res,next)=>{
  if(err && err.code && err.code.startsWith("LIMIT")) return res.status(400).json({error:err.message});
  if(err && err.message) return res.status(400).json({error:err.message});
  next(err);
});

app.listen(PORT,()=>console.log(`CNCmarketplace running at http://localhost:${PORT}`));
