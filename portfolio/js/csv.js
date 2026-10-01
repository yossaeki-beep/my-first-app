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
    if (isZipOrXls(bytes)) return 'PK\u0003\u0004';
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes);
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes);
    }
    const utf16 = sniffUtf16(bytes);
    if (utf16) return new TextDecoder(utf16).decode(bytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(bytes);
    }
  }

  function isZipOrXls(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return true;
    return bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
  }

  /* BOM が無い UTF-16。日本語は高位バイトが 0 ではないので、NUL の位置で LE/BE を見る。 */
  function sniffUtf16(bytes) {
    if (bytes.length < 8) return '';
    const n = Math.min(bytes.length, 400);
    let zeros = 0;
    for (let i = 0; i < n; i++) if (bytes[i] === 0) zeros += 1;
    if (zeros / n < 0.08) return '';
    const pairs = Math.floor(n / 2);
    let oddZero = 0;
    let evenZero = 0;
    for (let i = 0; i < pairs; i++) {
      if (bytes[i * 2 + 1] === 0) oddZero += 1;
      if (bytes[i * 2] === 0) evenZero += 1;
    }
    if (oddZero > evenZero * 2 && oddZero / pairs > 0.12) return 'utf-16le';
    if (evenZero > oddZero * 2 && evenZero / pairs > 0.12) return 'utf-16be';
    return '';
  }

  function looksLikeXlsx(text) {
    return String(text).startsWith('PK\u0003\u0004');
  }

  function detectDelimiter(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
    const counts = { ',': 0, '\t': 0, ';': 0, '，': 0 };
    lines.forEach(line => {
      let q = false;
      for (const c of line) {
        if (c === '"') q = !q;
        else if (!q && counts[c] != null) counts[c] += 1;
      }
    });
    let best = ',';
    let n = 0;
    Object.keys(counts).forEach(d => {
      if (counts[d] > n) { best = d; n = counts[d]; }
    });
    return best;
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
    s = s.replace(/[−－﹣]/g, '-');
    if (/^[▲△]/.test(s)) s = s.slice(1);
    else if (/^[▼▽]/.test(s)) s = '-' + s.slice(1);
    if (s.startsWith('+')) s = s.slice(1);
    if (!s || s === '-' || s === '.' || s === '-.') return null;
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
    if ((a === '通貨' || a === '通貨1' || a === '通貨2' || a === '市場' || a === 'Market' || a === 'Markets' || a === 'Currency' || a === '币种' || a === '币種' || a === '市场') && h !== a) return false;
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

  /* moomoo のコード先頭（US. / HK.）と通貨・市場列。香港・中国・シンガポールは米国株にしない。 */
  function moomooMarket(rawCode, ccy, market) {
    const raw = norm(rawCode).toUpperCase();
    const cur = norm(ccy).toUpperCase();
    const mkt = norm(market).toUpperCase();
    const blob = [raw, cur, mkt].join(' ');
    if (/^HK\./.test(raw) || /\.HK$/.test(raw) || cur === 'HKD' || cur === 'HK' || mkt === 'HK' || /香港|HKEX|SEHK/.test(blob)) return 'HK';
    if (/^(SH|SZ|CN)\./.test(raw) || cur === 'CNH' || cur === 'CNY' || cur === 'CN' || mkt === 'SH' || mkt === 'SZ' || mkt === 'CN' || /上海|深セン|深圳/.test(blob)) return 'CN';
    if (/^SG\./.test(raw) || cur === 'SGD' || cur === 'SG' || mkt === 'SG' || /シンガポール|SGX/.test(blob)) return 'SG';
    if (/^US\./.test(raw) || /\.US$/.test(raw) || cur === 'USD' || cur === 'US' || mkt === 'US' || /米国|NASDAQ|NYSE|AMEX/.test(blob)) return 'US';
    if (/^(JP|TYO)\./.test(raw) || cur === 'JPY' || cur === 'JP' || mkt === 'JP' || /日本|東証/.test(blob)) return 'JP';
    const code = cleanCode(raw);
    if (/^[A-Z][A-Z.\-]{0,9}$/.test(code)) return 'US';
    if (/^\d{4}$/.test(code)) return 'JP';
    return '';
  }

  function atFill(text) {
    const s = norm(text).replace(/\s/g, '');
    const m = s.match(/^(\d+(?:\.\d+)?)[@＠](\d+(?:\.\d+)?)$/);
    if (!m) return null;
    return { qty: Number(m[1]), price: Number(m[2]) };
  }

  function findCol(headers, re, allowAt) {
    const hs = headers.map(h => norm(h).replace(/\s/g, ''));
    return hs.findIndex(h => re.test(h) && (allowAt || !/@|＠/.test(h)));
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
    const hasName = hs.some(h => /銘柄|ファンド|ティッカー|Symbol|名称|名前|^コード$|^代码$|^Name$|股票/.test(h));
    const hasQty = /建株数|保有数量|保有株数|保有数|約定数量|数量|株数|口数|FilledQty|Quantity|Qty|持仓|持有|ポジション数量/.test(joined);
    const hasVal = /評価|単価|コスト|价格|価格|Price|Cost|時価|市值|金额|金額|損益|Market|成本|现价|現価|市価/.test(joined);
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

    const qtyAliases = ['建株数', '約定数量', 'FilledQty', '保有数量', '保有株数', '保有数', 'ポジション数量', '持仓数量', '持有数量', '数量', '株数', '口数', 'Qty'];
    const avgAliases = ['平均建単価', '建単価', '取得平均', '平均取得価額', '平均取得価格', '取得単価', '平均コスト', '平均成本', '成本价', 'DilutedCost', 'AverageCost', 'AvgCost', 'コスト'];
    const priceAliases = ['評価単価', '現在価格', '現在値', '現価', '市価', '终值', '现价', '最新价', '市价', '終値', '基準価額', 'CurrentPrice', 'Last', '約定価格', '約定単価', 'AvgPrice', 'FillPrice'];
    const mktAliases = ['時価評価額', '評価額', '市場価値', 'MarketValue', '市值', '時価'];
    const pnlAliases = ['評価損益', '含み損益', '損益合計', '損益額', '損益'];
    const priceLike = h => /評価単価|現在|約定価格|約定単価|終値|基準価額|CurrentPrice|AvgPrice|FillPrice|^Last$|现价|最新|市価|市价|現価/.test(h) && !/前日|コスト|平均|注文|建単価|取得|Cost/.test(h);
    const avgLike = h => /平均|取得|建単価|コスト|Cost/i.test(h) && !/評価単価|現在|前日|損益/.test(h);

    const iKind = col(headers, ['種別', '商品']);
    const iCode = col(headers, ['銘柄コード・ティッカー', '銘柄コード', 'ティッカー', 'Symbol', 'シンボル', '代码', '股票代码', 'コード']);
    const iName = col(headers, ['ファンド名', '銘柄名', '名称', '名前', 'Name', '股票名称', '銘柄（コード）', '銘柄(コード)', '銘柄']);
    const iAcct = col(headers, ['預り区分', '口座区分', '口座']);
    const iPosSide = col(headers, ['売買区分', 'ポジション方向', '建玉方向', '方向', 'Side', '买卖', '買賣', '売買']);
    const iQty = firstCol(headers, qtyAliases, h => /建株数|保有数|保有株数|ポジション数量|持仓数量|持有数量|約定数量|FilledQty/.test(h));
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
    const iCcy = col(headers, ['通貨', 'Currency', '币种', '币種', '市場', 'Market']);
    const iMarket = col(headers, ['市場', 'Markets', 'Market', '市场']);

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
      if (/売建/.test([kind, iAcct >= 0 ? cells[iAcct] : '', cells[iCode] || '', sideText].join(' ')) ||
        /ショート|空売|卖空|賣空|^Short$/i.test(norm(sideText))) {
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
      if (opt.scope === 'moomoo-trades') {
        const where = moomooMarket(iCode >= 0 ? cells[iCode] : '', ccy, iMarket >= 0 ? cells[iMarket] : '');
        if (where === 'HK' || where === 'CN' || where === 'SG') {
          const label = name || code;
          const msg = label + ' は米国株・日本株ではないため飛ばしました';
          if (warnings.indexOf(msg) < 0) warnings.push(msg);
          skipped += 1;
          continue;
        }
        if (where === 'US') assetType = 'us-stock';
        else if (where === 'JP' && assetType !== 'fund') assetType = 'jp-stock';
      }
      /* 通貨がドルなら、列名に「ドル」と書いていなくても評価額は円にしない。 */
      if (assetType === 'us-stock' && /^(USD|US)$/.test(ccy) && iMktJpy < 0 && iAvgJpy < 0) {
        priced.csvMarketJpy = null;
        priced.csvPriceCurrency = 'USD';
        priced.costJpy = null;
        if (avg != null && qty) priced.costUsd = avg * qty;
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

  /* 売買の列があるときだけ取引履歴。保有一覧の「方向」や平均コストだけでは約定にしない。 */
  function isTradeHeader(cells) {
    const hs = cells.map(c => norm(c).replace(/\s/g, ''));
    if (hs.filter(Boolean).length < 3) return false;
    const hasSide = hs.some(h => {
      if (/ポジション方向|建玉方向|PositionSide/.test(h)) return false;
      return /方向|売買|Side|Direction|TrdSide|取引種別|买卖|買賣/.test(h);
    });
    const hasQty = hs.some(h => /数量|株数|Qty|Quantity|成交/.test(h));
    const hasPrice = hs.some(h => /価格|价格|単価|Price|均价|均價/.test(h));
    const hasAt = hs.some(h => /Filled@|約定@|成交@|@平均|@Avg/i.test(h));
    const snapshot = hs.some(h => /保有数量|保有数|保有株数|ポジション数量|持仓数量|持有数量|平均コスト|平均成本|市場価値|市值|現在価格|现价|MarketValue|AvgCost|取得単価/.test(h));
    const fills = hs.some(h => /約定数量|約定価格|約定@|FillQty|FilledQty|FillPrice|Filled@|成交数量|成交价格|OrderQty|注文数量|注文価格|OrderPrice/.test(h));
    if (snapshot && !fills) return false;
    return hasSide && (hasQty || hasAt) && (hasPrice || hasAt);
  }

  function tradeSide(text) {
    const s = norm(text);
    if (/売|卖|賣|sell/i.test(s)) return 'sell';
    if (/買|买|buy|購入/i.test(s)) return 'buy';
    return '';
  }

  function tradeStamp(s) {
    const raw = norm(s).replace(/\b(ET|EST|EDT|JST|HKT|CST|UTC|GMT)\b/ig, '').replace(/\s+/g, ' ').trim();
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
    const m = raw.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
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
    if (headerIndex < 0) return blankResult([]);

    const qtyAliases = ['約定数量', '成交数量', 'FilledQty', 'FillQty', '数量', '株数', 'Qty', 'Quantity'];
    const priceAliases = ['約定価格', '約定単価', '約定平均価格', '成交价格', '成交价', 'AvgFillPrice', 'AvgPrice', 'FillPrice', '単価', '价格', '価格', 'Price'];
    const iDate = findCol(headers, /約定時間|約定日|FillTime|FilledTime|CreateTime|OrderTime|取引日|注文時間|日時|^日付$|^時間$|^Time$|^Date$/);
    const iCode = col(headers, ['銘柄コード', 'ティッカー', 'Symbol', 'シンボル', '代码', '股票代码', 'コード']);
    const iName = col(headers, ['銘柄名', '名称', '名前', 'Name', '股票名称', '銘柄']);
    const iSide = col(headers, ['売買区分', '取引方向', '売買方向', '取引種別', 'Direction', 'Side', '买卖', '買賣', '売買', '方向']);
    const iQtyFill = findCol(headers, /約定数量|成交数量|FilledQty|FillQty|DealtQty/);
    const iQtyLoose = firstCol(headers, qtyAliases, h => /約定|Fill|Dealt|成交/.test(h) && !/@|＠|注文|Order/.test(h));
    const iPriceFill = findCol(headers, /約定価格|約定単価|約定平均価格|成交价格|成交价|成交均价|FillPrice|AvgFillPrice|^AvgPrice$/);
    const iPriceLoose = firstCol(headers, priceAliases, h => /約定|Avg|Fill|成交/.test(h) && !/注文|Order|Trigger|トリガー|@|＠/.test(h));
    const iAt = findCol(headers, /約定@|Filled@|成交@|@平均|@Avg/i, true);
    const iFee = findCol(headers, /手数料|^Fee$|^Commission$/);
    const iCcy = col(headers, ['通貨', 'Currency', '币种', '币種', '市場', 'Market']);
    const iMarket = col(headers, ['市場', 'Markets', 'Market', '市场']);
    const iAcct = col(headers, ['口座区分', '預り区分', '口座', 'Account']);
    const iStatus = col(headers, ['注文ステータス', 'ステータス', '状态', '状態', 'Status']);

    if (iSide < 0 || (iQtyFill < 0 && iQtyLoose < 0 && iAt < 0) || (iPriceFill < 0 && iPriceLoose < 0 && iAt < 0)) {
      return {
        holdings: [], skipped: 0, recognizedTrade: true,
        warnings: ['売買・数量・単価の列が必要です。見つかった見出し: ' + headerList(headers)],
      };
    }

    const txs = [];
    let skipped = 0;
    const warnings = [];
    const foreignSeen = new Set();
    for (let r = headerIndex + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.some(c => norm(c))) continue;
      const status = iStatus >= 0 ? norm(cells[iStatus]) : '';
      const at = iAt >= 0 ? atFill(cells[iAt]) : null;
      let qty = iQtyFill >= 0 ? num(cells[iQtyFill]) : null;
      if (!(qty > 0) && iQtyFill < 0 && iQtyLoose >= 0) qty = num(cells[iQtyLoose]);
      if (!(qty > 0) && at) qty = at.qty;
      const dead = /キャンセル|取消|失効|拒否|未約定|Cancelled|Canceled|Rejected|Expired|Pending|Waiting/.test(status);
      if (dead && !(qty > 0)) { skipped += 1; continue; }
      const side = tradeSide(cells[iSide]);
      if (!side) { skipped += 1; continue; }
      let price = iPriceFill >= 0 ? num(cells[iPriceFill]) : null;
      if (price == null && iPriceLoose >= 0 && !/@|＠/.test(norm(headers[iPriceLoose]))) price = num(cells[iPriceLoose]);
      if (price == null && at) price = at.price;
      const rawCode = iCode >= 0 ? cells[iCode] : '';
      const code = cleanCode(rawCode);
      const name = iName >= 0 ? norm(cells[iName]) : code;
      if (!(qty > 0) || price == null || (!code && !name)) { skipped += 1; continue; }
      const ccy = iCcy >= 0 ? norm(cells[iCcy]).toUpperCase() : '';
      const where = moomooMarket(rawCode, ccy, iMarket >= 0 ? cells[iMarket] : '');
      if (where === 'HK' || where === 'CN' || where === 'SG') {
        const label = name || code || norm(rawCode);
        if (!foreignSeen.has(label)) {
          foreignSeen.add(label);
          warnings.push(label + ' は米国株・日本株ではないため飛ばしました');
        }
        skipped += 1;
        continue;
      }
      const assetType = where === 'JP' ? 'jp-stock' : 'us-stock';
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
    txs.sort((a, b) => {
      const ta = tradeStamp(a.date);
      const tb = tradeStamp(b.date);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a.date).localeCompare(String(b.date));
    });
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
  const PASTE_NOISE = /^(米国|日本|NASDAQ|NYSE|AMEX|ナスダック|ニューヨーク|東証|銘柄|現在値|保有数量|取得単価|参考単価|評価額|評価損益|外貨建評価額|円換算評価額|外貨建評価損益|円換算評価損益|売却注文中|保有銘柄|前日比|前日比率|取得金額|円換算額|合計|小計|預り金|現金)$/;

  function isTickerToken(line) {
    const s = norm(line);
    const m = s.match(/^([A-Z]{1,5}(?:\.[A-Z])?)(?:\s+.*)?$/);
    if (!m) return null;
    if (/^(USD|JPY|NYSE|NASDAQ|AMEX|ETF|ADR|IPO)$/.test(m[1])) return null;
    return m[1];
  }

  function isParenQty(line) {
    return /^[（(]\s*[\d,.]+\s*株?\s*[）)]$/.test(norm(line));
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
    return /^[+\-−▲△▼▽]?[\d,.]+(\s*(円|ドル|USD|JPY|株))?$/.test(s);
  }

  function isLabelToken(line) {
    const s = norm(line).replace(/\s/g, '');
    if (!s) return false;
    if (PASTE_NOISE.test(s)) return true;
    return /前日比|評価損益|取得金額|円換算|売却注文|参考単価|保有数量|現在値|合計|小計|預り金/.test(s);
  }

  function isAccountToken(line) {
    const s = norm(line).replace(/^[【\[]|[】\]]$/g, '');
    if (!s || s.length > 32 || /[。、]/.test(s)) return null;
    if (/[A-Z]{2,}/.test(s) && !/NISA/.test(s)) return null;
    if (!/特定|一般|NISA|つみたて|成長/.test(s)) return null;
    return mapAccount(s);
  }

  function relErr(a, b) {
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale;
  }

  /* 4〜6桁で、どれかのドル価格×為替（50〜250）に一致する数は円の単価。株数にしない。 */
  function looksLikeYenUnit(qty, nums) {
    if (!(qty >= 1000) || qty >= 1000000) return false;
    for (let i = 0; i < nums.length; i++) {
      const p = nums[i];
      if (!(p > 0) || p >= 1000) continue;
      const fx = qty / p;
      if (fx >= 50 && fx <= 250) return true;
    }
    return false;
  }

  /* 1,000円未満でも、別の株数×ドル価格が評価額になるなら円の現在値。株数そのもの（1ドル×150株など）は残す。 */
  function looksLikeSmallYenPrice(qty, nums) {
    if (!(qty >= 50) || qty >= 1000) return false;
    for (let i = 0; i < nums.length; i++) {
      const p = nums[i];
      if (!(p > 0) || p >= 1000) continue;
      const fx = qty / p;
      if (fx < 50 || fx > 250) continue;
      for (let q = 0; q < nums.length; q++) {
        const shares = nums[q];
        if (!(shares > 0) || Math.abs(shares - qty) < 1e-6) continue;
        const mv = shares * p;
        for (let v = 0; v < nums.length; v++) {
          if (nums[v] > 0 && relErr(nums[v], mv) <= 0.03) return true;
        }
      }
    }
    return false;
  }

  /* 表の左から見て、最初に「ドル×為替＝円」になる数が現在値。取得単価はそれより右。 */
  function earliestFxIndex(nums) {
    for (let i = 0; i < nums.length; i++) {
      const p = nums[i];
      if (!(p > 0) || p >= 100000) continue;
      for (let j = 0; j < nums.length; j++) {
        if (j === i || !(nums[j] > 0)) continue;
        const fx = nums[j] / p;
        if (fx >= 50 && fx <= 250) return i;
      }
    }
    return -1;
  }

  /* 円換算評価額 − 円の評価損益 ＝ 取得金額、かつ取得単価×株数。
     取得金額そのものも為替の範囲に入るので、損益の一致で評価額と取り違えない。 */
  function bestYenChain(nums, used, jpyMv, qty) {
    let best = null;
    for (let ip = 0; ip < nums.length; ip++) {
      if (used.has(ip)) continue;
      const pnl = nums[ip];
      const cost = jpyMv - pnl;
      if (!(cost > 0)) continue;
      let listed = null;
      let listedErr = 1;
      let unit = null;
      let unitErr = 1;
      for (let k = 0; k < nums.length; k++) {
        if (k === ip || used.has(k)) continue;
        const v = nums[k];
        if (!(v > 0)) continue;
        const e = relErr(v, cost);
        if (e <= 0.01 && e < listedErr) { listedErr = e; listed = v; }
        if (qty > 0) {
          const eu = relErr(v * qty, cost);
          if (eu <= 0.01 && eu < unitErr) { unitErr = eu; unit = v; }
        }
      }
      if (listed == null && unit == null) continue;
      const both = listed != null && unit != null;
      const err = (listed != null ? listedErr : 0.01) + (unit != null ? unitErr : 0.01);
      const rank = both ? 0 : 1;
      if (!best || rank < best.rank || (rank === best.rank && err < best.err)) {
        best = {
          rank, err, pnl, both,
          cost: listed != null ? listed : (unit != null ? unit * qty : cost),
          unit,
        };
      }
    }
    return best;
  }

  /* アプリ内の短い1行（数量、取得単価ドル、現在値ドル、円評価額）だけ列の順で読む。 */
  function positionalSimple(nums) {
    if (nums.length !== 4 || nums.some(n => !(n > 0))) return null;
    if (nums[3] < 1000 || nums.slice(0, 3).some(n => n >= 1000)) return null;
    const qty = nums[0];
    const avg = nums[1];
    const price = nums[2];
    const market = nums[3];
    if (!(qty < 1000 && price < 100000 && avg < 100000)) return null;
    const fx = market / (price * qty);
    if (!(fx >= 50 && fx <= 250)) return null;
    const ratio = avg / price;
    if (!(ratio >= 0.05 && ratio <= 20)) return null;
    return {
      quantity: qty,
      csvPrice: price,
      csvMarketJpy: market,
      costJpy: avg * fx * qty,
      costUsd: avg * qty,
    };
  }

  /* 並び順に依存しない。株数×ドル現在値＝ドル評価額。
     取得金額の円も為替の範囲に入るため、円の評価損益＝円評価額−（円の取得単価×株数）も満たす組を優先する。
     ％・前日比・円の現在値（4〜6桁）は株数にしない。 */
  /* 売却注文中の列で株数が分かっているとき、評価額が現在値から大きくずれていても数量は返す。 */
  function fallbackFromHint(nums, qty) {
    const ei = earliestFxIndex(nums);
    const price = ei >= 0 ? nums[ei] : null;
    let yenUnit = null;
    if (price != null) {
      for (let j = 0; j < nums.length; j++) {
        if (j === ei || !(nums[j] > 0)) continue;
        const fx = nums[j] / price;
        if (fx >= 50 && fx <= 250) { yenUnit = nums[j]; break; }
      }
    }
    const fx = price != null && yenUnit != null ? yenUnit / price : null;
    let avg = null;
    const zeroAvg = nums.some(v => v === 0);
    if (!zeroAvg && price != null) {
      for (let i = ei + 1; i < nums.length; i++) {
        const a = nums[i];
        if (!(a > 0) || a >= 100000 || Math.abs(a - price) < 1e-9) continue;
        const ratio = a / price;
        if (ratio < 0.01 || ratio > 400) continue;
        let paired = false;
        for (let j = 0; j < nums.length; j++) {
          if (j === i || !(nums[j] > 0)) continue;
          const afx = nums[j] / a;
          if (afx >= 50 && afx <= 250) { paired = true; break; }
        }
        if (paired) { avg = a; break; }
      }
    }
    let jpyMv = null;
    if (price != null && fx != null) {
      const expect = price * qty * fx;
      let err = 0.08;
      for (let i = 0; i < nums.length; i++) {
        if (!(nums[i] > 0)) continue;
        const e = relErr(nums[i], expect);
        if (e < err) { err = e; jpyMv = nums[i]; }
      }
    }
    let costJpy = zeroAvg ? 0 : null;
    if (!zeroAvg && avg != null && fx != null) {
      const expectCost = avg * fx * qty;
      let err = 0.02;
      let found = null;
      for (let i = 0; i < nums.length; i++) {
        if (!(nums[i] > 0)) continue;
        const e = relErr(nums[i], expectCost);
        if (e < err) { err = e; found = nums[i]; }
      }
      costJpy = found != null ? found : expectCost;
    }
    return {
      quantity: qty,
      csvPrice: price,
      csvMarketJpy: jpyMv,
      costJpy,
      costUsd: avg != null ? avg * qty : (zeroAvg ? 0 : null),
    };
  }

  function interpretUsNumbers(nums, qtyHint) {
    const simple = positionalSimple(nums);
    if (simple) return simple;
    const n = nums.length;
    const hasYen = nums.some(v => v >= 1000);
    if (qtyHint != null && (looksLikeYenUnit(qtyHint, nums) || qtyHint >= 100000)) qtyHint = null;
    const fxAt = earliestFxIndex(nums);
    let best = null;
    for (let iq = 0; iq < n; iq++) {
      const qty = nums[iq];
      if (!(qty > 0) || qty > 1000000) continue;
      const hinted = qtyHint != null && Math.abs(qty - qtyHint) < 1e-4;
      for (let ip = 0; ip < n; ip++) {
        if (ip === iq) continue;
        const usdPx = nums[ip];
        if (!(usdPx > 0) || usdPx >= 100000) continue;
        for (let ia = 0; ia < n; ia++) {
          if (ia === iq || ia === ip) continue;
          const usdAvg = nums[ia];
          const zeroAvg = usdAvg === 0;
          if (usdAvg < 0 || usdAvg >= 100000) continue;
          let avgRatio = 1;
          if (!zeroAvg) {
            if (!(usdAvg > 0)) continue;
            avgRatio = usdAvg / usdPx;
            const maxRatio = hinted ? 400 : 20;
            if (avgRatio < 0.05 || avgRatio > maxRatio) continue;
          }
          let usdMv = null;
          let im = -1;
          const expectMv = qty * usdPx;
          for (let k = 0; k < n; k++) {
            if (k === iq || k === ip || k === ia || !(nums[k] > 0)) continue;
            if (!(expectMv > 0) || relErr(nums[k], expectMv) > 0.03) continue;
            if (im < 0 || relErr(nums[k], expectMv) < relErr(usdMv, expectMv)) {
              usdMv = nums[k];
              im = k;
            }
          }
          const usdPnlExpect = qty * (usdPx - usdAvg);
          let usdPnlOk = false;
          const usedUsd = new Set([iq, ip, ia]);
          if (im >= 0) usedUsd.add(im);
          for (let k = 0; k < n; k++) {
            if (usedUsd.has(k)) continue;
            const pnlTol = Math.max(0.05, Math.abs(usdPnlExpect) * 0.005);
            if (Math.abs(nums[k] - usdPnlExpect) <= pnlTol) {
              usdPnlOk = true;
              break;
            }
          }
          let usdCostOk = false;
          const expectCost = qty * usdAvg;
          for (let k = 0; k < n; k++) {
            if (usedUsd.has(k) || !(nums[k] > 0)) continue;
            if (expectCost === 0) continue;
            if (relErr(nums[k], expectCost) <= 0.005) { usdCostOk = true; break; }
          }
          const jpyCandidates = [];
          /* 1,000を超える数はドルの評価額でもある。円が無くても、株数×現在値に合う組は残す。 */
          if (usdMv != null) jpyCandidates.push(-1);
          const fxLo = hinted ? 15 : 50;
          const fxHi = hinted ? 500 : 250;
          for (let ij = 0; ij < n; ij++) {
            if (ij === iq || ij === ip || ij === ia || ij === im) continue;
            if (!(nums[ij] > 0)) continue;
            const fxTry = nums[ij] / (usdPx * qty);
            if (fxTry >= fxLo && fxTry <= fxHi) jpyCandidates.push(ij);
          }
          if (!jpyCandidates.length) continue;
          for (const ij of jpyCandidates) {
            const jpyMv = ij < 0 ? null : nums[ij];
            const fx = jpyMv == null ? null : jpyMv / (usdPx * qty);
            const used = new Set(usedUsd);
            if (ij >= 0) used.add(ij);
            let jpyPx = false;
            if (fx != null && fx > 0) {
              for (let k = 0; k < n; k++) {
                if (used.has(k) || !(nums[k] > 0)) continue;
                if (Math.abs(nums[k] / usdPx - fx) / fx <= 0.02) { jpyPx = true; break; }
              }
            }
            const chain = jpyMv == null ? null : bestYenChain(nums, used, jpyMv, qty);
            let score = (usdMv != null ? 90 : 0) + (jpyMv != null ? 30 : 0) + (jpyPx ? 25 : 0);
            if (usdPnlOk) score += 110;
            if (usdCostOk) score += 35;
            if (chain) score += chain.both ? 220 : 120;
            if (!zeroAvg) score += Math.max(0, 20 - Math.abs(Math.log(avgRatio)) * 8);
            else score += 30;
            if (Math.abs(qty - Math.round(qty)) < 1e-6) score += 8;
            if (looksLikeYenUnit(qty, nums)) score -= 70;
            if (looksLikeSmallYenPrice(qty, nums) && !hinted) score -= 70;
            if (hinted) score += 40;
            if (ip < ia) score += 12;
            if (ip === fxAt) score += 140;
            if (!best || score > best.score) {
              best = { score, qty, usdPx, usdAvg, jpyMv, fx, chain, usdPnlOk, zeroAvg };
            }
          }
        }
      }
    }
    if (!best) {
      if (qtyHint != null && qtyHint > 0 && !looksLikeYenUnit(qtyHint, nums)) return fallbackFromHint(nums, qtyHint);
      return null;
    }
    if (qtyHint != null && Math.abs(best.qty - qtyHint) > 1e-4 && !looksLikeYenUnit(qtyHint, nums)
      && (looksLikeYenUnit(best.qty, nums) || looksLikeSmallYenPrice(best.qty, nums))) {
      return fallbackFromHint(nums, qtyHint);
    }
    let costJpy = null;
    if (best.zeroAvg) {
      if (best.chain && best.chain.cost > 0 && best.jpyMv != null && relErr(best.chain.cost, best.jpyMv) > 0.02) {
        costJpy = best.chain.cost;
      } else costJpy = 0;
      return {
        quantity: best.qty,
        csvPrice: best.usdPx,
        csvMarketJpy: best.jpyMv,
        costJpy,
        costUsd: 0,
      };
    }
    if (best.chain) costJpy = best.chain.cost;
    else if (best.jpyMv != null && best.fx) costJpy = best.usdAvg * best.fx * best.qty;
    if (best.chain && best.chain.unit != null && best.qty > 1 && costJpy != null && relErr(costJpy, best.chain.unit) <= 0.01) {
      costJpy = best.chain.unit * best.qty;
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
    const cells = String(line).split('\t').map(norm);
    return cells.some(Boolean) ? cells : [];
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
      if (!cell || cell === code || isTickerToken(cell) || isNumberToken(cell) || isParenQty(cell) || shareCountToken(cell) != null || isPercentToken(cell) || isAccountToken(cell) || isLabelToken(cell)) continue;
      const stripped = cell.replace(code, '').replace(/米国|日本|NASDAQ|NYSE|AMEX/g, '').trim();
      if (stripped) return stripped;
    }
    return '';
  }

  function lineHasNumbers(line) {
    return line.some(c => isNumberToken(c) || isParenQty(c) || shareCountToken(c) != null);
  }

  /* 合計・現金・見出し・預り区分。銘柄の上下に挟まっても、隣の株数に混ぜない。 */
  function isSectionBoundary(line) {
    if (!line.length) return true;
    const head = norm(line[0]).replace(/\s/g, '');
    if (/^(合計|小計|預り金|現金|銘柄|USD|JPY)$/.test(head)) return true;
    if (line.length === 1 && isAccountToken(line[0])) return true;
    if (line.every(c => !norm(c) || isLabelToken(c) || isAccountToken(c))) return true;
    if (!lineHasNumbers(line) && line.filter(c => isLabelToken(c)).length >= 2) return true;
    return false;
  }

  /* 次の銘柄の上段（名前＋ドル）。円だけの続き行とは別。 */
  function looksLikeFreshUpper(line) {
    if (tickerIn(line) || isSectionBoundary(line)) return false;
    if (!line.some(c => isNumberToken(c) || shareCountToken(c) != null)) return false;
    return nameIn(line, '') !== '';
  }

  /* 保有数量の真下（または真上）が（売却注文中）。株数は括弧の外。列がずれても2行の組で見る。 */
  function qtyHintAcross(group) {
    let hint = null;
    for (let a = 0; a < group.length; a++) {
      for (let b = 0; b < group.length; b++) {
        if (a === b) continue;
        const width = Math.max(group[a].length, group[b].length);
        for (let c = 0; c < width; c++) {
          const upper = group[a][c] || '';
          const lower = group[b][c] || '';
          const shares = shareCountToken(upper);
          if (shares != null && (isParenQty(lower) || lower === '')) hint = shares;
          if (isNumberToken(upper) && isParenQty(lower)) hint = num(upper);
        }
      }
    }
    return hint;
  }

  function holdingName(group, code) {
    const parts = [];
    group.forEach(line => {
      const n = nameIn(line, code);
      if (!n || /好材料|悪材料|注目/.test(n)) return;
      if (parts.indexOf(n) < 0) parts.push(n);
    });
    return parts.join(' ').trim();
  }

  /* 表のコピーはふつう1銘柄が2行。名前の折り返しや材料で3行になっても、ティッカーの前後を同じ銘柄にする。
     上段がドルと株数、下段が円と（売却注文中）。下段が欠けていてもティッカー行は残す。 */
  function parseSbiUsTable(lines, opt) {
    const holdings = [];
    let skipped = 0;
    const warnings = [];
    let account = opt.accountFallback || 'unset';
    const kinds = lines.map(line => ({
      line,
      code: tickerIn(line),
      nums: lineHasNumbers(line),
      boundary: isSectionBoundary(line),
    }));
    const consumed = new Set();
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i].boundary) {
        const acct = kinds[i].line.map(isAccountToken).find(Boolean);
        if (acct) account = acct;
      }
      if (!kinds[i].code || consumed.has(i)) continue;
      const idxs = [i];
      for (let j = i - 1; j >= 0 && idxs.length < 4; j--) {
        if (consumed.has(j) || kinds[j].code || kinds[j].boundary) break;
        idxs.unshift(j);
      }
      const numCount = idxs.filter(k => kinds[k].nums).length;
      const next = i + 1;
      if (numCount < 2 && next < kinds.length && !consumed.has(next) && !kinds[next].code && !kinds[next].boundary
        && kinds[next].nums && !looksLikeFreshUpper(kinds[next].line)) {
        idxs.push(next);
      }
      idxs.forEach(k => consumed.add(k));
      const group = idxs.map(k => kinds[k].line);
      const code = kinds[i].code;
      for (const line of group) {
        const acct = line.map(isAccountToken).find(Boolean);
        if (acct) account = acct;
      }
      const cells = group.reduce((acc, line) => acc.concat(line), []);
      const found = numbersInCells(cells);
      const across = qtyHintAcross(group);
      const qtyHint = across != null ? across : found.qtyHint;
      const parsed = interpretUsNumbers(found.nums, qtyHint);
      const name = holdingName(group, code);
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
        if (isNumberToken(token) || isParenQty(token) || shareCountToken(token) != null || isAccountToken(token) || isLabelToken(token)) continue;
        name = token;
        break;
      }
      const nums = [];
      let qtyHint = null;
      for (let i = at + 1; i < next; i++) {
        const acct = isAccountToken(tokens[i]);
        if (acct) {
          let nameAfter = false;
          for (let k = i + 1; k < next; k++) {
            const token = tokens[k];
            if (isNumberToken(token) || isParenQty(token) || shareCountToken(token) != null || isAccountToken(token) || isLabelToken(token)) continue;
            nameAfter = true;
            break;
          }
          if (!nameAfter && nums.length) account = acct;
          break;
        }
        const shares = shareCountToken(tokens[i]);
        if (shares != null) {
          nums.push(shares);
          if (qtyHint == null) qtyHint = shares;
          continue;
        }
        if (isNumberToken(tokens[i]) && isParenQty(tokens[i + 1] || '')) {
          const q = num(tokens[i]);
          nums.push(q);
          if (qtyHint == null) qtyHint = q;
          continue;
        }
        if (isPercentToken(tokens[i]) || isParenQty(tokens[i]) || isLabelToken(tokens[i])) continue;
        if (isNumberToken(tokens[i])) nums.push(num(tokens[i]));
      }
      if (!name) {
        for (let i = at + 1; i < next; i++) {
          const token = tokens[i];
          if (isNumberToken(token) || isParenQty(token) || shareCountToken(token) != null || isAccountToken(token) || isLabelToken(token)) continue;
          name = token;
          break;
        }
      }
      const parsed = interpretUsNumbers(nums, qtyHint);
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
      if (looksLikeXlsx(text)) return blankResult(['Excelのままでは読めません。CSVで保存してください']);
      const trades = parseTrades(rows, opt);
      if (trades.recognizedTrade || trades.holdings.length) return trades;
      const positions = parseFlat(rows, opt);
      if (positions.holdings.length) {
        positions.warnings.unshift('取引履歴ではなく、いまの保有一覧として読みました');
        return positions;
      }
      const warnings = [];
      positions.warnings.concat(trades.warnings).forEach(w => {
        if (w && warnings.indexOf(w) < 0) warnings.push(w);
      });
      if (!warnings.length) warnings.push('見出し行が見つかりませんでした');
      return { holdings: [], skipped: positions.skipped, warnings };
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
