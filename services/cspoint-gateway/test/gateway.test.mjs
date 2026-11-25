import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openMessages} from '../vendor/messages.mjs';
import {openAutomation,createResponder} from '../automation.mjs';
import {createGateway} from '../http.mjs';

test('outbound CS and AI identities remain distinct',()=>{
  const messages=openMessages(':memory:');messages.registerOutbound('manual','123@s.whatsapp.net','default','cs');messages.registerOutbound('auto','123@s.whatsapp.net','default');
  assert.equal(messages.outboundSource('manual','123@s.whatsapp.net','default'),'cs');assert.equal(messages.outboundSource('auto','123@s.whatsapp.net','default'),'ai');assert.equal(messages.outboundSource('auto','123@s.whatsapp.net','n2'),undefined);messages.close();
});
test('duplicates, manual takeover, and uncertain send never cause an extra automatic send',async()=>{
  const db=new DatabaseSync(':memory:'),state=openAutomation(db);const socket={},number={id:'default',socket,status:'connected'};let last={id:'1',jid:'jid',text:'Halo',outgoing:false},sent=0;
  const messages={thread:()=>[last]};
  const respond=createResponder({state,messages,callReply:async()=> 'Halo kembali',sendText:async()=>{sent++;}});
  await Promise.all([respond(number,socket,last),respond(number,socket,last)]);assert.equal(sent,1);
  last={...last,id:'2'};state.pause('default','jid',true);await respond(number,socket,last);assert.equal(sent,1);
  state.pause('default','jid',false);last={...last,id:'3'};
  const takeover=createResponder({state,messages,callReply:async()=>{state.pause('default','jid',true);return 'Draft';},sendText:async()=>{sent++;}});await takeover(number,socket,last);assert.equal(sent,1);
  state.pause('default','jid',false);last={...last,id:'4'};
  const failed=createResponder({state,messages,callReply:async()=> 'Draft',sendText:async()=>{sent++;throw new Error('timeout after submission');}});await failed(number,socket,last);await failed(number,socket,last);assert.equal(sent,2);db.close();
});
test('gateway requires both token and workspace; QR listing uses injected socket only',async()=>{
  const server=createGateway({workspace:'a',token:'fixture-token',numbers:{list:()=>[{view:()=>({id:'default',status:'idle'})}]},messages:{},state:{},qrImage:async()=>'',sendText:async()=>{throw new Error('must not send');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  try {assert.equal((await fetch(url+'/numbers')).status,401);assert.equal((await fetch(url+'/numbers',{headers:{Authorization:'Bearer fixture-token','X-Arenka-Workspace':'b'}})).status,401);const response=await fetch(url+'/numbers',{headers:{Authorization:'Bearer fixture-token','X-Arenka-Workspace':'a'}});assert.equal(response.status,200);assert.equal((await response.json()).numbers.length,1);}finally{await new Promise(resolve=>server.close(resolve));}
});
