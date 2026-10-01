/* 終値の問い合わせ。保有数量は送らず、銘柄コードだけを中継に渡す。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Prices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function symbolFor(h) {
    const code = String(h.code || '').trim().toUpperCase();
    if (!code || h.assetType === 'fund') return null;
    if (h.assetType === 'jp-stock') {
      if (code.endsWith('.T')) return code;
      if (/^\d{4}$/.test(code)) return code + '.T';
      return null;
    }
    if (h.assetType === 'us-stock') return code.replace(/\./g, '-');
    if (h.assetType === 'crypto') return code + '-JPY';
    return null;
  }

  function symbolsFor(holdings) {
    const set = new Set();
    for (const h of holdings) {
      const s = symbolFor(h);
      if (s) set.add(s);
    }
    if (holdings.some(h => h.assetType === 'us-stock')) set.add('JPY=X');
    return Array.from(set);
  }

  /* Yahoo の日足から、確定した終値を1本選ぶ。
     場中は当日の未確定の足を使わず、1本前を前日終値とする。 */
  function pickClose(chart) {
    const result = chart && chart.chart && chart.chart.result && chart.chart.result[0];
    if (!result) return null;
    const meta = result.meta || {};
    const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
    const closes = quote.close || [];
    const stamps = result.timestamp || [];
    const points = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && stamps[i] != null) points.push({ price: closes[i], ts: stamps[i] });
    }
    if (!points.length) return null;
    const state = meta.marketState;
    const sessionOpen = state === 'REGULAR' || state === 'PRE' || state === 'PREPRE';
    const chosen = sessionOpen && points.length >= 2 ? points[points.length - 2] : points[points.length - 1];
    const asOf = new Date(chosen.ts * 1000).toISOString().slice(0, 10);
    return { price: chosen.price, asOf, currency: meta.currency || null };
  }

  function applyQuotes(state, quotes) {
    const fxQuote = quotes['JPY=X'];
    if (fxQuote && fxQuote.price != null) {
      state.fx = { usdJpy: fxQuote.price, asOf: fxQuote.asOf || null, source: 'close' };
    }
    const missed = [];
    for (const h of state.holdings) {
      const sym = symbolFor(h);
      if (!sym) continue;
      const q = quotes[sym];
      if (!q || q.price == null) {
        missed.push(h.name || h.code || sym);
        continue;
      }
      h.closePrice = q.price;
      h.closeAsOf = q.asOf || null;
      h.closeCurrency = h.assetType === 'us-stock' ? 'USD' : 'JPY';
    }
    return { missed };
  }

  async function fetchCloses(endpoint, symbols) {
    const base = String(endpoint || '').replace(/\/$/, '');
    if (!base) {
      const err = new Error('終値の中継URLが未設定です');
      err.code = 'NO_ENDPOINT';
      throw err;
    }
    const url = base + '/closes?symbols=' + encodeURIComponent(symbols.join(','));
    const res = await fetch(url);
    if (!res.ok) throw new Error('終値を取得できませんでした（' + res.status + '）');
    const data = await res.json();
    return data.quotes || data;
  }

  return { symbolFor, symbolsFor, pickClose, applyQuotes, fetchCloses };
});
