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
