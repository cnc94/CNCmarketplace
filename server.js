const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE = path.join(__dirname, "storage");
const DATA = path.join(STORAGE, "data.json");
const UPLOADS = path.join(STORAGE, "designs");
const IMAGES = path.join(STORAGE, "images");

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@cncmarketplace.local";
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
  secret: process.env.SESSION_SECRET || "change-this-session-secret",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true, sameSite:"lax", maxAge:1000*60*60*24*7}
}));

app.use(express.static(__dirname));
app.use("/uploads/images", express.static(IMAGES));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === "image" ? IMAGES : UPLOADS);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, Date.now() + "-" + crypto.randomBytes(5).toString("hex") + "-" + safe);
  }
});

const upload = multer({
  storage,
  limits:{fileSize:200*1024*1024},
  fileFilter:(req,file,cb)=>{
    if(file.fieldname === "image"){
      const ok = ["image/jpeg","image/png","image/webp"].includes(file.mimetype);
      return cb(ok ? null : new Error("Preview image must be JPG, PNG, or WEBP"));
    }
    cb(null,true);
  }
});

function auth(req,res,next){
  if(!req.session.user) return res.status(401).json({error:"Login required"});
  next();
}
function admin(req,res,next){
  if(!req.session.admin) return res.status(403).json({error:"Admin access required"});
  next();
}

app.get("/api/products",(req,res)=>{
  const d=db();
  res.json(d.products.map(({file,...p})=>p));
});

app.post("/api/register",(req,res)=>{
  const {name,email,password}=req.body;
  if(!name || !email || !password || password.length<6)
    return res.status(400).json({error:"Name, email and 6+ character password required"});
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
  const {file,...safe}=p;
  res.json(safe);
});

app.get("/api/download/:id",auth,(req,res)=>{
  const d=db(), p=d.products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).send("Design not found");
  if(p.premium) return res.status(402).json({error:"Premium design. Connect your payment provider before enabling paid downloads."});
  if(!p.file || !fs.existsSync(p.file)) return res.status(404).send("File unavailable");
  d.downloads.push({id:id(),userId:req.session.user.id,productId:p.id,at:new Date().toISOString()});
  save(d);
  res.download(p.file,p.originalName || path.basename(p.file));
});

app.post("/api/admin/login",(req,res)=>{
  if(req.body.email===ADMIN_EMAIL && req.body.password===ADMIN_PASSWORD){
    req.session.admin=true;
    return res.json({ok:true});
  }
  res.status(401).json({error:"Invalid admin credentials"});
});

app.post("/api/admin/logout",(req,res)=>{
  req.session.admin=false;
  res.json({ok:true});
});

app.get("/api/admin/stats",admin,(req,res)=>{
  const d=db();
  res.json({
    users:d.users.length,
    products:d.products.length,
    downloads:d.downloads.length,
    premium:d.products.filter(p=>p.premium).length
  });
});

app.post("/api/admin/products",admin,(req,res)=>{
  upload.fields([
    {name:"file",maxCount:1},
    {name:"image",maxCount:1}
  ])(req,res,err=>{
    if(err) return res.status(400).json({error:err.message});
    try{
      const file=req.files?.file?.[0];
      const image=req.files?.image?.[0];
      const {name,description,category,format,price,premium}=req.body;
      if(!name || !file) return res.status(400).json({error:"Design name and CNC file are required"});
      const d=db();
      const product={
        id:id(),
        name,
        description:description||"",
        category:category||"Other",
        format:format||path.extname(file.originalname).slice(1).toUpperCase(),
        price:Number(price||0),
        premium:premium==="true",
        file:file.path,
        originalName:file.originalname,
        imageUrl:image ? `/uploads/images/${path.basename(image.path)}` : null,
        size:file.size,
        createdAt:new Date().toISOString()
      };
      d.products.unshift(product);
      save(d);
      const {file:privateFile,...safe}=product;
      res.json(safe);
    }catch(e){
      res.status(500).json({error:"Upload failed"});
    }
  });
});

app.delete("/api/admin/products/:id",admin,(req,res)=>{
  const d=db(), i=d.products.findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({error:"Not found"});
  const p=d.products[i];
  if(p.file && fs.existsSync(p.file)) fs.unlinkSync(p.file);
  if(p.imageUrl){
    const imagePath=path.join(IMAGES,path.basename(p.imageUrl));
    if(fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
  d.products.splice(i,1); save(d);
  res.json({ok:true});
});

app.get("/api/admin/products",admin,(req,res)=>{
  res.json(db().products.map(({file,...p})=>p));
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

app.listen(PORT,()=>console.log(`CNCmarketplace running at http://localhost:${PORT}`));
