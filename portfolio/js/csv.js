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
      { scope: 'monex-stock', label: '株式（国内）' },
      { scope: 'monex-us', label: '米国株' },
      { scope: 'monex-fractional', label: '単元未満株' },
      { scope: 'monex-fund', label: '投資信託' },
    ],
    'moomoo証券': [{ scope: 'moomoo-trades', label: '取引履歴・保有一覧' }],
    'ウィブル証券': [],
    'bitFlyer': [{ scope: 'bitflyer-spot', label: 'お取引レポート（すべてのお取引）' }],
  };

  function decodeCsvBytes(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(bytes);
    }
  }

  function detectDelimiter(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
    let commas = 0;
    let tabs = 0;
    lines.forEach(line => {
      commas += (line.match(/,/g) || []).length;
      tabs += (line.match(/\t/g) || []).length;
    });
    return tabs > commas ? '\t' : ',';
  }

  function parseCsv(text, delimiter) {
    const sep = delimiter || ',';
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
      else if (c === sep) { row.push(cell); cell = ''; }
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
    s = s.replace(/[¥￥$＄,\s　円口株]/g, '').replace(/ドル/g, '').replace(/usd/ig, '').replace(/^\((.*)\)$/, '$1');
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
    if ((a === '通貨' || a === '通貨1' || a === '通貨2' || a === '市場' || a === 'Market' || a === 'Currency') && h !== a) return false;
    if (a === '銘柄' && (h.includes('コード') || h.includes('ティッカー'))) return false;
    if (a === '評価額' && h.includes('損益')) return false;
    if (a === '損益' && (h.includes('率') || h.includes('%') || h.includes('前日'))) return false;
    if (a === '現在値' && h.includes('前日')) return false;
    if (a === 'コード' && (h.includes('口座') || h.includes('SWIFT'))) return false;
    return true;
  }

  /* 完全一致を先に見る。「通貨1」が「通貨1数量」に吸われないようにする。
     prefer を渡したとき、条件に合う列が無ければ -1（別の列へ落とさない）。 */
  function col(headers, aliases, prefer) {
    const hs = headers.map(h => norm(h).replace(/\s/g, ''));
    const pool = [];
    const add = i => { if (i >= 0 && pool.indexOf(i) < 0) pool.push(i); };
    aliases.forEach(a => hs.forEach((h, i) => { if (h === a) add(i); }));
    if (!pool.length) aliases.forEach(a => hs.forEach((h, i) => { if (headerMatches(h, a)) add(i); }));
    if (!pool.length) return -1;
    if (!prefer) return pool[0];
    const hit = pool.find(i => prefer(hs[i]));
    return hit == null ? -1 : hit;
  }

  /* prefer に合う列が無ければ、別名のどれかへ戻す。 */
  function firstCol(headers, aliases, prefer) {
    if (!prefer) return col(headers, aliases);
    const hit = col(headers, aliases, prefer);
    return hit >= 0 ? hit : col(headers, aliases);
  }

  function usdHeader(h) { return /ドル|USD/i.test(h) && !/円/.test(h); }
  function jpyHeader(h) { return /円|JPY/i.test(h) && !/ドル|USD/i.test(h); }

  function cleanCode(code) {
    let c = norm(code).toUpperCase().split(/\s+/)[0] || '';
    c = c.replace(/^(US|HK|SH|SZ|SG|JP|TYO)\./, '');
    c = c.replace(/\.(US|JP|HK|T|O|N|PK)$/, '');
    return c;
  }

  function headerList(headers) {
    return headers.map(norm).filter(Boolean).join(' / ');
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

  function isHoldingHeader(cells) {
    const hs = cells.map(c => norm(c).replace(/\s/g, ''));
    if (hs.filter(Boolean).length < 3) return false;
    const joined = hs.join(',');
    const hasName = hs.some(h => /銘柄|ファンド|ティッカー|Symbol|名称|名前|^コード$|^Name$/.test(h));
    const hasQty = /建株数|保有数量|保有株数|保有数|約定数量|数量|株数|口数|FilledQty|Quantity|Qty/.test(joined);
    const hasVal = /評価|単価|コスト|価格|Price|Cost|時価|金額|損益|Market/.test(joined);
    return hasName && hasQty && hasVal;
  }

  /* ---------- 表形式の保有一覧（楽天のフラット、マネックス、moomooの保有、共通） ---------- */
  function parseFlat(rows, opt) {
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
      if (isHoldingHeader(rows[i])) {
        headerIndex = i;
        headers = rows[i].map(norm);
        break;
      }
    }
    if (headerIndex < 0) {
      const sample = rows.find(r => r.map(norm).filter(Boolean).length > 2);
      const found = sample ? headerList(sample) : '';
      return blankResult(['見出し行（銘柄・数量・評価額）が見つかりませんでした' + (found ? '。見つかった行: ' + found : '')]);
    }

    const qtyAliases = ['建株数', '約定数量', 'FilledQty', '保有数量', '保有株数', '保有数', '数量', '株数', '口数', 'Qty'];
    const avgAliases = ['平均建単価', '建単価', '取得平均', '平均取得価額', '平均取得価格', '取得単価', '平均コスト', 'DilutedCost', 'AverageCost', 'AvgCost', 'コスト'];
    const priceAliases = ['評価単価', '現在価格', '現在値', '終値', '基準価額', 'CurrentPrice', '約定価格', '約定単価', 'AvgPrice', 'FillPrice'];
    const mktAliases = ['時価評価額', '評価額', '市場価値', 'MarketValue', '時価'];
    const pnlAliases = ['評価損益', '含み損益', '損益合計', '損益額', '損益'];
    const priceLike = h => /評価単価|現在|約定価格|約定単価|終値|基準価額|CurrentPrice|AvgPrice|FillPrice/.test(h) && !/前日|コスト|平均|注文|建単価|取得/.test(h);
    const avgLike = h => /平均|取得|建単価|コスト|Cost/i.test(h) && !/評価単価|現在|前日|損益/.test(h);

    const iKind = col(headers, ['種別', '商品']);
    const iCode = col(headers, ['銘柄コード・ティッカー', '銘柄コード', 'ティッカー', 'Symbol', 'シンボル', 'コード']);
    const iName = col(headers, ['ファンド名', '銘柄名', '名称', '名前', 'Name', '銘柄（コード）', '銘柄(コード)', '銘柄']);
    const iAcct = col(headers, ['預り区分', '口座区分', '口座']);
    const iPosSide = col(headers, ['売買区分', '売買']);
    const iQty = firstCol(headers, qtyAliases, h => /建株数|保有数|保有株数|約定数量|FilledQty/.test(h));
    const iAvgUsd = col(headers, avgAliases, h => usdHeader(h) && avgLike(h));
    const iAvgJpy = col(headers, avgAliases, h => jpyHeader(h) && avgLike(h));
    const iAvg = col(headers, avgAliases, avgLike);
    const iAvgAny = iAvg >= 0 ? iAvg : col(headers, avgAliases);
    const iPriceUsd = col(headers, priceAliases, h => usdHeader(h) && priceLike(h));
    const iPrice = col(headers, priceAliases, priceLike);
    const iPriceAny = iPrice >= 0 ? iPrice : col(headers, priceAliases);
    const iCost = col(headers, ['取得総額', '取得金額', '取得額']);
    const iBag = col(headers, ['建玉金額合計', '建玉金額', '建玉合計']);
    const iMktJpy = col(headers, mktAliases, jpyHeader);
    const iMktUsd = col(headers, mktAliases, usdHeader);
    const iMkt = iMktJpy >= 0 ? iMktJpy : col(headers, mktAliases, h => !usdHeader(h));
    const iMktAny = iMkt >= 0 ? iMkt : col(headers, mktAliases);
    const iPnlJpy = col(headers, pnlAliases, jpyHeader);
    const iPnlUsd = col(headers, pnlAliases, usdHeader);
    const iPnl = col(headers, pnlAliases, h => !usdHeader(h));
    const iPnlAny = iPnl >= 0 ? iPnl : col(headers, pnlAliases);
    const iCcy = col(headers, ['通貨', 'Currency', '市場', 'Market']);

    if (iQty < 0) return blankResult(['数量の列が見つかりませんでした。見つかった見出し: ' + headerList(headers)]);

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
      let code = iCode >= 0 ? cleanCode(cells[iCode]) : '';
      let name = rawName;
      if (!code && iName >= 0 && /コード/.test(headers[iName] || '')) {
        const split = splitCodeName(rawName);
        code = cleanCode(split.code);
        name = split.name;
      }
      if ((!name && !code) || /合計|評価額合計/.test(name)) { skipped += 1; continue; }
      const sideText = iPosSide >= 0 ? cells[iPosSide] : '';
      if (/売建/.test([kind, iAcct >= 0 ? cells[iAcct] : '', cells[iCode] || '', sideText].join(' '))) {
        skipped += 1;
        warnings.push((name || code) + ' は売建のため飛ばしました');
        continue;
      }

      const qty = iQty >= 0 ? num(cells[iQty]) : null;
      const avg = iAvgAny >= 0 ? num(cells[iAvgAny]) : null;
      const price = iPriceAny >= 0 ? num(cells[iPriceAny]) : null;
      const costCol = iCost >= 0 ? num(cells[iCost]) : null;
      const market = iMktAny >= 0 ? num(cells[iMktAny]) : null;
      const pnl = iPnlAny >= 0 ? num(cells[iPnlAny]) : null;
      const ccy = iCcy >= 0 ? norm(cells[iCcy]).toUpperCase() : '';
      let assetType = guessAsset(opt.scope, kind, code);
      if (assetType !== 'fund' && (/^USD$|^US$|米国|NASDAQ|NYSE/.test(ccy) || opt.scope === 'monex-us')) {
        if (!/^\d{4}$/.test(code)) assetType = 'us-stock';
      }
      const priced = settlePrices(assetType, qty, avg, price, costCol, market, pnl);
      if (assetType === 'us-stock') {
        const usdAvg = iAvgUsd >= 0 ? num(cells[iAvgUsd]) : null;
        const jpyAvg = iAvgJpy >= 0 ? num(cells[iAvgJpy]) : null;
        const usdPx = iPriceUsd >= 0 ? num(cells[iPriceUsd]) : null;
        const jpyMkt = iMktJpy >= 0 ? num(cells[iMktJpy]) : null;
        const usdMkt = iMktUsd >= 0 ? num(cells[iMktUsd]) : null;
        const jpyPnl = iPnlJpy >= 0 ? num(cells[iPnlJpy]) : null;
        const usdPnl = iPnlUsd >= 0 ? num(cells[iPnlUsd]) : null;
        const bag = iBag >= 0 ? num(cells[iBag]) : null;
        if (usdPx != null) priced.csvPrice = usdPx;
        priced.csvPriceCurrency = 'USD';
        /* ドルの評価額・損益を円の取得額や時価として残さない。 */
        if (jpyMkt != null) priced.csvMarketJpy = jpyMkt;
        else if (usdMkt != null) priced.csvMarketJpy = null;
        if (jpyMkt != null && jpyPnl != null) priced.costJpy = jpyMkt - jpyPnl;
        else if (jpyAvg != null && qty) priced.costJpy = jpyAvg * qty;
        else if (usdMkt != null || usdPnl != null) priced.costJpy = iCost >= 0 ? costCol : null;
        if (usdAvg != null && qty) priced.costUsd = usdAvg * qty;
        else if (bag != null && !jpyHeader(norm(headers[iBag]).replace(/\s/g, ''))) priced.costUsd = bag;
        else if (usdMkt != null && usdPnl != null) priced.costUsd = usdMkt - usdPnl;
        else if (jpyAvg != null) priced.costUsd = null;
      }
      const ok = pushHolding(holdings, {
        accountType: accountOf([iAcct >= 0 ? cells[iAcct] : '', cells[iCode] || ''].join(' '), sectionAccount || opt.accountFallback),
        assetType,
        code,
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

  /* 売買の列があるときだけ取引履歴。約定数量の「約定」だけでは日付とみなさない。 */
  function isTradeHeader(cells) {
    const hs = cells.map(c => norm(c).replace(/\s/g, ''));
    if (hs.filter(Boolean).length < 3) return false;
    const hasSide = hs.some(h => /方向|売買|Side|Direction|TrdSide/.test(h));
    const hasQty = hs.some(h => /数量|株数|Qty|Quantity/.test(h));
    const hasPrice = hs.some(h => /価格|単価|Price/.test(h));
    return hasSide && hasQty && hasPrice;
  }

  function tradeSide(text) {
    const s = norm(text);
    if (/売|卖|sell/i.test(s)) return 'sell';
    if (/買|买|buy|購入/i.test(s)) return 'buy';
    return '';
  }

  /* ---------- 取引履歴（moomoo） ---------- */
  function parseTrades(rows, opt) {
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < rows.length; i++) {
      if (!isTradeHeader(rows[i])) continue;
      headerIndex = i;
      headers = rows[i].map(norm);
      break;
    }
    if (headerIndex < 0) return blankResult(['取引履歴の見出し（約定日・数量）が見つかりませんでした']);

    const qtyAliases = ['約定数量', 'FilledQty', '数量', '株数', 'Qty'];
    const priceAliases = ['約定価格', '約定単価', 'AvgPrice', 'FillPrice', '単価', '価格', 'Price'];
    const iDate = col(headers, ['約定時間', '約定日', '取引日', '注文時間', 'CreateTime', '日時', '日付', '時間', 'Time', 'Date']);
    const iCode = col(headers, ['銘柄コード', 'ティッカー', 'Symbol', 'シンボル', 'コード']);
    const iName = col(headers, ['銘柄名', '名称', '名前', 'Name', '銘柄']);
    const iSide = col(headers, ['売買区分', '取引方向', '売買方向', '取引種別', 'Direction', 'Side', '売買', '方向']);
    const iQtyAny = firstCol(headers, qtyAliases, h => /約定|Filled/.test(h));
    const iPrice = col(headers, priceAliases, h => /約定|Avg|Fill/.test(h) && !/注文|Order/.test(h));
    const iPriceAny = iPrice >= 0 ? iPrice : col(headers, priceAliases, h => !/注文|Order/.test(h));
    const iFee = col(headers, ['手数料', 'Fee', 'Commission']);
    const iCcy = col(headers, ['通貨', 'Currency', '市場', 'Market']);
    const iAcct = col(headers, ['口座区分', '預り区分', '口座', 'Account']);
    const iStatus = col(headers, ['注文ステータス', 'ステータス', 'Status']);

    if (iSide < 0 || iQtyAny < 0 || iPriceAny < 0) {
      return blankResult(['売買・数量・単価の列が必要です。見つかった見出し: ' + headerList(headers)]);
    }

    const txs = [];
    let skipped = 0;
    const warnings = [];
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cells = rows[r];
      const status = iStatus >= 0 ? norm(cells[iStatus]) : '';
      if (/キャンセル|取消|失効|拒否|Cancelled|Canceled|Reject|Expired/.test(status)) { skipped += 1; continue; }
      const side = tradeSide(cells[iSide]);
      if (!side) { skipped += 1; continue; }
      const qty = num(cells[iQtyAny]);
      const price = num(cells[iPriceAny]);
      const code = iCode >= 0 ? cleanCode(cells[iCode]) : '';
      const name = iName >= 0 ? norm(cells[iName]) : code;
      if (!(qty > 0) || price == null || (!code && !name)) { skipped += 1; continue; }
      const ccy = iCcy >= 0 ? norm(cells[iCcy]).toUpperCase() : '';
      const assetType = ccy === 'USD' || ccy === 'US' || /米国|NASDAQ|NYSE/.test(ccy) || /^[A-Z][A-Z.\-]{0,9}$/.test(code)
        ? 'us-stock'
        : 'jp-stock';
      txs.push({
        date: iDate >= 0 ? norm(cells[iDate]) : '',
        accountType: accountOf(iAcct >= 0 ? cells[iAcct] : '', opt.accountFallback),
        assetType,
        code,
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
    return { holdings, skipped, warnings, recognizedTrade: true };
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

  function isPercentToken(line) {
    return /[%％]/.test(norm(line));
  }

  /* 「10（0）」は保有数量と、その下の売却注文中。株数は括弧の外。 */
  function shareCountToken(line) {
    const s = norm(line);
    const wrapped = s.match(/^([\d,.]+)\s*[（(]\s*[\d,.]+\s*[）)]$/);
    if (!wrapped) return null;
    return num(wrapped[1]);
  }

  function isNumberToken(line) {
    const s = norm(line);
    if (!s || isParenQty(s) || isPercentToken(s) || shareCountToken(s) != null) return false;
    if (num(s) == null) return false;
    return /^[+\-−－]?[\d,.]+(\s*(円|ドル|USD|JPY|株))?$/.test(s);
  }

  function isAccountToken(line) {
    const s = norm(line).replace(/^[【\[]|[】\]]$/g, '');
    if (!s || s.length > 32 || /[。、]/.test(s)) return null;
    if (/[A-Z]{2,}/.test(s) && !/NISA/.test(s)) return null;
    if (!/特定|一般|NISA|つみたて|成長/.test(s)) return null;
    return mapAccount(s);
  }

  /* 並び順に依存しない。株数×ドル現在値＝ドル評価額、かつ円評価が為替でつながる組だけを残す。
     画面コピーは上段がドル・下段が円になり、円の現在値が株数の位置に来ることがある。 */
  function interpretUsNumbers(nums, qtyHint) {
    const n = nums.length;
    const hasYen = nums.some(v => v >= 1000);
    let best = null;
    for (let iq = 0; iq < n; iq++) {
      const qty = nums[iq];
      if (qtyHint != null && Math.abs(qty - qtyHint) > 1e-4) continue;
      if (!(qty > 0) || qty > 1000000) continue;
      for (let ip = 0; ip < n; ip++) {
        if (ip === iq) continue;
        const usdPx = nums[ip];
        if (!(usdPx > 0) || usdPx > 1000000) continue;
        for (let ia = 0; ia < n; ia++) {
          if (ia === iq || ia === ip) continue;
          const usdAvg = nums[ia];
          if (!(usdAvg > 0)) continue;
          const avgRatio = usdAvg / usdPx;
          if (avgRatio < 0.05 || avgRatio > 20) continue;
          for (let im = -1; im < n; im++) {
            if (im === iq || im === ip || im === ia) continue;
            const usdMv = im < 0 ? null : nums[im];
            if (usdMv != null) {
              const expect = qty * usdPx;
              if (!(expect > 0) || Math.abs(usdMv - expect) / expect > 0.03) continue;
            }
            for (let ij = -1; ij < n; ij++) {
              if (ij === iq || ij === ip || ij === ia || ij === im) continue;
              const jpyMv = ij < 0 ? null : nums[ij];
              if (usdMv == null && jpyMv == null) continue;
              if (hasYen && jpyMv == null) continue;
              let fx = null;
              if (jpyMv != null) {
                fx = jpyMv / (usdPx * qty);
                if (!(fx >= 50 && fx <= 250)) continue;
              }
              let jpyPx = null;
              if (fx != null) {
                for (let k = 0; k < n; k++) {
                  if (k === iq || k === ip || k === ia || k === im || k === ij) continue;
                  if (Math.abs(nums[k] / usdPx - fx) / fx <= 0.05) { jpyPx = nums[k]; break; }
                }
              }
              let score = (usdMv != null ? 80 : 0) + (jpyMv != null ? 40 : 0) + (jpyPx != null ? 40 : 0);
              score += Math.max(0, 30 - Math.abs(Math.log(avgRatio)) * 12);
              if (Math.abs(qty - Math.round(qty)) < 1e-6) score += 5;
              if (!best || score > best.score) {
                best = { score, qty, usdPx, usdAvg, jpyMv, jpyPx, fx };
              }
            }
          }
        }
      }
    }
    if (!best) return null;
    let costJpy = null;
    if (best.jpyMv != null && best.fx) {
      const unit = best.usdAvg * best.fx;
      let jpyAvg = null;
      for (let k = 0; k < n; k++) {
        if (Math.abs(nums[k] - unit) / unit <= 0.05) jpyAvg = nums[k];
      }
      costJpy = (jpyAvg != null ? jpyAvg : unit) * best.qty;
      for (let k = 0; k < n; k++) {
        if (!(costJpy > 0)) break;
        if (Math.abs((best.jpyMv - nums[k]) - costJpy) / costJpy <= 0.02) {
          costJpy = best.jpyMv - nums[k];
          break;
        }
      }
    }
    return {
      quantity: best.qty,
      csvPrice: best.usdPx,
      csvMarketJpy: best.jpyMv,
      costJpy,
      costUsd: best.usdAvg * best.qty,
    };
  }

  function numbersInCells(cells) {
    const nums = [];
    let qtyHint = null;
    cells.forEach(cell => {
      const shares = shareCountToken(cell);
      if (shares != null) {
        nums.push(shares);
        if (qtyHint == null) qtyHint = shares;
        return;
      }
      if (isParenQty(cell) || isPercentToken(cell)) return;
      if (isNumberToken(cell)) nums.push(num(cell));
    });
    return { nums, qtyHint };
  }

  function cellsOf(line) {
    return String(line).split('\t').map(norm).filter(Boolean);
  }

  function tickerIn(cells) {
    for (const cell of cells) {
      const code = isTickerToken(cell);
      if (code) return code;
    }
    return null;
  }

  function nameIn(cells, code) {
    for (const cell of cells) {
      if (!cell || cell === code || isTickerToken(cell) || isNumberToken(cell) || isParenQty(cell) || shareCountToken(cell) != null || isPercentToken(cell) || isAccountToken(cell) || PASTE_NOISE.test(cell)) continue;
      const stripped = cell.replace(code, '').replace(/米国|日本|NASDAQ|NYSE|AMEX/g, '').trim();
      if (stripped) return stripped;
    }
    return '';
  }

  /* 表のコピーは1銘柄が2行になる。上段がドルと株数、下段が円と（売却注文中）。 */
  function parseSbiUsTable(lines, opt) {
    const holdings = [];
    let skipped = 0;
    const warnings = [];
    let account = opt.accountFallback || 'unset';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const next = lines[i + 1] || null;
      const codeHere = tickerIn(line);
      const codeNext = next ? tickerIn(next) : null;
      if (!codeHere && !codeNext) {
        const acct = line.map(isAccountToken).find(Boolean);
        if (acct) account = acct;
        continue;
      }
      let upper = line;
      let lower = null;
      let code = codeHere;
      if (!codeHere && codeNext) {
        upper = line;
        lower = next;
        code = codeNext;
        i += 1;
      } else if (codeHere && next && !codeNext && next.some(c => isNumberToken(c) || isParenQty(c) || shareCountToken(c) != null)) {
        lower = next;
        i += 1;
      }
      const cells = lower ? upper.concat(lower) : upper;
      for (const cell of cells) {
        const acct = isAccountToken(cell);
        if (acct) account = acct;
      }
      const found = numbersInCells(cells);
      let qtyHint = found.qtyHint;
      if (lower) {
        const width = Math.max(upper.length, lower.length);
        for (let c = 0; c < width; c++) {
          const a = upper[c] || '';
          const b = lower[c] || '';
          const aShare = shareCountToken(a);
          const bShare = shareCountToken(b);
          if (aShare != null && (isParenQty(b) || b === '')) qtyHint = aShare;
          if (bShare != null && (isParenQty(a) || a === '')) qtyHint = bShare;
          if (isNumberToken(a) && isParenQty(b)) qtyHint = num(a);
          if (isNumberToken(b) && isParenQty(a)) qtyHint = num(b);
        }
      }
      const parsed = interpretUsNumbers(found.nums, qtyHint);
      const name = nameIn(upper, code) || nameIn(lower || [], code);
      if (!parsed) {
        skipped += 1;
        warnings.push(code + ' の数量か金額を読み取れませんでした');
        continue;
      }
      const ok = pushHolding(holdings, Object.assign({
        accountType: account,
        assetType: 'us-stock',
        code,
        name: name || code,
        csvPriceCurrency: 'USD',
      }, parsed));
      if (!ok) skipped += 1;
    }
    if (!holdings.length && !warnings.length) warnings.push('米国株の保有を読み取れませんでした');
    return { holdings: mergeLots(holdings), skipped, warnings };
  }

  function parseSbiUsPaste(text, opt) {
    const lines = String(text).split(/\r?\n/).map(cellsOf).filter(line => line.length);
    if (lines.some(line => line.length >= 3)) return parseSbiUsTable(lines, opt);
    const tokens = lines.flat();
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
        const shares = shareCountToken(tokens[i]);
        if (shares != null) { nums.push(shares); continue; }
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

  function tagMonexUs(opt, result) {
    if (opt.scope === 'monex-stock' && result.holdings.length && result.holdings.every(h => h.assetType === 'us-stock')) {
      result.scope = 'monex-us';
    }
    return result;
  }

  function parseFile(text, opt) {
    const rows = parseCsv(text, detectDelimiter(text));
    const scope = opt.scope;
    if (scope === 'bitflyer-spot') return parseBitflyer(rows, opt);
    if (scope === 'moomoo-trades') {
      const trades = parseTrades(rows, opt);
      if (trades.recognizedTrade || trades.holdings.length) return trades;
      const positions = parseFlat(rows, opt);
      if (positions.holdings.length) {
        positions.warnings.unshift('取引履歴ではなく、いまの保有一覧として読みました');
        return positions;
      }
      return trades.warnings.length ? trades : positions;
    }
    if (scope === 'sbi-domestic') return parseSbi(rows, opt);
    if (scope === 'sbi-us') {
      if (/銘柄[(（]コード[)）]|ファンド名/.test(text)) return parseSbi(rows, opt);
      return parseSbiUsPaste(text, opt);
    }
    const flat = tagMonexUs(opt, parseFlat(rows, opt));
    if (flat.holdings.length) return flat;
    const sbi = parseSbi(rows, opt);
    if (sbi.holdings.length) return sbi;
    return flat.warnings.length ? flat : sbi;
  }

  return {
    FILE_KINDS, decodeCsvBytes, parseCsv, parseFile, mapAccount, num,
  };
});
