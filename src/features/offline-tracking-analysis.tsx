import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import type { OfflineBreakdownDimension } from './offline-tracking-parser';

export type AnalysisRow = {
  id?: string; day: string; campaign: string; adset: string | null; ad_name: string | null;
  spend: number; impressions: number; reach: number | null; frequency: number | null;
  link_clicks: number | null; results: number; video_3s: number | null; thruplays: number | null;
  objective: string | null; delivery: string | null; campaign_budget: number | null; adset_budget: number | null;
  quality_ranking: string | null; engagement_ranking: string | null; conversion_ranking: string | null;
  breakdown_type: string | null; breakdown_value: string | null;
};
export type AnalysisReport = {
  id: string; title: string; file_name: string; goal: string; currency: string;
  target_cost_per_result: number | null; profit_per_sale: number | null; closing_rate: number | null;
  date_from: string; date_to: string; row_count: number;
};
export type BreakdownFile = { id: string; dimension: OfflineBreakdownDimension; file_name: string; row_count: number; created_at: string };
export type BreakdownRow = {
  id: string; file_id: string; dimension: OfflineBreakdownDimension; day: string | null; campaign: string | null;
  dimension_value: string; spend: number; impressions: number; reach: number | null; frequency: number | null;
  link_clicks: number | null; results: number; video_3s: number | null; thruplays: number | null;
};
type Props = {
  report: AnalysisReport; rows: AnalysisRow[]; previousRows: AnalysisRow[];
  from: string; to: string; periodLabel: string; compared: boolean;
  targetValue: number; onSetTarget: (value: number) => void;
  breakdownFiles: BreakdownFile[]; breakdownRows: BreakdownRow[];
  onAddBreakdown: (dimension: OfflineBreakdownDimension) => void;
  onDeleteBreakdown: (file: BreakdownFile) => void;
  formatMoney: (value: number) => string; resultLabel: string;
};
type Totals = { spend: number; results: number; impressions: number; clicks: number; reach: number; frequency: number; video3s: number; thruplays: number; rows: number };
type Benchmarks = { ctr: number; frequency: number; cpm: number; hook: number; hold: number; resultPerClick: number };
const defaultBenchmarks: Benchmarks = { ctr: .5, frequency: 1.6, cpm: 30000, hook: 20, hold: 20, resultPerClick: 15 };
const dimensionLabels: Record<OfflineBreakdownDimension, string> = { placement: 'Placement', age: 'Umur', gender: 'Gender' };

function total(rows: AnalysisRow[]): Totals {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedFrequency = rows.reduce((sum, row) => sum + (row.frequency ?? 0) * Math.max(row.impressions, 1), 0);
  const frequencyWeight = rows.reduce((sum, row) => sum + (row.frequency === null ? 0 : Math.max(row.impressions, 1)), 0);
  return {
    spend: rows.reduce((sum, row) => sum + row.spend, 0),
    results: rows.reduce((sum, row) => sum + row.results, 0),
    impressions,
    clicks: rows.reduce((sum, row) => sum + (row.link_clicks ?? 0), 0),
    reach: rows.reduce((sum, row) => sum + (row.reach ?? 0), 0),
    frequency: frequencyWeight ? weightedFrequency / frequencyWeight : 0,
    video3s: rows.reduce((sum, row) => sum + (row.video_3s ?? 0), 0),
    thruplays: rows.reduce((sum, row) => sum + (row.thruplays ?? 0), 0),
    rows: rows.length,
  };
}
function percent(value: number, base: number) { return base ? value / base * 100 : 0; }
function quadrantColor(xGood: boolean, yGood: boolean) { return xGood && yGood ? '#c6e1d0' : !xGood && !yGood ? '#f6d8d5' : '#e8e1d5'; }
function costPerResult(value: Totals) { return value.results ? value.spend / value.results : 0; }
function groupBy<T>(rows: T[], key: (row: T) => string, metrics: (row: T) => AnalysisRow): Array<{ name: string; rows: AnalysisRow[]; stats: Totals }> {
  const groups = new Map<string, AnalysisRow[]>();
  for (const item of rows) {
    const row = metrics(item), name = key(item) || 'Tanpa nama';
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, rows: items, stats: total(items) })).sort((a, b) => b.stats.spend - a.stats.spend);
}
function delta(current: number, previous: number) {
  if (!previous) return 'Tidak ada pembanding';
  const change = (current - previous) / previous * 100;
  return `${change > 0 ? 'Naik' : change < 0 ? 'Turun' : 'Tetap'} ${Math.abs(change).toFixed(0)}%`;
}
function dateLabel(value: string) { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)); }
function statusFor(value: number, target: number) { return !value ? 'Belum ada hasil' : !target ? 'Target belum diatur' : value <= target ? 'Di bawah target' : value <= target * 1.2 ? 'Sedikit di atas target' : 'Jauh di atas target'; }
function MetricCard({ name, value, note, state }: { name: string; value: string; note: string; state?: 'good' | 'bad' | 'neutral' }) {
  return <Card className="analyzer-kpi"><div className="analyzer-kpi-top"><span className={`analyzer-kpi-dot ${state ?? 'neutral'}`}/><span>{name}</span><button type="button" title={note} aria-label={`${name}: ${note}`}>?</button></div><b>{value}</b><small>{note}</small></Card>;
}

export default function OfflineTrackingAnalysis({ report, rows, previousRows, from, to, periodLabel, compared, targetValue, onSetTarget, breakdownFiles, breakdownRows, onAddBreakdown, onDeleteBreakdown, formatMoney, resultLabel }: Props) {
  const current = useMemo(() => total(rows), [rows]);
  const prior = useMemo(() => total(previousRows), [previousRows]);
  const ads = useMemo(() => groupBy(rows, row => row.ad_name || 'Tanpa nama iklan', row => row), [rows]);
  const adsets = useMemo(() => groupBy(rows, row => `${row.campaign} / ${row.adset || 'Tanpa ad set'}`, row => row), [rows]);
  const campaigns = useMemo(() => groupBy(rows, row => row.campaign, row => row), [rows]);
  const days = useMemo(() => groupBy(rows, row => row.day, row => row).sort((a, b) => a.name.localeCompare(b.name)), [rows]);
  const priorAds = useMemo(() => new Map(groupBy(previousRows, row => row.ad_name || 'Tanpa nama iklan', row => row).map(item => [item.name, item.stats])), [previousRows]);
  const key = `arenka-offline-analysis:${report.id}:${from}:${to}`;
  const [qualified, setQualified] = useState('');
  const [closings, setClosings] = useState('');
  const [benchmarks, setBenchmarks] = useState<Benchmarks>(defaultBenchmarks);
  const [breakdownTab, setBreakdownTab] = useState<OfflineBreakdownDimension>('placement');
  const [openCampaigns, setOpenCampaigns] = useState<Record<string, boolean>>({});
  const [budgetModes, setBudgetModes] = useState<Record<string, 'cbo' | 'abo'>>({});
  const [showBenchmarkEdit, setShowBenchmarkEdit] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}') as { qualified?: string; closings?: string; benchmarks?: Partial<Benchmarks> };
      setQualified(saved.qualified ?? ''); setClosings(saved.closings ?? '');
      setBenchmarks({ ...defaultBenchmarks, ...saved.benchmarks });
    } catch { setQualified(''); setClosings(''); setBenchmarks(defaultBenchmarks); }
  }, [key]);
  useEffect(() => {
    try { setBudgetModes(JSON.parse(localStorage.getItem(`arenka-offline-budget:${report.id}`) || '{}')); } catch { setBudgetModes({}); }
  }, [report.id]);
  const persist = (next: { qualified?: string; closings?: string; benchmarks?: Benchmarks }) => {
    const data = { qualified, closings, benchmarks, ...next };
    localStorage.setItem(key, JSON.stringify(data));
  };
  const setQuality = (field: 'qualified' | 'closings', value: string) => {
    const next = field === 'qualified' ? { qualified: value } : { closings: value };
    field === 'qualified' ? setQualified(value) : setClosings(value); persist(next);
  };
  const setBenchmark = (field: keyof Benchmarks, value: string) => {
    const number = Number(value), next = { ...benchmarks, [field]: Number.isFinite(number) && number >= 0 ? number : 0 };
    setBenchmarks(next); persist({ benchmarks: next });
  };
  const setBudgetMode = (campaign: string, mode: 'cbo' | 'abo') => {
    const next = { ...budgetModes, [campaign]: mode };
    setBudgetModes(next); localStorage.setItem(`arenka-offline-budget:${report.id}`, JSON.stringify(next));
  };

  const ctr = percent(current.clicks, current.impressions);
  const cpc = current.clicks ? current.spend / current.clicks : 0;
  const cpm = current.impressions ? current.spend / current.impressions * 1000 : 0;
  const cpr = costPerResult(current);
  const clickToResult = percent(current.results, current.clicks);
  const hookRate = percent(current.video3s, current.impressions);
  const holdRate = percent(current.thruplays, current.video3s);
  const frequencyPerDay = days.length ? days.reduce((sum, item) => sum + item.stats.frequency, 0) / days.length : current.frequency;
  const qualifiedNumber = Number(qualified) || 0, closingNumber = Number(closings) || 0;
  const closingRateFromResults = current.results ? closingNumber / current.results : 0;
  const suggestedTarget = Number(report.profit_per_sale) > 0 && closingRateFromResults > 0 ? Number(report.profit_per_sale) * closingRateFromResults : 0;
  const overallStatus = statusFor(cpr, targetValue);
  const bestAd = ads.filter(item => item.stats.results > 0).sort((a, b) => costPerResult(a.stats) - costPerResult(b.stats))[0];
  const worstAd = ads.filter(item => item.stats.results > 0).sort((a, b) => costPerResult(b.stats) - costPerResult(a.stats))[0];
  const goodAds = ads.filter(item => targetValue && item.stats.results && costPerResult(item.stats) <= targetValue).length;
  const overTargetAds = ads.filter(item => targetValue && item.stats.results && costPerResult(item.stats) > targetValue).length;
  const recommendations = [
    !current.clicks ? 'Sertakan kolom Link clicks agar CTR, CPC, dan tahap klik ke hasil dapat dihitung.' : '',
    !targetValue ? 'Tetapkan target biaya per hasil dari target bisnis Anda sebelum mengambil keputusan anggaran.' : '',
    targetValue && overTargetAds ? `${overTargetAds} iklan berada di atas target. Periksa diagnosa iklan dan creative sebelum mengurangi atau memindahkan anggaran.` : '',
    current.frequency > benchmarks.frequency ? `Frekuensi rata-rata ${current.frequency.toFixed(2)}× melampaui acuan ${benchmarks.frequency.toFixed(1)}×; periksa kejenuhan audiens.` : '',
    !breakdownFiles.length ? 'Tambahkan file breakdown placement, umur, atau gender untuk melihat segmen yang paling efisien.' : '',
  ].filter(Boolean);
  if (!recommendations.length) recommendations.push('Pantau tren dan kualitas lead pada periode berikutnya sebelum menaikkan anggaran bertahap.');

  const matrixDefs = [
    { key: 'reach-frequency', title: 'Reach × Frekuensi', sub: 'Audience masih luas atau mulai jenuh?', x: (s: Totals) => s.reach, y: (s: Totals) => s.frequency, xLabel: 'Reach', yLabel: 'Frekuensi', xHigh: true, yHigh: false, xLimit: Math.max(1, current.reach / Math.max(ads.length, 1)), yLimit: benchmarks.frequency, xDisplay: (v: number) => Math.round(v).toLocaleString('id-ID'), yDisplay: (v: number) => `${v.toFixed(2)}×`, note: 'Reach per iklan dibanding batas frekuensi.' },
    { key: 'frequency-ctr', title: 'Frekuensi × CTR', sub: 'Sudah waktunya menyiapkan creative baru?', x: (s: Totals) => s.frequency, y: (s: Totals) => percent(s.clicks, s.impressions), xLabel: 'Frekuensi', yLabel: 'CTR link', xHigh: false, yHigh: true, xLimit: benchmarks.frequency, yLimit: benchmarks.ctr, xDisplay: (v: number) => `${v.toFixed(2)}×`, yDisplay: (v: number) => `${v.toFixed(2)}%`, note: 'Frekuensi harian dan CTR link.' },
    { key: 'cpm-cpr', title: 'CPM × Cost per result', sub: 'Tayangan murah, apakah hasilnya ikut murah?', x: (s: Totals) => s.impressions ? s.spend / s.impressions * 1000 : 0, y: costPerResult, xLabel: 'CPM', yLabel: 'Biaya per hasil', xHigh: false, yHigh: false, xLimit: benchmarks.cpm, yLimit: targetValue, xDisplay: (v: number) => formatMoney(v), yDisplay: (v: number) => formatMoney(v), note: 'Biaya hasil dibanding target laporan.' },
    { key: 'cpm-ctr', title: 'CPM × CTR', sub: 'Mahal karena lelang atau iklan kurang relevan?', x: (s: Totals) => s.impressions ? s.spend / s.impressions * 1000 : 0, y: (s: Totals) => percent(s.clicks, s.impressions), xLabel: 'CPM', yLabel: 'CTR link', xHigh: false, yHigh: true, xLimit: benchmarks.cpm, yLimit: benchmarks.ctr, xDisplay: (v: number) => formatMoney(v), yDisplay: (v: number) => `${v.toFixed(2)}%`, note: 'CPM dan CTR link dari export.' },
    { key: 'hook-hold', title: 'Hook rate × Hold rate', sub: 'Videonya kuat di pembuka, diisi, atau keduanya?', x: (s: Totals) => percent(s.video3s, s.impressions), y: (s: Totals) => percent(s.thruplays, s.video3s), xLabel: 'Hook rate', yLabel: 'Hold rate', xHigh: true, yHigh: true, xLimit: benchmarks.hook, yLimit: benchmarks.hold, xDisplay: (v: number) => `${v.toFixed(1)}%`, yDisplay: (v: number) => `${v.toFixed(1)}%`, note: 'Video plays 3 detik dan ThruPlays.' },
    { key: 'hook-ctr', title: 'Hook rate × CTR', sub: 'Ditonton, tetapi apakah ajakannya berhasil?', x: (s: Totals) => percent(s.video3s, s.impressions), y: (s: Totals) => percent(s.clicks, s.impressions), xLabel: 'Hook rate', yLabel: 'CTR link', xHigh: true, yHigh: true, xLimit: benchmarks.hook, yLimit: benchmarks.ctr, xDisplay: (v: number) => `${v.toFixed(1)}%`, yDisplay: (v: number) => `${v.toFixed(2)}%`, note: 'Membandingkan pembuka video dengan klik.' },
    { key: 'ctr-conversion', title: 'CTR × Klik → hasil', sub: 'Apakah orang yang mengeklik lanjut menjadi hasil?', x: (s: Totals) => percent(s.clicks, s.impressions), y: (s: Totals) => percent(s.results, s.clicks), xLabel: 'CTR link', yLabel: 'Hasil / klik', xHigh: true, yHigh: true, xLimit: benchmarks.ctr, yLimit: benchmarks.resultPerClick, xDisplay: (v: number) => `${v.toFixed(2)}%`, yDisplay: (v: number) => `${v.toFixed(1)}%`, note: 'Klik ke hasil Meta, bukan event website.' },
    { key: 'ctr-cpr', title: 'CTR × Cost per result', sub: 'Klik menarik dan hasil tetap efisien?', x: (s: Totals) => percent(s.clicks, s.impressions), y: costPerResult, xLabel: 'CTR link', yLabel: 'Biaya per hasil', xHigh: true, yHigh: false, xLimit: benchmarks.ctr, yLimit: targetValue, xDisplay: (v: number) => `${v.toFixed(2)}%`, yDisplay: (v: number) => formatMoney(v), note: 'Biaya per hasil dibanding target laporan.' },
  ];
  const matrixResults = matrixDefs.map(def => {
    const points = ads.map((item, index) => ({ name: item.name, stats: item.stats, index: index + 1, x: def.x(item.stats), y: def.y(item.stats) })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    const xMax = Math.max(def.xLimit * 2, ...points.map(point => point.x), 1), yMax = Math.max(def.yLimit * 2, ...points.map(point => point.y), 1);
    const xCut = Math.min(.9, Math.max(.1, def.xLimit / xMax)), yCut = Math.min(.9, Math.max(.1, def.yLimit / yMax));
    const classified = points.map(point => {
      const xGood = def.xHigh ? point.x >= def.xLimit : point.x <= def.xLimit;
      const yGood = def.yHigh ? point.y >= def.yLimit : point.y <= def.yLimit;
      const state = xGood && yGood ? 'good' : !xGood && !yGood ? 'bad' : 'watch';
      return { ...point, xGood, yGood, state };
    });
    return { def, points: classified, xMax, yMax, xCut, yCut };
  });
  const primaryDiagnosis = (name: string) => {
    for (const matrix of matrixResults) {
      const match = matrix.points.find(point => point.name === name);
      if (match?.state === 'bad') {
        if (matrix.def.key === 'ctr-conversion') return { title: 'Banyak klik, hasil sedikit', text: 'Tinjau kesesuaian penawaran, halaman tujuan, atau tindak lanjut setelah klik.', source: matrix.def.title };
        if (matrix.def.key === 'frequency-ctr' || matrix.def.key === 'reach-frequency') return { title: 'Jangkauan mulai jenuh', text: 'Perluas audience atau siapkan variasi creative setelah memeriksa tren.', source: matrix.def.title };
        if (matrix.def.key.includes('hook')) return { title: 'Creative perlu ditinjau', text: 'Uji pembuka atau pesan utama; data video menunjukkan titik lemah di bagian awal atau isi.', source: matrix.def.title };
        return { title: 'Biaya melewati acuan', text: 'Tinjau kualitas audience dan biaya sebelum meneruskan atau memindahkan anggaran.', source: matrix.def.title };
      }
    }
    return { title: 'Belum ada masalah besar', text: 'Tidak ada metrik yang berada di dua sisi kurang baik sekaligus berdasarkan acuan saat ini.', source: '' };
  };

  return <div className="analyzer-report-flow">
    <section className="analyzer-overview">
      <h2>Overview</h2><p>Ringkasan kondisi iklan {periodLabel.toLowerCase()} dalam bahasa sehari-hari. Baca bagian ini dulu, lalu buka Detail analisis untuk melihat alasan di balik kesimpulan.</p>
      <Card className="analyzer-summary">
        <div className="analyzer-summary-status"><span className={`offline-status ${overallStatus === 'Di bawah target' ? 'good' : overallStatus.includes('atas') ? 'attention' : 'neutral'}`}><i/>{overallStatus === 'Di bawah target' ? 'Sehat, sesuai target' : overallStatus}</span><small>Ringkasan {dateLabel(from)} – {dateLabel(to)}</small></div>
        <p className="analyzer-status-description">Status dinilai dari biaya per {resultLabel.toLowerCase()} dibanding target laporan.</p>
        <h3>{current.results ? `${periodLabel} iklan menghasilkan ${current.results.toLocaleString('id-ID')} ${resultLabel.toLowerCase()} dengan biaya rata-rata ${formatMoney(cpr)} per ${resultLabel.toLowerCase()}${targetValue ? `, ${cpr <= targetValue ? 'masih di bawah' : 'berada di atas'} target ${formatMoney(targetValue)}` : ''}.` : `Belum ada ${resultLabel.toLowerCase()} pada periode yang dipilih.`}</h3>
        {compared && previousRows.length > 0 && <p>Dibanding periode sebelumnya, biaya iklan {delta(current.spend, prior.spend).toLowerCase()} dan biaya per hasil {delta(cpr, costPerResult(prior)).toLowerCase()}.</p>}
        <p className="analyzer-summary-caption">Tiga angka utama: uang yang keluar, hasil yang didapat, dan biaya untuk setiap hasil.</p>
        <div className="analyzer-summary-numbers"><div><span>Uang terpakai</span><b>{formatMoney(current.spend)}</b>{compared&&<small>{delta(current.spend,prior.spend)} vs periode lalu</small>}</div><div><span>{resultLabel} didapat</span><b>{current.results.toLocaleString('id-ID')}</b>{compared&&<small>{delta(current.results,prior.results)} vs periode lalu</small>}</div><div><span><i className={current.results&&targetValue&&cpr<=targetValue?'good':''}/>Biaya per {resultLabel.toLowerCase()}</span><b>{current.results?formatMoney(cpr):'—'}</b>{targetValue&&<small>Target {formatMoney(targetValue)}</small>}</div></div>
        <div className="analyzer-summary-bottom"><div><h3>Yang perlu kamu tahu</h3><ul>{bestAd&&<li>Iklan terbaik: <b>{bestAd.name}</b>, {bestAd.stats.results} hasil dengan {formatMoney(costPerResult(bestAd.stats))} per hasil.</li>}{worstAd&&worstAd.name!==bestAd?.name&&<li>Perlu ditinjau: <b>{worstAd.name}</b>, {formatMoney(costPerResult(worstAd.stats))} per hasil.</li>}{!bestAd&&<li>Belum ada iklan yang menghasilkan; periksa status delivery dan pemetaan kolom.</li>}</ul></div><div><h3>Yang perlu dilakukan</h3><ol>{recommendations.slice(0,3).map(item=><li key={item}>{item}</li>)}</ol></div></div>
      </Card>
    </section>
    <div className="analyzer-section-heading"><h2>Detail analisis</h2><p>Angka lengkap, diagnosa, dan alasan di balik ringkasan di atas.</p></div>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Angka lengkap</h2><p>Metrik dibandingkan dengan periode sebelumnya jika data tersedia.</p></div></div><div className="analyzer-kpi-grid">
      <MetricCard name="Spend" value={formatMoney(current.spend)} note={compared ? `${delta(current.spend, prior.spend)} vs periode lalu` : `${current.rows} baris`} />
      <MetricCard name={resultLabel} value={current.results.toLocaleString('id-ID')} note={compared ? `${delta(current.results, prior.results)} vs periode lalu` : 'Total hasil dari file'} />
      <MetricCard name={`Cost per ${resultLabel.toLowerCase()}`} value={current.results ? formatMoney(cpr) : '—'} note={targetValue ? `Target ${formatMoney(targetValue)}` : 'Tambahkan target di bagian kualitas lead'} state={targetValue && cpr <= targetValue ? 'good' : targetValue && cpr > targetValue ? 'bad' : 'neutral'} />
      <MetricCard name="CTR link" value={current.impressions ? `${ctr.toFixed(2)}%` : '—'} note={compared ? `${delta(ctr, percent(prior.clicks, prior.impressions))} vs periode lalu` : 'Link clicks / impressions'} state={ctr >= benchmarks.ctr ? 'good' : 'bad'} />
      <MetricCard name="CPC" value={current.clicks ? formatMoney(cpc) : '—'} note={compared ? `${delta(cpc, prior.clicks ? prior.spend / prior.clicks : 0)} vs periode lalu` : 'Biaya per link click'} />
      <MetricCard name="CPM" value={current.impressions ? formatMoney(cpm) : '—'} note={compared ? `${delta(cpm, prior.impressions ? prior.spend / prior.impressions * 1000 : 0)} vs periode lalu` : 'Biaya per 1.000 impressions'} state={cpm && cpm <= benchmarks.cpm ? 'good' : 'bad'} />
      <MetricCard name="Frekuensi harian" value={frequencyPerDay ? `${frequencyPerDay.toFixed(2)}×` : '—'} note={`Acuan ${benchmarks.frequency.toFixed(1)}×`} state={frequencyPerDay <= benchmarks.frequency ? 'good' : 'bad'} />
      <MetricCard name="Klik → hasil" value={current.clicks ? `${clickToResult.toFixed(1)}%` : '—'} note="Results / link clicks" state={clickToResult >= benchmarks.resultPerClick ? 'good' : 'bad'} />
      <MetricCard name="Hook rate (video)" value={current.impressions ? `${hookRate.toFixed(1)}%` : '—'} note={current.video3s ? `${holdRate.toFixed(1)}% hold rate · ThruPlays / video plays` : 'Perlu video plays 3 detik'} state={hookRate >= benchmarks.hook ? 'good' : 'neutral'} />
    </div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Tren harian</h2><p>Spend per hari dan biaya per hasil selama periode terpilih.</p></div><Badge>{days.length} hari</Badge></div>{days.length ? <div className="analyzer-trend-card"><div className="analyzer-trend-legend"><span><i className="spend"/>Spend per hari</span><span><i className="cpr"/>Cost per result</span>{targetValue>0&&<span><i className="target"/>Target {formatMoney(targetValue)}</span>}</div><div className="analyzer-trend-plot"><span className="analyzer-trend-axis left">Spend</span><svg viewBox={`0 0 ${Math.max(620,days.length*88)} 260`} role="img" aria-label="Grafik spend dan biaya per hasil per hari" preserveAspectRatio="none">
      {(() => { const width=Math.max(620,days.length*88), left=44,right=width-18,top=24,bottom=212, plotW=right-left, plotH=bottom-top, maxSpend=Math.max(1,...days.map(item=>item.stats.spend)), maxCpr=Math.max(targetValue,1,...days.map(item=>costPerResult(item.stats)))*1.2, step=plotW/days.length, line=days.map((item,index)=>{const x=left+step*(index+.5),value=costPerResult(item.stats),y=bottom-(value/maxCpr)*plotH;return `${index?'L':'M'}${x},${y}`}).join(' '),targetY=bottom-(targetValue/maxCpr)*plotH;return <>{days.map((item,index)=>{const height=item.stats.spend/maxSpend*plotH,x=left+step*(index+.18),barWidth=step*.64;return <g key={item.name}><rect x={x} y={bottom-height} width={barWidth} height={height} rx="4" fill="#dce6f5"><title>{dateLabel(item.name)} · Spend {formatMoney(item.stats.spend)} · {item.stats.results} hasil</title></rect><text x={x+barWidth/2} y={bottom+24} textAnchor="middle">{dateLabel(item.name)}</text></g>})}<path d={line} fill="none" stroke="#07385e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{days.map((item,index)=>{const x=left+step*(index+.5),y=bottom-(costPerResult(item.stats)/maxCpr)*plotH;return <circle key={`cpr-${item.name}`} cx={x} cy={y} r="4" fill="#07385e"><title>{dateLabel(item.name)} · Cost per result {formatMoney(costPerResult(item.stats))}</title></circle>})}{targetValue>0&&<><line x1={left} x2={right} y1={targetY} y2={targetY} stroke="#ca493f" strokeDasharray="6 5"/><text x={right} y={targetY-7} textAnchor="end" className="analyzer-target-label">Target {formatMoney(targetValue)}</text></>}</>})()}
    </svg><span className="analyzer-trend-axis right">Biaya / hasil</span></div></div> : <div className="analyzer-breakdown-empty"><b>Belum ada baris pada periode ini.</b><span>Ubah periode atau periksa tanggal yang diimpor.</span></div>}</section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Kualitas leads</h2><p>Meta tidak tahu lead mana yang serius. Isi angka dari WhatsApp atau CRM agar penilaian tidak berhenti di cost per result.</p></div></div><div className="analyzer-quality-panel"><div className="analyzer-quality-inputs"><label>Leads berkualitas periode ini<Input type="number" min="0" value={qualified} onChange={event=>setQuality('qualified',event.target.value)} placeholder="Misalnya 18"/></label><label>Closing periode ini<Input type="number" min="0" value={closings} onChange={event=>setQuality('closings',event.target.value)} placeholder="Misalnya 3"/></label></div><div className="analyzer-quality-results"><p>Isi angkanya untuk melihat cost per leads berkualitas dan closing rate periode ini.</p>{qualifiedNumber||closingNumber?<div className="analyzer-quality-calcs"><span><small>Cost per lead berkualitas</small><b>{qualifiedNumber?formatMoney(current.spend/qualifiedNumber):'—'}</b></span><span><small>Closing rate</small><b>{current.results&&closingNumber?`${percent(closingNumber,current.results).toFixed(1)}%`:'—'}</b></span><span><small>Cost per closing</small><b>{closingNumber?formatMoney(current.spend/closingNumber):'—'}</b></span></div>:null}{suggestedTarget>0&&<div className="analyzer-target-suggestion"><b>Dari datamu sendiri:</b> sekitar {closingNumber} dari {current.results} hasil menjadi closing ({(closingRateFromResults*100).toFixed(1)}%), dengan untung {formatMoney(Number(report.profit_per_sale))} per penjualan. Batas biaya per hasil sekitar <b>{formatMoney(suggestedTarget)}</b>.<Button variant="secondary" size="sm" onClick={()=>onSetTarget(suggestedTarget)}>Pakai sebagai target</Button></div>}</div></div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Alur funnel</h2><p>Di tahap mana orang paling banyak berhenti. Bandingkan tahap pertama yang lemah sebelum mengambil keputusan di bawah.</p></div></div><div className="analyzer-funnel-panel">{[
      { label:'Impresi', value:current.impressions, rate:100, note:'' },
      { label:report.goal.startsWith('ctwa')||report.goal==='lpwa'?'Klik ke WhatsApp':'Link clicks', value:current.clicks, rate:percent(current.clicks,current.impressions), note:`CTR ${ctr.toFixed(2)}% · acuan ${benchmarks.ctr.toFixed(2)}%` },
      { label:resultLabel, value:current.results, rate:percent(current.results,current.impressions), note:`Konversi klik ${clickToResult.toFixed(1)}% · acuan ${benchmarks.resultPerClick.toFixed(0)}%` },
    ].map((item,index)=><div className="analyzer-funnel-row" key={item.label}><span>{item.label}</span><div className="analyzer-funnel-track"><i style={{width:`${Math.max(item.value?3:0,Math.min(100,item.rate))}%`}}/></div><b>{item.value.toLocaleString('id-ID')}</b><small>{item.note}</small></div>)}</div><div className={`analyzer-funnel-message ${ctr>=benchmarks.ctr&&clickToResult>=benchmarks.resultPerClick?'ok':'attention'}`}>{current.clicks?ctr<benchmarks.ctr?'CTR berada di bawah acuan. Tinjau creative, pesan, dan audiens sebelum menilai tahap setelah klik.':clickToResult<benchmarks.resultPerClick?'Klik cukup menarik, tetapi konversi ke hasil di bawah acuan. Periksa proses setelah klik dan kualitas tindak lanjut.':'Semua tahap berada di atas atau mendekati acuan. Pantau konsistensinya di periode berikutnya.':'Funnel belum lengkap. Impor Link clicks dan Results agar perpindahan antar tahap bisa dihitung.'}</div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Breakdown audience</h2><p>Placement, umur, dan gender mana yang paling efisien. Tambahkan satu file untuk setiap jenis breakdown.</p></div><Button onClick={()=>onAddBreakdown(breakdownTab)}>+ Tambah file {dimensionLabels[breakdownTab].toLowerCase()}</Button></div><div className="analyzer-breakdown-tabs" role="tablist" aria-label="Pilih dimensi breakdown">{(['placement','age','gender'] as const).map(dimension=><button key={dimension} role="tab" aria-selected={breakdownTab===dimension} className={breakdownTab===dimension?'active':''} onClick={()=>setBreakdownTab(dimension)}>{dimensionLabels[dimension]}</button>)}</div>{(() => {const files=breakdownFiles.filter(file=>file.dimension===breakdownTab),entries=breakdownRows.filter(row=>row.dimension===breakdownTab&&(row.day===null||row.day>=from&&row.day<=to)),groups=new Map<string,BreakdownRow[]>();for(const row of entries)groups.set(row.dimension_value,[...(groups.get(row.dimension_value)??[]),row]);const items=[...groups.entries()].map(([name,values])=>({name,values,spend:values.reduce((sum,row)=>sum+row.spend,0),results:values.reduce((sum,row)=>sum+row.results,0),impressions:values.reduce((sum,row)=>sum+row.impressions,0),clicks:values.reduce((sum,row)=>sum+(row.link_clicks??0),0)})).sort((a,b)=>b.spend-a.spend),avg=current.results?current.spend/current.results:0,best=items.filter(item=>item.results>0).sort((a,b)=>a.spend/a.results-b.spend/b.results)[0],worst=items.filter(item=>item.results===0&&item.spend>0).sort((a,b)=>b.spend-a.spend)[0];return <>{items.length>0?<><div className="analyzer-breakdown-highlights">{best&&<p><b>{best.name}</b> paling efisien: {formatMoney(best.spend/best.results)} per hasil{avg?`, ${Math.max(0,Math.round((1-best.spend/best.results/avg)*100))}% lebih murah dari rata-rata.`:'.'}</p>}{worst&&<p><b>{worst.name}</b> menghabiskan {formatMoney(worst.spend)} tanpa hasil pada data ini.</p>}</div><div className="offline-table-scroll"><table className="offline-table analyzer-breakdown-table"><thead><tr><th>{dimensionLabels[breakdownTab]}</th><th>Porsi spend</th><th>{resultLabel}</th><th>Cost per result</th><th>CTR</th><th>CPM</th></tr></thead><tbody>{items.map(item=><tr key={item.name}><td><b>{item.name}</b></td><td><div className="analyzer-spend-share"><i style={{width:`${current.spend?item.spend/current.spend*100:0}%`}}/><span>{current.spend?Math.round(item.spend/current.spend*100):0}%</span></div></td><td>{item.results}</td><td>{item.results?formatMoney(item.spend/item.results):'—'}</td><td>{item.impressions?`${percent(item.clicks,item.impressions).toFixed(2)}%`:'—'}</td><td>{item.impressions?formatMoney(item.spend/item.impressions*1000):'—'}</td></tr>)}</tbody></table></div></>:<div className="analyzer-breakdown-empty"><b>File {dimensionLabels[breakdownTab].toLowerCase()} belum ditambahkan.</b><span>Export breakdown dari Ads Manager dan impor file terpisah untuk melihat biaya, hasil, dan efisiensi tiap segmen.</span><Button variant="secondary" size="sm" onClick={()=>onAddBreakdown(breakdownTab)}>Tambah file {dimensionLabels[breakdownTab].toLowerCase()}</Button></div>}<div className="analyzer-breakdown-files">{files.map(file=><div key={file.id}><span>{file.file_name} · {file.row_count} baris</span><button onClick={()=>onDeleteBreakdown(file)}>Hapus</button></div>)}</div><p className="analyzer-source-note">Segmen dengan kurang dari 3 hasil tidak dijadikan patokan terbaik atau termahal. Data mengikuti periode pada file bila kolom tanggal tersedia.</p></>})()}</section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Matriks diagnosa</h2><p>Setiap titik adalah satu iklan, ukurannya mengikuti spend. Garis tengah menunjukkan angka acuan yang bisa kamu ubah di sini.</p></div></div><div className="analyzer-benchmark-note"><b>Angka acuan adalah patokan umum untuk membaca data, bukan jaminan hasil.</b> Sesuaikan dengan performa dan margin bisnis Anda.<button onClick={()=>setShowBenchmarkEdit(value=>!value)}>{showBenchmarkEdit?'Tutup pengaturan':'Ubah angka acuan di sini'}</button>{showBenchmarkEdit&&<div className="analyzer-benchmark-grid">{([['ctr','CTR link (%)'],['frequency','Frekuensi harian'],['cpm','CPM'],['hook','Hook rate (%)'],['hold','Hold rate (%)'],['resultPerClick','Klik → hasil (%)']] as Array<[keyof Benchmarks,string]>).map(([field,label])=><label key={field}>{label}<Input type="number" min="0" step="0.1" value={benchmarks[field]} onChange={event=>setBenchmark(field,event.target.value)}/></label>)}</div>}<small>{ads.length} iklan dengan data mencukupi ditampilkan; sumbu yang tidak tersedia akan ditandai.</small></div><div className="analyzer-matrix-grid">{matrixResults.map(({def,points,xMax,yMax,xCut,yCut})=>{const usable=points.filter(point=>point.stats.spend>0),bad=usable.filter(point=>point.state==='bad'),good=usable.filter(point=>point.state==='good'),watch=usable.filter(point=>point.state==='watch');return <Card className="analyzer-matrix-card" key={def.key}><div className="analyzer-matrix-head"><div><h3>{def.title}</h3><p>{def.sub}</p></div><button type="button" title={`${def.note} Acuan sumbu X: ${def.xDisplay(def.xLimit)}; sumbu Y: ${def.yDisplay(def.yLimit)}.`} aria-label={`Info ${def.title}`}>?</button></div>{usable.length>0?<><div className="analyzer-quadrant-wrap"><span className="scatter-y-label">{def.yLabel} · {def.yDisplay(def.yLimit)} acuan</span><svg className="analyzer-quadrant" viewBox="0 0 300 200" role="img" aria-label={`Matriks ${def.title}`}><rect x="30" y="8" width="256" height="158" rx="8" fill="#f3f5f8"/><rect x="30" y="8" width={256*xCut} height={158*yCut} rx="8" fill={quadrantColor(!def.xHigh,def.yHigh)}/><rect x={30+256*xCut} y="8" width={256*(1-xCut)} height={158*yCut} rx="8" fill={quadrantColor(def.xHigh,def.yHigh)}/><rect x="30" y={8+158*yCut} width={256*xCut} height={158*(1-yCut)} rx="8" fill={quadrantColor(!def.xHigh,!def.yHigh)}/><rect x={30+256*xCut} y={8+158*yCut} width={256*(1-xCut)} height={158*(1-yCut)} rx="8" fill={quadrantColor(def.xHigh,!def.yHigh)}/><line x1={30+256*xCut} x2={30+256*xCut} y1="8" y2="166" stroke="#71839a" strokeDasharray="4 4"/><line x1="30" x2="286" y1={8+158*yCut} y2={8+158*yCut} stroke="#71839a" strokeDasharray="4 4"/>{usable.map(point=>{const x=30+Math.min(.97,point.x/xMax)*256,y=166-Math.min(.97,point.y/yMax)*158;return <g key={`${def.key}-${point.name}`}><circle cx={x} cy={y} r="9" fill="#063c63" stroke="white" strokeWidth="2"><title>{point.name} · {def.xLabel}: {def.xDisplay(point.x)} · {def.yLabel}: {def.yDisplay(point.y)}</title></circle><text x={x} y={y+3} textAnchor="middle">{point.index}</text></g>})}</svg><span className="scatter-x-label">{def.xLabel} · {def.xDisplay(def.xLimit)} acuan</span></div><div className="analyzer-quadrant-summary"><span className="good">Sehat · {good.length}</span><span className="watch">Pantau · {watch.length}</span><span className="bad">Perlu tindakan · {bad.length}</span></div>{bad.length>0&&<article className="analyzer-matrix-diagnosis bad"><small>Hasil diagnosa · {bad.length} iklan</small><b>{matrixDefs.findIndex(item=>item.key===def.key)+1}. {bad.length===1?bad[0].name:`${bad.length} iklan di kuadran perlu tindakan`}</b><p>{primaryDiagnosis(bad[0].name).text}</p><div>{bad.slice(0,5).map(point=><span key={point.name}>{point.name}</span>)}</div></article>}{good.length>0&&<article className="analyzer-matrix-diagnosis good"><small>Hasil diagnosa · {good.length} iklan</small><b>Sehat pada metrik ini</b><p>Pertahankan dan pantau tren. Satu matriks saja tidak cukup untuk menaikkan anggaran.</p><div>{good.slice(0,5).map(point=><span key={point.name}>{point.name}</span>)}</div></article>}</>:<div className="analyzer-matrix-empty">Matriks belum dapat dihitung. Impor {def.key.includes('hook')?'video plays 3 detik dan ThruPlays':def.key.includes('frequency')||def.key.includes('reach')?'Reach dan Frequency':def.key.includes('ctr')?'Link clicks dan Impressions':'Results dan target biaya'} di laporan.</div>}<p className="analyzer-source-note">{def.note} · Batas: X {def.xDisplay(def.xLimit)}, Y {def.yDisplay(def.yLimit)}.</p></Card>})}</div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Diagnosa per iklan</h2><p>Masalah utama yang terlihat pada matriks, dengan sumber metrik yang bisa ditelusuri.</p></div><Badge>{ads.length} iklan</Badge></div><div className="analyzer-ad-diagnoses">{ads.map((item,index)=>{const diagnosis=primaryDiagnosis(item.name);return <article key={item.name}><div className="analyzer-ad-number">{index+1}</div><div className="analyzer-ad-body"><b>{item.name}</b><small>{item.rows[0]?.adset||'Tanpa ad set'} · spend {formatMoney(item.stats.spend)} · {item.stats.results} {resultLabel.toLowerCase()} · {item.stats.results?formatMoney(costPerResult(item.stats)):'—'} per hasil</small><div className={`analyzer-diagnosis-result ${diagnosis.title==='Belum ada masalah besar'?'good':'bad'}`}><small>Hasil diagnosa</small><b>{diagnosis.title}</b><p>{diagnosis.text}</p>{diagnosis.source&&<small>Dari matriks {diagnosis.source}</small>}</div></div></article>})}</div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Cek creative</h2><p>Creative mana yang dipertahankan, disiapkan penggantinya, atau diganti setelah melihat cukup data.</p></div></div><div className="analyzer-creative-status"><span className="replace">Ganti sekarang · {ads.filter(item=>targetValue&&item.stats.results>0&&costPerResult(item.stats)>targetValue*1.2&&percent(item.stats.clicks,item.stats.impressions)<benchmarks.ctr).length} creative</span><span className="prepare">Siapkan pengganti · {ads.filter(item=>targetValue&&item.stats.results>0&&costPerResult(item.stats)>targetValue&&costPerResult(item.stats)<=targetValue*1.2).length} creative</span><span className="keep">Pertahankan · {ads.filter(item=>!targetValue||!item.stats.results||costPerResult(item.stats)<=targetValue).length} creative</span></div><div className="analyzer-creative-grid">{ads.map(item=>{const cprValue=costPerResult(item.stats),previous=priorAds.get(item.name),worsening=previous&&costPerResult(previous)>0&&cprValue>costPerResult(previous)*1.15,replace=Boolean(targetValue&&item.stats.results>0&&cprValue>targetValue*1.2&&percent(item.stats.clicks,item.stats.impressions)<benchmarks.ctr),prepare=Boolean(targetValue&&item.stats.results>0&&cprValue>targetValue&&!replace),status=replace?'Ganti sekarang':prepare?'Siapkan pengganti':'Pertahankan';return <article className={`analyzer-creative-card ${replace?'replace':prepare?'prepare':'keep'}`} key={item.name}><div className="analyzer-creative-title"><b>{item.name}</b><Badge>{status}</Badge></div><small>{item.rows[0]?.adset||'Tanpa ad set'} · {item.rows[0]?.campaign}</small><ul><li>{item.stats.results?`${formatMoney(cprValue)} per hasil${targetValue?` (target ${formatMoney(targetValue)})`:''}`:'Belum ada hasil pada periode ini.'}</li>{compared&&previous&&<li>Biaya per hasil {formatMoney(costPerResult(previous))} → {formatMoney(cprValue)}{worsening?' · naik dari periode sebelumnya':''}</li>}<li>{item.stats.impressions?`CTR ${percent(item.stats.clicks,item.stats.impressions).toFixed(2)}%`:'CTR tidak tersedia'} · frekuensi {item.stats.frequency?`${item.stats.frequency.toFixed(1)}×`:'—'}</li><li>{item.stats.video3s?`Hook ${percent(item.stats.video3s,item.stats.impressions).toFixed(1)}%, hold ${percent(item.stats.thruplays,item.stats.video3s).toFixed(1)}%`:'Data video belum tersedia'}</li></ul><b className="analyzer-creative-action">Aksi: {replace?'Uji sudut pesan atau opening baru dan periksa funnel setelah klik.':prepare?'Siapkan 1–2 variasi creative baru untuk diuji dengan audience yang sama.':'Pertahankan sementara dan pantau hasil, CTR, serta frekuensi.'}</b></article>})}</div></section>
    <section className="analyzer-subsection"><div className="analyzer-report-heading"><div><h2>Keputusan per campaign dan ad set</h2><p>Setiap campaign dinilai dari totalnya dibanding target, lalu cek kondisi ad set di dalamnya. Pilih CBO atau ABO supaya saran anggaran tepat.</p></div></div><div className="analyzer-budget-table"><div className="analyzer-budget-header"><span>Campaign / ad set</span><span>Spend</span><span>{resultLabel}</span><span>Cost per result</span><span>Keputusan</span></div>{campaigns.map(campaign=>{const mode=budgetModes[campaign.name]??(campaign.rows.some(row=>row.campaign_budget)?'cbo':'abo'),campaignAdsets=groupBy(campaign.rows,row=>row.adset||'Tanpa ad set',row=>row),campaignCpr=costPerResult(campaign.stats),good=campaignCpr&&targetValue&&campaignCpr<=targetValue,action=!campaign.stats.results?'Tinjau delivery dan data hasil':good&&campaignAdsets.filter(item=>item.stats.results>0&&costPerResult(item.stats)>targetValue).length?'Pertahankan campaign; tinjau ad set yang melewati target':good?'Pertahankan; pertimbangkan kenaikan bertahap':'Evaluasi creative dan alihkan budget bila tren berlanjut';return <div className="analyzer-budget-group" key={campaign.name}><div className="analyzer-budget-campaign"><div><b>{campaign.name}</b><small>Campaign · {campaignAdsets.length} ad set</small><div className="analyzer-budget-toggle"><span>Budget</span><button className={mode==='cbo'?'active':''} onClick={()=>setBudgetMode(campaign.name,'cbo')}>CBO</button><button className={mode==='abo'?'active':''} onClick={()=>setBudgetMode(campaign.name,'abo')}>ABO</button><small>Pilih supaya saran budget tepat</small></div><button className="analyzer-expand-adsets" onClick={()=>setOpenCampaigns(value=>({...value,[campaign.name]:!value[campaign.name]}))}>{openCampaigns[campaign.name]?'Sembunyikan':'Lihat'} {campaignAdsets.length} ad set</button></div><b>{formatMoney(campaign.stats.spend)}</b><b>{campaign.stats.results}</b><div><strong className={good?'good':'watch'}>{good?'Pertahankan':'Tinjau'}</strong><p>{action}. Biaya rata-rata {campaign.stats.results?formatMoney(campaignCpr):'—'} per hasil{targetValue?` dibanding target ${formatMoney(targetValue)}`:''}.</p></div></div>{openCampaigns[campaign.name]&&campaignAdsets.map(item=>{const itemCpr=costPerResult(item.stats),itemGood=Boolean(targetValue&&item.stats.results&&itemCpr<=targetValue),budget=mode==='cbo'?item.rows.find(row=>row.campaign_budget)?.campaign_budget:item.rows.find(row=>row.adset_budget)?.adset_budget;return <div className="analyzer-budget-adset" key={item.name}><div><b>{item.name}</b><small>{mode.toUpperCase()} · {budget?formatMoney(budget):'Budget tidak tersedia'}</small></div><span>{formatMoney(item.stats.spend)}</span><span>{item.stats.results}</span><div><strong className={itemGood?'good':'watch'}>{itemGood?'Pertahankan':'Tinjau'}</strong><p>{!item.stats.results?'Belum ada hasil. Periksa delivery.':itemGood?'Biaya per hasil berada di bawah target. Pantau kualitas hasil.':'Biaya per hasil melewati target. Periksa creative, CTR, dan tindak lanjut.'}</p><small>CTR {percent(item.stats.clicks,item.stats.impressions).toFixed(2)}% · CPM {item.stats.impressions?formatMoney(item.stats.spend/item.stats.impressions*1000):'—'}</small></div></div>})}</div>})}</div></section>
    <section className="analyzer-recommendations"><div className="analyzer-report-heading"><div><h2>Langkah berikutnya</h2><p>Urutkan dari yang paling mendesak. Lakukan satu per satu dan lihat dampaknya di periode berikutnya.</p></div></div><ol>{recommendations.map((item,index)=><li key={item}><span>{index+1}.</span>{item}</li>)}</ol></section>
  </div>;
}
