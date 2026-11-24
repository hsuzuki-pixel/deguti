/*
 * 収益・回収シミュレーション
 * クロスセルの想定手数料（期待値）と、事務所買収価格の回収年数を試算する。
 * 金額単位は万円。前提条件はすべて画面から変更でき、localStorage に保存される。
 */
(function (global) {
  'use strict';

  const DEFAULT_ASSUMPTIONS = {
    years: 10,
    // 成約確率（ニーズ度別）
    probHigh: 30, probMid: 15, probLow: 3,
    // 進捗による上書き（％）
    probProposing: 50,
    // 生命保険
    lifeFirstRate: 20,      // 初年度手数料率（年払保険料に対する％）
    lifeRenewRate: 3,       // 次年度以降の手数料率（％／年）
    lifeTermRate: 0.5,      // 事業保障の定期保険料率（保障額に対する％）
    // 損害保険
    nlPremiumPerItem: 25,   // 未加入補償1件あたりの想定年間保険料
    nlRate: 15,             // 代理店手数料率（％／年）
    // M&A
    maShare: 50,            // 当事務所の取り分（％）：紹介のみなら低め、自社FAなら100
    maMinFee: 500,          // 最低報酬
    // 不動産
    reShare: 30,            // 仲介手数料のうち当事務所の取り分（紹介料）（％）
    // 顧問料
    churn: 8,               // 顧問先の年間解約率（％）
    advisoryMargin: 40,     // 顧問料の粗利率（％）
    // 一時収益の実現時期（1〜3年目の配分％）
    ramp1: 40, ramp2: 40, ramp3: 20,
    firms: {},              // { 事務所名: { price, integrationCost } }
  };

  const pct = (v) => (Number(v) || 0) / 100;

  // レーマン方式（企業価値ベースの簡易版）
  function lehman(value) {
    const tiers = [[50000, 0.05], [50000, 0.04], [400000, 0.03], [500000, 0.02], [Infinity, 0.01]];
    let rest = Math.max(0, value);
    let fee = 0;
    for (const [size, rate] of tiers) {
      const part = Math.min(rest, size);
      fee += part * rate;
      rest -= part;
      if (rest <= 0) break;
    }
    return fee;
  }

  function probability(level, status, A) {
    if (status === '成約') return 1;
    if (status === '見送り') return 0;
    if (status === '提案中') return Math.max(pct(A.probProposing), level === '高' ? pct(A.probHigh) : 0);
    return level === '高' ? pct(A.probHigh) : level === '中' ? pct(A.probMid) : pct(A.probLow);
  }

  /*
   * 1社あたりの想定手数料。
   * once = 一時収益（成約年に1回）、recurring = 継続収益（毎年）
   * expected = 成約確率を掛けた期待値
   */
  function clientFees(c, a, A) {
    const n = (v) => Number(v) || 0;
    const st = c.status || {};
    const out = {};

    // 生命保険
    const yearsToRetire = Math.max(5, 65 - n(c.repAge));
    let savingPremium = a.life.metrics.retireGap / yearsToRetire;
    const profitCap = Math.max(0, n(c.ordinaryProfit)) * 0.4; // 利益の4割を上限
    savingPremium = Math.min(savingPremium, profitCap);
    const termPremium = a.life.metrics.gap * pct(A.lifeTermRate);
    const lifePremium = savingPremium + termPremium;
    out.life = {
      premium: lifePremium,
      once: lifePremium * pct(A.lifeFirstRate),
      recurring: lifePremium * pct(A.lifeRenewRate),
      basis: `想定年払保険料 ${Math.round(lifePremium)}万円（退職金積立 ${Math.round(savingPremium)}＋事業保障 ${Math.round(termPremium)}）`,
    };

    // 損害保険
    const nlPremium = a.nonlife.metrics.missingCount * n(A.nlPremiumPerItem);
    out.nonlife = {
      premium: nlPremium,
      once: 0,
      recurring: nlPremium * pct(A.nlRate),
      basis: `未加入補償 ${a.nonlife.metrics.missingCount}件 × 年間保険料 ${A.nlPremiumPerItem}万円`,
    };

    // M&A
    const value = a.ma.metrics.value;
    const maFee = a.ma.score > 0 ? Math.max(n(A.maMinFee), lehman(value)) * pct(A.maShare) : 0;
    out.ma = {
      once: maFee,
      recurring: 0,
      basis: `企業価値 ${Math.round(value)}万円のレーマン報酬（最低${A.maMinFee}万円）× 取り分${A.maShare}%`,
    };

    // 不動産
    const budget = a.re.metrics.budget || 0;
    const brokerage = budget > 0 ? budget * 0.03 + 6 : 0;
    out.re = {
      once: brokerage * pct(A.reShare),
      recurring: 0,
      basis: budget ? `取得予算 ${Math.round(budget)}万円 ×（3%＋6万円）× 取り分${A.reShare}%` : '取得予算の目安なし',
    };

    ['life', 'nonlife', 'ma', 're'].forEach((k) => {
      const p = probability(a[k].level, st[k], A);
      out[k].prob = p;
      out[k].expOnce = out[k].once * p;
      out[k].expRecurring = out[k].recurring * p;
    });
    out.expOnce = ['life', 'nonlife', 'ma', 're'].reduce((s, k) => s + out[k].expOnce, 0);
    out.expRecurring = ['life', 'nonlife', 'ma', 're'].reduce((s, k) => s + out[k].expRecurring, 0);
    out.expTotal = out.expOnce + out.expRecurring * 5; // 一覧表示用：継続収益は5年分で換算
    return out;
  }

  /*
   * 事務所単位の回収シミュレーション
   * list: [{ c, a, f }]（f = clientFees の結果）
   */
  function simulate(list, firm, A) {
    const years = Math.max(1, Math.min(20, Number(A.years) || 10));
    const ramp = [pct(A.ramp1), pct(A.ramp2), pct(A.ramp3)];
    const rampSum = ramp.reduce((s, v) => s + v, 0) || 1;
    const share = (t) => (t >= 1 && t <= 3 ? ramp[t - 1] / rampSum : 0);
    const cumShare = (t) => { let s = 0; for (let i = 1; i <= Math.min(t, 3); i++) s += share(i); return s; };

    const price = Number(firm.price) || 0;
    const integration = Number(firm.integrationCost) || 0;
    const advisory = list.reduce((s, { c }) => s + (Number(c.advisoryFee) || 0), 0);
    const sum = (fn) => list.reduce((s, x) => s + fn(x.f), 0);
    const once = { life: sum((f) => f.life.expOnce), ma: sum((f) => f.ma.expOnce), re: sum((f) => f.re.expOnce) };
    const rec = { life: sum((f) => f.life.expRecurring), nonlife: sum((f) => f.nonlife.expRecurring) };

    const rows = [];
    let cumBase = -price - integration;
    let cumAll = -price - integration;
    for (let t = 1; t <= years; t++) {
      const retention = Math.pow(1 - pct(A.churn), t - 1);
      const r = {
        year: t,
        advisory: advisory * pct(A.advisoryMargin) * retention,
        life: once.life * share(t) + rec.life * cumShare(t - 1) * retention,
        nonlife: rec.nonlife * cumShare(t) * retention,
        ma: once.ma * share(t),
        re: once.re * share(t),
      };
      r.cross = r.life + r.nonlife + r.ma + r.re;
      cumBase += r.advisory;
      cumAll += r.advisory + r.cross;
      r.cumBase = cumBase;
      r.cumAll = cumAll;
      rows.push(r);
    }

    const payback = (key) => {
      let prev = -price - integration;
      for (const r of rows) {
        if (r[key] >= 0) {
          const gain = r[key] - prev;
          return gain > 0 ? r.year - 1 + (0 - prev) / gain : r.year;
        }
        prev = r[key];
      }
      return null;
    };

    return {
      price, integration, advisory, once, rec, rows,
      paybackBase: payback('cumBase'),
      paybackAll: payback('cumAll'),
      crossTotal: rows.reduce((s, r) => s + r.cross, 0),
      advisoryTotal: rows.reduce((s, r) => s + r.advisory, 0),
    };
  }

  global.Economics = { DEFAULT_ASSUMPTIONS, clientFees, simulate, lehman };
})(window);
