import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { kinds, recordData, text, publicHttps, instanceId, type Kind } from './validation.ts';
import { composeReply } from '../../shared/cspoint/compose-reply.mjs';
import { buildAiMessages } from '../../shared/cspoint/prompt.mjs';
import { rankKnowledge } from '../../shared/cspoint/knowledge.mjs';
import { parseTariffText, resolveShipping } from '../../shared/cspoint/shipping.mjs';

type Bindings = {DB: D1Database; SESSION_SECRET?: string; AUTH_RATE: RateLimit};
type Variables = {workspaceId: string; userId: string};
type C = Context<{Bindings: Bindings; Variables: Variables}>;
type Settings = {router_url: string; model: string; api_key_cipher: string; gateway_url: string; gateway_token_cipher: string};
type Row = {id: string; name: string; data: string; created_at: string; updated_at: string};
type ThreadItem = {id: string; text: string; outgoing: boolean; source?: string};
type Cipher = {encrypt: (value:string,secret:string)=>Promise<string>; decrypt:(value:string,secret:string)=>Promise<string>};
type QrLeadInput = {name:string;phone:string;ctwa_clid:string|null};
const defaults: Settings = {router_url:'',model:'Hermesollama',api_key_cipher:'',gateway_url:'',gateway_token_cipher:''};
const meta = (row: Row, full = false) => {
  const data = JSON.parse(row.data);
  if (!full && 'content' in data) { data.size = data.content.length; delete data.content; }
  return {...data,id:row.id,created_at:row.created_at,updated_at:row.updated_at};
};
async function body(c: C): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(()=>null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HTTPException(400,{message:'Isi permintaan harus objek JSON.'});
  return parsed;
}
function kindOf(value: string): Kind {
  if (!kinds.includes(value as Kind)) throw new HTTPException(404,{message:'Modul tidak ditemukan.'});
  return value as Kind;
}
async function settings(c: C, workspace = c.get('workspaceId')) {
  return await c.env.DB.prepare('SELECT router_url,model,api_key_cipher,gateway_url,gateway_token_cipher FROM cs_settings WHERE workspace_id=?').bind(workspace).first<Settings>() ?? {...defaults};
}
const publicSettings = (row: Settings) => ({router_url:row.router_url,model:row.model,has_api_key:!!row.api_key_cipher,gateway_url:row.gateway_url,has_gateway_token:!!row.gateway_token_cipher});
async function responseText(response: Response, maxBytes: number) {
  const reader=response.body?.getReader();
  if(!reader)return '';
  const decoder=new TextDecoder(),parts:string[]=[];let bytes=0;
  try {
    for(;;) {
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes) {await reader.cancel();throw new HTTPException(502,{message:'Respons layanan melebihi batas ukuran.'});}
      parts.push(decoder.decode(value,{stream:true}));
    }
    return parts.join('')+decoder.decode();
  } finally {reader.releaseLock();}
}
function secret(c: C) {
  if (!c.env.SESSION_SECRET) throw new HTTPException(503,{message:'Secret aplikasi belum tersedia.'});
  return c.env.SESSION_SECRET;
}
async function agent(c: C, workspace: string, instance: string) {
  const row = await c.env.DB.prepare('SELECT assistant_name,instructions,enabled FROM cs_agents WHERE workspace_id=? AND instance=?').bind(workspace,instance).first<{assistant_name:string;instructions:string;enabled:number}>();
  return {instance,assistantName:row?.assistant_name??'Kak',instructions:row?.instructions??'',enabled:!!row?.enabled};
}
async function records(c: C, kind: Kind, workspace = c.get('workspaceId')) {
  const result = await c.env.DB.prepare('SELECT id,name,data,created_at,updated_at FROM cs_records WHERE workspace_id=? AND kind=? ORDER BY created_at DESC LIMIT 1000').bind(workspace,kind).all<Row>();
  return result.results.map(row=>meta(row,true));
}
async function provider(c: C, cipher: Cipher, config: Settings, path: string, payload?: unknown) {
  if (!config.router_url || !config.api_key_cipher) throw new HTTPException(409,{message:'Simpan URL dan API key 9Router terlebih dahulu.'});
  const response = await fetch(config.router_url+path,{method:payload?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${await cipher.decrypt(config.api_key_cipher,secret(c))}`,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})}).catch(()=>{throw new HTTPException(502,{message:'9Router tidak dapat dihubungi.'})});
  if (!response.ok) throw new HTTPException(502,{message:response.status===401?'API key 9Router ditolak.':`9Router mengembalikan status ${response.status}.`});
  const raw = await responseText(response,250000);
  try { return JSON.parse(raw); } catch { throw new HTTPException(502,{message:'Respons 9Router bukan JSON.'}); }
}
async function draft(c: C, cipher: Cipher, workspace: string, instance: string, thread: ThreadItem[]) {
  const config = await settings(c,workspace);
  const [currentAgent,products,knowledge] = await Promise.all([agent(c,workspace,instance),records(c,'products',workspace),records(c,'knowledge',workspace)]);
  const tariffs = knowledge.filter(doc=>doc.category==='shipping').map(doc=>parseTariffText(doc.content));
  const result = await composeReply({
    agent:currentAgent,thread,attempts:1,
    store:{products:{list:()=>products},knowledge:{shipping:(items:ThreadItem[])=>resolveShipping(items,tariffs),relevant:(query:string)=>rankKnowledge(query,knowledge.filter(doc=>doc.category!=='shipping'))}},
    buildMessages:buildAiMessages,
    router:{complete:async(messages:unknown)=>{
      const response = await provider(c,cipher,config,'/chat/completions',{model:config.model,messages,temperature:0.3,max_tokens:800});
      const output = response.choices?.[0]?.message?.content;
      if (typeof output!=='string' || !output.trim() || output.length>16000 || response.choices?.[0]?.finish_reason==='length') throw new HTTPException(502,{message:'Model tidak mengembalikan balasan teks yang lengkap.'});
      return output.trim();
    }},
  });
  if (!result.text) throw result.error ?? new HTTPException(502,{message:'Draf AI tidak tersedia.'});
  return {reply:result.text.slice(0,4000),guarded:!!result.guarded,model:config.model};
}
function errorHandler(error: Error, c: C) {
  return c.json({error:error instanceof HTTPException?error.message:'Modul CSPoint gagal memproses permintaan.'},error instanceof HTTPException?error.status:500);
}

export function createCsPoint(cipher: Cipher, onQrLead:(context:any,workspace:string,input:QrLeadInput)=>Promise<{id:string;created:boolean}> = async()=>{throw new HTTPException(503,{message:'Penerimaan lead WhatsApp belum tersedia.'})}) {
  const api = new Hono<{Bindings:Bindings;Variables:Variables}>();
  const bridge = new Hono<{Bindings:Bindings;Variables:Variables}>();
  api.onError(errorHandler);
  bridge.onError(errorHandler);
  api.use('*',bodyLimit({maxSize:2100000,onError:c=>c.json({error:'Data terlalu besar. Maksimal 2 MB.'},413)}));
  api.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});

  api.get('/settings',async c=>c.json(publicSettings(await settings(c))));
  api.put('/settings',async c=>{
    const input=await body(c), old=await settings(c);
    const router_url=input.router_url===undefined?old.router_url:publicHttps(input.router_url,'URL 9Router');
    const gateway_url=input.gateway_url===undefined?old.gateway_url:publicHttps(input.gateway_url,'URL gateway');
    if (gateway_url && new URL(gateway_url).pathname!=='/') throw new HTTPException(400,{message:'URL gateway hanya berisi origin HTTPS tanpa path.'});
    const model=input.model===undefined?old.model:text(input.model,160,'Model',true);
    let api_key_cipher=old.api_key_cipher,gateway_token_cipher=old.gateway_token_cipher;
    if (input.clear_api_key===true) api_key_cipher='';
    else if (input.api_key) api_key_cipher=await cipher.encrypt(text(input.api_key,4096,'API key',true),secret(c));
    if (input.clear_gateway_token===true) gateway_token_cipher='';
    else if (input.gateway_token) {
      const token=text(input.gateway_token,4096,'Token gateway',true);
      if (token.length<32) throw new HTTPException(400,{message:'Token gateway minimal 32 karakter.'});
      gateway_token_cipher=await cipher.encrypt(token,secret(c));
    }
    // Never forward a previously saved credential to a newly entered origin.
    if (router_url!==old.router_url && !input.api_key) api_key_cipher='';
    if (gateway_url!==old.gateway_url && !input.gateway_token) gateway_token_cipher='';
    const conflict=gateway_url && await c.env.DB.prepare('SELECT workspace_id FROM cs_settings WHERE gateway_url=? AND workspace_id<>?').bind(gateway_url,c.get('workspaceId')).first();
    if (conflict) throw new HTTPException(409,{message:'Gateway ini sudah dipakai workspace lain. Gunakan instance gateway terpisah.'});
    await c.env.DB.prepare('INSERT INTO cs_settings(workspace_id,router_url,model,api_key_cipher,gateway_url,gateway_token_cipher) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET router_url=excluded.router_url,model=excluded.model,api_key_cipher=excluded.api_key_cipher,gateway_url=excluded.gateway_url,gateway_token_cipher=excluded.gateway_token_cipher,updated_at=CURRENT_TIMESTAMP').bind(c.get('workspaceId'),router_url,model,api_key_cipher,gateway_url,gateway_token_cipher).run();
    return c.json(publicSettings({router_url,model,api_key_cipher,gateway_url,gateway_token_cipher}));
  });
  api.get('/agent',async c=>c.json(await agent(c,c.get('workspaceId'),instanceId(c.req.query('instance')))));
  api.put('/agent',async c=>{
    const input=await body(c),instance=instanceId(input.instance),assistantName=text(input.assistantName,60,'Nama asisten',true),instructions=text(input.instructions,16000,'Instruksi'),enabled=input.enabled===true;
    const config=await settings(c);
    if (enabled && (!instructions || !config.api_key_cipher || !config.router_url)) throw new HTTPException(409,{message:'Isi instruksi serta koneksi 9Router sebelum mengaktifkan AI.'});
    await c.env.DB.prepare('INSERT INTO cs_agents(workspace_id,instance,assistant_name,instructions,enabled) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,instance) DO UPDATE SET assistant_name=excluded.assistant_name,instructions=excluded.instructions,enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP').bind(c.get('workspaceId'),instance,assistantName,instructions,enabled?1:0).run();
    return c.json({instance,assistantName,instructions,enabled});
  });
  api.post('/ai/test',async c=>{
    if (!(await c.env.AUTH_RATE.limit({key:`cs-ai:${c.get('workspaceId')}`})).success) return c.json({error:'Terlalu banyak uji AI. Coba lagi sebentar.'},429);
    const input=await body(c),prompt=text(input.prompt,4000,'Pesan uji',true);
    return c.json(await draft(c,cipher,c.get('workspaceId'),instanceId(input.instance),[{id:'test',text:prompt,outgoing:false}]));
  });
  api.get('/ai/models',async c=>{
    const result=await provider(c,cipher,await settings(c),'/models');
    return c.json({models:Array.isArray(result.data)?result.data.slice(0,100).map((m:{id:unknown})=>String(m.id).slice(0,160)):[]});
  });
  api.post('/shipping/check',async c=>{
    const input=await body(c),destination=text(input.destination,500,'Tujuan',true),documents=await records(c,'knowledge');
    const tariffs=documents.filter(doc=>doc.category==='shipping').map(doc=>parseTariffText(doc.content));
    return c.json(resolveShipping([{text:`Alamat pengiriman: ${destination}`,outgoing:false}],tariffs));
  });
  api.get('/records/:kind',async c=>{
    const kind=kindOf(c.req.param('kind')),q=text(c.req.query('q'),100,'Pencarian'),page=Math.max(1,Math.min(10000,Number(c.req.query('page'))||1));
    const filter=`workspace_id=? AND kind=? AND (name LIKE ? OR (kind<>'knowledge' AND data LIKE ?))`,bindings=[c.get('workspaceId'),kind,`%${q}%`,`%${q}%`];
    const [result,total]=await Promise.all([c.env.DB.prepare(`SELECT id,name,data,created_at,updated_at FROM cs_records WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?`).bind(...bindings,(Math.floor(page)-1)*25).all<Row>(),c.env.DB.prepare(`SELECT COUNT(*) AS count FROM cs_records WHERE ${filter}`).bind(...bindings).first<{count:number}>()]);
    return c.json({items:result.results.map(row=>meta(row)),total:total?.count??0,page:Math.floor(page),pageSize:25});
  });
  api.get('/records/:kind/:id',async c=>{
    const row=await c.env.DB.prepare('SELECT id,name,data,created_at,updated_at FROM cs_records WHERE id=? AND workspace_id=? AND kind=?').bind(c.req.param('id'),c.get('workspaceId'),kindOf(c.req.param('kind'))).first<Row>();
    if (!row) throw new HTTPException(404,{message:'Data tidak ditemukan.'});
    return c.json(meta(row,true));
  });
  api.post('/records/:kind',async c=>{
    const kind=kindOf(c.req.param('kind')),data=recordData(kind,await body(c)),id=crypto.randomUUID(),limit=kind==='knowledge'?20:1000;
    // The count and insert share one statement so concurrent requests cannot exceed the quota.
    const result=await c.env.DB.prepare('INSERT INTO cs_records(id,workspace_id,kind,name,data) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM cs_records WHERE workspace_id=? AND kind=?)<?').bind(id,c.get('workspaceId'),kind,data.name,JSON.stringify(data),c.get('workspaceId'),kind,limit).run();
    if (!result.meta.changes) throw new HTTPException(409,{message:`Batas ${limit} data untuk modul ini tercapai.`});
    return c.json({id,...data},201);
  });
  api.put('/records/:kind/:id',async c=>{
    const kind=kindOf(c.req.param('kind')),data=recordData(kind,await body(c));
    const result=await c.env.DB.prepare('UPDATE cs_records SET name=?,data=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND kind=?').bind(data.name,JSON.stringify(data),c.req.param('id'),c.get('workspaceId'),kind).run();
    if (!result.meta.changes) throw new HTTPException(404,{message:'Data tidak ditemukan.'});
    return c.json({id:c.req.param('id'),...data});
  });
  api.delete('/records/:kind/:id',async c=>{
    const result=await c.env.DB.prepare('DELETE FROM cs_records WHERE id=? AND workspace_id=? AND kind=?').bind(c.req.param('id'),c.get('workspaceId'),kindOf(c.req.param('kind'))).run();
    if (!result.meta.changes) throw new HTTPException(404,{message:'Data tidak ditemukan.'});
    return c.json({deleted:true});
  });

  const allowed: Record<string,string[]>={numbers:['GET','POST'],status:['GET'],qr:['GET'],connect:['POST'],disconnect:['POST'],conversations:['GET'],messages:['GET'],send:['POST'],labels:['GET','POST'],'conversations/labels':['POST'],'conversations/read':['POST'],'conversations/unread':['POST'],'conversations/ai':['POST']};
  api.all('/gateway/*',async c=>{
    const path=c.req.path.split('/gateway/')[1]??'';
    if (!(allowed[path]?.includes(c.req.method) || (c.req.method==='DELETE' && /^labels\/[a-zA-Z0-9-]{1,64}$/.test(path)))) throw new HTTPException(404,{message:'Operasi gateway tidak tersedia.'});
    const config=await settings(c);
    if (!config.gateway_url || !config.gateway_token_cipher) throw new HTTPException(409,{message:'Gateway WhatsApp QR belum dihubungkan. Isi URL dan token pada Pengaturan CSPoint.'});
    const response=await fetch(config.gateway_url+'/'+path+new URL(c.req.url).search,{method:c.req.method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${await cipher.decrypt(config.gateway_token_cipher,secret(c))}`,'Content-Type':'application/json','X-Arenka-Workspace':c.get('workspaceId')},...(c.req.method==='GET'?{}:{body:await c.req.text()})}).catch(()=>{throw new HTTPException(502,{message:'Gateway WhatsApp QR tidak dapat dihubungi.'})});
    if (response.status>=300&&response.status<400) throw new HTTPException(502,{message:'Gateway tidak boleh mengalihkan permintaan.'});
    const raw=await responseText(response,2000000);
    try { JSON.parse(raw); } catch { throw new HTTPException(502,{message:'Respons gateway bukan JSON.'}); }
    return new Response(raw,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  });
  api.notFound(c=>c.json({error:'Endpoint CSPoint tidak ditemukan.'},404));

  bridge.use('*',bodyLimit({maxSize:150000,onError:c=>c.json({error:'Data terlalu besar.'},413)}));
  bridge.post('/:workspace/lead',async c=>{
    const workspace=c.req.param('workspace'),config=await settings(c,workspace),provided=c.req.header('Authorization')?.replace(/^Bearer /,'')??'';
    if(!config.gateway_token_cipher||!provided)return c.json({error:'Tidak diizinkan.'},401);
    const expected=await cipher.decrypt(config.gateway_token_cipher,secret(c)),digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),[a,b]=await Promise.all([digest(expected),digest(provided)]);
    if(a.some((value,i)=>value!==b[i]))return c.json({error:'Tidak diizinkan.'},401);
    if(!(await c.env.AUTH_RATE.limit({key:`cs-lead:${workspace}`})).success)return c.json({error:'Batas permintaan tercapai.'},429);
    const input=await body(c),name=text(input.name,120,'Nama'),rawPhone=text(input.phone,30,'Nomor WhatsApp',true).replace(/[ +()-]/g,''),phone=rawPhone.startsWith('0')?'62'+rawPhone.slice(1):rawPhone;
    if(!/^[1-9]\d{7,14}$/.test(phone))throw new HTTPException(400,{message:'Nomor WhatsApp tidak valid.'});
    const ctwa=text(input.ctwa_clid,500,'ctwa_clid');
    if(ctwa&&(ctwa.length>500||/[\u0000-\u001f\u007f]/.test(ctwa)))throw new HTTPException(400,{message:'ctwa_clid tidak valid.'});
    const result=await onQrLead(c,workspace,{name,phone,ctwa_clid:ctwa||null});
    return c.json(result,result.created?201:200);
  });
  bridge.post('/:workspace/reply',async c=>{
    const workspace=c.req.param('workspace'),config=await settings(c,workspace),provided=c.req.header('Authorization')?.replace(/^Bearer /,'')??'';
    if (!config.gateway_token_cipher || !provided) return c.json({error:'Tidak diizinkan.'},401);
    const expected=await cipher.decrypt(config.gateway_token_cipher,secret(c));
    const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
    const [a,b]=await Promise.all([digest(expected),digest(provided)]);
    if (a.some((value,i)=>value!==b[i])) return c.json({error:'Tidak diizinkan.'},401);
    if (!(await c.env.AUTH_RATE.limit({key:`cs-bridge:${workspace}`})).success) return c.json({error:'Batas balasan per menit tercapai.'},429);
    const input=await body(c),instance=instanceId(input.instance),current=await agent(c,workspace,instance);
    if (!current.enabled || !current.instructions) return c.json({reply:null,reason:'disabled'});
    if (!Array.isArray(input.thread) || !input.thread.length || input.thread.length>30) throw new HTTPException(400,{message:'Riwayat percakapan tidak valid.'});
    const thread:ThreadItem[]=input.thread.map(item=>{
      if(!item || typeof item!=='object') throw new HTTPException(400,{message:'Isi riwayat tidak valid.'});
      return {id:text(item.id,100,'ID'),text:text(item.text,4000,'Pesan'),outgoing:item.outgoing===true||item.outgoing===1,source:item.source==='cs'?'cs':item.source==='ai'?'ai':'unknown'};
    });
    const result=await draft(c,cipher,workspace,instance,thread);
    if (!(await agent(c,workspace,instance)).enabled) return c.json({reply:null,reason:'disabled'});
    return c.json(result);
  });
  return {api,bridge};
}
