import type { AnalysisReport, AnalysisRow, BreakdownRow } from './offline-tracking-analysis';

const adSpecs = [
  { name: 'Video Testimoni Pembeli', campaign: 'CTWA | Promo Oktober', adset: 'Broad 25–45 | Jakarta', spend: 790141, results: 117, clicks: 330, plays: 10200, thruplays: 5200 },
  { name: 'Video Promo Harga', campaign: 'CTWA | Promo Oktober', adset: 'Broad 25–45 | Jakarta', spend: 639108, results: 34, clicks: 186, plays: 4200, thruplays: 900 },
  { name: 'Video Jamaah Bercerita', campaign: 'CTWA | Umroh Desember', adset: 'Broad 30–55 | Jabodetabek', spend: 626487, results: 76, clicks: 240, plays: 7200, thruplays: 4300 },
  { name: 'Gambar Jadwal Keberangkatan', campaign: 'CTWA | Umroh Desember', adset: 'Broad 30–55 | Jabodetabek', spend: 400412, results: 22, clicks: 90, plays: 0, thruplays: 0 },
  { name: 'Gambar Promo DP 0', campaign: 'CTWA | Promo Oktober', adset: 'Interest Properti & KPR', spend: 337766, results: 6, clicks: 55, plays: 0, thruplays: 0 },
  { name: 'Carousel Tipe Unit', campaign: 'CTWA | Promo Oktober', adset: 'Interest Properti & KPR', spend: 329446, results: 21, clicks: 83, plays: 0, thruplays: 0 },
  { name: 'Video FAQ Akad', campaign: 'CTWA | Umroh Desember', adset: 'Retarget IG Engagers', spend: 325466, results: 15, clicks: 68, plays: 13800, thruplays: 12800 },
];
const dates = Array.from({ length: 7 }, (_, index) => `2026-11-${String(index + 16).padStart(2, '0')}`);
const allocate = (value: number, index: number, count: number) => Math.floor(value / count) + (index < value % count ? 1 : 0);

export const offlineDemoReport: AnalysisReport = {
  id: 'offline-analysis-preview', title: 'Contoh analisis CTWA', file_name: 'data-contoh-ctwa.csv', goal: 'ctwa', currency: 'IDR',
  target_cost_per_result: 16684, profit_per_sale: 1500000, closing_rate: 1,
  date_from: dates[0], date_to: dates[6], row_count: dates.length * adSpecs.length,
};

export const offlineDemoRows: AnalysisRow[] = dates.flatMap((day, dayIndex) => adSpecs.map((ad, adIndex) => {
  const index = dayIndex * adSpecs.length + adIndex;
  return {
    id: `preview-${index}`, day, campaign: ad.campaign, adset: ad.adset, ad_name: ad.name,
    spend: allocate(ad.spend, dayIndex, dates.length), impressions: allocate(110386, index, dates.length * adSpecs.length),
    reach: allocate(79900, index, dates.length * adSpecs.length), frequency: [1.2, 1.8, 1.4, 1.5, 1.3, 1.7, 1.1][adIndex],
    link_clicks: allocate(ad.clicks, dayIndex, dates.length), results: allocate(ad.results, dayIndex, dates.length),
    video_3s: allocate(ad.plays, dayIndex, dates.length), thruplays: allocate(ad.thruplays, dayIndex, dates.length),
    objective: 'CTWA', delivery: 'active', campaign_budget: ad.campaign.includes('Oktober') ? 500000 : 400000,
    adset_budget: ad.adset.includes('Interest') ? 120000 : 180000, quality_ranking: null,
    engagement_ranking: null, conversion_ranking: null, breakdown_type: null, breakdown_value: null,
  };
}));

function breakdownRow(dimension: BreakdownRow['dimension'], name: string, spend: number, impressions: number, clicks: number, results: number, index: number): BreakdownRow {
  return { id: `preview-${dimension}-${index}`, file_id: `preview-${dimension}`, dimension, day: null, campaign: null,
    dimension_value: name, spend, impressions, reach: null, frequency: null, link_clicks: clicks, results, video_3s: null, thruplays: null };
}

export const offlineDemoBreakdowns: BreakdownRow[] = [
  breakdownRow('placement', 'Instagram · Feed', 1172601, 37500, 356, 104, 0),
  breakdownRow('placement', 'Instagram · Stories', 896695, 28800, 284, 104, 1),
  breakdownRow('placement', 'Facebook · Feed', 827718, 26500, 252, 55, 2),
  breakdownRow('placement', 'Audience Network · Native, banner and interstitial', 551812, 17586, 160, 28, 3),
  breakdownRow('age', '25–34', 1410000, 45100, 445, 136, 4),
  breakdownRow('age', '35–44', 1230000, 39300, 379, 111, 5),
  breakdownRow('age', '45–54', 808826, 25986, 228, 44, 6),
  breakdownRow('gender', 'Perempuan', 1890000, 60400, 590, 174, 7),
  breakdownRow('gender', 'Laki-laki', 1558826, 49986, 462, 117, 8),
];
