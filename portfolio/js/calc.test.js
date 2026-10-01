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
  assert.equal(simple.holdings[0].csvPrice, 190);
  assert.equal(simple.holdings[0].csvMarketJpy, 285000);
  assert.equal(simple.holdings[0].costJpy, 270000);
  assert.equal(simple.holdings[0].accountType, 'tokutei');
});

test('SBI米国株の表コピーでは円の現在値を株数にしない', () => {
  const table = [
    '株式（現物/特定預り）',
    'アップル\t190.00\t10\t180.00\t1,900.00\t+100.00',
    'AAPL 米国\t28,500\t（0）\t27,000\t285,000\t+15,000',
    'マイクロソフト\t400.00\t2\t380.00\t800.00\t+40.00',
    'MSFT 米国\t60,000\t（0）\t57,000\t120,000\t+6,000',
  ].join('\n');
  const parsed = Csv.parseFile(table, { scope: 'sbi-us', accountFallback: 'unset' });
  assert.equal(parsed.holdings.length, 2);
  const aapl = parsed.holdings.find(x => x.code === 'AAPL');
  assert.equal(aapl.quantity, 10);
  assert.equal(aapl.name, 'アップル');
  assert.equal(aapl.csvPrice, 190);
  assert.equal(aapl.csvMarketJpy, 285000);
  assert.equal(aapl.costJpy, 270000);
  assert.equal(aapl.accountType, 'tokutei');
  const msft = parsed.holdings.find(x => x.code === 'MSFT');
  assert.equal(msft.quantity, 2);
  assert.equal(msft.csvMarketJpy, 120000);
  assert.equal(msft.costJpy, 114000);
  const glued = Csv.parseFile([
    'アップル',
    'AAPL 米国',
    '190.00',
    '28,500',
    '10（0）',
    '180.00',
    '27,000',
    '1,900.00',
    '285,000',
    '+100.00',
    '+15,000',
  ].join('\n'), { scope: 'sbi-us', accountFallback: 'tokutei' });
  assert.equal(glued.holdings[0].quantity, 10);
  assert.equal(glued.holdings[0].csvPrice, 190);
  assert.equal(glued.holdings[0].csvMarketJpy, 285000);
  assert.equal(glued.holdings[0].costJpy, 270000);
});

test('SBI米国株の実画面は前日比と取得金額があっても株数・円の取得・損益になる', () => {
  const table = [
    '銘柄\t現在値\t前日比\t前日比（％）\t保有数量\t取得単価\t参考単価\t取得金額\t外貨建評価額\t評価損益\t評価損益（％）',
    '\t円換算額\t\t\t（売却注文中）\t円換算額\t\t円換算額\t円換算評価額\t円換算評価損益\t',
    '株式（現物/特定預り）',
    'アップル\t190.00\t+2.50\t+1.33%\t10\t180.00\t179.50\t1,800.00\t1,900.00\t+100.00\t+5.56%',
    'AAPL 米国\t28,500\t+375\t\t（0）\t27,000\t26,925\t270,000\t285,000\t+15,000\t',
    '合計\t\t\t\t\t\t\t1,800.00\t1,900.00\t+100.00\t',
    'USD\t1,500.00\t225,000',
    'NISA成長',
    'マイクロソフト\t400.00\t-1.20\t-0.30%\t2\t380.00\t760.00\t800.00\t+40.00\t+5.26%',
    'MSFT 米国\t60,000\t-180\t\t（0）\t57,000\t114,000\t120,000\t+6,000\t',
  ].join('\n');
  const parsed = Csv.parseFile(table, { scope: 'sbi-us', accountFallback: 'unset' });
  assert.equal(parsed.holdings.length, 2);
  const aapl = parsed.holdings.find(x => x.code === 'AAPL');
  assert.equal(aapl.accountType, 'tokutei');
  assert.equal(aapl.name, 'アップル');
  assert.equal(aapl.quantity, 10);
  assert.notEqual(aapl.quantity, 28500);
  assert.notEqual(aapl.quantity, 190);
  assert.equal(aapl.csvPrice, 190);
  assert.equal(aapl.csvPriceCurrency, 'USD');
  assert.equal(aapl.csvMarketJpy, 285000);
  assert.equal(aapl.costJpy, 270000);
  assert.notEqual(aapl.costJpy, 27000);
  assert.notEqual(aapl.costJpy, 190);
  const pos = Calc.position(aapl, null);
  assert.equal(pos.marketJpy, 285000);
  assert.equal(pos.cost, 270000);
  assert.equal(pos.pnl, 15000);
  assert.equal(Calc.signClass(pos.pnl), 'up');
  const msft = parsed.holdings.find(x => x.code === 'MSFT');
  assert.equal(msft.accountType, 'nisa-growth');
  assert.equal(msft.quantity, 2);
  assert.equal(msft.csvPrice, 400);
  assert.equal(msft.csvMarketJpy, 120000);
  assert.equal(msft.costJpy, 114000);
  const msftPos = Calc.position(msft, null);
  assert.equal(msftPos.pnl, 6000);

  const vertical = [
    '株式（現物/特定預り）',
    'アップル',
    'AAPL 米国',
    '190.00',
    '28,500',
    '+2.50',
    '+375',
    '+1.33%',
    '10（0）',
    '180.00',
    '27,000',
    '1,800.00',
    '270,000',
    '1,900.00',
    '285,000',
    '+100.00',
    '+15,000',
    '+5.56%',
    'NISA成長',
    'マイクロソフト',
    'MSFT',
    '400.00',
    '60,000',
    '2',
    '（0）',
    '380.00',
    '57,000',
    '760.00',
    '114,000',
    '800.00',
    '120,000',
    '+40.00',
    '+6,000',
  ].join('\n');
  const pasted = Csv.parseFile(vertical, { scope: 'sbi-us', accountFallback: 'unset' });
  assert.equal(pasted.holdings.length, 2);
  const a = pasted.holdings.find(x => x.code === 'AAPL');
  assert.equal(a.quantity, 10);
  assert.equal(a.csvPrice, 190);
  assert.equal(a.csvMarketJpy, 285000);
  assert.equal(a.costJpy, 270000);
  assert.equal(a.accountType, 'tokutei');
  assert.equal(Calc.position(a, null).pnl, 15000);
  const m = pasted.holdings.find(x => x.code === 'MSFT');
  assert.equal(m.quantity, 2);
  assert.equal(m.accountType, 'nisa-growth');
  assert.equal(m.costJpy, 114000);
  assert.equal(m.csvMarketJpy, 120000);

  const loss = [
    'アップル\t190.00\t−5.00\t−2.56%\t10\t200.00\t2,000.00\t1,900.00\t−100.00\t−5.00%',
    'AAPL 米国\t28,500\t−750\t\t（0）\t30,000\t300,000\t285,000\t−15,000\t',
  ].join('\n');
  const down = Csv.parseFile(loss, { scope: 'sbi-us', accountFallback: 'tokutei' });
  assert.equal(down.holdings.length, 1);
  assert.equal(down.holdings[0].quantity, 10);
  assert.equal(down.holdings[0].csvPrice, 190);
  assert.equal(down.holdings[0].csvMarketJpy, 285000);
  assert.equal(down.holdings[0].costJpy, 300000);
  const lossPos = Calc.position(down.holdings[0], null);
  assert.equal(lossPos.pnl, -15000);
  assert.equal(Calc.signClass(lossPos.pnl), 'down');

  const drift = [
    'アップル\t190.00\t+2.50\t+1.33%\t10\t180.00\t1,800.00\t1,900.00\t+100.00\t+5.56%',
    'AAPL 米国\t28,500\t+375\t\t（0）\t25,200\t252,000\t285,000\t+33,000\t',
  ].join('\n');
  const drifted = Csv.parseFile(drift, { scope: 'sbi-us', accountFallback: 'tokutei' });
  assert.equal(drifted.holdings[0].quantity, 10);
  assert.equal(drifted.holdings[0].csvPrice, 190);
  assert.equal(drifted.holdings[0].csvMarketJpy, 285000);
  assert.equal(drifted.holdings[0].costJpy, 252000);
  assert.equal(Calc.position(drifted.holdings[0], null).pnl, 33000);
});

test('マネックス米国株はドル建の建玉と残高を株数どおり読む', () => {
  const margin = [
    '銘柄名,ティッカー,口座区分,建株数,平均建単価[ドル],評価単価[ドル],損益合計[ドル]',
    'アップル,AAPL,特定,10,180,190,100',
  ].join('\n');
  const built = Csv.parseFile(margin, { scope: 'monex-us', accountFallback: 'unset' });
  assert.equal(built.holdings.length, 1);
  assert.equal(built.holdings[0].code, 'AAPL');
  assert.equal(built.holdings[0].quantity, 10);
  assert.equal(built.holdings[0].costUsd, 1800);
  assert.equal(built.holdings[0].csvPrice, 190);
  assert.equal(built.holdings[0].csvMarketJpy, null);
  assert.equal(built.holdings[0].accountType, 'tokutei');
  assert.equal(built.holdings[0].assetType, 'us-stock');

  const cash = [
    '銘柄名,ティッカー,口座区分,保有数,取得平均[ドル],取得平均[円],評価単価[ドル],評価額[円],評価損益[円]',
    'マイクロソフト,MSFT,一般,2,380,57000,400,120000,6000',
  ].join('\n');
  const held = Csv.parseFile(cash, { scope: 'monex-stock', accountFallback: 'tokutei' });
  assert.equal(held.scope, 'monex-us');
  assert.equal(held.holdings[0].quantity, 2);
  assert.equal(held.holdings[0].costJpy, 114000);
  assert.equal(held.holdings[0].costUsd, 760);
  assert.equal(held.holdings[0].csvPrice, 400);
  assert.equal(held.holdings[0].csvMarketJpy, 120000);
  assert.equal(held.holdings[0].accountType, 'general');
});

test('moomooの保有一覧は米国株のコードとドル評価を読む', () => {
  const csv = [
    'コード,名称,数量,現在価格,平均コスト,市場価値,通貨',
    'US.AAPL,アップル,3,190,180,570,USD',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 3);
  assert.equal(parsed.holdings[0].costUsd, 540);
  assert.equal(parsed.holdings[0].csvPrice, 190);
  assert.equal(parsed.holdings[0].csvMarketJpy, null);
  assert.ok(parsed.warnings.some(w => w.includes('保有一覧')));
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

  const en = [
    'Side,Symbol,Name,Filled Qty,Avg Price,Currency',
    'Buy,US.MSFT,Microsoft,2,180,USD',
    'Sell,US.MSFT,Microsoft,1,200,USD',
  ].join('\n');
  const english = Csv.parseFile(en, { scope: 'moomoo-trades' });
  assert.equal(english.holdings[0].code, 'MSFT');
  assert.equal(english.holdings[0].quantity, 1);
  assert.equal(english.holdings[0].costUsd, 180);

  const ja = [
    '方向,銘柄コード,名称,約定数量,約定価格,通貨',
    '買い,AAPL,アップル,2,180,USD',
    '売り,AAPL,アップル,1,200,USD',
  ].join('\n');
  const japanese = Csv.parseFile(ja, { scope: 'moomoo-trades' });
  assert.equal(japanese.holdings[0].quantity, 1);
  assert.equal(japanese.holdings[0].costUsd, 180);

  const closed = [
    '方向,コード,名称,約定数量,約定価格,通貨',
    '買い,AAPL,アップル,1,180,USD',
    '売り,AAPL,アップル,1,190,USD',
  ].join('\n');
  const flat = Csv.parseFile(closed, { scope: 'moomoo-trades' });
  assert.equal(flat.holdings.length, 0);
  assert.ok(flat.warnings.some(w => w.includes('残っている保有')));
});

test('マネックスの売建とドルの評価額は円の保有にしない', () => {
  const csv = [
    '銘柄名,ティッカー,口座区分,売買,建株数,平均建単価[ドル],評価単価[ドル],評価額[ドル],損益合計[ドル],建玉金額合計[ドル]',
    'アップル,AAPL,特定,買建,10,180,190,2500,100,1800',
    'テスラ,TSLA,特定,売建,4,200,210,900,40,800',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'monex-us', accountFallback: 'unset' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 10);
  assert.equal(parsed.holdings[0].costUsd, 1800);
  assert.equal(parsed.holdings[0].csvPrice, 190);
  assert.equal(parsed.holdings[0].csvMarketJpy, null);
  assert.equal(parsed.holdings[0].costJpy, null);
  assert.equal(parsed.holdings[0].accountType, 'tokutei');
  assert.ok(parsed.warnings.some(w => w.includes('売建')));
});

test('moomooのUTF-16タブ区切り保有一覧を読む', () => {
  const text = '口座\nコード\t名称\t数量\t現在価格\t平均コスト\t市場価値\t通貨\nUS.AAPL\tアップル\t3\t190\t180\t570\tUSD\n';
  const bytes = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
  const parsed = Csv.parseFile(Csv.decodeCsvBytes(bytes), { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 3);
  assert.equal(parsed.holdings[0].costUsd, 540);
});

test('moomooのPC履歴CSVは約定数量を使い、香港株は飛ばす', () => {
  const csv = [
    '取引履歴',
    '口座,米国株',
    '"Side","Symbol","Name","Order Price","Order Qty","Order Amount","Status","Filled@Avg Price","Order Time","Markets","Currency","Fill Qty","Fill Price"',
    '"Buy","US.AAPL","Apple","181","100","18100","Filled","60@180.5","Jan 15, 2026 09:00:00 ET","US","USD","60","180.5"',
    '"Sell","US.AAPL","Apple","190","10","1900","Filled","10@190","Feb 2, 2026 09:00:00 ET","US","USD","10","190"',
    '"Buy","HK.00700","Tencent","400","100","40000","Filled","100@400","Feb 3, 2026 09:00:00 ET","HK","HKD","100","400"',
    '"Buy","US.MSFT","Microsoft","300","5","1500","Cancelled","","Feb 4, 2026 09:00:00 ET","US","USD","0",""',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 50);
  assert.equal(parsed.holdings[0].costUsd, 50 * 180.5);
  assert.equal(parsed.holdings[0].csvMarketJpy, null);
  assert.equal(parsed.holdings[0].assetType, 'us-stock');
  assert.ok(parsed.warnings.some(w => w.includes('00700') || w.includes('Tencent')));
  assert.ok(!parsed.holdings.some(h => h.code === '00700' || h.code === 'MSFT'));
});

test('moomooの日本語履歴は注文価格ではなく約定価格を使う', () => {
  const csv = [
    '取引履歴',
    '期間,2020/01/01-2026/10/01',
    '方向,シンボル,名称,注文価格,注文数量,ステータス,約定@平均価格,約定数量,約定価格,通貨,市場',
    '買い,US.AAPL,アップル,1,100,全約定,2@180,2,180,USD,米国',
    '買い,HK.00700,テンセント,400,100,全約定,100@400,100,400,HKD,香港',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 2);
  assert.equal(parsed.holdings[0].costUsd, 360);
  assert.ok(parsed.warnings.some(w => w.includes('テンセント') || w.includes('00700')));
});

test('moomooの約定@平均価格だけでも残数量を作る', () => {
  const csv = [
    'Side,Symbol,Name,Status,Filled@Avg Price,Currency,Market',
    'Buy,AAPL,Apple,Filled,10@180.5,USD,US',
    'Sell,AAPL,Apple,Filled,4@190,USD,US',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].quantity, 6);
  assert.equal(parsed.holdings[0].costUsd, 6 * 180.5);
});

test('moomooの英語月名は売買の順に並べる', () => {
  const csv = [
    'Side,Symbol,Name,Filled Qty,Avg Price,Currency,Order Time',
    'Sell,AAPL,Apple,4,190,USD,"Feb 2, 2026 09:00:00 ET"',
    'Buy,AAPL,Apple,10,180,USD,"Jan 15, 2026 09:00:00 ET"',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings[0].quantity, 6);
  assert.equal(parsed.holdings[0].costUsd, 1080);
});

test('moomooの保有一覧に方向があってもロングを残す', () => {
  const csv = [
    '方向,コード,名称,保有数量,現在価格,平均コスト,市場価値,通貨',
    'ロング,US.AAPL,アップル,3,190,180,570,USD',
    'ショート,US.TSLA,テスラ,1,200,180,200,USD',
    'ロング,HK.00700,テンセント,100,400,380,40000,HKD',
  ].join('\n');
  const parsed = Csv.parseFile(csv, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings.length, 1);
  assert.equal(parsed.holdings[0].code, 'AAPL');
  assert.equal(parsed.holdings[0].quantity, 3);
  assert.equal(parsed.holdings[0].costUsd, 540);
  assert.equal(parsed.holdings[0].csvPrice, 190);
  assert.equal(parsed.holdings[0].csvMarketJpy, null);
  assert.equal(parsed.holdings[0].costJpy, null);
  assert.ok(parsed.warnings.some(w => w.includes('保有一覧')));
  assert.ok(parsed.warnings.some(w => w.includes('テスラ')));
  assert.ok(parsed.warnings.some(w => w.includes('テンセント') || w.includes('00700')));
});

test('moomooの中国語の約定と保有を読む', () => {
  const trades = [
    '方向,代码,名称,成交数量,成交价格,币种',
    '买入,US.AAPL,苹果,2,180,USD',
    '卖出,US.AAPL,苹果,1,200,USD',
  ].join('\n');
  const parsed = Csv.parseFile(trades, { scope: 'moomoo-trades' });
  assert.equal(parsed.holdings[0].quantity, 1);
  assert.equal(parsed.holdings[0].costUsd, 180);
  const held = [
    '代码,名称,持仓数量,现价,平均成本,市值,币种',
    'US.NVDA,英伟达,5,120,100,600,USD',
  ].join('\n');
  const positions = Csv.parseFile(held, { scope: 'moomoo-trades' });
  assert.equal(positions.holdings[0].code, 'NVDA');
  assert.equal(positions.holdings[0].quantity, 5);
  assert.equal(positions.holdings[0].costUsd, 500);
  assert.equal(positions.holdings[0].csvPrice, 120);
  assert.equal(positions.holdings[0].csvMarketJpy, null);
});

test('moomooはセミコロンと全角カンマとBOM無しUTF-16を読む', () => {
  const semi = [
    'Side;Symbol;Name;Filled Qty;Avg Fill Price;Currency',
    'Buy;US.AAPL;Apple;3;180;USD',
  ].join('\n');
  const fromSemi = Csv.parseFile(semi, { scope: 'moomoo-trades' });
  assert.equal(fromSemi.holdings[0].quantity, 3);
  assert.equal(fromSemi.holdings[0].costUsd, 540);

  const wide = '方向，銘柄コード，名称，約定数量，約定価格，通貨\n買い，US.AAPL，アップル，3，180，USD\n';
  const fromWide = Csv.parseFile(wide, { scope: 'moomoo-trades' });
  assert.equal(fromWide.holdings[0].code, 'AAPL');
  assert.equal(fromWide.holdings[0].quantity, 3);
  assert.equal(fromWide.holdings[0].costUsd, 540);

  const text = 'コード\t名称\t数量\t現在価格\t平均コスト\t市場価値\t通貨\nUS.AAPL\tアップル\t3\t190\t180\t570\tUSD\n';
  const bytes = Buffer.from(text, 'utf16le');
  const fromUtf16 = Csv.parseFile(Csv.decodeCsvBytes(bytes), { scope: 'moomoo-trades' });
  assert.equal(fromUtf16.holdings[0].quantity, 3);
  assert.equal(fromUtf16.holdings[0].costUsd, 540);
  assert.equal(fromUtf16.holdings[0].csvMarketJpy, null);
});

test('moomooのExcelと未知の見出しは理由を出す', () => {
  const xlsx = Csv.parseFile(Csv.decodeCsvBytes(Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00])), { scope: 'moomoo-trades' });
  assert.equal(xlsx.holdings.length, 0);
  assert.ok(xlsx.warnings.some(w => w.includes('Excelのままでは読めません')));

  const unknown = Csv.parseFile('foo,bar,baz\n1,2,3\n', { scope: 'moomoo-trades' });
  assert.equal(unknown.holdings.length, 0);
  assert.ok(unknown.warnings.some(w => w.includes('foo') && w.includes('bar')));
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

test('保有割合は下限以上だけ残し、未満はその他にまとめる', () => {
  const chart = Calc.chartSlices([
    { id: 'a', name: '大きい', marketJpy: 60 },
    { id: 'b', name: '中', marketJpy: 30 },
    { id: 'c', name: '小さい', marketJpy: 10 },
  ], 25);
  assert.deepEqual(chart.slices.map(s => s.label), ['大きい', '中', 'その他']);
  assert.equal(chart.slices[2].other, true);
  assert.equal(chart.slices[2].count, 1);
  assert.equal(chart.slices[2].marketJpy, 10);
  assert.equal(chart.slices[2].id, '');
  assert.equal(chart.total, 100);
});

test('下限0ではその他を作らず、時価が無い銘柄は含めない', () => {
  const chart = Calc.chartSlices([
    { id: 'a', name: 'A', marketJpy: 40 },
    { id: 'b', name: 'B', marketJpy: 60 },
    { id: 'c', name: 'C', marketJpy: null },
    { id: 'd', name: 'D', marketJpy: 0 },
  ], 0);
  assert.equal(chart.missing, 2);
  assert.deepEqual(chart.slices.map(s => s.label), ['B', 'A']);
  assert.equal(chart.slices.some(s => s.other), false);
  assert.equal(chart.total, 100);
  const nan = Calc.chartSlices([
    { id: 'a', name: 'A', marketJpy: 10 },
    { id: 'b', name: 'B', marketJpy: 10 },
  ], Number.NaN);
  assert.equal(nan.slices.some(s => s.other), false);
});

test('下限ちょうどの割合は個別のまま残し、わずかでも下回ればその他になる', () => {
  const exact = Calc.chartSlices([
    { id: 'a', name: 'ぴったり', marketJpy: 10 },
    { id: 'b', name: '残り', marketJpy: 90 },
  ], 10);
  assert.equal(exact.slices.some(s => s.other), false);
  assert.equal(exact.slices.length, 2);
  const under = Calc.chartSlices([
    { id: 'a', name: '未満', marketJpy: 9.999 },
    { id: 'b', name: '残り', marketJpy: 90.001 },
  ], 10);
  assert.equal(under.slices.find(s => s.label === '未満'), undefined);
  assert.equal(under.slices.find(s => s.other).count, 1);
  assert.equal(under.slices.find(s => s.other).marketJpy, 9.999);
});

test('同じ名称は証券会社を付けて区別する', () => {
  const chart = Calc.chartSlices([
    { id: 'a', name: 'アップル', broker: '楽天証券', marketJpy: 50 },
    { id: 'b', name: 'アップル', broker: 'SBI証券', marketJpy: 50 },
  ], 5);
  assert.deepEqual(chart.slices.map(s => s.label).sort(), ['アップル（SBI証券）', 'アップル（楽天証券）']);
});

function overlapArea(a, b) {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (x <= 1e-6 || y <= 1e-6) return 0;
  return x * y;
}

test('ツリーマップの面積は全体を埋め、はみ出さず重ならない', () => {
  const slices = [
    { id: 'a', label: 'A', marketJpy: 50, other: false },
    { id: 'b', label: 'B', marketJpy: 30, other: false },
    { id: 'c', label: 'C', marketJpy: 12, other: false },
    { id: 'd', label: 'その他', marketJpy: 8, other: true },
  ];
  const width = 400;
  const height = 260;
  const rects = Calc.treemapRects(slices, width, height);
  assert.equal(rects.length, 4);
  const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  assert.ok(Math.abs(area - width * height) < 1e-6, area);
  rects.forEach(r => {
    assert.ok(r.x >= -1e-6 && r.y >= -1e-6);
    assert.ok(r.x + r.w <= width + 1e-6);
    assert.ok(r.y + r.h <= height + 1e-6);
    assert.ok(r.w > 0 && r.h > 0);
  });
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.ok(overlapArea(rects[i], rects[j]) < 1e-4);
    }
  }
  const one = Calc.treemapRects([slices[0]], width, height);
  assert.equal(one.length, 1);
  assert.ok(Math.abs(one[0].w - width) < 1e-6);
  assert.ok(Math.abs(one[0].h - height) < 1e-6);
  assert.deepEqual(Calc.treemapRects([], width, height), []);
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
