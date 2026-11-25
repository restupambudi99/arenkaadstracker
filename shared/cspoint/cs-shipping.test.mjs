import assert from 'node:assert/strict';
import { openMessages } from '../../services/cspoint-gateway/vendor/messages.mjs';
import { buildAiMessages } from './prompt.mjs';
import { composeReply } from './compose-reply.mjs';
import { csShipping } from './reply-rules.mjs';

const pdf = { status: 'found', value: 65000, amount: 'Rp65.000', destination: 'Baguala, Kota Ambon', final: false };
const customer = text => ({ id: 'in', jid: 'lead', instance: 'n1', text, outgoing: false });
const manual = { ...customer('Ongkir final Rp75.000 ya Kak.'), id: 'cs', outgoing: true, source: 'cs' };
const thread = [customer('Alamat: Baguala, Kota Ambon'), manual, customer('Totalnya berapa kak?')];
assert.equal(csShipping(thread, pdf).value, 75000);
assert.equal(csShipping(thread, pdf).final, true);
for (const source of ['ai', 'unknown', undefined]) assert.equal(csShipping(thread.map(item => item === manual ? { ...item, source } : item), pdf), null);
assert.equal(csShipping([...thread, customer('Alamat ganti ke Bubon Aceh Barat')], pdf), null);
assert.equal(csShipping([customer('Halo'), { ...manual, jid: 'other' }, customer('Ongkirnya?')], pdf), null);
assert.equal(csShipping([customer('Halo'), { ...manual, instance: 'n2' }, customer('Ongkirnya?')], pdf), null);
assert.equal(csShipping([...thread, { ...manual, text: 'Ongkir Rp80.000 atau Rp90.000' }], pdf).status, 'confirm');
assert.equal(csShipping([...thread, { ...manual, text: 'Ongkir tadi salah, cek dulu' }], pdf).status, 'confirm');
assert.equal(csShipping([...thread, { ...manual, text: 'Ongkir 80k ya kak' }], pdf).value, 80000);
assert.equal(csShipping([...thread, { ...manual, text: 'Gratis ongkir ya kak' }], pdf).value, 0);
assert.equal(csShipping([...thread, { ...manual, text: 'Ongkir Rp80.000 ya kak' }], pdf).value, 80000);

const messages = openMessages(':memory:');
const saved = { ...manual, id: 'out', timestamp: Date.now() };
messages.registerOutbound(saved.id, saved.jid, saved.instance);
assert.equal(messages.outboundSource(saved.id, saved.jid, saved.instance), 'ai', 'AI origin is available before socket echo');
assert.equal(messages.outboundSource(saved.id, 'other', saved.instance), undefined);
messages.add({ ...saved, source: 'unknown' });
messages.add({ ...saved, source: 'ai' });
messages.add({ ...saved, source: 'cs' });
assert.equal(messages.thread(saved.jid, saved.instance)[0].source, 'ai', 'echo must not relabel AI as CS');
messages.add({ ...saved, id: 'manual', source: 'cs' });
assert.equal(messages.thread(saved.jid, saved.instance).at(-1).source, 'cs');
messages.close();

const agent = { assistantName: 'CS', instructions: 'Paket 2: 40 pcs - Rp149.000', enabled: true };
let prompt;
const reply = await composeReply({
  store: { knowledge: { shipping: () => pdf, relevant: () => [] }, products: { list: () => [] } },
  router: { complete: async messages => { prompt = messages; return 'Ongkir Rp75.000. Total COD Rp224.000.'; } },
  buildMessages: buildAiMessages, agent, thread,
});
assert.equal(reply.guarded, false);
assert.equal(reply.context.shipping.value, 75000);
assert.match(JSON.stringify(prompt), /dikonfirmasi CS manusia/);
assert.match(JSON.stringify(prompt), /Pesan CS manusia/);
assert.match(reply.text, /224\.000/);
console.log('PASS: CS tariff priority, address invalidation, lead isolation, origin persistence, echo race, and final COD');
