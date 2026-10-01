/* 保有はブラウザの localStorage にだけ置く。数量や取得金額は外に送らない。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'portfolio.v1';

  function empty() {
    return {
      version: 1,
      fx: { usdJpy: null, asOf: null, source: null },
      priceEndpoint: '',
      holdings: [],
      imports: [],
    };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const data = JSON.parse(raw);
      const base = empty();
      return Object.assign(base, data, {
        fx: Object.assign(base.fx, data.fx || {}),
        holdings: Array.isArray(data.holdings) ? data.holdings : [],
        imports: Array.isArray(data.imports) ? data.imports : [],
      });
    } catch (e) {
      return empty();
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function matchKey(h) {
    return [h.accountType, h.assetType, h.code || h.name].join('|');
  }

  /* 同じ証券会社・同じファイル区分だけを置き換える。終値は銘柄が残っていれば引き継ぐ。 */
  function applyImport(state, payload) {
    const prev = state.holdings.filter(h => h.broker === payload.broker && h.scope === payload.scope);
    const kept = new Map(prev.map(h => [matchKey(h), h]));
    const incoming = payload.holdings.map(h => {
      const old = kept.get(matchKey(h));
      const next = Object.assign({ id: uid() }, h, {
        broker: payload.broker,
        scope: payload.scope,
      });
      if (old && old.closePrice != null) {
        next.closePrice = old.closePrice;
        next.closeAsOf = old.closeAsOf;
        next.closeCurrency = old.closeCurrency;
      }
      if (!next.id) next.id = uid();
      return next;
    });
    state.holdings = state.holdings
      .filter(h => !(h.broker === payload.broker && h.scope === payload.scope))
      .concat(incoming);
    state.imports.unshift({
      id: uid(),
      broker: payload.broker,
      scope: payload.scope,
      filename: payload.filename || '',
      at: new Date().toISOString(),
      count: incoming.length,
      skipped: payload.skipped || 0,
    });
    state.imports = state.imports.slice(0, 20);
    return state;
  }

  function upsertHolding(state, holding) {
    const next = Object.assign({}, holding);
    if (!next.id) next.id = uid();
    if (!next.scope) next.scope = 'manual';
    const i = state.holdings.findIndex(h => h.id === next.id);
    if (i >= 0) state.holdings[i] = next;
    else state.holdings.push(next);
    return next;
  }

  function removeHolding(state, id) {
    state.holdings = state.holdings.filter(h => h.id !== id);
  }

  return { KEY, empty, uid, load, save, applyImport, upsertHolding, removeHolding, matchKey };
});
