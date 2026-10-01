const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const Calc = require('./calc.js');
const Csv = require('./csv.js');
const Store = require('./store.js');
const Prices = require('./prices.js');

function h(partial) {
  return Object.assign({
    broker: '楽天証券', scope: 'rakuten-all', accountType: 'tokutei',
    assetType: 'jp-stock', code: '7203', name: 'トヨタ', quantity: 100,
    costJpy: 250000, costUsd: null, csvPrice: 2500, csvPriceCurrency: 'JPY',
    csvMarketJpy: 250000, closePrice: null, closeAsOf: null,
  }, partial);
}

test('日本株は終値があれば終値で評価する', () => {
  const p = Calc.position(h({ closePrice: 2800, closeAsOf: '2026-03-31' }), null);
  assert.equal(p.marketJpy, 280000);
  assert.equal(p.pnl, 30000);
  assert.equal(p.basis, 'close');
  assert.ok(Math.abs(p.rate - 0.12) < 1e-9);
});

test('終値が無い日本株はCSVの評価額を使う', () => {
  const p = Calc.position(h({ csvMarketJpy: 260000, closePrice: null }), null);
  assert.equal(p.marketJpy, 260000);
  assert.equal(p.basis, 'csv');
});

test('米国株は終値とドル円で円評価し、CSVの円評価は終値の前には使う', () => {
  const held = h({
    assetType: 'us-stock', code: 'AAPL', name: 'アップル', quantity: 2,
    costJpy: 54000, csvPrice: 180, csvPriceCurrency: 'USD', csvMarketJpy: 56000,
  });
  const before = Calc.position(held, { usdJpy: 150 });
  assert.equal(before.basis, 'csv');
  assert.equal(before.marketJpy, 56000);
  const after = Calc.position(Object.assign({}, held, { closePrice: 190, closeAsOf: '2026-03-31' }), { usdJpy: 150 });
  assert.equal(after.marketUsd, 380);
  assert.equal(after.marketJpy, 57000);
  assert.equal(after.pnl, 3000);
});

test('取引履歴由来の米国株はドルコストをいまのドル円で円換算する', () => {
  const p = Calc.position(h({
    assetType: 'us-stock', quantity: 1, costJpy: null, costUsd: 180.5,
    csvMarketJpy: null, csvPrice: null, closePrice: 200,
  }), { usdJpy: 150 });
  assert.equal(p.costFromFx, true);
  assert.equal(p.cost, 180.5 * 150);
  assert.equal(p.marketJpy, 30000);
});

test('投資信託は終値を使わず、無ければ万口で計算する', () => {
  const fromCsv = Calc.position(h({
    assetType: 'fund', code: '', name: '全世界', quantity: 100000,
    costJpy: 150000, csvPrice: 16000, csvMarketJpy: 160000, closePrice: 99999,
  }), null);
  assert.equal(fromCsv.marketJpy, 160000);
  assert.equal(fromCsv.basis, 'csv');
  const fromNav = Calc.valueOf(h({
    assetType: 'fund', quantity: 100000, csvMarketJpy: null, csvPrice: 16000, closePrice: 1,
  }), null);
  assert.equal(fromNav.marketJpy, 160000);
});

test('口座区分と証券会社の合計は全体と一致し、NISAは二つの枠の和', () => {
  const fx = { usdJpy: 150 };
  const holdings = [
    h({ broker: '楽天証券', accountType: 'tokutei', csvMarketJpy: 100000, costJpy: 80000, closePrice: null }),
    h({ broker: '楽天証券', accountType: 'nisa-growth', code: '6758', csvMarketJpy: 40000, costJpy: 50000, closePrice: null }),
    h({ broker: 'SBI証券', accountType: 'nisa-tsumitate', assetType: 'fund', code: '', name: '投信', quantity: 1, csvMarketJpy: 30000, costJpy: 20000 }),
    h({ broker: 'bitFlyer', accountType: 'crypto', assetType: 'crypto', code: 'BTC', name: 'BTC', quantity: 0.1, costJpy: 500000, csvMarketJpy: null, closePrice: 8000000 }),
  ];
  const all = Calc.bucket(holdings, fx);
  const accounts = Calc.groupByAccount(holdings, fx);
  const nisa = accounts.find(a => a.key === 'nisa');
  assert.equal(nisa.marketJpy, 70000);
  assert.equal(nisa.children[0].marketJpy, 30000);
  assert.equal(nisa.children[1].marketJpy, 40000);
  const brokers = Calc.groupByBroker(holdings, fx);
  const brokerSum = brokers.reduce((s, b) => s + (b.marketJpy || 0), 0);
  assert.equal(brokerSum, all.marketJpy);
  assert.equal(brokers.find(b => b.broker === 'ウィブル証券').count, 0);
  const btc = Calc.position(holdings[3], fx);
  assert.equal(btc.marketJpy, 800000);
  assert.equal(brokers.find(b => b.broker === '楽天証券').parts.tokutei.marketJpy, 100000);
  assert.equal(brokers.find(b => b.broker === '楽天証券').parts.nisa.marketJpy, 40000);
});

test('同じ銘柄でも口座が違えば平均しない', () => {
  const list = [
    h({ accountType: 'tokutei', quantity: 100, costJpy: 200000, csvMarketJpy: 280000, closePrice: null }),
    h({ accountType: 'nisa-growth', quantity: 100, costJpy: 300000, csvMarketJpy: 280000, closePrice: null }),
  ];
  const positions = list.map(x => Calc.position(x, null));
  assert.equal(positions[0].pnl, 80000);
  assert.equal(positions[1].pnl, -20000);
  assert.equal(Calc.bucket(list, null).pnl, 60000);
});

test('楽天の保有一覧は種別と口座を分け、預り金は飛ばす', () => {
  const csv = [
    '種別,銘柄コード・ティッカー,銘柄,口座,保有数量,[単位],平均取得価格,[単位],現在値,[単位],時価評価額[円],評価損益[円]',
    '国内株式,7203,トヨタ自動車,特定,100,株,2500,円,2800,円,"280,000","30,000"',
    '米国株式,AAPL,アップル,NISA成長投資枠,2,株,180,ドル,190,ドル,"57,000","3,000"',
    '投資信託,,ｅＭＡＸＩＳ全世界,NISAつみたて投資枠,100000,口,15000,円,16000,円,"160,000","10,000"',
    '米ドル,,,特定,100,ドル,,,,,15000,0',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { broker: '楽天証券', scope: 'rakuten-all' });
  assert.equal(parsed.holdings.length, 3);
  const toyota = parsed.holdings.find(x => x.code === '7203');
  assert.equal(toyota.accountType, 'tokutei');
  assert.equal(toyota.assetType, 'jp-stock');
  assert.equal(toyota.costJpy, 250000);
  assert.equal(toyota.csvMarketJpy, 280000);
  const aapl = parsed.holdings.find(x => x.code === 'AAPL');
  assert.equal(aapl.accountType, 'nisa-growth');
  assert.equal(aapl.assetType, 'us-stock');
  assert.equal(aapl.csvPriceCurrency, 'USD');
  assert.equal(aapl.costJpy, 54000);
  const fund = parsed.holdings.find(x => x.assetType === 'fund');
  assert.equal(fund.accountType, 'nisa-tsumitate');
  assert.equal(fund.quantity, 100000);
  assert.equal(fund.costJpy, 150000);
});

test('SBIはセクションの預り区分で分け、国内指定では米国株を入れない', () => {
  const csv = [
    '【株式（現物/特定預り）】',
    '銘柄（コード）,買付日,数量,取得単価,現在値,前日比,前日比（％）,損益,損益（％）,評価額',
    '7203 トヨタ自動車,2024/04/01,100,2500,2800,10,0.3,30000,12,280000',
    '株式（現物/特定預り）合計',
    '【投資信託（金額/NISA預り(つみたて投資枠)）】',
    'ファンド名,買付日,数量,取得単価,現在値,前日比,前日比（％）,損益,損益（％）,評価額',
    'ｅＭＡＸＩＳ Ｓｌｉｍ,2024/04/01,100000,15000,16000,10,0.1,10000,6.7,160000',
    '【外国株式（現物/NISA預り(成長投資枠)）】',
    '銘柄（コード）,買付日,数量,参考単価,取得単価,現在値,前日比,前日比（％）,損益,損益（％）,評価額',
    'AAPL アップル,2024/04/01,2,180,180,190,1,0.5,3000,5,57000',
  ].join('\n');
  const domestic = Csv.parseFile(csv, { scope: 'sbi-domestic' });
  assert.equal(domestic.holdings.length, 2);
  assert.equal(domestic.holdings.find(x => x.code === '7203').accountType, 'tokutei');
  assert.equal(domestic.holdings.find(x => x.assetType === 'fund').accountType, 'nisa-tsumitate');
  const us = Csv.parseFile(csv, { scope: 'sbi-us' });
  assert.equal(us.holdings.length, 1);
  assert.equal(us.holdings[0].code, 'AAPL');
  assert.equal(us.holdings[0].accountType, 'nisa-growth');
  assert.equal(us.holdings[0].csvMarketJpy, 57000);
  assert.equal(us.holdings[0].costJpy, 54000);
});

test('Shift_JIS のマネックス株CSVを読める', () => {
  const script = [
    'import pathlib',
    'p = pathlib.Path("/tmp/monex-sjis.csv")',
    'text = "銘柄コード,銘柄名,保有数量,取得単価,現在値,取得金額,評価額\\n6758,ソニー,10,2000,2200,20000,22000\\n"',
    'p.write_bytes(text.encode("cp932"))',
  ].join('\n');
  const made = spawnSync('python3', ['-c', script]);
  assert.equal(made.status, 0, made.stderr && made.stderr.toString());
  const bytes = require('node:fs').readFileSync('/tmp/monex-sjis.csv');
  const text = Csv.decodeCsvBytes(bytes);
  const parsed = Csv.parseFile(text, { scope: 'monex-stock', accountFallback: 'tokutei' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, '6758');
  assert.equal(parsed.holdings[0].name, 'ソニー');
  assert.equal(parsed.holdings[0].accountType, 'tokutei');
  assert.equal(parsed.holdings[0].costJpy, 20000);
  assert.equal(parsed.holdings[0].assetType, 'jp-stock');
});

test('SBI米国株は画面コピーから読み、国内CSVとは別にする', () => {
  const pasted = [
    '株式（現物/特定預り）',
    'アップル',
    'AAPL 米国',
    '190.00',
    '28,500',
    '10',
    '（0）',
    '180.00',
    '27,000',
    '1,900.00',
    '285,000',
    '+100.00',
    '+15,000',
    '株式（現物/NISA預り(成長投資枠)）',
    'マイクロソフト',
    'MSFT',
    '400.00',
    '60,000',
    '2',
    '380.00',
    '57,000',
    '800.00',
    '120,000',
    '+40.00',
    '+6,000',
  ].join('\n');
  const parsed = Csv.parseFile(pasted, { scope: 'sbi-us', accountFallback: 'unset' });
  assert.equal(parsed.holdings.length, 2);
  const aapl = parsed.holdings.find(x => x.code === 'AAPL');
  assert.equal(aapl.accountType, 'tokutei');
  assert.equal(aapl.name, 'アップル');
  assert.equal(aapl.quantity, 10);
  assert.equal(aapl.csvPrice, 190);
  assert.equal(aapl.csvMarketJpy, 285000);
  assert.equal(aapl.costJpy, 270000);
  const msft = parsed.holdings.find(x => x.code === 'MSFT');
  assert.equal(msft.accountType, 'nisa-growth');
  assert.equal(msft.quantity, 2);
  assert.equal(msft.costJpy, 114000);
  const row = 'AAPL\tアップル\t10\t180\t190\t285000\t特定';
  const simple = Csv.parseFile(row, { scope: 'sbi-us' });
  assert.equal(simple.holdings[0].quantity, 10);
  assert.equal(simple.holdings[0].csvMarketJpy, 285000);
  assert.equal(simple.holdings[0].accountType, 'tokutei');
});

test('moomooの売買から残数量とドルコストを作る', () => {
  const csv = [
    '約定日,銘柄コード,銘柄名,売買,数量,単価,手数料,通貨,口座',
    '2024-01-10,AAPL,アップル,買付,2,180,1,USD,特定',
    '2024-02-01,AAPL,アップル,売付,1,200,1,USD,特定',
    '2024-03-01,7203,トヨタ,買付,100,2500,0,JPY,NISA成長投資枠',
    '2024-04-01,7203,トヨタ,売付,200,2600,0,JPY,NISA成長投資枠',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  const aapl = parsed.holdings.find(x => x.code === 'AAPL');
  assert.equal(aapl.quantity, 1);
  assert.equal(aapl.costUsd, 180.5);
  assert.equal(aapl.accountType, 'tokutei');
  assert.equal(aapl.assetType, 'us-stock');
  const toyota = parsed.holdings.find(x => x.code === '7203');
  assert.equal(toyota, undefined);
  assert.ok(parsed.warnings.some(w => w.includes('7203') || w.includes('トヨタ')));
});

test('bitFlyerは現物だけ残し、CFDは飛ばす', () => {
  const csv = [
    '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,注文 ID',
    '2024-01-01 10:00:00,BTC,買い,5000000,BTC,0.01,0,5000000,JPY,-50000,1',
    '2024-02-01 10:00:00,BTC,売り,6000000,BTC,0.004,0,6000000,JPY,24000,2',
    '2024-03-01 10:00:00,BTC,CFD買い,5000000,BTC,1,0,5000000,JPY,-5000000,3',
    '2024-04-01 10:00:00,ETH,買い,300000,ETH,0.5,0,300000,JPY,-150000,4',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'bitflyer-spot' });
  const btc = parsed.holdings.find(x => x.code === 'BTC');
  assert.equal(btc.accountType, 'crypto');
  assert.ok(Math.abs(btc.quantity - 0.006) < 1e-10);
  assert.ok(Math.abs(btc.costJpy - 30000) < 1e-6);
  const eth = parsed.holdings.find(x => x.code === 'ETH');
  assert.equal(eth.quantity, 0.5);
  assert.equal(eth.costJpy, 150000);
  assert.equal(parsed.skipped, 1);
});

test('再取込は同じファイル区分だけを置き換え、終値は残す', () => {
  const state = Store.empty();
  Store.applyImport(state, {
    broker: '楽天証券', scope: 'rakuten-all', filename: 'a.csv',
    holdings: [h({ code: '7203', closePrice: 2800, closeAsOf: '2026-03-31' })],
  });
  Store.applyImport(state, {
    broker: 'SBI証券', scope: 'sbi-domestic', filename: 'b.csv',
    holdings: [h({ broker: 'SBI証券', code: '6758', name: 'ソニー' })],
  });
  Store.applyImport(state, {
    broker: '楽天証券', scope: 'rakuten-all', filename: 'a2.csv',
    holdings: [h({ code: '7203', quantity: 50, costJpy: 100000, csvMarketJpy: 140000, closePrice: null })],
  });
  assert.equal(state.holdings.length, 2);
  const toyota = state.holdings.find(x => x.code === '7203');
  assert.equal(toyota.quantity, 50);
  assert.equal(toyota.closePrice, 2800);
  assert.equal(state.holdings.find(x => x.code === '6758').broker, 'SBI証券');
});

test('場中の日足は1本前を終値にする', () => {
  const chart = {
    chart: {
      result: [{
        meta: { marketState: 'REGULAR', currency: 'JPY' },
        timestamp: [1711843200, 1711929600],
        indicators: { quote: [{ close: [2700, 2750] }] },
      }],
    },
  };
  const picked = Prices.pickClose(chart);
  assert.equal(picked.price, 2700);
  chart.chart.result[0].meta.marketState = 'CLOSED';
  assert.equal(Prices.pickClose(chart).price, 2750);
});

test('終値の銘柄コードは市場ごとに組み立て、投信は対象外', () => {
  assert.equal(Prices.symbolFor(h({ assetType: 'jp-stock', code: '7203' })), '7203.T');
  assert.equal(Prices.symbolFor(h({ assetType: 'us-stock', code: 'BRK.B' })), 'BRK-B');
  assert.equal(Prices.symbolFor(h({ assetType: 'crypto', code: 'btc' })), 'BTC-JPY');
  assert.equal(Prices.symbolFor(h({ assetType: 'fund', code: '03311187' })), null);
  const symbols = Prices.symbolsFor([
    h({ assetType: 'jp-stock', code: '7203' }),
    h({ assetType: 'us-stock', code: 'AAPL' }),
  ]);
  assert.ok(symbols.includes('7203.T'));
  assert.ok(symbols.includes('AAPL'));
  assert.ok(symbols.includes('JPY=X'));
});
