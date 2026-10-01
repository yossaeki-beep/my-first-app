(() => {
  const $ = id => document.getElementById(id);
  let state = Store.load();
  let filter = { broker: '', account: '', asset: '' };

  const HELP = {
    'rakuten-all': '楽天証券の「資産残高・保有商品」で「すべて」を開き、「CSVで保存」したファイルです。同じファイルを読み直すと、楽天証券のこの区分だけが最新の内容に置き換わります。',
    'sbi-domestic': 'SBI証券の「口座管理 → 保有証券」から落としたCSVです。国内の株式と投資信託を読みます。米国株はこのCSVに入らないので、別の「米国株（画面からコピー）」で貼り付けてください。',
    'sbi-us': 'SBI証券の米国株には、保有残高をまとめて落とすCSVがありません。外国株式サイトの「口座管理 → 保有銘柄」で、預り区分ごとの表を選択してコピーし、下の欄に貼り付けてください。国内の株・投信とは別に保存します。',
    'monex-stock': 'マネックス証券の保有銘柄一覧のうち、株式の表の下にあるCSVです。単元未満株や投信は、それぞれの種類で読み込んでください。',
    'monex-fractional': 'マネックス証券の単元未満株（ワン株）のCSVです。株式の保有とは別に残ります。',
    'monex-fund': 'マネックス証券の投資信託のCSVです。基準価額と評価額は、このファイルの値を使います。',
    'moomoo-trades': 'moomoo証券の取引履歴CSVです。口座を開いてからの全期間を読み、買いと売りから残りの数量を作ります。期間を切ると過去の買いが落ちます。',
    'bitflyer-spot': 'bitFlyerの「お取引レポート」で「すべてのお取引」を申請したCSVです。現物の残高だけを作り、CFD・先物・FXは飛ばします。',
  };

  const ASSET_COLOR = {
    'jp-stock': '#d7b071',
    'us-stock': '#e7e1d6',
    fund: '#8fbf9f',
    crypto: '#d98b6a',
  };

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function persist() { Store.save(state); }

  function fx() { return state.fx && state.fx.usdJpy ? state.fx : null; }

  function positions() {
    return state.holdings.map(h => Calc.position(h, fx()));
  }

  function show(name) {
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'import') fillImportForm();
    if (name === 'settings') fillSettings();
    render();
  }

  function render() {
    renderAsOf();
    const view = document.querySelector('.view:not([hidden])').id;
    if (view === 'view-overview') renderOverview();
    if (view === 'view-holdings') renderHoldings();
    if (view === 'view-import') renderHistory();
  }

  function renderAsOf() {
    const dates = state.holdings.map(h => h.closeAsOf).filter(Boolean).sort();
    const bits = [];
    if (dates.length) bits.push('終値 ' + dates[dates.length - 1]);
    if (state.fx && state.fx.usdJpy) {
      bits.push('1ドル = ' + Number(state.fx.usdJpy).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '円');
    }
    $('asOf').textContent = bits.join(' / ');
  }

  function metric(label, value, cls) {
    return '<div><span>' + label + '</span><strong class="' + (cls || '') + '">' + value + '</strong></div>';
  }

  function renderOverview() {
    const list = positions();
    const total = Calc.sumPositions(list);
    const hero = $('hero');
    if (!state.holdings.length) {
      hero.innerHTML = '<p class="label">まだ保有がありません</p>' +
        '<p class="total">¥0</p>' +
        '<p class="note">「取込」で楽天・SBI・マネックスの保有CSV、moomooの取引履歴、bitFlyerの取引レポートを読み込みます。ウィブル証券は手入力です。</p>';
    } else {
      hero.innerHTML =
        '<p class="label">評価額</p>' +
        '<p class="total">' + Calc.fmtYen(total.marketJpy) + '</p>' +
        '<div class="metrics">' +
          metric('取得金額', Calc.fmtYen(total.costJpy)) +
          metric('評価損益', (total.pnl > 0 ? '+' : '') + Calc.fmtYen(total.pnl), Calc.signClass(total.pnl)) +
          metric('損益率', Calc.fmtPct(total.rate), Calc.signClass(total.pnl)) +
          metric('時価未設定', total.missing ? total.missing + '件' : 'なし') +
        '</div>';
    }

    const assets = Calc.groupByAsset(state.holdings, fx()).filter(g => g.marketJpy);
    const sum = assets.reduce((s, g) => s + g.marketJpy, 0);
    $('alloc').innerHTML = assets.map(g =>
      '<i style="width:' + (g.marketJpy / sum * 100) + '%;background:' + ASSET_COLOR[g.key] + '"></i>'
    ).join('');
    let legend = document.getElementById('allocLegend');
    if (!legend) {
      legend = document.createElement('div');
      legend.id = 'allocLegend';
      legend.className = 'alloc-legend';
      $('alloc').after(legend);
    }
    legend.innerHTML = assets.map(g =>
      '<span><i class="dot" style="background:' + ASSET_COLOR[g.key] + '"></i>' +
      g.label + ' ' + Calc.fmtYen(g.marketJpy) + '</span>'
    ).join('');

    $('accountGroups').innerHTML = Calc.groupByAccount(state.holdings, fx())
      .filter(g => g.key !== 'unset' || g.count)
      .map(g => {
      const children = (g.children || []).filter(c => c.count).map(c =>
        '<button type="button" class="group" data-account="' + c.key + '">' + groupBody(c) + '</button>'
      ).join('');
      return '<button type="button" class="group" data-account="' + g.key + '">' + groupBody(g) + '</button>' +
        (children ? '<div class="children">' + children + '</div>' : '');
    }).join('');

    $('brokerGroups').innerHTML = Calc.groupByBroker(state.holdings, fx()).map(g => {
      const parts = [
        g.parts.tokutei.count ? '特定 ' + Calc.fmtYen(g.parts.tokutei.marketJpy) : '',
        g.parts.nisa.count ? 'NISA ' + Calc.fmtYen(g.parts.nisa.marketJpy) : '',
        g.parts.general.count ? '一般 ' + Calc.fmtYen(g.parts.general.marketJpy) : '',
        g.parts.crypto.count ? '暗号資産 ' + Calc.fmtYen(g.parts.crypto.marketJpy) : '',
      ].filter(Boolean).join(' / ');
      return '<button type="button" class="group" data-broker="' + escapeHtml(g.broker) + '">' +
        groupBody(Object.assign({ label: g.broker }, g)) +
        (parts ? '<div class="parts">' + parts + '</div>' : '') +
        '</button>';
    }).join('');
  }

  function groupBody(g) {
    const pnl = g.pnl == null ? '—' : ((g.pnl > 0 ? '+' : '') + Calc.fmtYen(g.pnl) + ' ' + Calc.fmtPct(g.rate));
    return '<header><span class="name">' + escapeHtml(g.label) + '</span>' +
      '<strong>' + Calc.fmtYen(g.marketJpy) + '</strong></header>' +
      '<div class="sub">' + g.count + '件 · 損益 <span class="' + Calc.signClass(g.pnl) + '">' + pnl + '</span></div>';
  }

  function matches(h) {
    if (filter.broker && h.broker !== filter.broker) return false;
    if (filter.account === 'nisa' && h.accountType !== 'nisa-growth' && h.accountType !== 'nisa-tsumitate') return false;
    if (filter.account && filter.account !== 'nisa' && h.accountType !== filter.account) return false;
    if (filter.asset && h.assetType !== filter.asset) return false;
    return true;
  }

  function renderHoldings() {
    const chips = [];
    if (filter.broker) chips.push(filter.broker);
    if (filter.account) chips.push(filter.account === 'nisa' ? 'NISA口座' : Calc.ACCOUNT_LABEL[filter.account]);
    if (filter.asset) chips.push(Calc.ASSET_LABEL[filter.asset]);
    $('filters').innerHTML = (chips.length
      ? '<button type="button" id="clearFilter">絞り込み解除（' + chips.map(escapeHtml).join(' / ') + '）</button>'
      : '<span class="note">カードを押すと数量と取得金額を修正できます。</span>');

    const list = positions().filter(matches).sort((a, b) => (b.marketJpy || 0) - (a.marketJpy || 0));
    if (!list.length) {
      $('holdingList').innerHTML = '<div class="empty">該当する保有がありません。</div>';
      return;
    }
    $('holdingList').innerHTML = list.map(p => {
      const price = p.assetType === 'us-stock'
        ? (p.closePrice != null ? Calc.fmtUsd(p.closePrice) : (p.csvPrice != null ? Calc.fmtUsd(p.csvPrice) : '—'))
        : (p.closePrice != null ? Calc.fmtYen(p.closePrice) : (p.csvPrice != null ? Calc.fmtYen(p.csvPrice) : '—'));
      const fromFile = p.scope === 'sbi-us' ? '貼り付け時の評価' : 'CSVの評価';
      const basis = p.basis === 'close' ? '終値' + (p.closeAsOf ? ' ' + p.closeAsOf : '') : p.basis === 'csv' ? fromFile : '時価未設定';
      return '<button type="button" class="card" data-id="' + escapeHtml(p.id) + '">' +
        '<header><span><span class="code">' + escapeHtml(p.code || Calc.ASSET_LABEL[p.assetType]) + '</span> ' +
        escapeHtml(p.name) + '</span><strong>' + Calc.fmtYen(p.marketJpy) + '</strong></header>' +
        '<div class="sub">' + Calc.fmtQty(p) + ' · 取得 ' + Calc.fmtYen(p.cost) +
        (p.costFromFx ? '（いまのドル円で換算）' : '') + '</div>' +
        '<div class="sub">評価損益 <span class="' + Calc.signClass(p.pnl) + '">' +
        (p.pnl > 0 ? '+' : '') + Calc.fmtYen(p.pnl) + ' ' + Calc.fmtPct(p.rate) + '</span>' +
        (p.marketUsd != null ? ' · ' + Calc.fmtUsd(p.marketUsd) : '') + '</div>' +
        '<div class="tags"><span class="tag">' + escapeHtml(p.broker) + '</span>' +
        '<span class="tag">' + escapeHtml(Calc.ACCOUNT_LABEL[p.accountType] || '未設定') + '</span>' +
        '<span class="tag">' + basis + ' ' + price + '</span></div></button>';
    }).join('');
  }

  function fillImportForm() {
    const broker = $('importBroker');
    if (!broker.options.length) {
      broker.innerHTML = Calc.BROKERS.map(b => '<option>' + b + '</option>').join('');
    }
    const kinds = Csv.FILE_KINDS[broker.value] || [];
    const kind = $('importKind');
    const prev = kind.value;
    kind.innerHTML = kinds.map(k => '<option value="' + k.scope + '">' + k.label + '</option>').join('');
    if (kinds.some(k => k.scope === prev)) kind.value = prev;
    const scope = kind.value;
    const paste = !!(kinds.find(k => k.scope === scope) || {}).paste;
    $('kindWrap').hidden = kinds.length === 0;
    $('pasteWrap').hidden = !paste;
    $('fileWrap').hidden = paste || kinds.length === 0;
    $('csvFile').disabled = paste || kinds.length === 0;
    $('fileLabel').textContent = kinds.length ? 'CSVを選ぶ' : '手入力のみ';
    $('importHelp').textContent = kinds.length
      ? (HELP[scope] || '')
      : 'ウィブル証券は口座だけ登録しています。保有ができたあとにCSVの列を足します。それまでは「手入力で追加」を使ってください。';
    $('importAccount').parentElement.hidden = scope === 'bitflyer-spot';
  }

  function renderHistory() {
    $('importHistory').innerHTML = state.imports.length
      ? state.imports.map(item =>
        '<li>' + escapeHtml(item.broker) + ' · ' + escapeHtml(item.filename || item.scope) +
        ' · ' + item.count + '件 · ' + escapeHtml(item.at.slice(0, 16).replace('T', ' ')) + '</li>'
      ).join('')
      : '<li>まだありません</li>';
  }

  function fillSettings() {
    if (document.activeElement === $('fxInput') || document.activeElement === $('endpointInput')) return;
    $('fxInput').value = state.fx && state.fx.usdJpy ? state.fx.usdJpy : '';
    $('endpointInput').value = state.priceEndpoint || '';
  }

  function fillSelect(select, options, value) {
    select.innerHTML = options.map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('');
    select.value = value;
  }

  function openEdit(holding) {
    const fresh = !holding;
    const h = holding || {
      id: '', broker: '楽天証券', accountType: 'tokutei', assetType: 'jp-stock',
      name: '', code: '', quantity: '', costJpy: '', csvPrice: '', scope: 'manual',
    };
    $('editTitle').textContent = fresh ? '保有を追加' : '保有を修正';
    $('editScopeNote').textContent = !fresh && h.scope && h.scope !== 'manual'
      ? 'この行はCSVから入っています。同じファイルを読み直すと、修正は上書きされます。'
      : '';
    fillSelect($('editBroker'), Calc.BROKERS.map(b => ({ value: b, label: b })), h.broker || Calc.BROKERS[0]);
    fillSelect($('editAccount'), Object.keys(Calc.ACCOUNT_LABEL).map(k => ({ value: k, label: Calc.ACCOUNT_LABEL[k] })), h.accountType || 'tokutei');
    $('editAsset').value = h.assetType || 'jp-stock';
    $('editName').value = h.name || '';
    $('editCode').value = h.code || '';
    $('editQty').value = h.quantity ?? '';
    $('editCost').value = h.costJpy ?? '';
    $('editPrice').value = h.csvPrice ?? '';
    $('editDelete').hidden = fresh;
    $('editDialog').dataset.id = h.id || '';
    $('editDialog').dataset.scope = h.scope || 'manual';
    $('editDialog').showModal();
  }

  function applyParsed(parsed, filename) {
    const scope = $('importKind').value;
    const broker = $('importBroker').value;
    const box = $('importResult');
    box.hidden = false;
    if (!parsed.holdings.length) {
      box.innerHTML = '<strong>読み込めませんでした。</strong><br>' +
        parsed.warnings.map(escapeHtml).join('<br>');
      return;
    }
    Store.applyImport(state, {
      broker, scope, holdings: parsed.holdings, filename, skipped: parsed.skipped,
    });
    persist();
    box.innerHTML = '<strong>' + parsed.holdings.length + '件を取り込みました。</strong>' +
      (parsed.skipped ? '<br>飛ばした行: ' + parsed.skipped : '') +
      (parsed.warnings.length ? '<br>' + parsed.warnings.map(escapeHtml).join('<br>') : '');
    toast(broker + ' を更新しました');
    renderHistory();
  }

  async function onCsv(file) {
    const scope = $('importKind').value;
    if (!scope) { toast('この証券会社のCSVはまだ対応していません'); return; }
    const text = Csv.decodeCsvBytes(await file.arrayBuffer());
    applyParsed(Csv.parseFile(text, {
      broker: $('importBroker').value, scope, accountFallback: $('importAccount').value,
    }), file.name);
  }

  async function refreshCloses() {
    const symbols = Prices.symbolsFor(state.holdings);
    if (!symbols.length) { toast('終値を取る銘柄がありません'); return; }
    $('closeBtn').disabled = true;
    try {
      const quotes = await Prices.fetchCloses(state.priceEndpoint, symbols);
      const { missed } = Prices.applyQuotes(state, quotes);
      persist();
      render();
      toast(missed.length ? '終値を取れなかった銘柄があります' : '終値で評価しました');
    } catch (e) {
      toast(e.code === 'NO_ENDPOINT' ? '設定で終値の中継URLを入れてください' : e.message);
    } finally {
      $('closeBtn').disabled = false;
    }
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.querySelector('.tabbar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (btn) show(btn.dataset.view);
  });

  $('accountGroups').addEventListener('click', e => {
    const btn = e.target.closest('[data-account]');
    if (!btn) return;
    filter = { broker: '', account: btn.dataset.account, asset: '' };
    show('holdings');
  });
  $('brokerGroups').addEventListener('click', e => {
    const btn = e.target.closest('[data-broker]');
    if (!btn) return;
    filter = { broker: btn.dataset.broker, account: '', asset: '' };
    show('holdings');
  });
  $('holdingList').addEventListener('click', e => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    openEdit(state.holdings.find(h => h.id === btn.dataset.id));
  });
  $('filters').addEventListener('click', e => {
    if (e.target.id === 'clearFilter') {
      filter = { broker: '', account: '', asset: '' };
      renderHoldings();
    }
  });

  $('addBtn').addEventListener('click', () => openEdit(null));
  $('closeBtn').addEventListener('click', refreshCloses);
  $('importBroker').addEventListener('change', fillImportForm);
  $('importKind').addEventListener('change', fillImportForm);
  $('csvFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) onCsv(file);
  });
  $('pasteBtn').addEventListener('click', () => {
    const text = $('pasteBox').value;
    if (!text.trim()) { toast('保有一覧を貼り付けてください'); return; }
    applyParsed(Csv.parseFile(text, {
      broker: $('importBroker').value,
      scope: $('importKind').value,
      accountFallback: $('importAccount').value,
    }), 'SBI米国株（貼り付け）');
  });

  $('editForm').addEventListener('submit', e => { e.preventDefault(); $('editSave').click(); });
  $('editClose').addEventListener('click', () => $('editDialog').close());
  $('editSave').addEventListener('click', () => {
    const qty = Number($('editQty').value);
    if (!(qty > 0) || !$('editName').value.trim()) { toast('名称と数量を入力してください'); return; }
    const id = $('editDialog').dataset.id;
    const existing = state.holdings.find(h => h.id === id);
    const assetType = $('editAsset').value;
    Store.upsertHolding(state, {
      id: id || undefined,
      broker: $('editBroker').value,
      scope: $('editDialog').dataset.scope || 'manual',
      accountType: assetType === 'crypto' ? 'crypto' : $('editAccount').value,
      assetType,
      name: $('editName').value.trim(),
      code: $('editCode').value.trim(),
      quantity: qty,
      costJpy: $('editCost').value === '' ? null : Number($('editCost').value),
      costUsd: existing ? existing.costUsd : null,
      csvPrice: $('editPrice').value === '' ? null : Number($('editPrice').value),
      csvPriceCurrency: assetType === 'us-stock' ? 'USD' : 'JPY',
      csvMarketJpy: existing ? existing.csvMarketJpy : null,
      closePrice: existing ? existing.closePrice : null,
      closeAsOf: existing ? existing.closeAsOf : null,
      closeCurrency: existing ? existing.closeCurrency : null,
    });
    persist();
    $('editDialog').close();
    render();
    toast('保存しました');
  });
  $('editDelete').addEventListener('click', () => {
    const id = $('editDialog').dataset.id;
    if (!id) return;
    Store.removeHolding(state, id);
    persist();
    $('editDialog').close();
    render();
    toast('削除しました');
  });

  $('fxSave').addEventListener('click', () => {
    const n = Number($('fxInput').value);
    if (!(n > 0)) { toast('ドル円を入力してください'); return; }
    state.fx = { usdJpy: n, asOf: new Date().toISOString().slice(0, 10), source: 'manual' };
    persist();
    toast('ドル円を保存しました');
    renderAsOf();
  });
  $('endpointSave').addEventListener('click', () => {
    state.priceEndpoint = $('endpointInput').value.trim().replace(/\/$/, '');
    persist();
    toast('中継URLを保存しました');
  });
  $('backupBtn').addEventListener('click', () => {
    download('portfolio-backup.json', JSON.stringify(state, null, 2), 'application/json');
  });
  $('exportBtn').addEventListener('click', () => {
    download('holdings.csv', Calc.holdingsCsv(state.holdings, fx()), 'text/csv');
  });
  $('restoreBtn').addEventListener('click', () => $('restoreFile').click());
  $('restoreFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.holdings)) throw new Error('形式が違います');
      state = Object.assign(Store.empty(), data, {
        fx: Object.assign(Store.empty().fx, data.fx || {}),
        holdings: data.holdings,
        imports: Array.isArray(data.imports) ? data.imports : [],
      });
      persist();
      render();
      toast('復元しました');
    } catch (err) {
      toast('復元できませんでした');
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  fillImportForm();
  render();
})();
