import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import app from '../worker/index.ts';

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  for(const id of ['a','b']) {
    sqlite.prepare('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)').run(id,id+'@test.invalid','unusable-test-fixture');
    sqlite.prepare('INSERT INTO workspaces(id,owner_id,name,public_key) VALUES(?,?,?,?)').run(id,id,'Workspace '+id,'test-key-'+id);
  }
  const prepare=(sql,args=[])=>({
    bind:(...values)=>prepare(sql,values),
    first:async column=>{const row=sqlite.prepare(sql).get(...args);return column?row?.[column]??null:row??null;},
    all:async()=>({success:true,results:sqlite.prepare(sql).all(...args),meta:{}}),
    run:async()=>{const result=sqlite.prepare(sql).run(...args);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};},
  });
  const env={DB:{prepare,batch:async statements=>Promise.all(statements.map(s=>s.run()))},SESSION_SECRET:'isolated-test-secret-never-used-in-production',AUTH_RATE:{limit:async()=>({success:true})},TRACKER_RATE:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('fixture asset')}};
  const cookie=id=>{const payload=Buffer.from(JSON.stringify({sub:id,ver:0,exp:Date.now()+60000})).toString('base64url');return 'arenka_session='+payload+'.'+createHmac('sha256',env.SESSION_SECRET).update(payload).digest('base64url');};
  const request=(path,{user='a',method='GET',body,headers={}}={})=>app.fetch(new Request('https://arenka.test'+path,{method,headers:{...(user?{Cookie:cookie(user)}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil(){}});
  const cs=(path,options)=>request('/api/cspoint'+path,options);
  return {sqlite,request,cs};
}
test('new namespace retains Arenka session and origin protection',async()=>{
  const {sqlite,request,cs}=fixture();
  assert.equal((await cs('/records/products',{user:null})).status,401);
  assert.equal((await cs('/records/products',{method:'POST',body:{name:'Test'},headers:{Origin:'https://other.invalid'}})).status,403);
  assert.equal((await request('/api/me')).status,200);
  assert.equal((await request('/api/leads')).status,200);
  assert.equal((await request('/api/integrations')).status,200);
  assert.equal((await cs('/missing')).status,404);
  sqlite.close();
});
test('CRUD, search, pagination and workspace boundaries work for every record kind',async()=>{
  const {sqlite,cs}=fixture();
  for(const [kind,input] of Object.entries({products:{name:'Produk uji',price:'Rp 50.000',stock:3},orders:{name:'Pesanan uji',total:50000,status:'Selesai',phone:'081234567890'},contacts:{name:'Kontak uji',phone:'081234567890'},templates:{name:'Template uji',stage:'FU1',body:'Isi uji'},knowledge:{name:'Referensi uji',content:'Informasi produk uji',category:'knowledge'}})) {
    const response=await cs('/records/'+kind,{method:'POST',body:input});assert.equal(response.status,201,await response.clone().text());const created=await response.json();
    const list=await (await cs('/records/'+kind+'?q=uji')).json();assert.equal(list.total,1);assert.equal(list.items[0].id,created.id);
    assert.equal((await (await cs('/records/'+kind,{user:'b'})).json()).total,0);
    assert.equal((await cs('/records/'+kind+'/'+created.id,{user:'b'})).status,404);
    assert.equal((await cs('/records/'+kind+'/'+created.id,{user:'b',method:'PUT',body:input})).status,404);
    assert.equal((await cs('/records/'+kind+'/'+created.id,{user:'b',method:'DELETE'})).status,404);
    assert.equal((await cs('/records/'+kind+'/'+created.id,{method:'PUT',body:{...input,name:'Nama baru'}})).status,200);
    assert.equal((await (await cs('/records/'+kind+'/'+created.id)).json()).name,'Nama baru');
    assert.equal((await cs('/records/'+kind+'/'+created.id,{method:'DELETE'})).status,200);
  }
  for(let i=0;i<27;i++)assert.equal((await cs('/records/contacts',{method:'POST',body:{name:'Kontak '+i}})).status,201);
  const page=await (await cs('/records/contacts?page=2')).json();assert.equal(page.items.length,2);assert.equal(page.total,27);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM leads').get().n,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  sqlite.close();
});
test('invalid data, unknown kinds, quotas and absent gateway fail visibly',async()=>{
  const {sqlite,cs}=fixture();
  for(const [path,body] of [['products',{name:'x',stock:-1}],['orders',{name:'x',status:'Paid'}],['contacts',{name:'x',phone:'bad'}],['templates',{name:'x',stage:'FU6',body:'x'}],['knowledge',{name:'x',content:''}],['products',{name:12}]])assert.equal((await cs('/records/'+path,{method:'POST',body})).status,400);
  assert.equal((await cs('/records/users',{method:'POST',body:{name:'x'}})).status,404);
  assert.equal((await cs('/gateway/numbers')).status,409);
  assert.equal((await cs('/gateway/login')).status,404);
  assert.equal((await cs('/agent',{method:'PUT',body:{instance:'n11',assistantName:'Kak'}})).status,400);
  assert.equal((await cs('/agent',{method:'PUT',body:{instance:'default',assistantName:'Kak',instructions:'x',enabled:true}})).status,409);
  for(let i=0;i<20;i++)assert.equal((await cs('/records/knowledge',{method:'POST',body:{name:'x'+i,content:'Isi'}})).status,201);
  assert.equal((await cs('/records/knowledge',{method:'POST',body:{name:'extra',content:'Isi'}})).status,409);
  sqlite.close();
});
test('credentials are encrypted, masked, origin-bound and isolated',async()=>{
  const {sqlite,cs,request}=fixture();const key='test-key-do-not-use',token='test-gateway-token-long-enough-for-fixture';
  for(const url of ['http://localhost','https://127.0.0.1','https://[::1]','https://user:pass@router.arenka.biz.id','https://router.arenka.biz.id?url=foo'])assert.equal((await cs('/settings',{method:'PUT',body:{router_url:url}})).status,400);
  const result=await cs('/settings',{method:'PUT',body:{router_url:'https://router.arenka.biz.id/v1',api_key:key,gateway_url:'https://wa.arenka.biz.id',gateway_token:token}});assert.equal(result.status,200);
  const config=await result.json();assert.equal(config.has_api_key,true);assert.equal(config.has_gateway_token,true);assert.ok(!JSON.stringify(config).includes(key));
  const stored=sqlite.prepare('SELECT * FROM cs_settings WHERE workspace_id=?').get('a');assert.notEqual(stored.api_key_cipher,key);assert.notEqual(stored.gateway_token_cipher,token);
  const other=await (await cs('/settings',{user:'b'})).json();assert.equal(other.has_api_key,false);
  assert.equal((await cs('/settings',{user:'b',method:'PUT',body:{gateway_url:'https://wa.arenka.biz.id'}})).status,409);
  assert.equal((await request('/cspoint-bridge/a/reply',{user:null,method:'POST',body:{},headers:{Authorization:'Bearer wrong'}})).status,401);
  const disabled=await request('/cspoint-bridge/a/reply',{user:null,method:'POST',body:{instance:'default'},headers:{Authorization:'Bearer '+token}});assert.equal(disabled.status,200);assert.equal((await disabled.json()).reply,null);
  const changed=await (await cs('/settings',{method:'PUT',body:{router_url:'https://new.arenka.biz.id/v1',gateway_url:'https://wa2.arenka.biz.id'}})).json();assert.equal(changed.has_api_key,false);assert.equal(changed.has_gateway_token,false);
  sqlite.close();
});
test('AI test calls saved provider with workspace references only, never WhatsApp',async()=>{
  const {sqlite,cs}=fixture();const calls=[];const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({choices:[{message:{content:'Silakan sebutkan produk yang ingin ditanyakan.'}}]});};
  try {
    await cs('/settings',{method:'PUT',body:{router_url:'https://router.arenka.biz.id/v1',api_key:'fixture-key'}});
    await cs('/records/products',{user:'b',method:'POST',body:{name:'PRIVATE-WORKSPACE-B',price:'Rp 1.000'}});
    await cs('/agent',{method:'PUT',body:{instance:'default',assistantName:'Kak',instructions:'Jawab sopan.',enabled:false}});
    const response=await cs('/ai/test',{method:'POST',body:{instance:'default',prompt:'Halo'}});assert.equal(response.status,200,await response.clone().text());assert.equal(typeof (await response.json()).reply,'string');
    assert.ok(calls.length>0);assert.ok(calls.every(call=>call.url==='https://router.arenka.biz.id/v1/chat/completions'));assert.ok(!calls[0].options.body.includes('PRIVATE-WORKSPACE-B'));assert.equal(calls[0].options.redirect,'manual');
  } finally {globalThis.fetch=original;sqlite.close();}
});
