/*
 * ニーズ判定エンジン
 * 金額単位はすべて「万円」。
 * 各カテゴリは { score(0-100), level, reasons[], proposals[], metrics{} } を返す。
 */
(function (global) {
  'use strict';

  const CATEGORIES = [
    { key: 'life', label: '生命保険', short: '生保' },
    { key: 'nonlife', label: '損害保険', short: '損保' },
    { key: 'ma', label: 'M&A・事業承継', short: 'M&A' },
    { key: 're', label: '不動産購入', short: '不動産' },
  ];

  const STATUSES = ['未着手', '提案準備', '提案中', '成約', '見送り'];

  const INDUSTRIES = [
    '建設業', '製造業', '運送業', '飲食業', '小売業', '卸売業',
    '医療・介護', '整骨・治療院', 'IT・ソフトウェア', 'サービス業', '不動産業', 'その他',
  ];

  // 業種別の損害保険リスク重み（0-3）と具体的な商品名
  const NONLIFE_ITEMS = [
    { key: 'liability', label: '賠償責任保険' },
    { key: 'property', label: '財物・休業補償' },
    { key: 'auto', label: '自動車（フリート）' },
    { key: 'workers', label: '労災上乗せ' },
    { key: 'cyber', label: 'サイバー保険' },
  ];

  const INDUSTRY_RISK = {
    '建設業': { w: { liability: 3, property: 3, auto: 2, workers: 3, cyber: 1 }, names: { liability: '請負業者賠償責任保険', property: '建設工事保険・組立保険', workers: '労災上乗せ（使用者賠償含む）' } },
    '製造業': { w: { liability: 3, property: 3, auto: 1, workers: 2, cyber: 2 }, names: { liability: 'PL（生産物賠償）保険', property: '火災・機械保険・休業損害' } },
    '運送業': { w: { liability: 2, property: 1, auto: 3, workers: 3, cyber: 1 }, names: { liability: '運送業者貨物賠償', auto: 'フリート自動車保険' } },
    '飲食業': { w: { liability: 3, property: 3, auto: 0, workers: 1, cyber: 1 }, names: { liability: '施設・生産物賠償（食中毒）', property: '店舗総合・休業補償' } },
    '小売業': { w: { liability: 2, property: 3, auto: 1, workers: 1, cyber: 2 }, names: { property: '店舗総合・商品在庫' } },
    '卸売業': { w: { liability: 2, property: 3, auto: 2, workers: 1, cyber: 1 }, names: { property: '動産総合・在庫補償' } },
    '医療・介護': { w: { liability: 3, property: 2, auto: 2, workers: 2, cyber: 3 }, names: { liability: '医師・介護事業者賠償', cyber: 'サイバー保険（患者情報）', auto: '送迎車両の自動車保険' } },
    '整骨・治療院': { w: { liability: 3, property: 2, auto: 1, workers: 1, cyber: 2 }, names: { liability: '柔道整復師賠償責任保険' } },
    'IT・ソフトウェア': { w: { liability: 3, property: 1, auto: 0, workers: 1, cyber: 3 }, names: { liability: 'IT業務賠償（受託開発）', cyber: 'サイバー保険' } },
    'サービス業': { w: { liability: 2, property: 2, auto: 1, workers: 1, cyber: 2 }, names: {} },
    '不動産業': { w: { liability: 2, property: 3, auto: 1, workers: 1, cyber: 1 }, names: { liability: '宅建業者賠償・施設賠償', property: '賃貸物件の火災・地震' } },
    'その他': { w: { liability: 2, property: 2, auto: 1, workers: 1, cyber: 1 }, names: {} },
  };

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const level = (s) => (s >= 70 ? '高' : s >= 40 ? '中' : '低');
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const man = (v) => `${Math.round(v).toLocaleString('ja-JP')}万円`;

  function result(score, reasons, proposals, metrics) {
    const s = Math.round(clamp(score));
    return { score: s, level: level(s), reasons, proposals, metrics: metrics || {} };
  }

  // ---------- 生命保険 ----------
  function scoreLife(c) {
    const reasons = [];
    const proposals = [];
    let score = 0;

    // 1) 事業保障：社長に万一があった時に必要な資金
    const fixedCostHalfYear = n(c.sales) * 0.15; // 年商15% ≒ 固定費半年分の目安
    const need = Math.max(0, n(c.debt) + fixedCostHalfYear - n(c.cash) * 0.5);
    const gap = Math.max(0, need - n(c.deathCover));
    if (need > 0) {
      const ratio = gap / need;
      score += 45 * ratio;
      if (ratio >= 0.3) {
        reasons.push(`事業保障の不足 約${man(gap)}（必要額 ${man(need)}／現加入 ${man(n(c.deathCover))}）`);
        proposals.push('定期保険・収入保障保険で借入金返済と運転資金を確保');
      }
    }

    // 2) 役員退職金の準備
    const yearsToRetire = Math.max(0, 65 - n(c.repAge));
    const tenureAtRetire = n(c.tenureYears) + yearsToRetire;
    const retireTarget = n(c.execPayMonthly) * tenureAtRetire * 3; // 最終報酬月額×在任年数×功績倍率3.0
    const retireGap = Math.max(0, retireTarget - n(c.retireReserve));
    if (retireTarget > 0) {
      const ratio = retireGap / retireTarget;
      score += 35 * ratio;
      if (ratio >= 0.3) {
        reasons.push(`役員退職金の準備不足 約${man(retireGap)}（目安 ${man(retireTarget)}：月額報酬×在任${tenureAtRetire}年×3.0）`);
        proposals.push('退職金原資の計画的積立（法人契約の長期保険・経営セーフティ共済との組合せ）');
      }
    }

    // 3) 利益水準：積立余力
    if (n(c.ordinaryProfit) >= 1000) {
      score += 10;
      reasons.push(`経常利益 ${man(n(c.ordinaryProfit))}：保険料の負担余力あり`);
    }

    // 4) 相続・納税資金
    if (n(c.repAge) >= 60 && n(c.netAssets) >= 10000) {
      score += 15;
      reasons.push(`社長${c.repAge}歳・純資産 ${man(n(c.netAssets))}：自社株を含む相続税の納税資金が論点`);
      proposals.push('個人契約の終身保険で納税資金・代償分割資金を準備');
    }

    if (!reasons.length) reasons.push('現時点で大きな保障不足は見当たりません');
    return result(score, reasons, proposals, { need, gap, retireTarget, retireGap });
  }

  // ---------- 損害保険 ----------
  function scoreNonlife(c) {
    const risk = INDUSTRY_RISK[c.industry] || INDUSTRY_RISK['その他'];
    const nl = c.nonlife || {};
    const reasons = [];
    const proposals = [];
    let totalW = 0;
    let missingW = 0;
    const missing = [];

    NONLIFE_ITEMS.forEach((item) => {
      let w = risk.w[item.key] || 0;
      if (item.key === 'auto' && n(c.vehicles) >= 10) w = Math.max(w, 3);
      if (item.key === 'auto' && n(c.vehicles) === 0) w = 0;
      if (item.key === 'workers' && n(c.employees) >= 20) w = Math.max(w, 3);
      totalW += w;
      if (!nl[item.key] && w > 0) {
        missingW += w;
        const name = risk.names[item.key] || item.label;
        missing.push({ name, w });
      }
    });

    let score = totalW ? (missingW / totalW) * 85 : 0;
    missing
      .sort((a, b) => b.w - a.w)
      .forEach((m) => {
        if (m.w >= 2) reasons.push(`${c.industry}で重要度の高い「${m.name}」が未加入`);
        proposals.push(`${m.name}の見積り・補償内容の比較`);
      });

    if (n(c.employees) >= 20) {
      score += 10;
      reasons.push(`従業員${c.employees}名：労務事故・使用者賠償の備えが必要な規模`);
    }
    if (n(c.vehicles) >= 10) {
      score += 5;
      reasons.push(`車両${c.vehicles}台：フリート契約での保険料最適化の余地`);
    }
    const insuredCount = NONLIFE_ITEMS.filter((i) => nl[i.key]).length;
    if (insuredCount >= 3) proposals.push('既存契約の一括見直し（重複補償・保険料の適正化）');

    if (!reasons.length) reasons.push('業種上の主要リスクはおおむねカバーされています');
    return result(score, reasons, proposals, { missingCount: missing.length });
  }

  // ---------- M&A・事業承継 ----------
  function scoreMA(c) {
    const reasons = [];
    const proposals = [];
    const age = n(c.repAge);
    const op = n(c.opProfit);

    // 譲渡・承継ニーズ
    let sell = 0;
    if (age >= 65) sell = 55;
    else if (age >= 60) sell = 40;
    else if (age >= 55) sell = 20;
    if (c.successor === 'なし') sell *= 1;
    else if (c.successor === '候補あり') sell *= 0.6;
    else sell *= 0.25;
    if (sell > 0 && op > 0) sell += 15;
    if (sell > 0 && c.successor === 'なし') sell += 15;

    // 買収（成長）ニーズ
    let buy = 0;
    if (c.growth) {
      buy = 30;
      if (op >= 2000) buy += 20;
      else if (op >= 1000) buy += 10;
      if (n(c.cash) >= 10000) buy += 20;
      else if (n(c.cash) >= 5000) buy += 10;
      if (age < 55) buy += 10;
    }

    // 簡易企業価値（年買法：時価純資産＋営業利益×3年）
    const value = Math.max(0, n(c.netAssets) + Math.max(0, op) * 3);

    let type = '—';
    if (sell >= buy && sell > 0) {
      type = c.successor === '候補あり' ? '親族・社内承継' : '第三者承継（譲渡）';
      reasons.push(`社長${age}歳・後継者「${c.successor || '未確認'}」`);
      if (c.successor === 'なし') proposals.push('第三者承継（M&A）の選択肢を含めた出口戦略の整理');
      if (c.successor === '候補あり') proposals.push('事業承継税制・自社株対策を含む承継計画の策定');
      if (op > 0) reasons.push(`営業利益 ${man(op)}：譲渡市場で評価されやすい黒字体質`);
      if (n(c.netAssets) < 0) {
        reasons.push('債務超過：譲渡前の磨き上げ（財務改善）が必要');
        proposals.push('磨き上げ（不採算整理・役員借入金の処理）');
      }
      proposals.push(`簡易株価・企業価値算定（目安 ${man(value)}）`);
    }
    if (buy > sell) {
      type = '買収（成長戦略）';
      reasons.push(`拡大志向あり・現預金 ${man(n(c.cash))}・営業利益 ${man(op)}`);
      proposals.push('同業・隣接業種の買収候補リストアップ（引継ぎ事務所の譲渡ニーズとマッチング）');
    }

    const score = Math.max(sell, buy);
    if (!reasons.length) reasons.push('承継・M&Aの緊急性は現時点で低い');
    return result(score, reasons, proposals, { value, type, sell: Math.round(sell), buy: Math.round(buy) });
  }

  // ---------- 不動産購入 ----------
  function scoreRE(c) {
    const reasons = [];
    const proposals = [];
    let score = 0;
    const rent = n(c.rentMonthly);
    const monthlySales = n(c.sales) / 12;
    let budget = 0;

    // 1) 自社ビル・事務所購入
    if (c.office === '賃貸' && rent >= 20) {
      let s = rent >= 80 ? 40 : rent >= 40 ? 30 : 20;
      if (n(c.netAssets) >= 5000) s += 10;
      score += s;
      budget = Math.max(budget, rent * 12 * 15);
      reasons.push(`賃貸 月額家賃 ${man(rent)}（年 ${man(rent * 12)}）：購入とのコスト比較の価値あり`);
      proposals.push(`自社ビル・事務所の購入シミュレーション（予算目安 ${man(rent * 12 * 15)}＝家賃15年分）`);
    }

    // 2) 余剰資金の運用（収益不動産）
    const excessCash = n(c.cash) - monthlySales * 3;
    if (excessCash >= 5000) {
      score += excessCash >= 20000 ? 35 : excessCash >= 10000 ? 25 : 15;
      budget = Math.max(budget, excessCash * 2);
      reasons.push(`月商3ヶ月分を超える現預金 約${man(excessCash)}：資金の置き場所として検討余地`);
      proposals.push('法人での収益不動産取得（借入併用・利回りと減価償却の確認）');
    }

    // 3) 社長個人の相続対策
    if (n(c.repAge) >= 65 && n(c.netAssets) >= 10000) {
      score += 20;
      reasons.push(`社長${c.repAge}歳・純資産 ${man(n(c.netAssets))}：相続財産の組換え検討時期`);
      proposals.push('個人資産の組換え検討（※評価通達6項の否認リスクに留意し、経済合理性を確保）');
    }

    // 4) 利益水準
    if (n(c.ordinaryProfit) >= 3000) {
      score += 10;
      reasons.push(`経常利益 ${man(n(c.ordinaryProfit))}：取得・借入の与信が得やすい`);
    }

    if (!reasons.length) reasons.push('不動産購入の優先度は現時点で低い');
    return result(score, reasons, proposals, { budget });
  }

  function analyze(c) {
    const life = scoreLife(c);
    const nonlife = scoreNonlife(c);
    const ma = scoreMA(c);
    const re = scoreRE(c);
    const total = Math.round((life.score + nonlife.score + ma.score + re.score) / 4);
    return { life, nonlife, ma, re, total };
  }

  global.Scoring = { CATEGORIES, STATUSES, INDUSTRIES, NONLIFE_ITEMS, analyze, level, man };
})(window);
