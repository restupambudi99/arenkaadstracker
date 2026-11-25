import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync('docs/PANDUAN_OFFLINE_TRACKING_ARENKA.md', 'utf8');
const lines = source.split(/\r?\n/);
const pages = [];
let page = [];
for (const line of lines) {
  if (!line.trim()) { page.push(''); continue; }
  const wrapped = line.length > 92 ? line.match(/.{1,92}(?:\s|$)/g)?.map(x => x.trim()) ?? [line] : [line];
  for (const part of wrapped) {
    if (page.length >= 45) { pages.push(page); page = []; }
    page.push(part);
  }
}
if (page.length) pages.push(page);
const esc = value => value.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)').replace(/[^\x20-\x7e]/g,'-');
const objects = [];
const add = body => { objects.push(body); return objects.length; };
const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
const pageRefs = [];
for (let p = 0; p < pages.length; p++) {
  const content = [];
  content.push('0.11 0.27 0.24 rg 0 0 595 842 re f');
  content.push('0.96 0.97 0.95 rg 34 30 527 782 re f');
  content.push('0.13 0.34 0.30 rg 56 738 34 34 re f');
  content.push('BT /F2 20 Tf 0.98 0.98 0.94 rg 64 747 Td (a) Tj ET');
  content.push('BT /F2 13 Tf 0.11 0.17 0.15 rg 102 754 Td (arenka) Tj ET');
  content.push('BT /F1 7 Tf 0.37 0.46 0.42 rg 102 742 Td (ADS TRACKER / PANDUAN OFFLINE) Tj ET');
  content.push('0.84 0.63 0.29 rg 56 722 483 1 re f');
  let y = 700;
  for (const raw of pages[p]) {
    if (!raw) { y -= 8; continue; }
    const heading = raw.startsWith('#');
    const text = raw.replace(/^#+\s*/, '').replaceAll('**','').replace(/`([^`]+)`/g,'$1');
    const isTitle = heading && (raw.startsWith('# '));
    const size = isTitle ? 18 : heading ? 11 : 8.4;
    const color = isTitle ? '0.11 0.27 0.24' : heading ? '0.13 0.34 0.30' : '0.20 0.24 0.22';
    content.push(`BT /${heading?'F2':'F1'} ${size} Tf ${color} rg 58 ${y} Td (${esc(text)}) Tj ET`);
    y -= heading ? (isTitle ? 26 : 18) : 14;
  }
  content.push(`0.45 0.52 0.49 rg 58 55 480 0.5 re f`);
  content.push(`BT /F1 7 Tf 0.45 0.52 0.49 rg 58 41 Td (Arenka Ads Tracker  -  Panduan Offline Tracking) Tj ET`);
  content.push(`BT /F1 7 Tf 0.45 0.52 0.49 rg 506 41 Td (${p+1} / ${pages.length}) Tj ET`);
  const stream = content.join('\n');
  const streamRef = add(`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`);
  pageRefs.push(add(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${streamRef} 0 R >>`));
}
const pagesRef = add(`<< /Type /Pages /Kids [${pageRefs.map(x=>`${x} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
for(const ref of pageRefs) objects[ref-1]=objects[ref-1].replace('PAGES_REF',String(pagesRef));
const catalog = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
let pdf='%PDF-1.4\n%ARENA\n'; const offsets=[0];
objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
const xref=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.mkdirSync('public',{recursive:true});fs.writeFileSync(path.join('public','panduan-offline-tracking.pdf'),Buffer.from(pdf,'latin1'));
console.log(`PDF dibuat: ${pages.length} halaman`);
