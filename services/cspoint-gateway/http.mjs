import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { normalizeWaPhone, resolveWaJid } from './vendor/phone.mjs';
import { readConversation } from './vendor/read-receipts.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function createGateway({ workspace, token, messages, numbers, qrImage, state, sendText }) {
  return createServer(async (req, res) => {
    const send = (status, payload) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
    const auth = Buffer.from(req.headers.authorization?.replace(/^Bearer /,'') || '');
    const expected = Buffer.from(token);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected) || req.headers['x-arenka-workspace'] !== workspace) {send(401,{error:'Tidak diizinkan.'});return;}
    try {
      const url = new URL(req.url, 'http://localhost');
      let raw = '';
      for await (const chunk of req) {raw += chunk;if(Buffer.byteLength(raw)>200000) throw fail('Data terlalu besar.',413);}
      let input = {};
      try {input = raw ? JSON.parse(raw) : {};} catch {throw fail('JSON tidak valid.');}
      if (!input || typeof input!=='object' || Array.isArray(input)) throw fail('JSON tidak valid.');
      const method=req.method,path=url.pathname;
      const selected=()=>numbers.get(url.searchParams.get('number') || input.instance || 'default');
      const conversation=()=>{
        const jid=input.jid||url.searchParams.get('jid'),instance=input.instance||url.searchParams.get('instance')||'default';
        if (typeof jid!=='string' || !messages.hasConversation(jid,instance)) throw fail('Percakapan tidak ditemukan.',404);
        return {jid,instance};
      };
      if (method==='GET' && path==='/numbers') return send(200,{numbers:numbers.list().map(n=>n.view()),max:10});
      if (method==='POST' && path==='/numbers') return send(201,(await numbers.add()).view());
      if (method==='GET' && path==='/status') return send(200,selected().view());
      if (method==='GET' && path==='/qr') {const number=selected();if(!number.qr) return send(409,{error:'QR belum tersedia. Hubungkan nomor lalu muat ulang.'});return send(200,{image:await qrImage(number.qr)});}
      if (method==='POST' && path==='/connect') {const number=selected();await number.request();return send(200,number.view());}
      if (method==='POST' && path==='/disconnect') {if(input.confirm!=='PUTUSKAN')throw fail('Ketik PUTUSKAN untuk memutus nomor.');return send(200,await numbers.disconnect(selected().id));}
      if (method==='GET' && path==='/conversations') return send(200,messages.list().map(row=>({...row,aiPaused:state.paused(row.instance,row.jid)})));
      if (method==='GET' && path==='/messages') {const {jid,instance}=conversation();return send(200,messages.thread(jid,instance));}
      if (method==='GET' && path==='/labels') return send(200,messages.labels());
      if (method==='POST' && path==='/labels') return send(200,messages.saveLabel(input));
      if (method==='DELETE' && /^\/labels\/[a-zA-Z0-9-]{1,64}$/.test(path)) return send(200,{removed:messages.deleteLabel(path.split('/')[2])});
      if (method==='POST' && path==='/conversations/labels') {const {jid,instance}=conversation();messages.setLabels(jid,input.labelIds,instance);return send(200,{saved:true});}
      if (method==='POST' && path==='/conversations/unread') {const {jid,instance}=conversation();messages.markUnread(jid,instance);return send(200,{unread:true});}
      if (method==='POST' && path==='/conversations/read') {const {jid,instance}=conversation();const number=numbers.get(instance);return send(200,await readConversation(messages,number.status==='connected'?number.socket:null,jid,input.ids,instance));}
      if (method==='POST' && path==='/conversations/ai') {const {jid,instance}=conversation();if(typeof input.paused!=='boolean')throw fail('Status jeda tidak valid.');state.pause(instance,jid,input.paused);return send(200,{paused:input.paused});}
      if (method==='POST' && path==='/send') {
        const number=selected();if(number.status!=='connected')throw fail('Nomor belum terhubung.',409);
        const text=typeof input.text==='string'?input.text.trim():'';
        if(!text || text.length>4000)throw fail('Isi pesan wajib 1 sampai 4.000 karakter.');
        let jid=input.jid;
        if(jid!==undefined) {if(!messages.hasConversation(jid,number.id))throw fail('Percakapan tidak ditemukan pada nomor ini.',404);}
        else {const phone=normalizeWaPhone(input.phone);if(!phone)throw fail('Nomor tujuan tidak valid.');jid=await resolveWaJid(number.socket,phone);if(!jid)throw fail('Nomor tujuan tidak terdaftar.');}
        state.pause(number.id,jid,true);
        const result=await sendText(number,jid,text,'cs');
        return send(200,{id:result,status:'submitted',aiPaused:true});
      }
      send(404,{error:'Endpoint tidak ditemukan.'});
    } catch(error) {send(error.status||500,{error:error.status?error.message:'Gateway gagal memproses permintaan.'});}
  });
}
