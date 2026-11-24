#!/usr/bin/env node
/*
 * 動作確認テスト（Playwright）
 *   node crosssell/tests/smoke.js            … 開発版 index.html
 *   node crosssell/tests/smoke.js --dist     … 配布版 dist/crosssell-navi.html（事前に build.js を実行）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const target = process.argv.includes('--dist') ? path.join(root, 'dist', 'crosssell-navi.html') : path.join(root, 'index.html');
const URL = 'file://' + target;
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const go = async (hash) => { await page.goto(URL + '#/' + hash); await page.waitForTimeout(150); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('crosssell.clients.v1') || 'null'));

  console.log('対象:', path.relative(process.cwd(), target));
  await go('dashboard');
  await page.evaluate(() => localStorage.clear());

  console.log('画面表示');
  for (const r of ['dashboard', 'clients', 'pipeline', 'roi', 'finance', 'settings', 'help', 'new', 'client/c001', 'edit/c001']) {
    await go(r);
    const h1 = await page.textContent('h1');
    ok(!!h1 && errors.length === 0, `#/${r} → ${h1}`);
  }

  console.log('ニーズ判定');
  await go('client/c001');
  const scores = await page.$$eval('.score-big', (e) => e.map((x) => Number(x.textContent)));
  ok(scores.length === 4 && scores.every((s) => s >= 0 && s <= 100), `4商品のスコア 0〜100：${scores.join(', ')}`);
  ok(scores[2] >= 70, '社長68歳・後継者なし → M&Aニーズ高');

  console.log('クライアント追加・進捗更新');
  await go('new');
  await page.fill('input[name=company]', 'テスト建設株式会社');
  await page.fill('input[name=repAge]', '70');
  await page.fill('input[name=sales]', '30000');
  await page.fill('input[name=opProfit]', '2000');
  await page.fill('input[name=advisoryFee]', '120');
  await page.selectOption('select[name=successor]', 'なし');
  await page.click('button[type=submit]');
  await page.waitForTimeout(150);
  ok((await page.textContent('h1')) === 'テスト建設株式会社', '保存後に詳細画面へ遷移');
  await page.selectOption('select[data-status=ma]', '提案中');
  let data = await stored();
  const added = data.find((c) => c.company === 'テスト建設株式会社');
  ok(added && added.status.ma === '提案中' && added.advisoryFee === 120, '進捗・顧問料が保存される');
  ok(data.length === 31, `クライアント数 31（${data.length}）`);

  console.log('CSV 出力→取込（往復）');
  await go('clients');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
  const csvPath = await dl.path();
  const csv = fs.readFileSync(csvPath, 'utf8');
  ok(csv.startsWith('﻿会社名'), 'CSVはBOM付きUTF-8・見出しは日本語');
  await go('settings');
  await page.setInputFiles('#csvFile', { name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.selectOption('#csvMode', 'replace');
  await page.click('#csvImport');
  await page.waitForTimeout(200);
  data = await stored();
  const back = data.find((c) => c.company === 'テスト建設株式会社');
  ok(data.length === 31 && back && back.status.ma === '提案中' && back.repAge === 70, '全件入れ替えで内容が一致');

  console.log('会計データ取込（Shift_JIS 試算表）');
  await go('finance');
  await page.setInputFiles('#finFiles', { name: '北斗工務店_試算表.csv', mimeType: 'text/csv', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'hokuto_trial_balance_sjis.csv')) });
  await page.waitForTimeout(300);
  ok((await page.$eval('[data-target="0"]', (e) => e.selectedOptions[0].textContent)) === '株式会社北斗工務店', 'ファイル名から反映先を自動選択');
  await page.click('#finApply');
  await page.waitForTimeout(150);
  data = await stored();
  const h = data.find((c) => c.company === '株式会社北斗工務店');
  ok(h.sales === 18050 && h.opProfit === -210 && h.ordinaryProfit === -195 && h.netAssets === -320, `PL・純資産（△・損失表記）：売上${h.sales} 営業${h.opProfit} 経常${h.ordinaryProfit} 純資産${h.netAssets}`);
  ok(h.cash === 5572 && h.debt === 1980 && h.execPayMonthly === 80 && h.rentMonthly === 30, `BS・月額換算：現預金${h.cash} 借入${h.debt} 報酬${h.execPayMonthly} 家賃${h.rentMonthly}`);

  console.log('回収シミュレーション');
  await go('roi');
  const kpi = await page.$$eval('.kpi-value', (e) => e.map((x) => x.textContent));
  ok(kpi.length === 4 && /年|未回収/.test(kpi[1]), `KPI：${kpi.join(' / ')}`);
  await page.fill('input[data-firm][data-fk=price]', '99999');
  await page.dispatchEvent('input[data-firm][data-fk=price]', 'change');
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('crosssell.assumptions')).firms);
  ok(Object.values(saved).some((f) => f.price === 99999), '事務所の買収価格が保存される');

  console.log('バックアップ→復元（欠損データの補完）');
  await go('settings');
  await page.setInputFiles('#jsonIn', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ clients: [{ company: '欠損テスト', sales: '5000' }, { id: 'x', company: '重複ID1' }, { id: 'x', company: '重複ID2' }] })) });
  await page.waitForTimeout(200);
  data = await stored();
  ok(data.length === 3 && data[0].status.life === '未着手' && data[0].sales === 5000 && data[0].nonlife.cyber === false, '欠けた項目を補って復元');
  ok(new Set(data.map((c) => c.id)).size === 3, 'IDの重複を解消');
  for (const r of ['dashboard', 'clients', 'pipeline', 'roi', 'client/' + data[0].id]) { await go(r); }
  ok(errors.length === 0, '復元データで全画面が表示できる');


  console.log('安全性・堅牢性（レビュー指摘の再発防止）');
  await page.evaluate(() => localStorage.clear());
  await go('settings'); await page.reload(); await page.waitForTimeout(100);
  // 不正なIDを含むCSV（属性へのスクリプト注入・URL破損）
  await page.setInputFiles('#csvFile', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('会社名,引継ぎ元事務所,ID\r\nXSS社,旧A,"x"" onmouseover=""window.__x=1"\r\nスラッシュ社,旧A,a/b\r\n') });
  await page.selectOption('#csvMode', 'merge');
  await page.click('#csvImport'); await page.waitForTimeout(200);
  data = await stored();
  ok(data.every((c) => /^[A-Za-z0-9_-]+$/.test(c.id)), '取込IDは安全な文字だけに置き換わる');
  await go('clients');
  await page.hover('text=XSS社');
  ok(!(await page.evaluate(() => window.__x)), 'IDからのスクリプト注入が起きない');
  const slash = data.find((c) => c.company === 'スラッシュ社');
  await go('client/' + slash.id);
  ok((await page.textContent('h1')) === 'スラッシュ社', '「/」を含むIDでも詳細画面が開ける');

  // 前提条件への注入（バックアップ復元）
  await go('settings');
  await page.setInputFiles('#jsonIn', { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ clients: [{ company: 'J社', firm: '旧Z' }], assumptions: { churn: '<img src=x onerror="window.__y=1">', years: 50, firms: { '旧Z': { price: '1"><img src=x onerror="window.__z=1">' } } } })) });
  await page.waitForTimeout(200);
  await go('roi'); await page.waitForTimeout(100);
  ok(!(await page.evaluate(() => window.__y || window.__z)), '前提条件からのスクリプト注入が起きない');
  ok((await page.$$eval('tbody tr', (r) => r.length)) > 0 && (await page.textContent('body')).includes('20年間のクロスセル収益'), '試算期間は最大20年に補正され、表示と一致');

  // Shift_JIS の顧客CSV（Excel保存）と、上書き時の空欄
  await go('settings');
  await page.setInputFiles('#csvFile', { name: 's.csv', mimeType: 'text/csv', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'clients_sjis.csv')) });
  await page.selectOption('#csvMode', 'merge');
  await page.click('#csvImport'); await page.waitForTimeout(200);
  data = await stored();
  const sj = data.find((c) => c.company === 'エクセル商事株式会社');
  ok(sj && sj.sales === 12000 && sj.cash === 3000 && sj.debt === -100, 'Shift_JISのCSVを取込（△・万円表記も数値化）');
  await page.setInputFiles('#csvFile', { name: 'p.csv', mimeType: 'text/csv', buffer: Buffer.from('会社名,年商,現預金\r\nエクセル商事株式会社,15000,\r\n') });
  await page.click('#csvImport'); await page.waitForTimeout(200);
  data = await stored();
  const sj2 = data.find((c) => c.company === 'エクセル商事株式会社');
  ok(sj2.sales === 15000 && sj2.cash === 3000, '追加・上書きで空欄は既存値を残す');

  // 存在しない絞込み条件が残っても全件が消えない
  await page.evaluate(() => localStorage.setItem('crosssell.filters', JSON.stringify({ firm: '存在しない事務所' })));
  await page.reload(); await go('clients');
  const nRows = await page.$$eval('tbody tr[data-go]', (r) => r.length); ok(nRows === data.length, `無効になった絞込み条件は自動で解除（${nRows}/${data.length}）`);

  // 会計取込：反映先を削除した後に反映してもエラーにならない
  await go('finance');
  await page.setInputFiles('#finFiles', { name: 'エクセル商事_試算表.csv', mimeType: 'text/csv', buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'hokuto_trial_balance_sjis.csv')) });
  await page.waitForTimeout(300);
  await page.evaluate((id) => { const l = JSON.parse(localStorage.getItem('crosssell.clients.v1')); }, null);
  await go('client/' + sj2.id); await page.click('#delBtn'); await page.waitForTimeout(100);
  await go('finance'); await page.click('#finApply'); await page.waitForTimeout(100);
  ok(errors.length === 0, '反映先が削除されていてもエラーなし');

  // 試算表パーサーの書式バリエーション
  const parsed = await page.evaluate(() => {
    const A = (t) => FinanceImport.analyzeText(t).found;
    return {
      oneYear: A('勘定科目,残高\n短期借入金,100\n1年内返済予定の長期借入金,50\n長期借入金,200\n').debt,
      banks: A('勘定科目,残高\n長期借入金,100\n長期借入金,200\n').debt,
      bankTotal: A('勘定科目,残高\n長期借入金,100\n長期借入金,200\n長期借入金,300\n').debt,
      split: A('勘定科目,借方残高,貸方残高\n現金,"1,000",0\n売上高,0,"50,000,000"\n').sales,
      minus: [FinanceImport.parseAmount('−1,000'), FinanceImport.parseAmount('￥1,000'), FinanceImport.parseAmount('1,000-'), FinanceImport.parseAmount('△500')],
      noFallback: A('勘定科目,当期残高,貸方金額\n売上高,N/A,999\n').sales,
      match: FinanceImport.matchClient('山田(株)_試算表.csv', [{ id: 'y', company: '山田(株)' }]),
    };
  });
  ok(parsed.oneYear === 350, `「1年内返済予定の長期借入金」を合算（${parsed.oneYear}）`);
  ok(parsed.banks === 300 && parsed.bankTotal === 300, `銀行別の同名科目は合算、合計行があれば合計を採用（${parsed.banks}/${parsed.bankTotal}）`);
  ok(parsed.split === 50000000, '借方残高・貸方残高に分かれた形式');
  ok(JSON.stringify(parsed.minus) === '[-1000,1000,-1000,-500]', `マイナス・円記号の各種表記 ${JSON.stringify(parsed.minus)}`);
  ok(parsed.noFallback === undefined, '読めない金額は別の列で代用しない');
  ok(parsed.match === 'y', '「(株)」付きの社名でも自動照合');

  // CSV出力の数式注入対策
  const csvOut = await page.evaluate(() => { localStorage.setItem('crosssell.clients.v1', JSON.stringify([{ id: 'f1', company: '=HYPERLINK("x")', opProfit: -5 }])); return true; });
  await page.reload(); await go('clients');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
  const out2 = fs.readFileSync(await dl2.path(), 'utf8');
  ok(out2.includes(`"'=HYPERLINK(""x"")"`) && out2.includes(',-5,'), 'CSV出力で数式は無害化・負の数値はそのまま');

  console.log('空データ・スマホ表示');
  await page.evaluate(() => localStorage.setItem('crosssell.clients.v1', '[]'));
  await go('dashboard');
  await page.reload(); await page.waitForTimeout(150);
  ok((await page.textContent('h1')) === 'ようこそ', '0件のとき案内画面');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(URL + '#/dashboard');
  await mobile.evaluate(() => localStorage.clear());
  for (const r of ['dashboard', 'clients', 'roi', 'finance', 'help', 'client/c001']) {
    await mobile.goto(URL + '#/' + r); await mobile.waitForTimeout(150);
    ok((await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390, `スマホ幅で横はみ出しなし #/${r}`);
  }

  ok(errors.length === 0, `JavaScriptエラーなし ${errors.join(' | ')}`);
  await browser.close();
  console.log(failed ? `\n${failed}件失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
