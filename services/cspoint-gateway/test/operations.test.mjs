import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openMessages} from '../vendor/messages.mjs';
import {openAutomation} from '../automation.mjs';
import {createGateway} from '../http.mjs';

test('QR, labels, unread state, scoped inbox, manual reply and pause use the gateway contract',async()=>{
  const messages=openMessages(':memory:'),db=new DatabaseSync(':memory:'),state=openAutomation(db),jid='6281234567890@s.whatsapp.net';let sent=0;
  messages.add({id:'incoming',instance:'default',jid,name:'QA',text:'Halo',outgoing:false,timestamp:Date.now()});
  const number={id:'default',label:'Nomor 1',status:'idle',qr:'fixture',socket:{readMessages:async()=>{}},view(){return {id:this.id,status:this.status};},async request(){this.status='connected';}};
  const server=createGateway({workspace:'a',token:'test-token',messages,state,numbers:{list:()=>[number],get:id=>{assert.equal(id,'default');return number;},add:async()=>({view:()=>({id:'n2'})}),disconnect:async()=>{number.status='idle';return {disconnected:true};}},qrImage:async()=> 'data:image/png;base64,Zml4dHVyZQ==',sendText:async()=>{sent++;return 'outgoing';}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=async(path,method='GET',data)=>fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{Authorization:'Bearer test-token','X-Arenka-Workspace':'a','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  try {
    assert.equal((await request('/connect','POST',{})).status,200);
    assert.ok((await (await request('/qr')).json()).image.startsWith('data:image/png'));
    assert.equal((await request('/numbers','POST',{})).status,201);
    assert.equal((await request('/messages?jid='+encodeURIComponent(jid)+'&instance=n2')).status,404);
    assert.equal((await (await request('/messages?jid='+encodeURIComponent(jid))).json()).length,1);
    const label=await (await request('/labels','POST',{name:'Label QA',color:'green'})).json();assert.ok(label.id,JSON.stringify(label));
    assert.equal((await request('/conversations/labels','POST',{jid,instance:'default',labelIds:[label.id]})).status,200);
    assert.equal((await (await request('/conversations')).json())[0].labels[0].id,label.id);
    assert.equal((await request('/conversations/read','POST',{jid,instance:'default',ids:['incoming']})).status,200);
    assert.equal((await (await request('/conversations')).json())[0].unreadCount,0);
    await request('/conversations/unread','POST',{jid,instance:'default'});
    assert.equal((await (await request('/conversations')).json())[0].unreadCount,1);
    assert.equal((await request('/send','POST',{jid,instance:'default',text:'Balasan manual'})).status,200);assert.equal(sent,1);assert.equal(state.paused('default',jid),true);
    await request('/conversations/ai','POST',{jid,instance:'default',paused:false});assert.equal(state.paused('default',jid),false);
    assert.equal((await request('/labels/'+label.id,'DELETE')).status,200);
    assert.equal((await request('/disconnect','POST',{})).status,400);
    assert.equal((await request('/disconnect','POST',{confirm:'PUTUSKAN'})).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));messages.close();db.close();}
});
