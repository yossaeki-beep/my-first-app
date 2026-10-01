/* 銘柄コードの終値だけを返す中継。
   保有数量は受け取らない。Yahoo の日足から、場中は前日、引け後はその日の確定足を選ぶ。
   デプロイ先の例: Cloudflare Workers。アプリの設定に https://<name>.workers.dev を入れる。 */

const ALLOWED = /^[A-Z0-9.\^=-]{1,24}$/i;

function cors(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'cache-control': 'public, max-age=300',
    },
  });
}

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
  return {
    price: chosen.price,
    asOf: new Date(chosen.ts * 1000).toISOString().slice(0, 10),
    currency: meta.currency || null,
  };
}

async function one(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?interval=1d&range=10d';
  const res = await fetch(url, { headers: { 'user-agent': 'portfolio-close/1.0' } });
  if (!res.ok) return null;
  return pickClose(await res.json());
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return cors(null, 204);
    const url = new URL(request.url);
    if (url.pathname !== '/closes') return cors(JSON.stringify({ error: 'not found' }), 404);
    const symbols = (url.searchParams.get('symbols') || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => ALLOWED.test(s))
      .slice(0, 40);
    const quotes = {};
    await Promise.all(symbols.map(async symbol => {
      try { quotes[symbol] = await one(symbol); }
      catch (e) { quotes[symbol] = null; }
    }));
    return cors(JSON.stringify({ quotes }));
  },
};
