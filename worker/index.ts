import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

type Env = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN?: string; SESSION_SECRET?: string };
type Variables = { userId: string; workspaceId: string; workspace: { id: string; name: string; public_key: string; currency: string } };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const events = ["Visit LP", "Click CTA", "Masuk WA", "MQL", "Prospek", "Closing", "Isi Form"];
const platforms = ["Meta", "Google Ads", "TikTok", "GA4", "LinkedIn", "ChatGPT Ads"];
const json = (c: any, data: unknown, status = 200) => c.json(data, status);
const id = () => crypto.randomUUID();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return encode(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt).buffer as ArrayBuffer, iterations: 180000 }, key, 256)));
}
async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function session(c: any, userId: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ sub: userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 })));
  const secret = c.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum dikonfigurasi");
  setCookie(c, "arenka_session", `${payload}.${await sign(payload, secret)}`, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin && origin !== c.env.APP_ORIGIN) return json(c, { error: "Origin tidak diizinkan" }, 403);
  await next();
});

app.post("/api/auth/register", async c => {
  const body = await c.req.json<{ email?: string; password?: string; workspace?: string }>().catch(() => ({} as { email?: string; password?: string; workspace?: string }));
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) return json(c, { error: "Gunakan email valid dan kata sandi minimal 12 karakter." }, 400);
  const userId = id(), salt = crypto.getRandomValues(new Uint8Array(16)), publicKey = crypto.randomUUID().replaceAll("-", "");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)").bind(userId, email, `${encode(salt)}:${await derive(password, salt)}`),
      c.env.DB.prepare("INSERT INTO workspaces(id,owner_id,name,public_key) VALUES(?,?,?,?)").bind(id(), userId, body.workspace?.trim().slice(0, 80) || "Workspace Saya", publicKey),
    ]);
  } catch { return json(c, { error: "Email ini sudah terdaftar." }, 409); }
  await session(c, userId);
  return json(c, { ok: true });
});

app.post("/api/auth/login", async c => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const row = await c.env.DB.prepare("SELECT id,password_hash FROM users WHERE email=?").bind(body.email?.trim().toLowerCase() ?? "").first<{ id: string; password_hash: string }>();
  if (!row) return json(c, { error: "Email atau kata sandi tidak cocok." }, 401);
  const [salt, expected] = row.password_hash.split(":");
  if (!salt || await derive(body.password ?? "", decode(salt)) !== expected) return json(c, { error: "Email atau kata sandi tidak cocok." }, 401);
  await session(c, row.id);
  return json(c, { ok: true });
});
app.post("/api/auth/logout", c => { deleteCookie(c, "arenka_session", { path: "/" }); return json(c, { ok: true }); });

app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  const token = getCookie(c, "arenka_session") ?? "";
  const [payload, signature] = token.split(".");
  const secret = c.env.SESSION_SECRET;
  if (!payload || !signature || !secret || await sign(payload, secret) !== signature) return json(c, { error: "Sesi berakhir. Silakan masuk kembali." }, 401);
  try {
    const decoded = JSON.parse(new TextDecoder().decode(decode(payload))) as { sub: string; exp: number };
    if (!decoded.sub || decoded.exp < Date.now()) throw new Error();
    const workspace = await c.env.DB.prepare("SELECT id,name,public_key,currency FROM workspaces WHERE owner_id=? ORDER BY created_at LIMIT 1").bind(decoded.sub).first<Variables["workspace"]>();
    if (!workspace) throw new Error();
    c.set("userId", decoded.sub); c.set("workspaceId", workspace.id); c.set("workspace", workspace);
    await next();
  } catch { return json(c, { error: "Sesi tidak valid." }, 401); }
});

app.get("/api/me", c => json(c, { workspace: c.get("workspace") }));
app.get("/api/summary", async c => {
  const wid = c.get("workspaceId");
  const [leads, stages, spend, eventCount, bySource] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='Closing' THEN 1 ELSE 0 END) closing, SUM(CASE WHEN status='Closing' THEN value ELSE 0 END) revenue FROM leads WHERE workspace_id=?").bind(wid).first(),
    c.env.DB.prepare("SELECT status,COUNT(*) count FROM leads WHERE workspace_id=? GROUP BY status").bind(wid).all(),
    c.env.DB.prepare("SELECT COALESCE(SUM(spend),0) total FROM ad_costs WHERE workspace_id=? AND spend_date >= date('now','-30 day')").bind(wid).first(),
    c.env.DB.prepare("SELECT COUNT(*) total FROM events WHERE workspace_id=? AND created_at >= datetime('now','-30 day')").bind(wid).first(),
    c.env.DB.prepare("SELECT COALESCE(source,'Direct') source,COUNT(*) count FROM leads WHERE workspace_id=? GROUP BY source ORDER BY count DESC LIMIT 6").bind(wid).all(),
  ]);
  const l = leads as any, adSpend = Number((spend as any)?.total ?? 0), revenue = Number(l?.revenue ?? 0);
  return json(c, { leads: Number(l?.total ?? 0), closing: Number(l?.closing ?? 0), revenue, spend: adSpend, roas: adSpend ? revenue / adSpend : null, events: Number((eventCount as any)?.total ?? 0), stages: stages.results, sources: bySource.results });
});
app.get("/api/leads", async c => {
  const q = `%${(c.req.query("q") ?? "").slice(0, 80)}%`, status = c.req.query("status");
  const rows = await c.env.DB.prepare(`SELECT * FROM leads WHERE workspace_id=? AND (name LIKE ? OR COALESCE(phone,'') LIKE ? OR COALESCE(email,'') LIKE ?) ${status && ["Masuk WA","MQL","Prospek","Closing","Lost"].includes(status) ? "AND status=?" : ""} ORDER BY first_seen DESC LIMIT 200`)
    .bind(...[c.get("workspaceId"), q, q, q, ...(status && ["Masuk WA","MQL","Prospek","Closing","Lost"].includes(status) ? [status] : [])]).all();
  return json(c, rows.results);
});
app.post("/api/leads", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  if (!String(b.name ?? "").trim()) return json(c, { error: "Nama lead wajib diisi." }, 400);
  const leadId = id();
  await c.env.DB.prepare("INSERT INTO leads(id,workspace_id,name,phone,email,status,value,source,campaign,landing_page) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(leadId,c.get("workspaceId"),String(b.name).trim().slice(0,120),String(b.phone??"").slice(0,40)||null,String(b.email??"").slice(0,160)||null,["Masuk WA","MQL","Prospek","Closing","Lost"].includes(b.status)?b.status:"Masuk WA",Math.max(0,Number(b.value)||0),String(b.source??"Manual").slice(0,80),String(b.campaign??"").slice(0,160)||null,String(b.landing_page??"").slice(0,500)||null).run();
  return json(c, { id: leadId }, 201);
});
app.patch("/api/leads/:id", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  if (!b.status && b.name === undefined && b.value === undefined) return json(c, { error: "Tidak ada perubahan." }, 400);
  const result = await c.env.DB.prepare("UPDATE leads SET name=COALESCE(?,name),status=COALESCE(?,status),value=COALESCE(?,value),updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?")
    .bind(b.name ? String(b.name).trim().slice(0,120) : null,["Masuk WA","MQL","Prospek","Closing","Lost"].includes(b.status)?b.status:null,b.value === undefined?null:Math.max(0,Number(b.value)||0),c.req.param("id"),c.get("workspaceId")).run();
  return result.meta.changes ? json(c,{ok:true}) : json(c,{error:"Lead tidak ditemukan."},404);
});

app.get("/api/mappings", async c => {
  const rows = await c.env.DB.prepare("SELECT platform,event_name,destination_event FROM event_mappings WHERE workspace_id=?").bind(c.get("workspaceId")).all();
  return json(c, { platforms, events, mappings: rows.results });
});
app.put("/api/mappings", async c => {
  const b = await c.req.json<{ platform?: string; mappings?: Record<string,string> }>().catch(()=>({} as { platform?: string; mappings?: Record<string,string> }));
  if (!platforms.includes(b.platform ?? "")) return json(c,{error:"Platform tidak valid."},400);
  const statements = Object.entries(b.mappings ?? {}).filter(([event,dest])=>events.includes(event)&&typeof dest==="string").map(([event,dest])=>c.env.DB.prepare("INSERT INTO event_mappings(workspace_id,platform,event_name,destination_event) VALUES(?,?,?,?) ON CONFLICT(workspace_id,platform,event_name) DO UPDATE SET destination_event=excluded.destination_event").bind(c.get("workspaceId"),b.platform,event,dest.slice(0,100)));
  if(statements.length) await c.env.DB.batch(statements);
  return json(c,{ok:true});
});
app.get("/api/integrations", async c=>{
  const rows=await c.env.DB.prepare("SELECT platform,account_id,account_name,connected FROM integrations WHERE workspace_id=?").bind(c.get("workspaceId")).all();
  return json(c,{platforms,integrations:rows.results});
});
app.put("/api/integrations/:platform", async c=>{
  const platform=c.req.param("platform"), b=await c.req.json<{account_id?:string;account_name?:string}>().catch(()=>({} as {account_id?:string;account_name?:string}));
  if(!platforms.includes(platform))return json(c,{error:"Platform tidak valid."},400);
  await c.env.DB.prepare("INSERT INTO integrations(workspace_id,platform,account_id,account_name,connected) VALUES(?,?,?,?,0) ON CONFLICT(workspace_id,platform) DO UPDATE SET account_id=excluded.account_id,account_name=excluded.account_name,connected=0,updated_at=CURRENT_TIMESTAMP").bind(c.get("workspaceId"),platform,String(b.account_id??"").slice(0,100)||null,String(b.account_name??"").slice(0,120)||null).run();
  return json(c,{ok:true,note:"Akun tersimpan. OAuth platform belum diaktifkan."});
});
app.get("/api/report", async c=>{
  const from=c.req.query("from")??new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=c.req.query("to")??new Date().toISOString().slice(0,10),wid=c.get("workspaceId");
  const rows=await c.env.DB.prepare(`SELECT CASE lower(source) WHEN 'meta' THEN 'Meta' WHEN 'facebook' THEN 'Meta' WHEN 'instagram' THEN 'Meta' WHEN 'google' THEN 'Google Ads' WHEN 'google ads' THEN 'Google Ads' WHEN 'google_ads' THEN 'Google Ads' WHEN 'tiktok' THEN 'TikTok' WHEN 'linkedin' THEN 'LinkedIn' WHEN 'chatgpt ads' THEN 'ChatGPT Ads' ELSE source END platform,COALESCE(campaign,'') campaign,COUNT(*) leads,SUM(CASE WHEN status='Masuk WA' THEN 1 ELSE 0 END) whatsapp,SUM(CASE WHEN status='MQL' THEN 1 ELSE 0 END) mql,SUM(CASE WHEN status='Prospek' THEN 1 ELSE 0 END) prospects,SUM(CASE WHEN status='Closing' THEN 1 ELSE 0 END) closing,SUM(CASE WHEN status='Closing' THEN value ELSE 0 END) revenue FROM leads WHERE workspace_id=? AND date(first_seen) BETWEEN ? AND ? GROUP BY platform,campaign ORDER BY leads DESC`).bind(wid,from,to).all();
  const spend=await c.env.DB.prepare("SELECT platform,campaign,SUM(spend) spend FROM ad_costs WHERE workspace_id=? AND spend_date BETWEEN ? AND ? GROUP BY platform,campaign").bind(wid,from,to).all();
  return json(c,{rows:rows.results,spend:spend.results,from,to});
});
app.post("/api/costs",async c=>{
  const b=await c.req.json<any>().catch(()=>({})),spend=Math.round(Number(b.spend));
  if(!platforms.includes(b.platform)||!String(b.campaign??"").trim()||!Number.isFinite(spend)||spend<0||spend>1_000_000_000_000||!/^\d{4}-\d{2}-\d{2}$/.test(b.spend_date??""))return json(c,{error:"Periksa platform, campaign, tanggal, dan biaya."},400);
  await c.env.DB.prepare("INSERT INTO ad_costs(id,workspace_id,platform,campaign,spend,spend_date) VALUES(?,?,?,?,?,?)").bind(id(),c.get("workspaceId"),b.platform,String(b.campaign).trim().slice(0,160),spend,b.spend_date).run();return json(c,{ok:true},201);
});
app.get("/api/events",async c=>{const rows=await c.env.DB.prepare("SELECT id,event_name,page_url,source,medium,campaign,created_at FROM events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(c.get("workspaceId")).all();return json(c,rows.results);});

app.options("/t/:key", c=>new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400"}}));
app.post("/t/:key",async c=>{
  const workspace=await c.env.DB.prepare("SELECT id FROM workspaces WHERE public_key=?").bind(c.req.param("key")).first<{id:string}>();
  if(!workspace)return new Response(null,{status:404,headers:{"Access-Control-Allow-Origin":"*"}});
  const raw=await c.req.text();
  if(new TextEncoder().encode(raw).byteLength>8192)return new Response(null,{status:413,headers:{"Access-Control-Allow-Origin":"*"}});
  let b:any={};try{b=JSON.parse(raw)}catch{return new Response(null,{status:400,headers:{"Access-Control-Allow-Origin":"*"}})}
  const event=String(b.event??"").slice(0,100);
  if(!event)return new Response(null,{status:400,headers:{"Access-Control-Allow-Origin":"*"}});
  const p=b.payload&&typeof b.payload==="object"?b.payload:{}, utm=b.utm&&typeof b.utm==="object"?b.utm:{};
  let leadId:string|null=null;
  if(/click cta|wa|whatsapp|lead|form|contact/i.test(event)){
    leadId=id();
    const saved=await c.env.DB.prepare("INSERT INTO leads(id,workspace_id,visitor_id,name,phone,email,source,campaign,landing_page) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,visitor_id) DO UPDATE SET name=CASE WHEN excluded.name<>'Pengunjung baru' THEN excluded.name ELSE leads.name END,phone=COALESCE(excluded.phone,leads.phone),email=COALESCE(excluded.email,leads.email),updated_at=CURRENT_TIMESTAMP RETURNING id")
      .bind(leadId,workspace.id,String(b.visitor_id??"").slice(0,80)||null,String(p.name??"Pengunjung baru").slice(0,120),String(p.phone??"").slice(0,40)||null,String(p.email??"").slice(0,160)||null,String(utm.source??"Direct").slice(0,80),String(utm.campaign??"").slice(0,160)||null,String(b.page_url??"").slice(0,500)||null).first<{id:string}>();
    leadId=saved?.id??leadId;
  }
  await c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,page_url,referrer,source,medium,campaign,content,term,visitor_id,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id(),workspace.id,leadId,event,String(b.page_url??"").slice(0,500),String(b.referrer??"").slice(0,500),String(utm.source??"").slice(0,100),String(utm.medium??"").slice(0,100),String(utm.campaign??"").slice(0,200),String(utm.content??"").slice(0,200),String(utm.term??"").slice(0,200),String(b.visitor_id??"").slice(0,80),JSON.stringify(p).slice(0,4000)).run();
  return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400"}});
});

app.get("/tracker.js", c => {
  const js = `(function(){var endpoint=${JSON.stringify(new URL(c.req.url).origin)},key=${JSON.stringify(c.req.query("k")??"")},q=new URLSearchParams(location.search),vid=localStorage.getItem('arenka_vid')||crypto.randomUUID();localStorage.setItem('arenka_vid',vid);function send(event,payload){var utm={};['source','medium','campaign','term','content'].forEach(function(k){utm[k]=q.get('utm_'+k)||sessionStorage.getItem('a_utm_'+k)||'';if(q.get('utm_'+k))sessionStorage.setItem('a_utm_'+k,q.get('utm_'+k))});fetch(endpoint+'/t/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:event,payload:payload||{},utm:utm,page_url:location.href,referrer:document.referrer,visitor_id:vid}),keepalive:true}).catch(function(){})}window.arenkaTrack=send;send('Visit LP');document.addEventListener('click',function(e){var a=e.target.closest('a[href^="https://wa.me"],a[href^="https://api.whatsapp.com"],a[data-track]');if(a)send(a.dataset.track||'Click CTA',{href:a.href,text:(a.innerText||'').slice(0,120)})},true);})();`;
  return new Response(js,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"public, max-age=300","Access-Control-Allow-Origin":"*"}});
});

app.all("*", async (c,next)=>{
  if(c.req.path.startsWith("/api/")||c.req.path.startsWith("/t/")||c.req.path==="/tracker.js")return next();
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
