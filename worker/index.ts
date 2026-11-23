import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { pbkdf2 } from "node:crypto";

type Env = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN?: string; SESSION_SECRET?: string; RESEND_API_KEY?: string; RESET_EMAIL_FROM?: string };
type Variables = { userId: string; workspaceId: string; workspace: { id: string; name: string; public_key: string; currency: string } };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const events = ["Visit LP", "Click CTA", "Masuk WA", "MQL", "Prospek", "Closing", "Isi Form"];
const platforms = ["Meta", "Google Ads", "TikTok", "GA4", "LinkedIn", "ChatGPT Ads"];
const json = (c: any, data: unknown, status = 200) => c.json(data, status);
const id = () => crypto.randomUUID();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0));
async function derive(password: string, salt: Uint8Array) {
  const derived = await new Promise<Uint8Array>((resolve, reject) => {
    pbkdf2(password, salt, 100000, 32, "sha256", (error, key) => error ? reject(error) : resolve(new Uint8Array(key)));
  });
  return encode(new Uint8Array(derived));
}
async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function waCipherKey(secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const raw=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("arenka:whatsapp:secrets:v1"));return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"])}
async function encryptSecret(value:string,secret:string){const key=await waCipherKey(secret),iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));return encode(new Uint8Array([...iv,...new Uint8Array(encrypted)]))}
async function decryptSecret(value:string,secret:string){const bytes=decode(value),key=await waCipherKey(secret),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},key,bytes.slice(12));return new TextDecoder().decode(plain)}
function constantTimeEqual(a:string,b:string){if(a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0}
async function hmacHex(value:string,secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]),signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));return Array.from(signature,b=>b.toString(16).padStart(2,"0")).join("")}
async function session(c: any, userId: string, version = 0) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({ sub: userId, ver: version, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 })));
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) return json(c, { error: "Email ini sudah terdaftar." }, 409);
    return json(c, { error: "Akun tidak dapat dibuat. Coba lagi." }, 500);
  }
  await session(c, userId, 0);
  return json(c, { ok: true });
});

app.post("/api/auth/login", async c => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const row = await c.env.DB.prepare("SELECT id,password_hash,session_version FROM users WHERE email=?").bind(body.email?.trim().toLowerCase() ?? "").first<{ id: string; password_hash: string; session_version: number }>();
  if (!row) return json(c, { error: "Email atau kata sandi tidak cocok." }, 401);
  let matches = false;
  try {
    const [salt, expected] = row.password_hash.split(":");
    matches = !!salt && await derive(body.password ?? "", decode(salt)) === expected;
  } catch (error) {
    console.error("Password verification failed", error instanceof Error ? error.name : "unknown");
    return json(c, { error: "Autentikasi sementara tidak tersedia." }, 500);
  }
  if (!matches) return json(c, { error: "Email atau kata sandi tidak cocok." }, 401);
  try { await session(c, row.id, row.session_version); }
  catch (error) { console.error("Session creation failed", error instanceof Error ? error.name : "unknown"); return json(c, { error: "Autentikasi sementara tidak tersedia." }, 500); }
  return json(c, { ok: true });
});

app.post("/api/auth/forgot-password", async c => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const email = body.email?.trim().toLowerCase() ?? "";
  const generic = { message: "Jika email terdaftar, tautan pengaturan kata sandi akan dikirim." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(c, generic);
  if (!c.env.RESEND_API_KEY || !c.env.RESET_EMAIL_FROM || !c.env.APP_ORIGIN || !c.env.SESSION_SECRET) return json(c, { error: "Pemulihan email belum dikonfigurasi. Hubungi administrator." }, 503);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const ipHash = await sign(ip, c.env.SESSION_SECRET);
  const bucket = Math.floor(Date.now() / 600_000);
  await c.env.DB.prepare("INSERT INTO password_reset_limits(ip_hash,window_bucket,request_count) VALUES(?,?,1) ON CONFLICT(ip_hash,window_bucket) DO UPDATE SET request_count=request_count+1").bind(ipHash, bucket).run();
  const limit = await c.env.DB.prepare("SELECT request_count FROM password_reset_limits WHERE ip_hash=? AND window_bucket=?").bind(ipHash, bucket).first<{ request_count: number }>();
  if (bucket % 144 === 0) await c.env.DB.prepare("DELETE FROM password_reset_limits WHERE window_bucket<?").bind(bucket - 144).run();
  if (Number(limit?.request_count ?? 0) > 5) return json(c, generic);
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first<{ id: string }>();
  if (!user) return json(c, generic);
  const recent = await c.env.DB.prepare("SELECT COUNT(*) total FROM password_reset_tokens WHERE user_id=? AND created_at > datetime('now','-15 minutes')").bind(user.id).first<{ total: number }>();
  if (Number(recent?.total ?? 0) >= 3) return json(c, generic);
  const rawToken = encode(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken))), b => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").bind(user.id).run();
  await c.env.DB.prepare("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,datetime('now','+30 minutes'))").bind(id(), user.id, tokenHash).run();
  const resetUrl = `${c.env.APP_ORIGIN}/reset-password?token=${rawToken}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: c.env.RESET_EMAIL_FROM,
      to: [email],
      subject: "Atur ulang kata sandi Arenka Ads Tracker",
      text: `Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Tautan berlaku selama 30 menit dan hanya dapat digunakan sekali. Jika Anda tidak meminta ini, abaikan email ini.\n\n${resetUrl}`,
      html: `<p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda.</p><p><a href="${resetUrl}">Atur kata sandi baru</a></p><p>Tautan berlaku selama 30 menit dan hanya dapat digunakan sekali. Jika Anda tidak meminta ini, abaikan email ini.</p>`,
    }),
  }).catch(() => null);
  if (!response?.ok) {
    await c.env.DB.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();
    return json(c, { error: "Email pemulihan belum dapat dikirim. Coba lagi nanti." }, 503);
  }
  return json(c, generic);
});

app.post("/api/auth/reset-password", async c => {
  const body = await c.req.json<{ token?: string; password?: string }>().catch(() => ({} as { token?: string; password?: string }));
  const token = body.token ?? "", password = body.password ?? "";
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token) || password.length < 12 || password.length > 128) return json(c, { error: "Tautan tidak valid atau kata sandi belum memenuhi syarat." }, 400);
  const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
  const consumedKey = id();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = `${encode(salt)}:${await derive(password, salt)}`;
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP,consumed_key=? WHERE token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP").bind(consumedKey, tokenHash),
    c.env.DB.prepare("UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=(SELECT user_id FROM password_reset_tokens WHERE consumed_key=?)").bind(passwordHash, consumedKey),
  ]);
  if (!results[1].meta.changes) return json(c, { error: "Tautan reset sudah dipakai atau kedaluwarsa. Minta tautan baru." }, 400);
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
    const decoded = JSON.parse(new TextDecoder().decode(decode(payload))) as { sub: string; ver: number; exp: number };
    if (!decoded.sub || decoded.exp < Date.now()) throw new Error();
    const account = await c.env.DB.prepare("SELECT session_version FROM users WHERE id=?").bind(decoded.sub).first<{ session_version: number }>();
    if (!account || decoded.ver !== account.session_version) throw new Error();
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
  const q = `%${(c.req.query("q") ?? "").slice(0, 80)}%`, status = c.req.query("status"), follow=c.req.query("follow_up");
  const validStatus=!!status&&["Masuk WA","MQL","Prospek","Closing","Lost"].includes(status),followClause=follow==="overdue"?"AND follow_up_at IS NOT NULL AND date(follow_up_at)<date('now')":follow==="today"?"AND date(follow_up_at)=date('now')":follow==="upcoming"?"AND date(follow_up_at)>date('now')":"";
  const rows = await c.env.DB.prepare(`SELECT * FROM leads WHERE workspace_id=? AND (name LIKE ? OR COALESCE(phone,'') LIKE ? OR COALESCE(email,'') LIKE ?) ${validStatus ? "AND status=?" : ""} ${followClause} ORDER BY CASE WHEN follow_up_at IS NULL THEN 1 ELSE 0 END,follow_up_at,first_seen DESC LIMIT 200`)
    .bind(...[c.get("workspaceId"), q, q, q, ...(validStatus ? [status] : [])]).all();
  return json(c, rows.results);
});
app.post("/api/leads", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  if (!String(b.name ?? "").trim()) return json(c, { error: "Nama lead wajib diisi." }, 400);
  const leadId=id(),wid=c.get("workspaceId"),status=["Masuk WA","MQL","Prospek","Closing","Lost"].includes(b.status)?b.status:"Masuk WA",source=String(b.source??"Manual").slice(0,80),campaign=String(b.campaign??"").slice(0,160)||null,landing=String(b.landing_page??"").slice(0,500)||null;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO leads(id,workspace_id,name,phone,email,status,value,source,campaign,landing_page) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(leadId,wid,String(b.name).trim().slice(0,120),String(b.phone??"").slice(0,40)||null,String(b.email??"").slice(0,160)||null,status,Math.max(0,Number(b.value)||0),source,campaign,landing),
    c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,page_url,source,campaign,payload) VALUES(?,?,?,?,?,?,?,?)").bind(id(),wid,leadId,status,landing,source,campaign,JSON.stringify({origin:"manual"}))
  ]);
  return json(c, { id: leadId }, 201);
});
app.post("/api/leads/import",async c=>{
  const body=await c.req.json<{leads?:Array<Record<string,unknown>>}>().catch(()=>({} as {leads?:Array<Record<string,unknown>>})),rows=body.leads;
  if(!Array.isArray(rows)||rows.length===0||rows.length>500)return json(c,{error:"Pilih antara 1 sampai 500 lead per impor."},400);
  if(rows.some(row=>!String(row.name??"").trim()))return json(c,{error:"Setiap baris impor harus memiliki nama."},400);
  const wid=c.get("workspaceId"),allowed=["Masuk WA","MQL","Prospek","Closing","Lost"];
  const statements=rows.map(row=>c.env.DB.prepare("INSERT INTO leads(id,workspace_id,name,phone,email,status,value,source,campaign,landing_page) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id(),wid,String(row.name).trim().slice(0,120),String(row.phone??"").slice(0,40)||null,String(row.email??"").slice(0,160)||null,allowed.includes(String(row.status))?String(row.status):"Masuk WA",Math.max(0,Number(row.value)||0),String(row.source??"Impor CSV").slice(0,80),String(row.campaign??"").slice(0,160)||null,String(row.landing_page??"").slice(0,500)||null));
  await c.env.DB.batch(statements);
  return json(c,{created:rows.length},201);
});
app.patch("/api/leads/:id", async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const current=await c.env.DB.prepare("SELECT status,source,campaign,landing_page FROM leads WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).first<{status:string;source:string;campaign:string|null;landing_page:string|null}>();
  if(!current)return json(c,{error:"Lead tidak ditemukan."},404);
  const sets:string[]=[],values:(string|number|null)[]=[];
  if(b.name!==undefined){sets.push("name=?");values.push(String(b.name).trim().slice(0,120))}
  if(b.status!==undefined){if(!["Masuk WA","MQL","Prospek","Closing","Lost"].includes(b.status))return json(c,{error:"Status lead tidak valid."},400);sets.push("status=?");values.push(b.status)}
  if(b.value!==undefined){sets.push("value=?");values.push(Math.max(0,Number(b.value)||0))}
  if(b.follow_up_at!==undefined){if(b.follow_up_at!==null&&b.follow_up_at!==""&&!/^\d{4}-\d{2}-\d{2}$/.test(b.follow_up_at))return json(c,{error:"Tanggal follow-up tidak valid."},400);sets.push("follow_up_at=?");values.push(b.follow_up_at||null)}
  if(b.follow_up_note!==undefined){sets.push("follow_up_note=?");values.push(String(b.follow_up_note??"").trim().slice(0,500)||null)}
  if(!sets.length)return json(c,{error:"Tidak ada perubahan."},400);
  const result = await c.env.DB.prepare(`UPDATE leads SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`)
    .bind(...values,c.req.param("id"),c.get("workspaceId")).run();
  if(result.meta.changes&&b.status!==undefined&&b.status!==current.status)await c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,page_url,source,campaign,payload) VALUES(?,?,?,?,?,?,?,?)").bind(id(),c.get("workspaceId"),c.req.param("id"),b.status,current.landing_page,current.source,current.campaign,JSON.stringify({origin:"lead_status"})).run();
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
  const from=c.req.query("from")??new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=c.req.query("to")??new Date().toISOString().slice(0,10),wid=c.get("workspaceId"),mode=c.req.query("mode")==="events"?"events":"realtime";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json(c,{error:"Rentang tanggal laporan tidak valid."},400);
  const rows=mode==="events"?await c.env.DB.prepare(`WITH conversions AS (SELECT CASE lower(e.source) WHEN 'meta' THEN 'Meta' WHEN 'facebook' THEN 'Meta' WHEN 'instagram' THEN 'Meta' WHEN 'google' THEN 'Google Ads' WHEN 'google ads' THEN 'Google Ads' WHEN 'google_ads' THEN 'Google Ads' WHEN 'tiktok' THEN 'TikTok' WHEN 'linkedin' THEN 'LinkedIn' WHEN 'chatgpt ads' THEN 'ChatGPT Ads' ELSE COALESCE(e.source,'Direct') END platform,COALESCE(e.campaign,'') campaign,e.lead_id,MAX(CASE WHEN lower(e.event_name) LIKE '%click cta%' OR lower(e.event_name) LIKE '%whatsapp%' OR e.event_name='Masuk WA' THEN 1 ELSE 0 END) whatsapp,MAX(CASE WHEN e.event_name='MQL' THEN 1 ELSE 0 END) mql,MAX(CASE WHEN e.event_name='Prospek' THEN 1 ELSE 0 END) prospects,MAX(CASE WHEN e.event_name='Closing' THEN 1 ELSE 0 END) closing FROM events e WHERE e.workspace_id=? AND e.lead_id IS NOT NULL AND date(e.created_at) BETWEEN ? AND ? GROUP BY platform,campaign,e.lead_id) SELECT c.platform,c.campaign,COUNT(*) leads,SUM(c.whatsapp) whatsapp,SUM(c.mql) mql,SUM(c.prospects) prospects,SUM(c.closing) closing,SUM(CASE WHEN c.closing=1 THEN l.value ELSE 0 END) revenue FROM conversions c JOIN leads l ON l.id=c.lead_id GROUP BY c.platform,c.campaign ORDER BY leads DESC`).bind(wid,from,to).all():await c.env.DB.prepare(`SELECT CASE lower(source) WHEN 'meta' THEN 'Meta' WHEN 'facebook' THEN 'Meta' WHEN 'instagram' THEN 'Meta' WHEN 'google' THEN 'Google Ads' WHEN 'google ads' THEN 'Google Ads' WHEN 'google_ads' THEN 'Google Ads' WHEN 'tiktok' THEN 'TikTok' WHEN 'linkedin' THEN 'LinkedIn' WHEN 'chatgpt ads' THEN 'ChatGPT Ads' ELSE source END platform,COALESCE(campaign,'') campaign,COUNT(*) leads,SUM(CASE WHEN status='Masuk WA' THEN 1 ELSE 0 END) whatsapp,SUM(CASE WHEN status='MQL' THEN 1 ELSE 0 END) mql,SUM(CASE WHEN status='Prospek' THEN 1 ELSE 0 END) prospects,SUM(CASE WHEN status='Closing' THEN 1 ELSE 0 END) closing,SUM(CASE WHEN status='Closing' THEN value ELSE 0 END) revenue FROM leads WHERE workspace_id=? AND date(first_seen) BETWEEN ? AND ? GROUP BY platform,campaign ORDER BY leads DESC`).bind(wid,from,to).all();
  const spend=await c.env.DB.prepare("SELECT platform,campaign,SUM(spend) spend FROM ad_costs WHERE workspace_id=? AND spend_date BETWEEN ? AND ? GROUP BY platform,campaign").bind(wid,from,to).all();
  return json(c,{rows:rows.results,spend:spend.results,from,to,mode});
});
app.post("/api/costs",async c=>{
  const b=await c.req.json<any>().catch(()=>({})),spend=Math.round(Number(b.spend));
  if(!platforms.includes(b.platform)||!String(b.campaign??"").trim()||!Number.isFinite(spend)||spend<0||spend>1_000_000_000_000||!/^\d{4}-\d{2}-\d{2}$/.test(b.spend_date??""))return json(c,{error:"Periksa platform, campaign, tanggal, dan biaya."},400);
  await c.env.DB.prepare("INSERT INTO ad_costs(id,workspace_id,platform,campaign,spend,spend_date) VALUES(?,?,?,?,?,?)").bind(id(),c.get("workspaceId"),b.platform,String(b.campaign).trim().slice(0,160),spend,b.spend_date).run();return json(c,{ok:true},201);
});
app.get("/api/events",async c=>{const rows=await c.env.DB.prepare("SELECT id,event_name,page_url,source,medium,campaign,created_at FROM events WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(c.get("workspaceId")).all();return json(c,rows.results);});
app.get("/api/whatsapp/connection",async c=>{
  const row=await c.env.DB.prepare("SELECT phone_number_id,waba_id,api_version FROM wa_connections WHERE workspace_id=?").bind(c.get("workspaceId")).first<any>();
  return json(c,{connected:!!row,connection:row??null,webhook_url:new URL("/webhooks/whatsapp",c.req.url).toString()});
});
app.put("/api/whatsapp/connection",async c=>{
  const b=await c.req.json<any>().catch(()=>({})),phone=String(b.phone_number_id??"").trim(),waba=String(b.waba_id??"").trim(),token=String(b.access_token??""),appSecret=String(b.app_secret??""),verify=String(b.verify_token??""),version=String(b.api_version??"v27.0");
  if(!/^\d{5,30}$/.test(phone)||!/^\d{5,30}$/.test(waba)||token.length<20||token.length>4096||appSecret.length<16||appSecret.length>256||verify.length<16||verify.length>256||!/^v\d+\.\d+$/.test(version)||!c.env.SESSION_SECRET)return json(c,{error:"Lengkapi ID nomor, WABA, token, app secret, verify token (minimal 16 karakter), dan SESSION_SECRET."},400);
  try{
    const wid=c.get("workspaceId"),[tokenCipher,secretCipher,verifyHash]=await Promise.all([encryptSecret(token,c.env.SESSION_SECRET),encryptSecret(appSecret,c.env.SESSION_SECRET),sign(verify,c.env.SESSION_SECRET)]);
    await c.env.DB.prepare("INSERT INTO wa_connections(workspace_id,phone_number_id,waba_id,access_token_cipher,app_secret_cipher,verify_token_hash,api_version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET phone_number_id=excluded.phone_number_id,waba_id=excluded.waba_id,access_token_cipher=excluded.access_token_cipher,app_secret_cipher=excluded.app_secret_cipher,verify_token_hash=excluded.verify_token_hash,api_version=excluded.api_version,updated_at=CURRENT_TIMESTAMP").bind(wid,phone,waba,tokenCipher,secretCipher,verifyHash,version).run();
  }catch(error){console.error("WhatsApp configuration failed",error instanceof Error?error.name:"unknown");return json(c,{error:"Koneksi tidak dapat disimpan. Pastikan ID nomor belum dipakai workspace lain."},400)}
  return json(c,{ok:true});
});
app.get("/api/inbox/conversations",async c=>{
  const status=c.req.query("status")==="closed"?"closed":"open",rows=await c.env.DB.prepare("SELECT c.id,c.wa_id,c.display_name,c.status,c.last_message_at,c.last_read_at,m.body last_body,m.direction last_direction FROM wa_conversations c LEFT JOIN wa_messages m ON m.id=(SELECT id FROM wa_messages WHERE conversation_id=c.id ORDER BY sent_at DESC LIMIT 1) WHERE c.workspace_id=? AND c.status=? ORDER BY c.last_message_at DESC LIMIT 100").bind(c.get("workspaceId"),status).all();
  return json(c,rows.results);
});
app.get("/api/inbox/conversations/:id/messages",async c=>{
  const conversation=await c.env.DB.prepare("SELECT id,wa_id,display_name,status FROM wa_conversations WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).first();
  if(!conversation)return json(c,{error:"Percakapan tidak ditemukan."},404);
  const rows=await c.env.DB.prepare("SELECT id,direction,message_type,body,status,sent_at FROM wa_messages WHERE conversation_id=? ORDER BY sent_at ASC LIMIT 300").bind(c.req.param("id")).all();
  return json(c,{conversation,messages:rows.results});
});
app.patch("/api/inbox/conversations/:id",async c=>{
  const b=await c.req.json<{status?:string}>().catch(()=>({} as {status?:string}));if(!["open","closed"].includes(b.status??""))return json(c,{error:"Status percakapan tidak valid."},400);
  const result=await c.env.DB.prepare("UPDATE wa_conversations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(b.status,c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Percakapan tidak ditemukan."},404);
});
app.post("/api/inbox/conversations/:id/messages",async c=>{
  const b=await c.req.json<{body?:string}>().catch(()=>({} as {body?:string})),body=String(b.body??"").trim();if(!body||body.length>4096)return json(c,{error:"Pesan wajib diisi (maksimal 4096 karakter)."},400);
  const wid=c.get("workspaceId"),conversation=await c.env.DB.prepare("SELECT id,wa_id,phone_number_id FROM wa_conversations WHERE id=? AND workspace_id=? AND status='open'").bind(c.req.param("id"),wid).first<any>(),connection=await c.env.DB.prepare("SELECT access_token_cipher,api_version FROM wa_connections WHERE workspace_id=?").bind(wid).first<any>();
  if(!conversation||!connection)return json(c,{error:"Percakapan terbuka atau koneksi WhatsApp tidak ditemukan."},404);
  try{const token=await decryptSecret(connection.access_token_cipher,c.env.SESSION_SECRET??""),response=await fetch(`https://graph.facebook.com/${connection.api_version}/${conversation.phone_number_id}/messages`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:conversation.wa_id,type:"text",text:{preview_url:false,body}})}),result:any=await response.json();if(!response.ok||!result.messages?.[0]?.id)return json(c,{error:"Meta gagal mengirim pesan. Periksa koneksi atau jendela layanan WhatsApp."},502);
    const messageId=String(result.messages[0].id),now=new Date().toISOString();await c.env.DB.prepare("INSERT INTO wa_messages(id,workspace_id,conversation_id,message_id,direction,message_type,body,status,sent_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id(),wid,conversation.id,messageId,"outbound","text",body,"sent",now).run();await c.env.DB.prepare("UPDATE wa_conversations SET last_message_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(now,conversation.id).run();return json(c,{ok:true},201);
  }catch(error){console.error("WhatsApp send failed",error instanceof Error?error.name:"unknown");return json(c,{error:"Pesan belum terkirim. Periksa koneksi WhatsApp."},502)}
});
app.get("/webhooks/whatsapp",async c=>{
  const mode=c.req.query("hub.mode"),token=c.req.query("hub.verify_token")??"",challenge=c.req.query("hub.challenge")??"";if(mode!=="subscribe"||!token||!challenge||challenge.length>200)return new Response("Forbidden",{status:403});
  const rows=await c.env.DB.prepare("SELECT verify_token_hash FROM wa_connections").all<{verify_token_hash:string}>();if(!c.env.SESSION_SECRET)return new Response("Unavailable",{status:503});const hash=await sign(token,c.env.SESSION_SECRET);return rows.results.some(row=>constantTimeEqual(hash,row.verify_token_hash))?new Response(challenge,{headers:{"Content-Type":"text/plain"}}):new Response("Forbidden",{status:403});
});
app.post("/webhooks/whatsapp",async c=>{
  const raw=await c.req.text();if(new TextEncoder().encode(raw).byteLength>1_000_000)return new Response("Payload too large",{status:413});let payload:any;try{payload=JSON.parse(raw)}catch{return new Response("Bad request",{status:400})}if(payload.object!=="whatsapp_business_account")return new Response("Ignored",{status:404});
  const entries=Array.isArray(payload.entry)?payload.entry:[];for(const entry of entries)for(const change of entry.changes??[]){if(change.field!=="messages")continue;const value=change.value??{},phone=String(value.metadata?.phone_number_id??"");if(!phone)continue;
    const connection=await c.env.DB.prepare("SELECT workspace_id,app_secret_cipher FROM wa_connections WHERE phone_number_id=?").bind(phone).first<any>();if(!connection||!c.env.SESSION_SECRET)continue;
    let secret="";try{secret=await decryptSecret(connection.app_secret_cipher,c.env.SESSION_SECRET)}catch{continue}const supplied=c.req.header("X-Hub-Signature-256")??"",expected=`sha256=${await hmacHex(raw,secret)}`;if(!constantTimeEqual(supplied,expected))return new Response("Invalid signature",{status:401});
    const wid=connection.workspace_id,contacts=new Map<string,string>((value.contacts??[]).map((contact:any)=>[String(contact.wa_id),String(contact.profile?.name??"").slice(0,120)]));
    for(const message of value.messages??[]){const waId=String(message.from??"");if(!waId||!message.id)continue;const msgBody=message.type==="text"?String(message.text?.body??"").slice(0,4096):message.type==="button"?String(message.button?.text??"").slice(0,4096):`[${String(message.type??"media").slice(0,32)}]`,seconds=Number(message.timestamp),now=Number.isFinite(seconds)&&seconds>0&&seconds<=8_640_000_000_000?new Date(seconds*1000).toISOString():new Date().toISOString(),conversationId=id();
      const displayName=contacts.get(waId)||null,contactPhone=waId.startsWith("+")?waId:`+${waId}`;
      let lead=await c.env.DB.prepare("SELECT id FROM leads WHERE workspace_id=? AND (phone=? OR phone=?) ORDER BY first_seen LIMIT 1").bind(wid,waId,contactPhone).first<{id:string}>();
      if(!lead){const leadId=id(),savedLead=await c.env.DB.prepare("INSERT INTO leads(id,workspace_id,visitor_id,name,phone,status,source) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,visitor_id) DO UPDATE SET name=CASE WHEN leads.name='Pengunjung baru' THEN excluded.name ELSE leads.name END,phone=COALESCE(leads.phone,excluded.phone) RETURNING id").bind(leadId,wid,`wa:${waId}`,displayName||waId,contactPhone,"Masuk WA","WhatsApp").first<{id:string}>();lead=savedLead;}
      if(!lead?.id)continue;
      await c.env.DB.prepare("INSERT INTO wa_conversations(id,workspace_id,phone_number_id,wa_id,display_name,lead_id,last_message_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,wa_id) DO UPDATE SET phone_number_id=excluded.phone_number_id,display_name=COALESCE(excluded.display_name,wa_conversations.display_name),lead_id=COALESCE(wa_conversations.lead_id,excluded.lead_id),last_message_at=excluded.last_message_at,updated_at=CURRENT_TIMESTAMP").bind(conversationId,wid,phone,waId,displayName,lead.id,now).run();const conversation=await c.env.DB.prepare("SELECT id,lead_id FROM wa_conversations WHERE workspace_id=? AND wa_id=?").bind(wid,waId).first<{id:string;lead_id:string|null}>();if(!conversation)continue;
      const saved=await c.env.DB.prepare("INSERT OR IGNORE INTO wa_messages(id,workspace_id,conversation_id,message_id,direction,message_type,body,status,sent_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id(),wid,conversation.id,String(message.id).slice(0,200),"inbound",String(message.type??"unknown").slice(0,32),msgBody,"received",now).run();
      if(saved.meta.changes){await c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,source,payload,created_at) VALUES(?,?,?,?,?,?,?)").bind(id(),wid,conversation.lead_id,"Masuk WA","WhatsApp",JSON.stringify({origin:"whatsapp_inbox",message_id:String(message.id).slice(0,200),message_type:String(message.type??"unknown").slice(0,32)}),now).run();}
    }
    for(const status of value.statuses??[])if(status.id)await c.env.DB.prepare("UPDATE wa_messages SET status=? WHERE message_id=? AND workspace_id=? AND direction='outbound'").bind(String(status.status??"sent").slice(0,32),String(status.id).slice(0,200),wid).run();
  }
  return new Response("EVENT_RECEIVED",{status:200});
});
app.get("/api/lead-locations",async c=>{
  const from=c.req.query("from")??new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=c.req.query("to")??new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json(c,{error:"Rentang tanggal tidak valid."},400);
  const wid=c.get("workspaceId"),range="workspace_id=? AND date(created_at) BETWEEN ? AND ?";
  const [totals,regions]=await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(DISTINCT CASE WHEN event_name='Visit LP' THEN visitor_id END) visitors,SUM(CASE WHEN event_name='Visit LP' THEN 1 ELSE 0 END) visits,SUM(CASE WHEN lower(event_name) LIKE '%click cta%' THEN 1 ELSE 0 END) clicks,SUM(CASE WHEN lower(event_name) LIKE '%whatsapp%' OR lower(event_name)='masuk wa' THEN 1 ELSE 0 END) whatsapp,SUM(CASE WHEN event_name='MQL' THEN 1 ELSE 0 END) mql,SUM(CASE WHEN event_name='Prospek' THEN 1 ELSE 0 END) prospects,SUM(CASE WHEN event_name='Closing' THEN 1 ELSE 0 END) closing FROM events WHERE ${range}`).bind(wid,from,to).first(),
    c.env.DB.prepare(`SELECT COALESCE(NULLIF(region,''),NULLIF(city,''),'Tidak diketahui') region,MAX(country) country,SUM(CASE WHEN event_name='Visit LP' THEN 1 ELSE 0 END) visits,SUM(CASE WHEN lower(event_name) LIKE '%click cta%' THEN 1 ELSE 0 END) clicks,SUM(CASE WHEN lower(event_name) LIKE '%whatsapp%' OR lower(event_name)='masuk wa' THEN 1 ELSE 0 END) whatsapp,SUM(CASE WHEN event_name='MQL' THEN 1 ELSE 0 END) mql,SUM(CASE WHEN event_name='Prospek' THEN 1 ELSE 0 END) prospects,SUM(CASE WHEN event_name='Closing' THEN 1 ELSE 0 END) closing FROM events WHERE ${range} GROUP BY region ORDER BY visits DESC LIMIT 50`).bind(wid,from,to).all()
  ]);
  return json(c,{from,to,totals,regions:regions.results});
});

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
  const cf=(c.req.raw as Request & {cf?:{country?:string;region?:string;city?:string}}).cf;
  await c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,page_url,referrer,source,medium,campaign,content,term,visitor_id,payload,country,region,city) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id(),workspace.id,leadId,event,String(b.page_url??"").slice(0,500),String(b.referrer??"").slice(0,500),String(utm.source??"").slice(0,100),String(utm.medium??"").slice(0,100),String(utm.campaign??"").slice(0,200),String(utm.content??"").slice(0,200),String(utm.term??"").slice(0,200),String(b.visitor_id??"").slice(0,80),JSON.stringify(p).slice(0,4000),String(cf?.country??"").slice(0,2)||null,String(cf?.region??"").slice(0,100)||null,String(cf?.city??"").slice(0,100)||null).run();
  return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400"}});
});

app.get("/tracker.js", c => {
  const js = `(function(){var endpoint=${JSON.stringify(new URL(c.req.url).origin)},key=${JSON.stringify(c.req.query("k")??"")},q=new URLSearchParams(location.search),vid=localStorage.getItem('arenka_vid')||crypto.randomUUID();localStorage.setItem('arenka_vid',vid);function send(event,payload){var utm={};['source','medium','campaign','term','content'].forEach(function(k){utm[k]=q.get('utm_'+k)||sessionStorage.getItem('a_utm_'+k)||'';if(q.get('utm_'+k))sessionStorage.setItem('a_utm_'+k,q.get('utm_'+k))});fetch(endpoint+'/t/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:event,payload:payload||{},utm:utm,page_url:location.href,referrer:document.referrer,visitor_id:vid}),keepalive:true}).catch(function(){})}window.arenkaTrack=send;send('Visit LP');document.addEventListener('click',function(e){var a=e.target.closest('a[href^="https://wa.me"],a[href^="https://api.whatsapp.com"],a[data-track]');if(a){var event=a.dataset.track||(a.href.indexOf('wa.me')>=0||a.href.indexOf('api.whatsapp.com')>=0?'Masuk WA':'Click CTA');send(event,{href:a.href,text:(a.innerText||'').slice(0,120)})}},true);})();`;
  return new Response(js,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"public, max-age=300","Access-Control-Allow-Origin":"*"}});
});

app.all("*", async (c,next)=>{
  if(c.req.path.startsWith("/api/")||c.req.path.startsWith("/t/")||c.req.path==="/tracker.js"||c.req.path.startsWith("/webhooks/"))return next();
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

