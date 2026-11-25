import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMetaEvent,sendMetaEvent} from '../worker/meta-capi.ts';

test('Meta events hash contact fields and include optional CTWA attribution',async()=>{
  const payload=await buildMetaEvent({id:'lead-1',name:'Rina Putri',email:'RINA@example.com',phone:'+62 812-3456-7890',value:0,source:'WhatsApp QR',ctwa_clid:'click-id'},'Lead',{pixel_id:'12345',test_event_code:'',currency:'IDR',include_ctwa_clid:1},'event-1','TEST123');
  const event=payload.data[0];
  assert.equal(payload.test_event_code,'TEST123');
  assert.equal(event.event_name,'Lead');
  assert.equal(event.action_source,'chat');
  assert.equal(event.user_data.em,await (await import('../worker/meta-capi.ts')).sha256('rina@example.com'));
  assert.equal(event.user_data.ctwa_clid,'click-id');
  assert.ok(!JSON.stringify(payload).includes('RINA@example.com'));
  assert.ok(!JSON.stringify(payload).includes('812-3456'));
});

test('Purchase event uses configured currency and value',async()=>{
  const payload=await buildMetaEvent({id:'lead-2',name:'Buyer',email:null,phone:null,value:125000,source:'Mayar'},'Purchase',{pixel_id:'12345',test_event_code:'',currency:'IDR',include_ctwa_clid:0},'event-2');
  assert.deepEqual(payload.data[0].custom_data,{currency:'IDR',value:125000});
  assert.equal(payload.test_event_code,undefined);
});

test('Meta delivery records accepted events and safely handles rejected delivery',async()=>{
  const accepted=await sendMetaEvent({pixelId:'123456',token:'fixture-token',payload:{data:[]},fetcher:async(url,options)=>{assert.match(url,/graph\.facebook\.com\/v27\.0\/123456\/events$/);assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer fixture-token');return Response.json({events_received:1,fbtrace_id:'trace-1'})}});
  assert.equal(accepted.status,'sent');assert.equal(accepted.eventsReceived,1);assert.equal(accepted.traceId,'trace-1');
  const rejected=await sendMetaEvent({pixelId:'123456',token:'fixture-token',payload:{data:[]},fetcher:async()=>Response.json({error:{code:100,message:'private provider message'}},{status:400})});
  assert.equal(rejected.status,'failed');assert.equal(rejected.responseStatus,400);assert.equal(rejected.errorCode,'100');assert.ok(!JSON.stringify(rejected).includes('private provider message'));
  const network=await sendMetaEvent({pixelId:'123456',token:'fixture-token',payload:{data:[]},fetcher:async()=>{throw new Error('private network detail')}});
  assert.equal(network.errorCode,'network_error');assert.ok(!JSON.stringify(network).includes('private network detail'));
});
