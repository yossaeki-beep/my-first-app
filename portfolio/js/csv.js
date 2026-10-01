/* 証券会社・bitFlyer の CSV を保有一覧に変換する。
   文字コードは UTF-8 と Shift_JIS。列名のゆれは別名で吸収する。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Csv = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const FILE_KINDS = {
    '楽天証券': [{ scope: 'rakuten-all', label: '保有商品一覧（すべて）' }],
    'SBI証券': [
      { scope: 'sbi-domestic', label: '保有証券（国内の株・投信）' },
      { scope: 'sbi-us', label: '米国株（画面からコピー）', paste: true },
    ],
    'マネックス証券': [
      { scope: 'monex-stock', label: '株式' },
      { scope: 'monex-fractional', label: '単元未満株' },
      { scope: 'monex-fund', label: '投資信託' },
    ],
    'moomoo証券': [{ scope: 'moomoo-trades', label: '取引履歴' }],
    'ウィブル証券': [],
    'bitFlyer': [{ scope: 'bitflyer-spot', label: 'お取引レポート（すべてのお取引）' }],
  };

  function decodeCsvBytes(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(bytes);
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    const s = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 1; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function norm(s) {
    return String(s || '').normalize('NFKC').trim();
  }

  function num(v) {
    if (v == null) return null;
    let s = norm(v);
    if (!s || s === '-' || s === '--' || s === '－') return null;
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[¥￥,\s　円口株]/g, '').replace(/^\((.*)\)$/, '$1');
    if (s.startsWith('+')) s = s.slice(1);
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  }

  function mapAccount(text) {
    const s = norm(text).replace(/\s/g, '');
    if (!s) return null;
    if (/つみたて/.test(s)) return 'nisa-tsumitate';
    if (/成長投資枠|NISA成長/.test(s)) return 'nisa-growth';
    if (/NISA/.test(s)) return 'nisa-growth';
    if (/特定/.test(s)) return 'tokutei';
    if (/一般/.test(s)) return 'general';
    return null;
  }

  function accountOf(text, fallback) {
    return mapAccount(text) || fallback || 'unset';
  }

  function blankResult(warnings) {
    return { holdings: [], skipped: 0, warnings: warnings || [] };
  }

  function headerMatches(h, a) {
    if (!h || !h.includes(a)) return false;
    if ((a === '通貨' || a === '通貨1' || a === '通貨2') && h !== a) return false;
    if (a === '銘柄' && (h.includes('コード') || h.includes('ティッカー'))) return false;
    if (a === '評価額' && h.includes('損益')) return false;
    if (a === '損益' && (h.includes('率') || h.includes('%') || h.includes('前日'))) return false;
    if (a === '現在値' && h.includes('前日')) return false;
    if (a === 'コード' && (h.includes('口座') || h.includes('SWIFT'))) return false;
    return true;
  }

  /* 完全一致を先に見る。「通貨1」が「通貨1数量」に吸われないようにする。 */
  function col(headers, aliases) {
    const hs = headers.map(h => norm(h).replace(/\s/g, ''));
    for (const a of aliases) {
      const exact = hs.findIndex(h => h === a);
      if (exact >= 0) return exact;
    }
    for (const a of aliases) {
      const i = hs.findIndex(h => headerMatches(h, a));
      if (i >= 0) return i;
    }
    return -1;
  }

  function guessAsset(scope, kindText, code) {
    const kind = norm(kindText);
    if (scope === 'bitflyer-spot') return 'crypto';
    if (scope === 'monex-fund' || /投資信託|投信/.test(kind)) return 'fund';
    if (scope === 'sbi-us' || /米国株|外国株/.test(kind)) return 'us-stock';
    if (/国内株|日本株/.test(kind)) return 'jp-stock';
    const c = norm(code).toUpperCase();
    if (/^[A-Z][A-Z.\-]{0,9}$/.test(c)) return 'us-stock';
    if (/^\d{4}$/.test(c) || scope === 'monex-stock' || scope === 'monex-fractional') return 'jp-stock';
    if (/^\d{5,}$/.test(c)) return 'fund';
    return 'jp-stock';
  }

  function pushHolding(list, h) {
    if (!h || !(h.quantity > 0)) return false;
    if (!h.name && !h.code) return false;
    list.push(h);
    return true;
  }

  function mergeLots(list) {
    const map = new Map();
    for (const h of list) {
      const key = [h.accountType, h.assetType, h.code || h.name].join('|');
      const cur = map.get(key);
      if (!cur) { map.set(key, Object.assign({}, h)); continue; }
      const q1 = cur.quantity;
      const q2 = h.quantity;
      cur.quantity = q1 + q2;
      if (cur.costJpy != null || h.costJpy != null) cur.costJpy = (cur.costJpy || 0) + (h.costJpy || 0);
      if (cur.costUsd != null || h.costUsd != null) cur.costUsd = (cur.costUsd || 0) + (h.costUsd || 0);
      if (h.csvMarketJpy != null) cur.csvMarketJpy = (cur.csvMarketJpy || 0) + h.csvMarketJpy;
      if (h.csvPrice != null) cur.csvPrice = h.csvPrice;
    }
    return Array.from(map.values());
  }

  /* ---------- 表形式の保有一覧（楽天のフラット、マネックス、共通） ---------- */
  function parseFlat(rows, opt) {
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(norm);
      const joined = cells.join(',');
      if ((joined.includes('銘柄') || joined.includes('ファンド')) &&
          (joined.includes('数量') || joined.includes('株数') || joined.includes('口数') || joined.includes('評価額'))) {
        headerIndex = i;
        headers = cells;
        break;
      }
    }
    if (headerIndex < 0) return blankResult(['見出し行（銘柄・数量・評価額）が見つかりませんでした']);

    const iKind = col(headers, ['種別', '商品']);
    const iCode = col(headers, ['銘柄コード・ティッカー', '銘柄コード', 'ティッカー', 'シンボル', 'コード']);
    const iName = col(headers, ['ファンド名', '銘柄名', '銘柄（コード）', '銘柄(コード)', '銘柄']);
    const iAcct = col(headers, ['預り区分', '口座区分', '口座']);
    const iQty = col(headers, ['保有数量', '保有株数', '数量', '口数']);
    const iAvg = col(headers, ['平均取得価額', '平均取得価格', '取得単価', '基準価額']);
    const iPrice = col(headers, ['現在値', '基準価額', '終値']);
    const iCost = col(headers, ['取得総額', '取得金額', '取得額']);
    const iMkt = col(headers, ['時価評価額', '評価額']);
    const iPnl = col(headers, ['評価損益', '含み損益', '損益']);

    const holdings = [];
    let skipped = 0;
    const warnings = [];
    let sectionAccount = null;

    for (let r = 0; r < rows.length; r++) {
      if (r === headerIndex) continue;
      const cells = rows[r];
      const populated = cells.map(norm).filter(Boolean);
      if (populated.length === 1 && /^[■●【]/.test(populated[0])) {
        sectionAccount = mapAccount(populated[0]) || sectionAccount;
        continue;
      }
      if (r < headerIndex) continue;
      const kind = iKind >= 0 ? norm(cells[iKind]) : '';
      if (/預り金|現金|米ドル|証拠金|信用|先物/.test(kind)) { skipped += 1; continue; }
      const rawName = iName >= 0 ? norm(cells[iName]) : '';
      if (!rawName || /合計|評価額合計/.test(rawName)) { skipped += 1; continue; }

      let code = iCode >= 0 ? norm(cells[iCode]) : '';
      let name = rawName;
      if (!code && iName >= 0 && /コード/.test(headers[iName] || '')) {
        const split = splitCodeName(rawName);
        code = split.code;
        name = split.name;
      }
      const qty = iQty >= 0 ? num(cells[iQty]) : null;
      const avg = iAvg >= 0 ? num(cells[iAvg]) : null;
      const price = iPrice >= 0 ? num(cells[iPrice]) : null;
      const costCol = iCost >= 0 ? num(cells[iCost]) : null;
      const market = iMkt >= 0 ? num(cells[iMkt]) : null;
      const pnl = iPnl >= 0 ? num(cells[iPnl]) : null;
      const assetType = guessAsset(opt.scope, kind, code);
      const priced = settlePrices(assetType, qty, avg, price, costCol, market, pnl);
      const ok = pushHolding(holdings, {
        accountType: accountOf(iAcct >= 0 ? cells[iAcct] : '', sectionAccount || opt.accountFallback),
        assetType,
        code: code.replace(/\.T$/, ''),
        name: name || code,
        quantity: qty,
        costJpy: priced.costJpy,
        costUsd: priced.costUsd,
        csvPrice: priced.csvPrice,
        csvPriceCurrency: priced.csvPriceCurrency,
        csvMarketJpy: priced.csvMarketJpy,
      });
      if (!ok) skipped += 1;
    }
    if (!holdings.length && !warnings.length) warnings.push('取り込める行がありませんでした');
    return { holdings: mergeLots(holdings), skipped, warnings };
  }

  function splitCodeName(raw) {
    const text = norm(raw);
    const m = text.match(/^([0-9A-Za-z]{1,8})\s+(.+)$/);
    if (!m) return { code: '', name: text };
    return { code: m[1], name: m[2] };
  }

  function settlePrices(assetType, qty, avg, price, costCol, market, pnl) {
    let csvPrice = price != null ? price : avg;
    let csvPriceCurrency = assetType === 'us-stock' ? 'USD' : 'JPY';
    let csvMarketJpy = market;
    let costJpy = costCol;
    let costUsd = null;

    if (assetType === 'us-stock' && price != null && qty && market != null) {
      const usdMv = qty * price;
      if (usdMv && Math.abs(market - usdMv) / Math.abs(usdMv) < 0.08) csvMarketJpy = null;
    }
    if (assetType === 'fund' && csvMarketJpy == null && price != null && qty) {
      csvMarketJpy = qty * price / 10000;
    }
    if (costJpy == null && csvMarketJpy != null && pnl != null) costJpy = csvMarketJpy - pnl;
    if (costJpy == null && assetType !== 'us-stock' && avg != null && qty) {
      costJpy = assetType === 'fund' ? qty * avg / 10000 : qty * avg;
    }
    if (assetType === 'us-stock' && costJpy == null && avg != null && qty) {
      costUsd = qty * avg;
    }
    if (assetType === 'jp-stock' || assetType === 'fund' || assetType === 'crypto') csvPriceCurrency = 'JPY';
    return { csvPrice, csvPriceCurrency, csvMarketJpy, costJpy, costUsd };
  }

  /* ---------- SBI のセクション形式 ---------- */
  function isSbiSection(row) {
    const populated = row.map(norm).filter(Boolean);
    if (populated.length !== 1) return false;
    const header = stripSection(populated[0]);
    if (header.endsWith('合計')) return false;
    return /^[^()]+\(.+\/.+\)$/.test(header);
  }

  function stripSection(section) {
    return norm(section).replace(/^[【\[\]】\s]+/, '').replace(/[【\[\]】\s]+$/, '');
  }

  function sbiAccount(section) {
    const header = stripSection(section);
    const m = header.match(/^[^()]+\((.+)\)$/);
    const inner = m ? m[1] : header;
    const custody = inner.includes('/') ? inner.split('/').slice(1).join('/') : inner;
    return mapAccount(custody) || 'unset';
  }

  function sbiAsset(section) {
    const header = stripSection(section);
    if (header.startsWith('投資信託')) return 'fund';
    if (header.startsWith('外国株式') || header.startsWith('米国株')) return 'us-stock';
    if (header.startsWith('株式')) return 'jp-stock';
    return null;
  }

  function parseSbi(rows, opt) {
    const holdings = [];
    let skipped = 0;
    const warnings = [];
    let accountType = 'unset';
    let assetType = null;
    let layout = null;

    rows.forEach(row => {
      if (!row.some(c => norm(c))) return;
      const first = norm(row[0]);
      if (!first) return;
      if (first.includes('合計') || first === '評価額' || first === '含み損益' || first === '前日比') {
        layout = null;
        return;
      }
      if (isSbiSection(row)) {
        accountType = sbiAccount(first);
        assetType = sbiAsset(first);
        layout = null;
        if (!assetType) skipped += 1;
        return;
      }
      const head = norm(row[0]);
      if (head === 'ファンド名' || head.startsWith('銘柄(') || head.startsWith('銘柄（')) {
        const hasRef = row.some(c => norm(c).includes('参考単価'));
        layout = hasRef
          ? { qty: 2, avg: 4, price: 5, pnl: 8, market: 10, fund: head === 'ファンド名' }
          : { qty: 2, avg: 3, price: 4, pnl: 7, market: 9, fund: head === 'ファンド名' };
        if (layout.fund) assetType = 'fund';
        return;
      }
      if (!layout || !assetType) return;
      if (row.length < (layout.market + 1)) { skipped += 1; return; }
      const split = layout.fund ? { code: '', name: first } : splitCodeName(first);
      const qty = num(row[layout.qty]);
      const avg = num(row[layout.avg]);
      const price = num(row[layout.price]);
      const pnl = num(row[layout.pnl]);
      const market = num(row[layout.market]);
      const priced = settlePrices(assetType, qty, avg, price, null, market, pnl);
      const keep = (opt.scope === 'sbi-us' && assetType === 'us-stock') ||
        (opt.scope === 'sbi-domestic' && assetType !== 'us-stock') ||
        (opt.scope !== 'sbi-us' && opt.scope !== 'sbi-domestic');
      if (!keep) { skipped += 1; return; }
      const ok = pushHolding(holdings, {
        accountType: accountType || opt.accountFallback || 'unset',
        assetType,
        code: split.code,
        name: split.name,
        quantity: qty,
        costJpy: priced.costJpy,
        costUsd: priced.costUsd,
        csvPrice: priced.csvPrice,
        csvPriceCurrency: priced.csvPriceCurrency,
        csvMarketJpy: priced.csvMarketJpy,
      });
      if (!ok) skipped += 1;
    });
    if (!holdings.length) warnings.push('SBIの保有証券CSVから銘柄を読み取れませんでした');
    return { holdings: mergeLots(holdings), skipped, warnings };
  }

  /* ---------- 取引履歴（moomoo） ---------- */
  function parseTrades(rows, opt) {
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(norm);
      const joined = cells.join(',');
      if ((joined.includes('約定') || joined.includes('取引日') || joined.includes('日時')) &&
          (joined.includes('数量') || joined.includes('株数'))) {
        headerIndex = i;
        headers = cells;
        break;
      }
    }
    if (headerIndex < 0) return blankResult(['取引履歴の見出し（約定日・数量）が見つかりませんでした']);

    const iDate = col(headers, ['約定日', '取引日', '日時', '日付']);
    const iCode = col(headers, ['銘柄コード', 'ティッカー', 'シンボル', 'コード']);
    const iName = col(headers, ['銘柄名', '銘柄']);
    const iSide = col(headers, ['売買区分', '取引種別', '売買', '種別', '方向']);
    const iQty = col(headers, ['約定数量', '数量', '株数']);
    const iPrice = col(headers, ['約定単価', '単価', '価格', '約定価格']);
    const iFee = col(headers, ['手数料']);
    const iCcy = col(headers, ['通貨', '市場']);
    const iAcct = col(headers, ['口座区分', '預り区分', '口座']);

    if (iSide < 0 || iQty < 0 || iPrice < 0) {
      return blankResult(['売買・数量・単価の列が必要です。見つかった見出し: ' + headers.filter(Boolean).join(' / ')]);
    }

    const txs = [];
    let skipped = 0;
    const warnings = [];
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cells = rows[r];
      const sideRaw = norm(cells[iSide]);
      const side = /買|buy/i.test(sideRaw) ? 'buy' : /売|sell/i.test(sideRaw) ? 'sell' : '';
      if (!side) { skipped += 1; continue; }
      const qty = num(cells[iQty]);
      const price = num(cells[iPrice]);
      const code = iCode >= 0 ? norm(cells[iCode]).toUpperCase() : '';
      const name = iName >= 0 ? norm(cells[iName]) : code;
      if (!(qty > 0) || price == null || (!code && !name)) { skipped += 1; continue; }
      const ccy = iCcy >= 0 ? norm(cells[iCcy]).toUpperCase() : '';
      const assetType = ccy === 'USD' || ccy === 'US' || /^[A-Z][A-Z.\-]{0,9}$/.test(code)
        ? 'us-stock'
        : 'jp-stock';
      txs.push({
        date: iDate >= 0 ? norm(cells[iDate]) : '',
        accountType: accountOf(iAcct >= 0 ? cells[iAcct] : '', opt.accountFallback),
        assetType,
        code: code.replace(/\.T$/, ''),
        name: name || code,
        side,
        qty,
        price,
        fee: iFee >= 0 ? (num(cells[iFee]) || 0) : 0,
      });
    }
    txs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const lots = new Map();
    txs.forEach(t => {
      const key = [t.accountType, t.assetType, t.code || t.name].join('|');
      if (!lots.has(key)) {
        lots.set(key, {
          accountType: t.accountType,
          assetType: t.assetType,
          code: t.code,
          name: t.name,
          quantity: 0,
          cost: 0,
        });
      }
      const lot = lots.get(key);
      if (t.side === 'buy') {
        lot.cost += t.qty * t.price + t.fee;
        lot.quantity += t.qty;
        lot.name = t.name || lot.name;
      } else {
        if (t.qty > lot.quantity + 1e-8) {
          warnings.push((t.name || t.code) + ' の売却数量が、その時点の保有を超えています');
        }
        const q = Math.min(t.qty, lot.quantity);
        const avg = lot.quantity > 0 ? lot.cost / lot.quantity : 0;
        lot.cost -= avg * q;
        lot.quantity -= q;
        if (lot.quantity < 1e-8) { lot.quantity = 0; lot.cost = 0; }
      }
    });
    const holdings = [];
    lots.forEach(lot => {
      if (!(lot.quantity > 0)) return;
      const usd = lot.assetType === 'us-stock';
      holdings.push({
        accountType: lot.accountType,
        assetType: lot.assetType,
        code: lot.code,
        name: lot.name,
        quantity: lot.quantity,
        costJpy: usd ? null : lot.cost,
        costUsd: usd ? lot.cost : null,
        csvPrice: null,
        csvPriceCurrency: usd ? 'USD' : 'JPY',
        csvMarketJpy: null,
      });
    });
    if (!holdings.length) warnings.push('残っている保有がありません。期間を切った取引履歴だと、過去の買いが落ちていることがあります');
    return { holdings, skipped, warnings };
  }

  /* ---------- bitFlyer 現物 ---------- */
  function parseBitflyer(rows, opt) {
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(norm);
      if (cells.some(c => c.includes('取引日時')) && cells.some(c => c.includes('通貨'))) {
        headerIndex = i;
        headers = cells;
        break;
      }
    }
    if (headerIndex < 0) return blankResult(['bitFlyerの取引履歴（取引日時・通貨）が見つかりませんでした']);

    const iDate = col(headers, ['取引日時', '日時']);
    const iKind = col(headers, ['取引種別', '種別']);
    const iPrice = col(headers, ['取引価格', '価格']);
    const iC1 = col(headers, ['通貨1']);
    const iQ1 = col(headers, ['通貨1数量', '通貨1の数量']);
    const iRate = col(headers, ['通貨1の対円レート', '対円レート']);
    const iC2 = col(headers, ['通貨2']);
    const iQ2 = col(headers, ['通貨2数量', '通貨2の数量']);
    const iCcy = col(headers, ['通貨']);

    const txs = [];
    let skipped = 0;
    const warnings = [];
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cells = rows[r];
      const blob = cells.map(norm).join(' ');
      if (/CFD|証拠金|先物|FX|Lightning FX/i.test(blob)) { skipped += 1; continue; }
      const kind = iKind >= 0 ? norm(cells[iKind]) : '';
      const c1 = (iC1 >= 0 ? norm(cells[iC1]) : norm(cells[iCcy] || '')).toUpperCase();
      const base = c1.split('/')[0];
      if (!base || base === 'JPY' || base === '円') { skipped += 1; continue; }
      const q1 = iQ1 >= 0 ? num(cells[iQ1]) : null;
      const price = iPrice >= 0 ? num(cells[iPrice]) : null;
      const rate = iRate >= 0 ? num(cells[iRate]) : null;
      const c2 = iC2 >= 0 ? norm(cells[iC2]).toUpperCase() : '';
      const q2 = iQ2 >= 0 ? num(cells[iQ2]) : null;
      let side = '';
      if (/買/.test(kind)) side = 'buy';
      else if (/売/.test(kind)) side = 'sell';
      else if (/受取|預入|入庫|外部/.test(kind)) side = 'in';
      else if (/送金|出庫|送付|引出/.test(kind)) side = 'out';
      else { skipped += 1; continue; }
      const qty = q1 != null ? Math.abs(q1) : null;
      if (!(qty > 0)) { skipped += 1; continue; }
      let jpy = null;
      if (c2 === 'JPY' || c2 === '円') jpy = q2 != null ? Math.abs(q2) : null;
      else if (price != null && (rate || price > 100)) jpy = qty * (rate || price);
      txs.push({
        date: iDate >= 0 ? norm(cells[iDate]) : '',
        code: base,
        name: base,
        side,
        qty,
        jpy,
      });
    }
    txs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const lots = new Map();
    txs.forEach(t => {
      if (!lots.has(t.code)) {
        lots.set(t.code, { code: t.code, name: t.code, quantity: 0, cost: 0, uncosted: false });
      }
      const lot = lots.get(t.code);
      if (t.side === 'buy' || t.side === 'in') {
        lot.quantity += t.qty;
        if (t.jpy != null) lot.cost += t.jpy;
        else lot.uncosted = true;
      } else {
        if (t.qty > lot.quantity + 1e-10) warnings.push(t.code + ' の数量が、その時点の残高を超えています');
        const q = Math.min(t.qty, lot.quantity);
        const avg = lot.quantity > 0 ? lot.cost / lot.quantity : 0;
        lot.cost -= avg * q;
        lot.quantity -= q;
        if (lot.quantity < 1e-10) { lot.quantity = 0; lot.cost = 0; }
      }
    });
    const holdings = [];
    lots.forEach(lot => {
      if (!(lot.quantity > 1e-10)) return;
      if (lot.uncosted) warnings.push(lot.code + ' は入庫だけの数量があり、取得金額が一部未設定です');
      holdings.push({
        accountType: 'crypto',
        assetType: 'crypto',
        code: lot.code,
        name: lot.name,
        quantity: lot.quantity,
        costJpy: lot.uncosted && lot.cost === 0 ? null : lot.cost,
        costUsd: null,
        csvPrice: null,
        csvPriceCurrency: 'JPY',
        csvMarketJpy: null,
      });
    });
    if (!holdings.length) warnings.push('現物の残高が残りませんでした');
    return { holdings, skipped, warnings };
  }

  /* SBIの外国株式には保有残高のCSVが無い。画面の表をコピーしたテキストから読む。 */
  const PASTE_NOISE = /^(米国|日本|NASDAQ|NYSE|AMEX|ナスダック|ニューヨーク|東証|銘柄|現在値|保有数量|取得単価|参考単価|評価額|評価損益|外貨建評価額|円換算評価額|外貨建評価損益|円換算評価損益|売却注文中|保有銘柄)$/;

  function isTickerToken(line) {
    const s = norm(line);
    const m = s.match(/^([A-Z]{1,5}(?:\.[A-Z])?)(?:\s+.*)?$/);
    if (!m) return null;
    if (/^(USD|JPY|NYSE|NASDAQ|AMEX|ETF|ADR|IPO)$/.test(m[1])) return null;
    return m[1];
  }

  function isParenQty(line) {
    return /^[（(]\s*[\d,.]+\s*[）)]$/.test(norm(line));
  }

  function isNumberToken(line) {
    const s = norm(line);
    if (!s || isParenQty(s)) return false;
    if (num(s) == null) return false;
    return /^[+\-−－]?[\d,.]+(\s*(円|ドル|USD|JPY|％|%))?$/.test(s);
  }

  function isAccountToken(line) {
    const s = norm(line).replace(/^[【\[]|[】\]]$/g, '');
    if (!s || s.length > 32 || /[。、]/.test(s)) return null;
    if (/[A-Z]{2,}/.test(s) && !/NISA/.test(s)) return null;
    if (!/特定|一般|NISA|つみたて|成長/.test(s)) return null;
    return mapAccount(s);
  }

  /* 数字の並びが、SBIの保有表（現在値・数量・取得単価・評価額）のどれかに合うか見る。 */
  function interpretUsNumbers(nums) {
    const layouts = [
      { usdPx: 0, qty: 2, usdAvg: 3, jpyAvg: 4, usdMv: 5, jpyMv: 6, jpyPnl: 8 },
      { usdPx: 0, qty: 1, usdAvg: 2, jpyAvg: 3, usdMv: 4, jpyMv: 5, jpyPnl: 7 },
      { usdPx: 0, qty: 1, usdAvg: 2, usdMv: 3, jpyMv: 4, jpyPnl: 5 },
      { qty: 0, usdAvg: 1, usdPx: 2, jpyMv: 3 },
      { qty: 0, usdAvg: 1, usdPx: 2 },
    ];
    for (const L of layouts) {
      const need = Math.max.apply(null, Object.keys(L).map(k => L[k]));
      if (nums.length <= need) continue;
      const qty = nums[L.qty];
      const usdPx = nums[L.usdPx];
      const usdAvg = nums[L.usdAvg];
      if (!(qty > 0) || !(usdPx > 0) || !(usdAvg > 0)) continue;
      if (qty > 1000000) continue;
      const usdMv = L.usdMv == null ? qty * usdPx : nums[L.usdMv];
      if (L.usdMv != null) {
        const expect = qty * usdPx;
        if (!(expect > 0) || Math.abs(usdMv - expect) / expect > 0.25) continue;
      }
      const jpyMv = L.jpyMv == null ? null : nums[L.jpyMv];
      if (jpyMv != null) {
        const ratio = jpyMv / (usdPx * qty);
        if (!(ratio >= 20 && ratio <= 1000)) continue;
      }
      const jpyAvg = L.jpyAvg == null ? null : nums[L.jpyAvg];
      const jpyPnl = L.jpyPnl == null || nums.length <= L.jpyPnl ? null : nums[L.jpyPnl];
      let costJpy = null;
      if (jpyMv != null && jpyPnl != null) costJpy = jpyMv - jpyPnl;
      else if (jpyAvg != null) costJpy = jpyAvg * qty;
      return {
        quantity: qty,
        csvPrice: usdPx,
        csvMarketJpy: jpyMv,
        costJpy,
        costUsd: usdAvg * qty,
      };
    }
    return null;
  }

  function parseSbiUsPaste(text, opt) {
    const tokens = String(text).split(/\r?\n/).flatMap(line => line.split('\t')).map(norm).filter(Boolean);
    const tickerAt = [];
    tokens.forEach((token, i) => { if (isTickerToken(token)) tickerAt.push(i); });
    if (!tickerAt.length) {
      return blankResult(['ティッカー（例: AAPL）が見つかりませんでした。保有銘柄の表を選択してコピーし、貼り付けてください']);
    }
    const holdings = [];
    let skipped = 0;
    const warnings = [];
    let account = opt.accountFallback || 'unset';
    tickerAt.forEach((at, n) => {
      const prev = n === 0 ? 0 : tickerAt[n - 1] + 1;
      const next = n + 1 < tickerAt.length ? tickerAt[n + 1] : tokens.length;
      for (let i = prev; i < at; i++) {
        const acct = isAccountToken(tokens[i]);
        if (acct) account = acct;
      }
      const code = isTickerToken(tokens[at]);
      let name = '';
      for (let i = at - 1; i >= prev; i--) {
        const token = tokens[i];
        if (isNumberToken(token) || isParenQty(token) || isAccountToken(token) || PASTE_NOISE.test(token)) continue;
        name = token;
        break;
      }
      const nums = [];
      for (let i = at + 1; i < next; i++) {
        const acct = isAccountToken(tokens[i]);
        if (acct) {
          let nameAfter = false;
          for (let k = i + 1; k < next; k++) {
            const token = tokens[k];
            if (isNumberToken(token) || isParenQty(token) || isAccountToken(token) || PASTE_NOISE.test(token)) continue;
            nameAfter = true;
            break;
          }
          if (!nameAfter && nums.length) account = acct;
          break;
        }
        if (isNumberToken(tokens[i])) nums.push(num(tokens[i]));
      }
      if (!name) {
        for (let i = at + 1; i < next; i++) {
          const token = tokens[i];
          if (isNumberToken(token) || isParenQty(token) || isAccountToken(token) || PASTE_NOISE.test(token)) continue;
          name = token;
          break;
        }
      }
      const parsed = interpretUsNumbers(nums);
      if (!parsed) {
        skipped += 1;
        warnings.push(code + ' の数量か金額を読み取れませんでした');
        return;
      }
      const ok = pushHolding(holdings, Object.assign({
        accountType: account,
        assetType: 'us-stock',
        code,
        name: name || code,
        csvPriceCurrency: 'USD',
      }, parsed));
      if (!ok) skipped += 1;
    });
    if (!holdings.length && !warnings.length) warnings.push('米国株の保有を読み取れませんでした');
    return { holdings: mergeLots(holdings), skipped, warnings };
  }

  function parseFile(text, opt) {
    const rows = parseCsv(text);
    const scope = opt.scope;
    if (scope === 'bitflyer-spot') return parseBitflyer(rows, opt);
    if (scope === 'moomoo-trades') return parseTrades(rows, opt);
    if (scope === 'sbi-domestic') return parseSbi(rows, opt);
    if (scope === 'sbi-us') {
      if (/銘柄[(（]コード[)）]|ファンド名/.test(text)) return parseSbi(rows, opt);
      return parseSbiUsPaste(text, opt);
    }
    const flat = parseFlat(rows, opt);
    if (flat.holdings.length) return flat;
    const sbi = parseSbi(rows, opt);
    if (sbi.holdings.length) return sbi;
    return flat.warnings.length ? flat : sbi;
  }

  return {
    FILE_KINDS, decodeCsvBytes, parseCsv, parseFile, mapAccount, num,
  };
});
