import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import makeWASocket, {DisconnectReason,generateMessageIDV2,normalizeMessageContent,useMultiFileAuthState} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import {openMessages} from './vendor/messages.mjs';
import {openNumbers} from './vendor/wa-numbers.mjs';
import {createGateway} from './http.mjs';
import {openAutomation,createResponder} from './automation.mjs';

const {GATEWAY_TOKEN:token,ARENKA_WORKSPACE_ID:workspace,ARENKA_ORIGIN:origin}=process.env;
if (!token || token.length<32 || !workspace || !origin || new URL(origin).protocol!=='https:') throw new Error('Set GATEWAY_TOKEN (32+ characters), ARENKA_WORKSPACE_ID and ARENKA_ORIGIN (HTTPS).');
const data=resolve(process.env.DATA_DIR||'./data');
await mkdir(data,{recursive:true,mode:0o700});
const dbPath=join(data,'cspoint.sqlite'),messages=openMessages(dbPath),db=new DatabaseSync(dbPath),state=openAutomation(db);
db.exec('CREATE TABLE IF NOT EXISTS arenka_identity(id INTEGER PRIMARY KEY CHECK(id=1),workspace TEXT NOT NULL)');
db.prepare('INSERT OR IGNORE INTO arenka_identity VALUES(1,?)').run(workspace);
if(db.prepare('SELECT workspace FROM arenka_identity WHERE id=1').get().workspace!==workspace) throw new Error('DATA_DIR belongs to another workspace. Use a separate empty directory.');
const logger=pino({level:'silent'});
async function sendText(number,jid,text,source) {
  const messageId=generateMessageIDV2(number.socket.user?.id);
  messages.registerOutbound(messageId,jid,number.id,source);
  const result=await number.socket.sendMessage(jid,{text},{messageId});
  messages.add({id:result.key.id,jid,text,name:'',outgoing:true,source,status:result.status,timestamp:Date.now(),instance:number.id});
  return result.key.id;
}
const respond=createResponder({state,messages,sendText,callReply:async(instance,thread)=>{
  const response=await fetch(`${origin.replace(/\/$/,'')}/cspoint-bridge/${encodeURIComponent(workspace)}/reply`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({instance,thread:thread.map(m=>({id:m.id,text:m.text.slice(0,4000),outgoing:!!m.outgoing,source:m.source}))})});
  if(!response.ok)throw new Error(`Arenka reply endpoint status ${response.status}`);
  const result=await response.json();
  return typeof result.reply==='string'?result.reply:null;
},onError:()=>console.error('AI reply failed; inspect provider configuration. Message was not automatically retried.')});
const numbers=await openNumbers({sessionDir:join(data,'session'),makeSocket:auth=>makeWASocket({auth,logger,markOnlineOnConnect:false,syncFullHistory:false}),useAuth:useMultiFileAuthState,closeCodes:DisconnectReason,messages,
  onMessages(number,current,batch) {
    for(const message of batch) {
      const jid=message.key?.remoteJid,content=normalizeMessageContent(message.message),text=content?.conversation||content?.extendedTextMessage?.text;
      if(!jid || !message.key?.id || !text || !/\@(s\.whatsapp\.net|lid)$/.test(jid))continue;
      const outgoing=!!message.key.fromMe,timestamp=Number(message.messageTimestamp)*1000||Date.now();
      // Only registered outbound IDs establish AI/CS provenance; historical echoes remain unknown.
      const source=outgoing?messages.outboundSource(message.key.id,jid,number.id):'unknown';
      const saved={id:message.key.id,jid,text:text.slice(0,4000),name:message.pushName||'',outgoing,status:message.status,timestamp,instance:number.id,source:source||'unknown'};
      const fresh=messages.add(saved);
      if(outgoing&&source!=='ai'&&Math.abs(Date.now()-timestamp)<120000)state.pause(number.id,jid,true);
      if(fresh&&!outgoing&&!numbers.owns(jid)&&Math.abs(Date.now()-timestamp)<120000)void respond(number,current,saved);
    }
  },onOpen() {},
});
const server=createGateway({workspace,token,messages,numbers,qrImage:QRCode.toDataURL,state,sendText});
server.requestTimeout=30000;
server.listen(Number(process.env.PORT||18181),process.env.HOST||'127.0.0.1',()=>console.log('Arenka QR gateway listening.'));
void numbers.start();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{numbers.close();server.close(()=>{messages.close();db.close();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();});
