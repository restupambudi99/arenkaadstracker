import { HTTPException } from 'hono/http-exception';

export const kinds = ['products', 'orders', 'contacts', 'templates', 'knowledge'] as const;
export type Kind = typeof kinds[number];
export function text(value: unknown, max: number, label: string, required = false): string {
  if (value !== undefined && typeof value !== 'string') throw new HTTPException(400, {message: `${label} harus berupa teks.`});
  const clean = String(value ?? '').trim();
  if ((required && !clean) || clean.length > max || clean.includes('\0')) throw new HTTPException(400, {message: `${label} wajib sesuai batas ${max.toLocaleString('id-ID')} karakter.`});
  return clean;
}
function integer(value: unknown, label: string) {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0 || result > 1e12) throw new HTTPException(400, {message: `${label} harus berupa bilangan bulat positif atau nol.`});
  return result;
}
function phone(value: unknown) {
  let valueText = text(value, 30, 'Nomor WhatsApp').replace(/[ +()-]/g, '');
  if (valueText.startsWith('0')) valueText = '62' + valueText.slice(1);
  if (valueText && !/^[1-9]\d{7,14}$/.test(valueText)) throw new HTTPException(400, {message: 'Nomor WhatsApp tidak valid.'});
  return valueText;
}
export function recordData(kind: Kind, input: Record<string, unknown>) {
  const name = text(input.name, 160, kind === 'orders' ? 'Nama pelanggan' : 'Nama', true);
  const base = {name};
  switch (kind) {
    case 'products': return {...base, sku: text(input.sku,60,'SKU'), price:text(input.price,240,'Harga'), stock:integer(input.stock,'Stok'), description:text(input.description,2000,'Deskripsi')};
    case 'orders': {
      const status = text(input.status ?? 'Menunggu Bayar',30,'Status');
      if (!['Menunggu Bayar','Diproses','Selesai'].includes(status)) throw new HTTPException(400,{message:'Status pesanan tidak valid.'});
      return {...base, phone:phone(input.phone), status, total:integer(input.total,'Total'), note:text(input.note,2000,'Catatan')};
    }
    case 'contacts': return {...base, phone:phone(input.phone), tag:text(input.tag,40,'Label')};
    case 'templates': {
      const stage = text(input.stage,10,'Tahap',true);
      if (!/^FU[1-5]$/.test(stage)) throw new HTTPException(400,{message:'Tahap harus FU1 sampai FU5.'});
      return {...base, stage, body:text(input.body,4000,'Isi template',true)};
    }
    case 'knowledge': {
      const category = input.category === 'shipping' ? 'shipping' : 'knowledge';
      return {...base, category, content:text(input.content,500000,'Isi pengetahuan',true), source:text(input.source,160,'Nama berkas'), mime:input.mime==='application/pdf'?'application/pdf':'text/plain'};
    }
  }
}
export function publicHttps(value: unknown, label: string): string {
  const raw = text(value, 500, label);
  if (!raw) return '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new HTTPException(400,{message:`${label} tidak valid.`}); }
  // Only public DNS names, no IP literals, credentials, query or redirect-based forwarding.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port!=='443') || !/^[a-z0-9](?:[a-z0-9.-]*\.)[a-z]{2,63}$/i.test(url.hostname) || /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname)) throw new HTTPException(400,{message:`${label} harus URL HTTPS pada domain publik.`});
  return url.href.replace(/\/$/,'');
}
export function instanceId(value: unknown) {
  const instance = text(value ?? 'default',20,'Nomor');
  if (!/^(default|n(?:[2-9]|10))$/.test(instance)) throw new HTTPException(400,{message:'Slot nomor tidak valid.'});
  return instance;
}
