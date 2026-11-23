import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { pbkdf2 } from "node:crypto";

type Env = { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN?: string; SESSION_SECRET?: string; RESEND_API_KEY?: string; RESET_EMAIL_FROM?: string };
type Variables = { userId: string; workspaceId: string; workspace: { id: string; name: string; public_key: string; currency: string } };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const events = ["Visit LP", "Click CTA", "Masuk WA", "MQL", "Prospek", "Closing", "Isi Form"];
const platforms = ["Meta", "Google Ads", "TikTok", "GA4", "LinkedIn", "ChatGPT Ads"];
const webhookEvents=["lead.created","lead.updated","lead.status_changed","lead.closed","chat.message.created"] as const;
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
async function deliverWebhook(db:D1Database,secret:string,endpoint:any,event:string,data:Record<string,unknown>){const deliveryId=id(),body=JSON.stringify({id:deliveryId,event,created_at:new Date().toISOString(),data}),cipher=await encryptSecret(body,secret);await db.prepare("INSERT INTO webhook_deliveries(id,workspace_id,endpoint_id,event_name,payload_cipher) VALUES(?,?,?,?,?)").bind(deliveryId,endpoint.workspace_id,endpoint.id,event,cipher).run();let status:number|null=null,success=false;try{const signingSecret=await decryptSecret(endpoint.secret_cipher,secret),response=await fetch(endpoint.url,{method:"POST",redirect:"manual",signal:AbortSignal.timeout(8000),headers:{"Content-Type":"application/json","X-Arenka-Event":event,"X-Arenka-Delivery":deliveryId,"X-Arenka-Signature":`sha256=${await hmacHex(body,signingSecret)}`},body});status=response.status;success=response.status>=200&&response.status<300}catch(error){console.warn("Webhook delivery failed",event,error instanceof Error?error.name:"unknown")}await db.prepare("UPDATE webhook_deliveries SET response_status=?,success=?,attempts=1,delivered_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,success?1:0,deliveryId).run()}
function emitWorkspaceEvent(c:any,workspaceId:string,event:string,data:Record<string,unknown>){if(!webhookEvents.includes(event as typeof webhookEvents[number])||!c.env.SESSION_SECRET)return;c.executionCtx.waitUntil((async()=>{try{const rows:any=await c.env.DB.prepare("SELECT id,workspace_id,url,events,secret_cipher FROM webhook_endpoints WHERE workspace_id=? AND active=1").bind(workspaceId).all();await Promise.all(rows.results.filter((endpoint:any)=>{try{return (JSON.parse(endpoint.events) as string[]).includes(event)}catch{return false}}).map((endpoint:any)=>deliverWebhook(c.env.DB,c.env.SESSION_SECRET,endpoint,event,data))) }catch(error){console.error("Webhook dispatch failed",error instanceof Error?error.name:"unknown")}})())}
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
app.get("/api/tracking/status",async c=>{const row=await c.env.DB.prepare("SELECT COUNT(*) total,MAX(created_at) last_event,MAX(CASE WHEN event_name='Visit LP' THEN created_at END) last_visit FROM events WHERE workspace_id=?").bind(c.get("workspaceId")).first<{total:number;last_event:string|null;last_visit:string|null}>();return json(c,{...row,tracker_url:`${new URL(c.req.url).origin}/tracker.js?k=${c.get("workspace").public_key}`})});
const audienceStageNames=["Closing","Prospek","MQL","Isi Form"] as const;
type AudienceStageName=typeof audienceStageNames[number];
function parseAudienceStages(value:string):AudienceStageName[]{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is AudienceStageName=>audienceStageNames.includes(item)):[]}catch{return []}}
async function audienceMembers(db:D1Database,workspaceId:string,stages:AudienceStageName[]){const leadStages=stages.filter((stage):stage is "Closing"|"Prospek"|"MQL"=>stage!=="Isi Form"),conditions:string[]=[],values:(string|number|null)[]=[workspaceId];if(leadStages.length){conditions.push(`l.status IN (${leadStages.map(()=>"?").join(",")})`);values.push(...leadStages)}if(stages.includes("Isi Form"))conditions.push("EXISTS (SELECT 1 FROM events e WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id AND e.event_name='Isi Form')");if(!conditions.length)return [];const rows=await db.prepare(`SELECT DISTINCT l.id,l.email,l.phone FROM leads l WHERE l.workspace_id=? AND (${conditions.join(" OR ")}) AND (COALESCE(trim(l.email),'')<>'' OR COALESCE(trim(l.phone),'')<>'') ORDER BY l.id LIMIT 100000`).bind(...values).all<{id:string;email:string|null;phone:string|null}>();return rows.results}
async function sha256Hex(value:string){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("")}
function normalizeAudiencePhone(value:string){const digits=value.replace(/\D/g,"");if(!digits)return "";if(value.trim().startsWith("+"))return digits;if(digits.startsWith("00"))return digits.slice(2);if(digits.startsWith("0"))return `62${digits.slice(1)}`;if(digits.startsWith("8"))return `62${digits}`;return digits}
app.get("/api/audiences",async c=>{const wid=c.get("workspaceId"),rows=await c.env.DB.prepare("SELECT id,platform,name,criteria,sync_status,last_export_at,created_at,updated_at FROM custom_audiences WHERE workspace_id=? ORDER BY updated_at DESC,created_at DESC LIMIT 100").bind(wid).all<any>();const audiences=await Promise.all(rows.results.map(async(row:any)=>{const stages=parseAudienceStages(String(row.criteria??"")),members=await audienceMembers(c.env.DB,wid,stages);return {...row,stages,people_count:members.length}}));return json(c,audiences)});
app.post("/api/audiences",async c=>{const body=await c.req.json<Record<string,unknown>>().catch(()=>({} as Record<string,unknown>)),platforms=Array.isArray(body.platforms)?Array.from(new Set(body.platforms.map(String))):[],stages=Array.isArray(body.stages)?Array.from(new Set(body.stages.map(String))).filter((stage):stage is AudienceStageName=>audienceStageNames.includes(stage as AudienceStageName)):[];if(!platforms.length||platforms.some(platform=>!(["meta","google"] as string[]).includes(platform)))return json(c,{error:"Pilih Meta, Google Ads, atau keduanya."},400);if(!stages.length||stages.length!==(Array.isArray(body.stages)?new Set(body.stages.map(String).filter(stage=>audienceStageNames.includes(stage as AudienceStageName))).size:0))return json(c,{error:"Pilih setidaknya satu tahap lead yang valid."},400);if(body.consent!==true)return json(c,{error:"Persetujuan pemilik workspace wajib dicentang."},400);const orderedStages=audienceStageNames.filter(stage=>stages.includes(stage)),criteria=JSON.stringify(orderedStages),names:Record<AudienceStageName,string>={Closing:"Closing · Lookalike pembeli",Prospek:"Prospek · Retargeting",MQL:"MQL", "Isi Form":"Isi Form"},name=orderedStages.length===1?names[orderedStages[0]]:orderedStages.join(" + "),wid=c.get("workspaceId"),created:string[]=[];for(const platform of platforms){await c.env.DB.prepare("INSERT INTO custom_audiences(id,workspace_id,platform,name,criteria,consent_at,sync_status) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,'not_connected') ON CONFLICT(workspace_id,platform,criteria) DO UPDATE SET consent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").bind(id(),wid,platform,name,criteria).run();const row=await c.env.DB.prepare("SELECT id FROM custom_audiences WHERE workspace_id=? AND platform=? AND criteria=?").bind(wid,platform,criteria).first<{id:string}>();if(row)created.push(row.id)}return json(c,{ids:created},201)});
app.post("/api/audiences/:id/export",async c=>{const wid=c.get("workspaceId"),audience=await c.env.DB.prepare("SELECT id,criteria,platform FROM custom_audiences WHERE id=? AND workspace_id=?").bind(c.req.param("id"),wid).first<{id:string;criteria:string;platform:string}>();if(!audience)return json(c,{error:"Audiens tidak ditemukan."},404);const stages=parseAudienceStages(audience.criteria),members=await audienceMembers(c.env.DB,wid,stages),contacts=new Map<string,{email_hash:string;phone_hash:string}>();for(const member of members){const email=String(member.email??"").trim().toLowerCase(),phone=normalizeAudiencePhone(String(member.phone??"")),emailHash=email?await sha256Hex(email):"",phoneHash=phone?await sha256Hex(phone):"";if(!emailHash&&!phoneHash)continue;const key=`${emailHash}|${phoneHash}`;contacts.set(key,{email_hash:emailHash,phone_hash:phoneHash})}await c.env.DB.prepare("UPDATE custom_audiences SET last_export_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(audience.id,wid).run();return json(c,{contacts:Array.from(contacts.values()),count:contacts.size,platform:audience.platform})});
app.delete("/api/audiences/:id",async c=>{const result=await c.env.DB.prepare("DELETE FROM custom_audiences WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Audiens tidak ditemukan."},404)});
const adResearchCountries = new Set(["ID","MY","SG","PH","TH","VN","US","GB","AU","ALL"]);
function cleanPageRef(input:unknown){const value=String(input??"").trim();if(!value)return null;if(/^\d{5,25}$/.test(value))return value;let url:URL;try{url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`)}catch{return "invalid"}if(url.protocol!=="https:"||!(url.hostname==="facebook.com"||url.hostname.endsWith(".facebook.com"))||url.username||url.password)return "invalid";return `${url.origin}${url.pathname}${url.search}`.slice(0,300)}
function cleanAdUrl(input:unknown){const value=String(input??"").trim();if(!value)return null;try{const url=new URL(value);if(url.protocol!=="https:"||!(url.hostname==="facebook.com"||url.hostname.endsWith(".facebook.com"))||url.username||url.password)return "invalid";return url.toString().slice(0,1000)}catch{return "invalid"}}
function validWebhookUrl(input:unknown){try{const url=new URL(String(input??""));if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname.length>253||/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname)||/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)||url.hostname.startsWith("["))return null;return url.toString()}catch{return null}}
app.get("/api/webhooks",async c=>{const wid=c.get("workspaceId"),[outbound,inbound,deliveries]=await Promise.all([c.env.DB.prepare("SELECT id,name,url,events,active,created_at,updated_at FROM webhook_endpoints WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(wid).all<any>(),c.env.DB.prepare("SELECT id,name,active,created_at FROM inbound_webhooks WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(wid).all<any>(),c.env.DB.prepare("SELECT d.id,d.endpoint_id,e.name endpoint_name,d.event_name,d.response_status,d.success,d.attempts,d.created_at,d.delivered_at FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id AND e.workspace_id=d.workspace_id WHERE d.workspace_id=? ORDER BY d.created_at DESC LIMIT 100").bind(wid).all()]);return json(c,{events:webhookEvents,outbound:outbound.results.map((row:any)=>({...row,events:JSON.parse(row.events)})),inbound:inbound.results,deliveries:deliveries.results})});
app.post("/api/webhooks/outbound",async c=>{const body=await c.req.json<any>().catch(()=>({})),name=String(body.name??"").trim(),url=validWebhookUrl(body.url),selected=Array.isArray(body.events)?Array.from(new Set(body.events.filter((event:unknown)=>webhookEvents.includes(event as typeof webhookEvents[number])))):[];if(!name||name.length>100||!url||!selected.length||body.consent!==true||!c.env.SESSION_SECRET)return json(c,{error:"Lengkapi nama, URL HTTPS publik, event, persetujuan pengiriman data, dan SESSION_SECRET."},400);const endpointId=id(),secret=encode(crypto.getRandomValues(new Uint8Array(32))),cipher=await encryptSecret(secret,c.env.SESSION_SECRET);await c.env.DB.prepare("INSERT INTO webhook_endpoints(id,workspace_id,name,url,events,secret_cipher,consent_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(endpointId,c.get("workspaceId"),name,url,JSON.stringify(selected),cipher).run();return json(c,{id:endpointId,signing_secret:secret},201)});
app.patch("/api/webhooks/outbound/:id",async c=>{const body=await c.req.json<{active?:boolean}>().catch(()=>({} as {active?:boolean}));if(typeof body.active!=="boolean")return json(c,{error:"Status endpoint tidak valid."},400);const result=await c.env.DB.prepare("UPDATE webhook_endpoints SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(body.active?1:0,c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Endpoint tidak ditemukan."},404)});
app.delete("/api/webhooks/outbound/:id",async c=>{const result=await c.env.DB.prepare("DELETE FROM webhook_endpoints WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Endpoint tidak ditemukan."},404)});
app.post("/api/webhooks/outbound/:id/test",async c=>{const endpoint=await c.env.DB.prepare("SELECT id,workspace_id,url,secret_cipher FROM webhook_endpoints WHERE id=? AND workspace_id=? AND active=1").bind(c.req.param("id"),c.get("workspaceId")).first<any>();if(!endpoint)return json(c,{error:"Endpoint aktif tidak ditemukan."},404);if(!c.env.SESSION_SECRET)return json(c,{error:"Signing secret tidak tersedia."},503);await deliverWebhook(c.env.DB,c.env.SESSION_SECRET,endpoint,"webhook.test",{message:"Tes webhook Arenka berhasil."});const delivery=await c.env.DB.prepare("SELECT response_status,success FROM webhook_deliveries WHERE endpoint_id=? ORDER BY created_at DESC LIMIT 1").bind(endpoint.id).first<any>();return json(c,{ok:Boolean(delivery?.success),status:delivery?.response_status??null})});
app.post("/api/webhooks/inbound",async c=>{const body=await c.req.json<any>().catch(()=>({})),name=String(body.name??"").trim();if(!name||name.length>100)return json(c,{error:"Nama webhook wajib diisi (maksimal 100 karakter)."},400);const token=encode(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await sha256Hex(token),webhookId=id();await c.env.DB.prepare("INSERT INTO inbound_webhooks(id,workspace_id,name,token_hash) VALUES(?,?,?,?)").bind(webhookId,c.get("workspaceId"),name,tokenHash).run();return json(c,{id:webhookId,token,url:`${new URL(c.req.url).origin}/webhooks/inbound/${webhookId}`},201)});
app.patch("/api/webhooks/inbound/:id",async c=>{const body=await c.req.json<{active?:boolean}>().catch(()=>({} as {active?:boolean}));if(typeof body.active!=="boolean")return json(c,{error:"Status endpoint tidak valid."},400);const result=await c.env.DB.prepare("UPDATE inbound_webhooks SET active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(body.active?1:0,c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Webhook masuk tidak ditemukan."},404)});
app.delete("/api/webhooks/inbound/:id",async c=>{const result=await c.env.DB.prepare("DELETE FROM inbound_webhooks WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Webhook masuk tidak ditemukan."},404)});
app.post("/api/webhooks/outbound/deliveries/:id/retry",async c=>{const delivery=await c.env.DB.prepare("SELECT d.id,d.event_name,d.payload_cipher,e.id endpoint_id,e.workspace_id,e.url,e.secret_cipher,e.active FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id AND e.workspace_id=d.workspace_id WHERE d.id=? AND d.workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).first<any>();if(!delivery||!delivery.active)return json(c,{error:"Endpoint aktif atau pengiriman tidak ditemukan."},404);if(!c.env.SESSION_SECRET)return json(c,{error:"Signing secret tidak tersedia."},503);try{const payload=JSON.parse(await decryptSecret(delivery.payload_cipher,c.env.SESSION_SECRET));await deliverWebhook(c.env.DB,c.env.SESSION_SECRET,delivery,delivery.event_name,payload.data??{});return json(c,{ok:true})}catch{return json(c,{error:"Pengiriman ulang gagal."},502)}});
app.post("/webhooks/inbound/:id",async c=>{const raw=await c.req.text();if(new TextEncoder().encode(raw).byteLength>16384)return json(c,{error:"Payload terlalu besar."},413);let body:any;try{body=JSON.parse(raw)}catch{return json(c,{error:"Payload harus JSON."},400)}const hook=await c.env.DB.prepare("SELECT id,workspace_id,token_hash FROM inbound_webhooks WHERE id=? AND active=1").bind(c.req.param("id")).first<any>(),supplied=(c.req.header("Authorization")??"").replace(/^Bearer\s+/i,"");if(!hook||!supplied||!constantTimeEqual(await sha256Hex(supplied),hook.token_hash))return json(c,{error:"Webhook tidak ditemukan atau token tidak valid."},401);const bucket=Math.floor(Date.now()/60000);await c.env.DB.prepare("INSERT INTO inbound_webhook_limits(webhook_id,window_bucket,request_count) VALUES(?,?,1) ON CONFLICT(webhook_id) DO UPDATE SET request_count=CASE WHEN inbound_webhook_limits.window_bucket=excluded.window_bucket THEN inbound_webhook_limits.request_count+1 ELSE 1 END,window_bucket=excluded.window_bucket").bind(hook.id,bucket).run();const rate=await c.env.DB.prepare("SELECT request_count FROM inbound_webhook_limits WHERE webhook_id=?").bind(hook.id).first<{request_count:number}>();if(Number(rate?.request_count??0)>60)return json(c,{error:"Batas 60 permintaan per menit tercapai."},429);const name=String(body.name??"").trim(),email=String(body.email??"").trim().slice(0,160),phone=String(body.phone??"").trim().slice(0,40);if(!name||name.length>120||(!email&&!phone)||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(c,{error:"Nama wajib diisi serta email valid atau nomor WhatsApp."},400);const externalId=String(c.req.header("Idempotency-Key")??body.event_id??id()).slice(0,160),existing=await c.env.DB.prepare("SELECT lead_id FROM inbound_webhook_requests WHERE webhook_id=? AND external_id=?").bind(hook.id,externalId).first<{lead_id:string}>();if(existing)return json(c,{id:existing.lead_id,duplicate:true});const leadId=id(),source=String(body.source??"Webhook").trim().slice(0,80)||"Webhook",campaign=String(body.campaign??"").trim().slice(0,160)||null,value=Math.max(0,Math.round(Number(body.value)||0)),status=["Masuk WA","MQL","Prospek","Closing"].includes(body.status)?body.status:"Masuk WA";await c.env.DB.batch([c.env.DB.prepare("INSERT INTO leads(id,workspace_id,name,email,phone,status,value,source,campaign,landing_page) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(leadId,hook.workspace_id,name,email||null,phone||null,status,value,source,campaign,String(body.landing_page??"").slice(0,500)||null),c.env.DB.prepare("INSERT INTO inbound_webhook_requests(id,webhook_id,external_id,lead_id) VALUES(?,?,?,?)").bind(id(),hook.id,externalId,leadId),c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,source,campaign,payload) VALUES(?,?,?,'lead.created',?,?,?)").bind(id(),hook.workspace_id,leadId,source,campaign,JSON.stringify({origin:"inbound_webhook"}))]);emitWorkspaceEvent(c,hook.workspace_id,"lead.created",{id:leadId,name,email:email||null,phone:phone||null,status,source,campaign,value});return json(c,{id:leadId,ok:true},201)});
app.get("/api/sources",async c=>{const wid=c.get("workspaceId"),filter=c.req.query("filter"),connection=await c.env.DB.prepare("SELECT provider,last_sync_at,created_at,updated_at FROM store_connections WHERE workspace_id=? AND provider='mayar'").bind(wid).first<any>(),summary=await c.env.DB.prepare("SELECT COUNT(*) orders,COUNT(lead_id) matched,COALESCE(SUM(CASE WHEN lead_id IS NOT NULL THEN amount ELSE 0 END),0) revenue FROM source_orders WHERE workspace_id=? AND status='paid'").bind(wid).first<any>(),orders=await c.env.DB.prepare(`SELECT o.id,o.provider,o.order_ref,o.customer_name,o.customer_email,o.customer_phone,o.product_name,o.amount,o.status,o.paid_at,o.lead_id,l.name lead_name FROM source_orders o LEFT JOIN leads l ON l.id=o.lead_id AND l.workspace_id=o.workspace_id WHERE o.workspace_id=? ${filter==="matched"?"AND o.lead_id IS NOT NULL":filter==="unmatched"?"AND o.lead_id IS NULL":""} ORDER BY o.paid_at DESC LIMIT 200`).bind(wid).all();return json(c,{connections:connection?[{...connection,provider:"mayar"}]:[],summary:{orders:Number(summary?.orders??0),matched:Number(summary?.matched??0),unmatched:Number(summary?.orders??0)-Number(summary?.matched??0),revenue:Number(summary?.revenue??0)},orders:orders.results})});
app.put("/api/sources/mayar",async c=>{const body=await c.req.json<{api_key?:string;consent?:string|boolean}>().catch(()=>({} as {api_key?:string;consent?:string|boolean})),apiKey=String(body.api_key??"").trim();if(apiKey.length<16||apiKey.length>500||!(body.consent===true||body.consent==="true")||!c.env.SESSION_SECRET)return json(c,{error:"Masukkan API key Mayar dan setujui penggunaan data order. SESSION_SECRET juga harus dikonfigurasi."},400);try{const response=await fetch("https://api.mayar.id/hl/v2/transactions?limit=1",{headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"}});if(!response.ok)return json(c,{error:response.status===401?"API key Mayar tidak valid.":response.status===429?"Batas permintaan Mayar tercapai. Coba lagi sebentar.":"Mayar belum dapat memvalidasi API key ini."},502);const result:any=await response.json();if(!Array.isArray(result.data))return json(c,{error:"Respons transaksi Mayar tidak dikenali."},502);const cipher=await encryptSecret(apiKey,c.env.SESSION_SECRET);await c.env.DB.prepare("INSERT INTO store_connections(workspace_id,provider,api_key_cipher,consent_at) VALUES(?,'mayar',?,CURRENT_TIMESTAMP) ON CONFLICT(workspace_id,provider) DO UPDATE SET api_key_cipher=excluded.api_key_cipher,consent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").bind(c.get("workspaceId"),cipher).run();return json(c,{ok:true})}catch(error){console.error("Mayar connection failed",error instanceof Error?error.name:"unknown");return json(c,{error:"Mayar tidak dapat dijangkau atau koneksi belum bisa disimpan."},502)}});
app.delete("/api/sources/mayar",async c=>{await c.env.DB.prepare("DELETE FROM store_connections WHERE workspace_id=? AND provider='mayar'").bind(c.get("workspaceId")).run();return json(c,{ok:true})});
app.post("/api/sources/mayar/sync",async c=>{const wid=c.get("workspaceId"),connection=await c.env.DB.prepare("SELECT api_key_cipher,last_cursor FROM store_connections WHERE workspace_id=? AND provider='mayar'").bind(wid).first<any>();if(!connection)return json(c,{error:"Hubungkan Mayar terlebih dahulu."},409);if(!c.env.SESSION_SECRET)return json(c,{error:"Enkripsi koneksi belum tersedia."},503);try{const apiKey=await decryptSecret(connection.api_key_cipher,c.env.SESSION_SECRET),params=new URLSearchParams({limit:"100"});if(connection.last_cursor)params.set("startingAfter",connection.last_cursor);const response=await fetch(`https://api.mayar.id/hl/v2/transactions?${params}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"}});if(!response.ok)return json(c,{error:response.status===401?"API key Mayar telah dicabut. Hubungkan ulang Mayar.":response.status===429?"Batas permintaan Mayar tercapai. Coba lagi sebentar.":"Transaksi Mayar gagal dimuat."},502);const result:any=await response.json();if(!Array.isArray(result.data))return json(c,{error:"Respons transaksi Mayar tidak dikenali."},502);const leads=await c.env.DB.prepare("SELECT id,name,email,phone FROM leads WHERE workspace_id=? LIMIT 20000").bind(wid).all<any>(),byEmail=new Map<string,any>(),byPhone=new Map<string,any>();for(const lead of leads.results){if(lead.email)byEmail.set(String(lead.email).trim().toLowerCase(),lead);if(lead.phone){const normalized=normalizeAudiencePhone(String(lead.phone));if(normalized)byPhone.set(normalized,lead)}}let imported=0,matched=0;for(const tx of result.data){if(!["settled","paid"].includes(String(tx.status??"").toLowerCase()))continue;const customer=tx.customer??{},email=String(customer.email??"").trim().toLowerCase(),phone=normalizeAudiencePhone(String(customer.mobile??customer.phone??"")),lead=(email&&byEmail.get(email))||(phone&&byPhone.get(phone))||null,orderRef=String(tx.transactionId??tx.paymentLinkTransactionId??tx.id??"").slice(0,160);if(!orderRef)continue;const amount=Math.max(0,Math.round(Number(tx.credit??tx.amount??0)||0)),paidAt=new Date(Number(tx.createdAt)||Date.now()).toISOString(),insert=await c.env.DB.prepare("INSERT INTO source_orders(id,workspace_id,provider,order_ref,customer_name,customer_email,customer_phone,product_name,amount,status,paid_at) VALUES(?,?,'mayar',?,?,?,?,?,?,'paid',?) ON CONFLICT(workspace_id,provider,order_ref) DO NOTHING").bind(id(),wid,orderRef,String(customer.name??"").slice(0,160)||null,email.slice(0,160)||null,String(customer.mobile??customer.phone??"").slice(0,40)||null,String(tx.paymentLink?.name??"").slice(0,200)||null,amount,paidAt).run();imported+=insert.meta.changes?1:0;if(lead){const attached=await c.env.DB.prepare("UPDATE source_orders SET lead_id=? WHERE workspace_id=? AND provider='mayar' AND order_ref=? AND lead_id IS NULL").bind(lead.id,wid,orderRef).run();if(attached.meta.changes){await c.env.DB.batch([c.env.DB.prepare("UPDATE leads SET status='Closing',value=value+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(amount,lead.id,wid),c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,source,campaign,payload) VALUES(?,?,?,'Closing','Mayar',?,?)").bind(id(),wid,lead.id,String(tx.paymentLink?.name??"").slice(0,160)||null,JSON.stringify({order_ref:orderRef,amount}))]);emitWorkspaceEvent(c,wid,"lead.status_changed",{id:lead.id,status:"Closing",source:"Mayar",campaign:String(tx.paymentLink?.name??"").slice(0,160)||null,value:amount});emitWorkspaceEvent(c,wid,"lead.closed",{id:lead.id,status:"Closing",source:"Mayar",campaign:String(tx.paymentLink?.name??"").slice(0,160)||null,value:amount});matched++}}}const cursor=String(result.nextStartingAfter??"");await c.env.DB.prepare("UPDATE store_connections SET last_cursor=?,last_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND provider='mayar'").bind(cursor||null,wid).run();return json(c,{imported,matched,has_more:Boolean(result.hasMore&&cursor)})}catch(error){console.error("Mayar sync failed",error instanceof Error?error.name:"unknown");return json(c,{error:"Sinkronisasi gagal. Periksa koneksi lalu coba lagi."},502)}});
app.get("/api/ad-research/competitors",async c=>{const q=`%${(c.req.query("q")??"").slice(0,80)}%`,rows=await c.env.DB.prepare("SELECT id,name,page_ref,search_terms,country,note,created_at FROM ad_research_competitors WHERE workspace_id=? AND (name LIKE ? OR COALESCE(page_ref,'') LIKE ? OR COALESCE(search_terms,'') LIKE ? OR COALESCE(note,'') LIKE ?) ORDER BY created_at DESC LIMIT 100").bind(c.get("workspaceId"),q,q,q,q).all();return json(c,rows.results)});
app.post("/api/ad-research/competitors",async c=>{const b=await c.req.json<Record<string,unknown>>().catch(()=>({} as Record<string,unknown>)),name=String(b.name??"").trim(),pageRef=cleanPageRef(b.page_ref),terms=String(b.search_terms??"").trim(),country=String(b.country??"ID"),note=String(b.note??"").trim();if(!name||name.length>100)return json(c,{error:"Nama kompetitor wajib diisi (maksimal 100 karakter)."},400);if(pageRef==="invalid")return json(c,{error:"Masukkan ID Page atau tautan Facebook yang valid."},400);if(!adResearchCountries.has(country))return json(c,{error:"Negara Meta Ad Library tidak valid."},400);const competitorId=id();await c.env.DB.prepare("INSERT INTO ad_research_competitors(id,workspace_id,name,page_ref,search_terms,country,note) VALUES(?,?,?,?,?,?,?)").bind(competitorId,c.get("workspaceId"),name,pageRef,terms.slice(0,160)||null,country,note.slice(0,500)||null).run();return json(c,{id:competitorId},201)});
app.delete("/api/ad-research/competitors/:id",async c=>{const result=await c.env.DB.prepare("DELETE FROM ad_research_competitors WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Kompetitor tidak ditemukan."},404)});
app.get("/api/ad-research/swipe",async c=>{const q=`%${(c.req.query("q")??"").slice(0,80)}%`,format=c.req.query("format"),competitor=c.req.query("competitor"),validFormat=["Video","Gambar","Carousel","Lainnya"].includes(format??"");const rows=await c.env.DB.prepare(`SELECT a.id,a.title,a.ad_url,a.competitor_id,c.name competitor_name,a.format,a.body,a.note,a.tags,a.first_seen_date,a.created_at FROM ad_research_swipe_ads a LEFT JOIN ad_research_competitors c ON c.id=a.competitor_id AND c.workspace_id=a.workspace_id WHERE a.workspace_id=? AND (a.title LIKE ? OR COALESCE(a.body,'') LIKE ? OR COALESCE(a.note,'') LIKE ? OR COALESCE(a.tags,'') LIKE ? OR COALESCE(c.name,'') LIKE ?) ${validFormat?"AND a.format=?":""} ${competitor?"AND a.competitor_id=?":""} ORDER BY COALESCE(a.first_seen_date,'') DESC,a.created_at DESC LIMIT 100`).bind(...[c.get("workspaceId"),q,q,q,q,q,...(validFormat?[format]:[]),...(competitor?[competitor]:[])]).all();return json(c,rows.results)});
app.post("/api/ad-research/swipe",async c=>{const b=await c.req.json<Record<string,unknown>>().catch(()=>({} as Record<string,unknown>)),title=String(b.title??"").trim(),adUrl=cleanAdUrl(b.ad_url),format=String(b.format??"Video"),competitorId=String(b.competitor_id??"")||null,dateValue=String(b.first_seen_date??"");if(!title||title.length>160)return json(c,{error:"Judul iklan wajib diisi (maksimal 160 karakter)."},400);if(adUrl==="invalid")return json(c,{error:"Tautan iklan harus berupa URL HTTPS Facebook yang valid."},400);if(!["Video","Gambar","Carousel","Lainnya"].includes(format))return json(c,{error:"Format iklan tidak valid."},400);if(dateValue&&!/^\d{4}-\d{2}-\d{2}$/.test(dateValue))return json(c,{error:"Tanggal mulai tayang tidak valid."},400);const wid=c.get("workspaceId");if(competitorId&&!await c.env.DB.prepare("SELECT id FROM ad_research_competitors WHERE id=? AND workspace_id=?").bind(competitorId,wid).first())return json(c,{error:"Kompetitor tidak ditemukan di workspace ini."},400);const tags=String(b.tags??"").split(",").map(v=>v.trim().slice(0,40)).filter(Boolean).slice(0,10).join(",");const adId=id();await c.env.DB.prepare("INSERT INTO ad_research_swipe_ads(id,workspace_id,title,ad_url,competitor_id,format,body,note,tags,first_seen_date) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(adId,wid,title,adUrl,competitorId,format,String(b.body??"").trim().slice(0,4000)||null,String(b.note??"").trim().slice(0,1000)||null,tags,dateValue||null).run();return json(c,{id:adId},201)});
app.patch("/api/ad-research/swipe/:id",async c=>{const b=await c.req.json<Record<string,unknown>>().catch(()=>({} as Record<string,unknown>)),title=String(b.title??"").trim(),adUrl=cleanAdUrl(b.ad_url),format=String(b.format??"Video"),competitorId=String(b.competitor_id??"")||null,dateValue=String(b.first_seen_date??"");if(!title||title.length>160)return json(c,{error:"Judul iklan wajib diisi (maksimal 160 karakter)."},400);if(adUrl==="invalid")return json(c,{error:"Tautan iklan harus berupa URL HTTPS Facebook yang valid."},400);if(!["Video","Gambar","Carousel","Lainnya"].includes(format))return json(c,{error:"Format iklan tidak valid."},400);if(dateValue&&!/^\d{4}-\d{2}-\d{2}$/.test(dateValue))return json(c,{error:"Tanggal mulai tayang tidak valid."},400);const wid=c.get("workspaceId");if(competitorId&&!await c.env.DB.prepare("SELECT id FROM ad_research_competitors WHERE id=? AND workspace_id=?").bind(competitorId,wid).first())return json(c,{error:"Kompetitor tidak ditemukan di workspace ini."},400);const tags=String(b.tags??"").split(",").map(v=>v.trim().slice(0,40)).filter(Boolean).slice(0,10).join(","),result=await c.env.DB.prepare("UPDATE ad_research_swipe_ads SET title=?,ad_url=?,competitor_id=?,format=?,body=?,note=?,tags=?,first_seen_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(title,adUrl,competitorId,format,String(b.body??"").trim().slice(0,4000)||null,String(b.note??"").trim().slice(0,1000)||null,tags,dateValue||null,c.req.param("id"),wid).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Iklan tidak ditemukan."},404)});
app.delete("/api/ad-research/swipe/:id",async c=>{const result=await c.env.DB.prepare("DELETE FROM ad_research_swipe_ads WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).run();return result.meta.changes?json(c,{ok:true}):json(c,{error:"Iklan tidak ditemukan."},404)});
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
  emitWorkspaceEvent(c,wid,"lead.created",{id:leadId,name:String(b.name).trim().slice(0,120),phone:String(b.phone??"").slice(0,40)||null,email:String(b.email??"").slice(0,160)||null,status,value:Math.max(0,Number(b.value)||0),source,campaign});
  if(status==="Closing")emitWorkspaceEvent(c,wid,"lead.closed",{id:leadId,status,value:Math.max(0,Number(b.value)||0),source,campaign});
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
  const current=await c.env.DB.prepare("SELECT name,email,phone,status,value,source,campaign,landing_page FROM leads WHERE id=? AND workspace_id=?").bind(c.req.param("id"),c.get("workspaceId")).first<{name:string;email:string|null;phone:string|null;status:string;value:number;source:string;campaign:string|null;landing_page:string|null}>();
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
  if(result.meta.changes){const data={id:c.req.param("id"),name:current.name,email:current.email,phone:current.phone,status:b.status??current.status,value:b.value===undefined?current.value:Number(b.value)||0,source:current.source,campaign:current.campaign};emitWorkspaceEvent(c,c.get("workspaceId"),"lead.updated",data);if(b.status!==undefined&&b.status!==current.status){emitWorkspaceEvent(c,c.get("workspaceId"),"lead.status_changed",{...data,previous_status:current.status});if(b.status==="Closing")emitWorkspaceEvent(c,c.get("workspaceId"),"lead.closed",data)}}
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
      if(saved.meta.changes){await c.env.DB.prepare("INSERT INTO events(id,workspace_id,lead_id,event_name,source,payload,created_at) VALUES(?,?,?,?,?,?,?)").bind(id(),wid,conversation.lead_id,"Masuk WA","WhatsApp",JSON.stringify({origin:"whatsapp_inbox",message_id:String(message.id).slice(0,200),message_type:String(message.type??"unknown").slice(0,32)}),now).run();emitWorkspaceEvent(c,wid,"chat.message.created",{lead_id:conversation.lead_id,phone:contactPhone,display_name:displayName,message_type:String(message.type??"unknown").slice(0,32),body:msgBody,created_at:now})}
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
  const js = `(function(){var endpoint=${JSON.stringify(new URL(c.req.url).origin)},key=${JSON.stringify(c.req.query("k")??"")},consentKey='arenka_consent_v1',q=new URLSearchParams(location.search),vid=null,queued=[];function send(event,payload){if(localStorage.getItem(consentKey)!=='granted'){queued.push([event,payload||{}]);return false}vid=vid||localStorage.getItem('arenka_vid')||crypto.randomUUID();localStorage.setItem('arenka_vid',vid);var utm={};['source','medium','campaign','term','content'].forEach(function(k){utm[k]=q.get('utm_'+k)||sessionStorage.getItem('a_utm_'+k)||'';if(q.get('utm_'+k))sessionStorage.setItem('a_utm_'+k,q.get('utm_'+k))});fetch(endpoint+'/t/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:event,payload:payload||{},utm:utm,page_url:location.href,referrer:document.referrer,visitor_id:vid}),keepalive:true}).catch(function(){});return true}function show(){if(!banner.isConnected)document.body.appendChild(banner)}function grant(){localStorage.setItem(consentKey,'granted');banner.remove();send('Visit LP');queued.splice(0).forEach(function(item){send(item[0],item[1])})}function reject(){localStorage.setItem(consentKey,'denied');queued=[];banner.remove()}window.arenkaTrack=send;window.arenkaConsent={grant:grant,reject:reject,show:show};var banner=document.createElement('aside');banner.setAttribute('role','dialog');banner.setAttribute('aria-label','Pilihan privasi tracking');banner.style.cssText='position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:560px;margin:auto;padding:18px;border:1px solid #dce6df;border-radius:10px;background:#fff;color:#203b35;box-shadow:0 12px 36px #10261f30;font:14px/1.55 system-ui,sans-serif';banner.innerHTML='<strong style="display:block;margin-bottom:5px">Pilihan privasi</strong><span style="display:block;color:#65756e;font-size:13px">Izinkan Arenka mengukur kunjungan dan interaksi untuk memahami performa campaign. Pilihan dapat diubah dengan membuka kembali pengaturan privasi situs.</span><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:13px"><button type="button" data-consent="reject" style="padding:8px 12px;border:1px solid #dce6df;border-radius:6px;background:white;color:#31443d;cursor:pointer">Tolak</button><button type="button" data-consent="grant" style="padding:8px 12px;border:1px solid #205c54;border-radius:6px;background:#205c54;color:white;cursor:pointer">Izinkan tracking</button></div>';banner.addEventListener('click',function(e){var action=e.target.closest('[data-consent]');if(action?.dataset.consent==='grant')grant();if(action?.dataset.consent==='reject')reject()});if(localStorage.getItem(consentKey)==='granted')send('Visit LP');else if(localStorage.getItem(consentKey)!=='denied'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show()}document.addEventListener('click',function(e){var a=e.target.closest('a[href^="https://wa.me"],a[href^="https://api.whatsapp.com"],a[data-track]');if(a){var event=a.dataset.track||(a.href.indexOf('wa.me')>=0||a.href.indexOf('api.whatsapp.com')>=0?'Masuk WA':'Click CTA');send(event,{href:a.href,text:(a.innerText||'').slice(0,120)})}},true)})();`;
  return new Response(js,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"public, max-age=300","Access-Control-Allow-Origin":"*"}});
});

app.all("*", async (c,next)=>{
  if(c.req.path.startsWith("/api/")||c.req.path.startsWith("/t/")||c.req.path==="/tracker.js"||c.req.path.startsWith("/webhooks/"))return next();
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
