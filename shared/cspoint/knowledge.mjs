export function rankKnowledge(query, documents, { limit = 5, chunkSize = 900, overlap = 140 } = {}) {
  const stopWords = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'pada', 'adalah', 'ini', 'itu', 'saya', 'kami', 'anda', 'kak', 'tolong', 'bisa', 'berapa', 'apakah', 'bagaimana', 'mohon', 'ongkir', 'tarif', 'biaya', 'harga', 'kirim', 'pengiriman', 'ke', 'di', 'kecamatan', 'kec', 'kabupaten', 'kab', 'kota', 'distrik', 'nama', 'lengkap', 'penerima', 'alamat', 'alamatnya', 'jalan', 'jl', 'rt', 'rw', 'kel', 'kelurahan', 'desa', 'kampung', 'negeri', 'dusun', 'kode', 'pos', 'patokan', 'rumah', 'nomor', 'telepon', 'wa', 'produk', 'paket', 'pcs', 'total', 'cod', 'pembayaran', 'transfer', 'admin', 'cek', 'cekkan', 'info', 'informasi', 'ada', 'dalam', 'penerima', 'permisi', 'halo', 'nih', 'ya', 'dong', 'sih', 'minta', 'tolong', 'bantu', 'kasih', 'mau', 'ambil', 'berapa', 'ongkos', 'ongkirnya', 'ongkirnya']);
  const normalize = value => String(value ?? '').toLocaleLowerCase('id-ID').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = [...new Set(normalize(query).match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(term => !stopWords.has(term));
  if (!terms.length) return [];

  const tokenCounts = [];
  const documentCounts = new Map();
  let totalTokens = 0;
  for (const document of documents) {
    const tokens = normalize(document.content).match(/[\p{L}\p{N}]{3,}/gu) || [];
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    tokenCounts.push(counts);
    totalTokens += tokens.length;
    for (const [token, count] of counts) documentCounts.set(token, (documentCounts.get(token) || 0) + count);
  }
  const editDistanceOne = (left, right) => {
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (left.length > right.length) i++;
      else if (right.length > left.length) j++;
      else { i++; j++; }
    }
    return edits + Number(i < left.length || j < right.length) <= 1;
  };
  const matches = terms.map(term => {
    if (documentCounts.has(term)) return { term, candidates: [term] };
    // Accommodate a one-letter typing error in a location, but only when the
    // result is a rare token in the uploaded reference.
    const candidate = term.length >= 6
      ? [...documentCounts.entries()].filter(([token, count]) => count <= 3 && editDistanceOne(term, token)).sort((a, b) => a[1] - b[1])[0]?.[0]
      : undefined;
    return { term, candidates: candidate ? [candidate] : [] };
  }).filter(match => match.candidates.length);
  if (!matches.length) return [];

  const ranked = [];
  for (const [documentIndex, document] of documents.entries()) {
    const content = String(document.content ?? '');
    for (let start = 0; start < content.length; start += chunkSize - overlap) {
      const excerpt = content.slice(start, start + chunkSize).trim();
      if (!excerpt) continue;
      const normalized = normalize(excerpt);
      const counts = new Map();
      for (const token of normalized.match(/[\p{L}\p{N}]{3,}/gu) || []) counts.set(token, (counts.get(token) || 0) + 1);
      let score = 0;
      let matchedTerms = 0;
      for (const { candidates } of matches) {
        const candidate = candidates.find(token => counts.has(token));
        if (!candidate) continue;
        matchedTerms++;
        const rarity = Math.log1p((totalTokens + 1) / ((documentCounts.get(candidate) || 0) + 1));
        score += rarity * Math.min(counts.get(candidate), 2);
      }
      if (matchedTerms) {
        // Ignore nonmatching address details, then prefer passages with all
        // searchable place names and exact tariff-row wording.
        score += matchedTerms === matches.length ? 20 : 0;
        if (/\b(?:rp\s*)?\d{2,3}[.]\d{3}\b|\bkonfirmasi\b/i.test(excerpt)) score += 4;
        ranked.push({ name: document.name, content: excerpt, score, documentIndex, start });
      }
    }
  }
  return ranked.sort((a, b) => b.score - a.score || a.documentIndex - b.documentIndex || a.start - b.start).slice(0, limit).map(({ name, content }) => ({ name, content }));
}
