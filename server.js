const express=require("express");
const session=require("express-session");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const app=express();
const PORT=process.env.PORT||3000;
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,"storage");
const DESIGN_DIR=path.join(DATA_DIR,"designs");
const IMAGE_DIR=path.join(DATA_DIR,"images");
const DATA_FILE=path.join(DATA_DIR,"data.json");
for(const d of [DATA_DIR,DESIGN_DIR,IMAGE_DIR]) fs.mkdirSync(d,{recursive:true});
if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE,JSON.stringify({users:[],products:[],downloads:[]},null,2));

const readDB=()=>{try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"))}catch{return {users:[],products:[],downloads:[]}}};
const writeDB=d=>fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));
const uid=()=>crypto.randomUUID();

const ADMIN_EMAIL=process.env.ADMIN_EMAIL||"admin@cncmarketplace.local";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"ChangeMe123!";
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"cncmarketplace-session-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:7*24*60*60*1000}}));
app.use(express.static(__dirname));
app.use("/uploads/images",express.static(IMAGE_DIR));
app.use("/uploads/designs",express.static(DESIGN_DIR));

const storage=multer.diskStorage({
 destination:(req,file,cb)=>cb(null,file.fieldname==="image"?IMAGE_DIR:DESIGN_DIR),
 filename:(req,file,cb)=>{
  const ext=path.extname(file.originalname).toLowerCase();
  const base=path.basename(file.originalname,ext).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,70);
  cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+"-"+base+ext);
 }
});
const upload=multer({
 storage,
 limits:{fileSize:250*1024*1024},
 fileFilter:(req,file,cb)=>{
  if(file.fieldname==="image") return cb(["image/jpeg","image/png","image/webp"].includes(file.mimetype)?null:new Error("Image must be JPG, PNG, or WEBP"));
  cb([".dxf",".stl",".cdr"].includes(path.extname(file.originalname).toLowerCase())?null:new Error("CNC file must be DXF, STL, or CDR"));
 }
});
const admin=(req,res,next)=>req.session.admin?next():res.status(403).json({error:"Admin access required"});
const user=(req,res,next)=>req.session.user?next():res.status(401).json({error:"Login required"});

app.get("/api/products",(req,res)=>res.json(readDB().products.map(({file,...p})=>p)));
app.get("/api/admin/products",admin,(req,res)=>res.json(readDB().products.map(({file,...p})=>p)));
app.get("/api/admin/stats",admin,(req,res)=>{const d=readDB();res.json({users:d.users.length,products:d.products.length,downloads:d.downloads.length,premium:d.products.filter(x=>x.premium).length})});

app.post("/api/admin/login",(req,res)=>{
 if(String(req.body.email||"").trim().toLowerCase()===ADMIN_EMAIL.trim().toLowerCase() && String(req.body.password||"")===ADMIN_PASSWORD){req.session.admin=true;return res.json({ok:true})}
 res.status(401).json({error:"Invalid admin credentials"});
});

app.post("/api/admin/products",admin,(req,res)=>{
 upload.fields([{name:"image",maxCount:1},{name:"file",maxCount:1}])(req,res,(err)=>{
  if(err) return res.status(400).json({error:err.message});
  const image=req.files?.image?.[0], file=req.files?.file?.[0];
  if(!image) return res.status(400).json({error:"Please choose a design preview image."});
  if(!file) return res.status(400).json({error:"Please choose a DXF, STL, or CDR file."});
  const d=readDB();
  const p={
   id:uid(),name:String(req.body.name||"Untitled design"),description:String(req.body.description||""),
   category:String(req.body.category||"Other"),format:String(req.body.format||path.extname(file.originalname).slice(1).toUpperCase()),
   price:Number(req.body.price||0),premium:String(req.body.premium||"")==="true",
   imageUrl:"/uploads/images/"+path.basename(image.filename),
   file:file.path,originalName:file.originalname,createdAt:new Date().toISOString()
  };
  d.products.unshift(p);writeDB(d);
  const {file:privateFile,...safe}=p;res.status(201).json(safe);
 });
});

app.delete("/api/admin/products/:id",admin,(req,res)=>{
 const d=readDB(),i=d.products.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Not found"});
 const p=d.products[i];if(p.file&&fs.existsSync(p.file))try{fs.unlinkSync(p.file)}catch{}
 if(p.imageUrl){const f=path.join(IMAGE_DIR,path.basename(p.imageUrl));if(fs.existsSync(f))try{fs.unlinkSync(f)}catch{}}
 d.products.splice(i,1);writeDB(d);res.json({ok:true});
});

app.post("/api/register",(req,res)=>{
 const e=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||"");
 if(!req.body.name||!e||pw.length<6)return res.status(400).json({error:"Invalid registration"});
 const d=readDB();if(d.users.some(x=>x.email===e))return res.status(409).json({error:"Email already registered"});
 const u={id:uid(),name:String(req.body.name),email:e,passwordHash:crypto.createHash("sha256").update(pw).digest("hex")};
 d.users.push(u);writeDB(d);req.session.user={id:u.id,name:u.name,email:u.email};res.json({user:req.session.user});
});
app.post("/api/login",(req,res)=>{
 const e=String(req.body.email||"").trim().toLowerCase(),h=crypto.createHash("sha256").update(String(req.body.password||"")).digest("hex");
 const u=readDB().users.find(x=>x.email===e&&x.passwordHash===h);if(!u)return res.status(401).json({error:"Invalid email or password"});
 req.session.user={id:u.id,name:u.name,email:u.email};res.json({user:req.session.user});
});
app.get("/api/me",(req,res)=>res.json({user:req.session.user||null,admin:!!req.session.admin}));
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

app.get("/api/download/:id",user,(req,res)=>{
 const p=readDB().products.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Not found"});
 if(p.premium)return res.status(402).json({error:"Premium payment is not configured yet."});
 if(!p.file||!fs.existsSync(p.file))return res.status(404).json({error:"File unavailable"});
 res.download(p.file,p.originalName||"cnc-design");
});
app.listen(PORT,()=>console.log("CNCmarketplace running on "+PORT));
