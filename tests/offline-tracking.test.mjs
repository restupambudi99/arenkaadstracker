import test from 'node:test';
import assert from 'node:assert/strict';
import {readMetaExport,guessOfflineMapping,buildOfflineRows,parseOfflineNumber,parseOfflineDate} from '../src/features/offline-tracking-parser.ts';

test('CSV parser finds Meta header after preamble and preserves quoted campaign names',async()=>{
  const file=new File(['Meta Ads export\nAccount; A\nDay;Campaign name;Ad set name;Ad name;Amount spent (IDR);Impressions;Link clicks;Results\n2026-11-01;"Promo; November";Broad;Video ""A"";103862;3369;44;14\n'],'meta.csv');
  const parsed=await readMetaExport(file);assert.deepEqual(parsed.headers,['Day','Campaign name','Ad set name','Ad name','Amount spent (IDR)','Impressions','Link clicks','Results']);
  const mapping=guessOfflineMapping(parsed.headers),rows=buildOfflineRows(parsed,mapping,'id');assert.equal(rows.length,1);assert.equal(rows[0].campaign,'Promo; November');assert.equal(rows[0].ad_name,'Video "A"');assert.equal(rows[0].results,14);assert.equal(rows[0].day,'2026-11-01');
});

test('Meta export numbers and dates honor Indonesian and English formats',()=>{
  assert.equal(parseOfflineNumber('Rp 1.234.567,50','id'),1234567.5);assert.equal(parseOfflineNumber('1,234,567.50','en'),1234567.5);
  assert.equal(parseOfflineNumber('0,95%','id'),0.95);assert.equal(parseOfflineDate('11/12/2026','id'),'2026-12-11');assert.equal(parseOfflineDate('11/12/2026','en'),'2026-11-12');
});

test('English Meta header aliases map to report metrics',()=>{
  const mapping=guessOfflineMapping(['Day','Campaign name','Ad set name','Ad name','Amount spent (USD)','Impressions','Reach','Frequency','Link clicks','Results','Cost per result','3-second video plays','ThruPlays']);
  assert.equal(mapping.spend,'Amount spent (USD)');assert.equal(mapping.link_clicks,'Link clicks');assert.equal(mapping.video_3s,'3-second video plays');assert.equal(mapping.thruplays,'ThruPlays');
});
