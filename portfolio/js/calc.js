/* 保有の評価額・損益と、口座区分・証券会社ごとの集計。
   取引履歴の再生は csv.js 側。ここは保存済みの保有を円で束ねる。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BROKERS = ['楽天証券', 'SBI証券', 'マネックス証券', 'moomoo証券', 'ウィブル証券', 'bitFlyer'];

  const ACCOUNT_LABEL = {
    tokutei: '特定口座',
    'nisa-growth': 'NISA（成長）',
    'nisa-tsumitate': 'NISA（つみたて）',
    general: '一般口座',
    crypto: '暗号資産',
    unset: '未設定',
  };

  const ASSET_LABEL = {
    'jp-stock': '日本株',
    'us-stock': '米国株',
    fund: '投資信託',
    crypto: '暗号資産',
  };

  function costJpyOf(h, fx) {
    if (h.costJpy != null && Number.isFinite(h.costJpy)) return h.costJpy;
    if (h.costUsd != null && Number.isFinite(h.costUsd) && fx && fx.usdJpy) return h.costUsd * fx.usdJpy;
    return null;
  }

  /* 評価額。投資信託はCSVの基準価額・評価額。
     株と暗号資産は終値があれば終値、なければCSV。 */
  function valueOf(h, fx) {
    const qty = Number(h.quantity) || 0;
    if (h.assetType === 'fund') {
      if (h.csvMarketJpy != null) return { marketJpy: h.csvMarketJpy, basis: 'csv' };
      if (h.csvPrice != null) return { marketJpy: qty * h.csvPrice / 10000, basis: 'csv' };
      return { marketJpy: null, basis: 'missing' };
    }
    if (h.assetType === 'jp-stock') {
      if (h.closePrice != null) return { marketJpy: qty * h.closePrice, basis: 'close', asOf: h.closeAsOf };
      if (h.csvMarketJpy != null) return { marketJpy: h.csvMarketJpy, basis: 'csv' };
      if (h.csvPrice != null) return { marketJpy: qty * h.csvPrice, basis: 'csv' };
      return { marketJpy: null, basis: 'missing' };
    }
    if (h.assetType === 'crypto') {
      if (h.closePrice != null) return { marketJpy: qty * h.closePrice, basis: 'close', asOf: h.closeAsOf };
      if (h.csvMarketJpy != null) return { marketJpy: h.csvMarketJpy, basis: 'csv' };
      if (h.csvPrice != null) return { marketJpy: qty * h.csvPrice, basis: 'csv' };
      return { marketJpy: null, basis: 'missing' };
    }
    if (h.assetType === 'us-stock') {
      const unit = h.closePrice != null
        ? h.closePrice
        : (h.csvPrice != null && h.csvPriceCurrency !== 'JPY' ? h.csvPrice : null);
      const marketUsd = unit != null ? qty * unit : null;
      if (h.closePrice != null && fx && fx.usdJpy && marketUsd != null) {
        return { marketJpy: marketUsd * fx.usdJpy, marketUsd, basis: 'close', asOf: h.closeAsOf };
      }
      if (h.csvMarketJpy != null && h.closePrice == null) {
        return { marketJpy: h.csvMarketJpy, marketUsd, basis: 'csv' };
      }
      if (marketUsd != null && fx && fx.usdJpy) {
        return { marketJpy: marketUsd * fx.usdJpy, marketUsd, basis: 'csv', asOf: fx.asOf };
      }
      return { marketJpy: h.csvMarketJpy ?? null, marketUsd, basis: h.csvMarketJpy != null ? 'csv' : 'missing' };
    }
    return { marketJpy: null, basis: 'missing' };
  }

  function position(h, fx) {
    const v = valueOf(h, fx);
    const cost = costJpyOf(h, fx);
    const pnl = v.marketJpy != null && cost != null ? v.marketJpy - cost : null;
    const rate = pnl != null && cost ? pnl / cost : null;
    const costFromFx = h.costJpy == null && h.costUsd != null && cost != null;
    return Object.assign({}, h, v, { cost, pnl, rate, costFromFx });
  }

  function sumPositions(list) {
    let market = 0;
    let cost = 0;
    let marketUsd = 0;
    let hasMarket = false;
    let hasCost = false;
    let hasUsd = false;
    let missing = 0;
    let pnl = 0;
    let pnlCost = 0;
    let both = 0;
    for (const p of list) {
      if (p.marketJpy == null) missing += 1;
      else { market += p.marketJpy; hasMarket = true; }
      if (p.cost != null) { cost += p.cost; hasCost = true; }
      if (p.marketUsd != null) { marketUsd += p.marketUsd; hasUsd = true; }
      if (p.marketJpy != null && p.cost != null) {
        pnl += p.marketJpy - p.cost;
        pnlCost += p.cost;
        both += 1;
      }
    }
    return {
      count: list.length,
      marketJpy: hasMarket ? market : null,
      costJpy: hasCost ? cost : null,
      marketUsd: hasUsd ? marketUsd : null,
      pnl: both ? pnl : null,
      rate: both && pnlCost ? pnl / pnlCost : null,
      missing,
    };
  }

  function bucket(list, fx) {
    return sumPositions(list.map(h => position(h, fx)));
  }

  function groupByAccount(holdings, fx) {
    const rows = {};
    for (const key of Object.keys(ACCOUNT_LABEL)) rows[key] = [];
    for (const h of holdings) {
      const key = rows[h.accountType] ? h.accountType : 'unset';
      rows[key].push(h);
    }
    const one = key => Object.assign({ key, label: ACCOUNT_LABEL[key] }, bucket(rows[key], fx));
    const tsumi = one('nisa-tsumitate');
    const growth = one('nisa-growth');
    const nisaHoldings = rows['nisa-tsumitate'].concat(rows['nisa-growth']);
    const nisa = Object.assign({ key: 'nisa', label: 'NISA口座', children: [tsumi, growth] }, bucket(nisaHoldings, fx));
    return [one('tokutei'), nisa, one('general'), one('crypto'), one('unset')];
  }

  function groupByBroker(holdings, fx) {
    return BROKERS.map(broker => {
      const list = holdings.filter(h => h.broker === broker);
      const stats = bucket(list, fx);
      const part = type => bucket(list.filter(h => h.accountType === type), fx);
      const nisa = bucket(list.filter(h => h.accountType === 'nisa-growth' || h.accountType === 'nisa-tsumitate'), fx);
      return Object.assign({ broker }, stats, {
        parts: {
          tokutei: part('tokutei'),
          nisa,
          general: part('general'),
          crypto: part('crypto'),
        },
      });
    });
  }

  /* minPct は百分率。それ以上の銘柄だけを残し、未満は「その他」にまとめる。 */
  function chartSlices(positions, minPct) {
    const floor = Number(minPct);
    const threshold = Number.isFinite(floor) && floor > 0 ? floor / 100 : 0;
    const known = positions.filter(p => p.marketJpy > 0);
    const missing = positions.length - known.length;
    const total = known.reduce((s, p) => s + p.marketJpy, 0);
    if (!(total > 0)) return { slices: [], missing, total: 0 };
    const sorted = known.slice().sort((a, b) => b.marketJpy - a.marketJpy);
    const named = [];
    let otherValue = 0;
    let otherCount = 0;
    sorted.forEach(p => {
      const rate = p.marketJpy / total;
      if (rate + 1e-12 >= threshold) {
        named.push({
          id: p.id,
          label: p.name || p.code || '名称未設定',
          code: p.code || '',
          broker: p.broker || '',
          marketJpy: p.marketJpy,
          rate,
          other: false,
        });
      } else {
        otherValue += p.marketJpy;
        otherCount += 1;
      }
    });
    const counts = {};
    named.forEach(s => { counts[s.label] = (counts[s.label] || 0) + 1; });
    named.forEach(s => {
      if (counts[s.label] > 1 && s.broker) s.label = s.label + '（' + s.broker + '）';
    });
    if (otherValue > 0) {
      named.push({
        id: '',
        label: 'その他',
        code: '',
        broker: '',
        marketJpy: otherValue,
        rate: otherValue / total,
        other: true,
        count: otherCount,
      });
    }
    return { slices: named, missing, total };
  }

  /* 正方形に近づく並びのツリーマップ。面積の合計は幅×高さになる。 */
  function treemapRects(slices, width, height) {
    const items = slices.filter(s => s.marketJpy > 0).map(s => ({
      id: s.id, label: s.label, other: !!s.other, value: s.marketJpy,
    }));
    const total = items.reduce((s, it) => s + it.value, 0);
    if (!(total > 0) || !(width > 0) || !(height > 0)) return [];
    items.forEach(it => { it.area = it.value / total * width * height; });
    const rects = [];
    const box = { x: 0, y: 0, w: width, h: height };

    function worst(row, length) {
      if (!row.length || !(length > 0)) return Infinity;
      const sum = row.reduce((s, it) => s + it.area, 0);
      let min = Infinity;
      let max = 0;
      row.forEach(it => {
        if (it.area < min) min = it.area;
        if (it.area > max) max = it.area;
      });
      const sum2 = sum * sum;
      const len2 = length * length;
      return Math.max(len2 * max / sum2, sum2 / (len2 * min));
    }

    function place(row) {
      const sum = row.reduce((s, it) => s + it.area, 0);
      let offset = 0;
      if (box.h <= box.w) {
        const thickness = sum / box.h;
        row.forEach(it => {
          const ext = it.area / thickness;
          rects.push({ id: it.id, label: it.label, other: it.other, value: it.value, x: box.x, y: box.y + offset, w: thickness, h: ext });
          offset += ext;
        });
        box.x += thickness;
        box.w -= thickness;
      } else {
        const thickness = sum / box.w;
        row.forEach(it => {
          const ext = it.area / thickness;
          rects.push({ id: it.id, label: it.label, other: it.other, value: it.value, x: box.x + offset, y: box.y, w: ext, h: thickness });
          offset += ext;
        });
        box.y += thickness;
        box.h -= thickness;
      }
    }

    function run(list) {
      if (!list.length) return;
      if (list.length === 1) {
        const it = list[0];
        rects.push({ id: it.id, label: it.label, other: it.other, value: it.value, x: box.x, y: box.y, w: box.w, h: box.h });
        return;
      }
      const length = Math.min(box.w, box.h);
      const row = [list[0]];
      let i = 1;
      while (i < list.length && worst(row, length) >= worst(row.concat([list[i]]), length)) {
        row.push(list[i]);
        i += 1;
      }
      place(row);
      run(list.slice(row.length));
    }

    run(items);
    return rects;
  }

  function groupByAsset(holdings, fx) {
    return ['jp-stock', 'us-stock', 'fund', 'crypto'].map(key => (
      Object.assign({ key, label: ASSET_LABEL[key] }, bucket(holdings.filter(h => h.assetType === key), fx))
    )).filter(g => g.count > 0);
  }

  function fmtYen(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '¥' + Math.round(Math.abs(n)).toLocaleString('ja-JP');
  }

  function fmtUsd(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtPct(rate) {
    if (rate == null || !Number.isFinite(rate)) return '—';
    const p = rate * 100;
    const sign = p > 0 ? '+' : '';
    return sign + p.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  function fmtQty(h) {
    const q = Number(h.quantity) || 0;
    if (h.assetType === 'fund') return Math.round(q).toLocaleString('ja-JP') + '口';
    const digits = h.assetType === 'crypto' ? 8 : 4;
    const s = q.toLocaleString('ja-JP', { maximumFractionDigits: digits });
    if (h.assetType === 'crypto') return s + (h.code ? ' ' + h.code : '');
    return s + '株';
  }

  function signClass(n) {
    if (n == null || !Number.isFinite(n) || Math.round(n) === 0) return '';
    return n > 0 ? 'up' : 'down';
  }

  function holdingsCsv(holdings, fx) {
    const header = ['証券会社', '口座区分', '区分', 'コード', '名称', '数量', '取得金額（円）', '評価額（円）', '評価損益（円）', '評価の基準', '終値日'];
    const lines = [header.join(',')];
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    for (const h of holdings) {
      const p = position(h, fx);
      lines.push([
        h.broker, ACCOUNT_LABEL[h.accountType] || h.accountType, ASSET_LABEL[h.assetType] || h.assetType,
        h.code, h.name, h.quantity,
        p.cost == null ? '' : Math.round(p.cost),
        p.marketJpy == null ? '' : Math.round(p.marketJpy),
        p.pnl == null ? '' : Math.round(p.pnl),
        p.basis === 'close' ? '終値' : p.basis === 'csv' ? 'CSV' : '',
        h.closeAsOf || '',
      ].map(esc).join(','));
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  return {
    BROKERS, ACCOUNT_LABEL, ASSET_LABEL,
    costJpyOf, valueOf, position, sumPositions, bucket,
    groupByAccount, groupByBroker, groupByAsset, chartSlices, treemapRects,
    fmtYen, fmtUsd, fmtPct, fmtQty, signClass, holdingsCsv,
  };
});
