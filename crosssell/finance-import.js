/*
 * 会計ソフトの試算表・決算書CSVから財務数値を読み取る。
 * 弥生会計／freee／マネーフォワード／勘定奉行／JDL 等の「残高試算表」「決算書（貸借対照表・損益計算書）」の
 * CSV出力を想定し、勘定科目名で判定する（ソフト固有の列配置には依存しない）。
 */
(function (global) {
  'use strict';

  // ---------- 文字コード ----------
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'Shift_JIS' };
    }
  }

  // ---------- CSV/TSV 分解 ----------
  function splitRows(text) {
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
    const out = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); out.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  // ---------- 正規化 ----------
  const toHalf = (s) => String(s).replace(/[０-９Ａ-Ｚａ-ｚ，．－（）]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const normName = (s) => toHalf(s)
    .replace(/[\s　]/g, '')
    .replace(/^[【\[〔<＜(（]+|[】\]〕>＞)）]+$/g, '')
    .replace(/^\d{3,}[.\-:]?|^\d+[.:\-]/, '') // 科目コード（「1年以内〜」は残す）
    .replace(/^[ⅠⅡⅢⅣⅤⅥ]+\.?/, '')
    .replace(/[<>＜＞【】]/g, '');

  // 「1,234」「△1,234」「▲1,234」「-1,234」「(1,234)」「1234円」に対応
  function parseAmount(raw) {
    if (raw == null) return null;
    let s = toHalf(raw).replace(/[\s\u3000,円¥￥\\]/g, '').replace(/[\u2212\u2012\u2013\u2014\u30fc]/g, '-');
    if (!s) return null;
    let neg = false;
    if (/^[△▲-]/.test(s)) { neg = true; s = s.slice(1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const v = Number(s);
    return neg ? -v : v;
  }

  // ---------- 勘定科目の対応表 ----------
  const RULES = {
    sales: [/^(純)?売上高(合計|計)?$/, /^売上(合計|計)$/, /^完成工事高(合計)?$/, /^営業収益(合計)?$/, /^(医業|介護事業)収益(合計)?$/, /^売上収益$/],
    grossProfit: [/^売上総(利益|損益)(金額)?$/, /^完成工事総利益$/],
    sga: [/^販売費(及び|および)?一般管理費(合計|計)?$/, /^販管費(合計|計)?$/],
    opProfit: [/^営業(利益|損益)(金額)?$/],
    opLoss: [/^営業損失(金額)?$/],
    ordinaryProfit: [/^経常(利益|損益)(金額)?$/],
    ordinaryLoss: [/^経常損失(金額)?$/],
    netAssets: [/^純資産(の部)?(合計|計)$/, /^純資産$/],
    cash: [/^現金(及び|および|・)?預金(合計|計)?$/, /^現預金(合計|計)?$/],
    cashParts: [/^(現金|小口現金|当座預金|普通預金|定期預金|定期積金|通知預金|外貨預金|別段預金|その他の?預金)$/],
    debt: [/^短期借入金$/, /^長期借入金$/, /^(1|一)年(以)?内(に)?(返済(予定)?の?)?長期借入金$/],
    execPay: [/^役員報酬$/],
    rent: [/^地代家賃$/],
    insuranceReserve: [/^保険積立金$/],
  };

  const AMOUNT_HEADERS = [/期末残高/, /当期残高/, /当月残高/, /残高/, /当期累計/, /当期金額/, /^金額$/, /当期/, /期末/];
  const NAME_HEADERS = [/勘定科目/, /科目名?/, /^項目$/];

  function detectColumns(rows) {
    // 見出し行を探す
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const cells = rows[i].map((x) => normName(x));
      let nameIdx = -1;
      for (const re of NAME_HEADERS) {
        nameIdx = cells.findIndex((h) => re.test(h) && !/コード|番号|No/i.test(h));
        if (nameIdx >= 0) break;
      }
      if (nameIdx < 0) continue;
      // 「借方残高」「貸方残高」に分かれた形式
      const drIdx = cells.findIndex((h) => /借方.*残高|残高.*借方/.test(h));
      const crIdx = cells.findIndex((h) => /貸方.*残高|残高.*貸方/.test(h));
      const plainIdx = cells.findIndex((h, j) => j !== nameIdx && /^(期末|当期|当月)?残高$/.test(h));
      if (drIdx >= 0 && crIdx >= 0 && plainIdx < 0) return { headerRow: i, nameIdx, amtIdx: -1, drIdx, crIdx, amtHeader: `${rows[i][drIdx]}／${rows[i][crIdx]}` };
      for (const re of AMOUNT_HEADERS) {
        const amtIdx = cells.findIndex((h, j) => j !== nameIdx && re.test(h) && !/前期|前月|比|借方|貸方/.test(h));
        if (amtIdx >= 0) return { headerRow: i, nameIdx, amtIdx, drIdx: -1, amtHeader: rows[i][amtIdx] };
      }
      return { headerRow: i, nameIdx, amtIdx: -1, drIdx: -1, amtHeader: '' };
    }
    return { headerRow: -1, nameIdx: -1, amtIdx: -1, drIdx: -1, crIdx: -1, amtHeader: '' };
  }

  function extract(text) {
    const rows = splitRows(text);
    const col = detectColumns(rows);
    const items = [];
    rows.forEach((r, i) => {
      if (i <= col.headerRow) return;
      let name = '';
      let amount = null;
      if (col.nameIdx >= 0) {
        name = normName(r[col.nameIdx] || '');
        if (!name) name = normName(r.find((x) => normName(x) && parseAmount(x) == null) || '');
      } else {
        name = normName(r.find((x) => normName(x) && parseAmount(x) == null) || '');
      }
      let explicitCell = false;
      if (col.drIdx >= 0) {
        // 借方・貸方の残高のうち、値の入っている側を採用（貸方科目もプラスで扱う）
        const dr = parseAmount(r[col.drIdx]), cr = parseAmount(r[col.crIdx]);
        amount = dr && !cr ? dr : cr && !dr ? cr : dr != null || cr != null ? (dr || 0) - (cr || 0) : null;
        explicitCell = true;
      } else if (col.amtIdx >= 0) {
        amount = parseAmount(r[col.amtIdx]);
        explicitCell = String(r[col.amtIdx] ?? '').trim() !== '';
      }
      if (amount == null && !explicitCell) {
        // 見出しが無い・空欄の場合は行の最後の数値
        for (let j = r.length - 1; j >= 0; j--) { const v = parseAmount(r[j]); if (v != null) { amount = v; break; } }
      }
      if (name && amount != null) items.push({ name, amount });
    });
    return { items, col };
  }

  const first = (items, rules) => items.find((it) => rules.some((re) => re.test(it.name)));
  const all = (items, rules) => items.filter((it) => rules.some((re) => re.test(it.name)));

  /*
   * 結果は「円」単位のまま返す（unit で万円換算は呼び出し側）
   */
  function analyzeText(text) {
    const { items, col } = extract(text);
    const found = {};
    const src = {};
    const set = (key, val, from) => { if (val != null && Number.isFinite(val)) { found[key] = val; src[key] = from; } };

    const s = first(items, RULES.sales); if (s) set('sales', s.amount, s.name);

    const op = first(items, RULES.opProfit);
    const opl = first(items, RULES.opLoss);
    if (op) set('opProfit', op.amount, op.name);
    else if (opl) set('opProfit', -Math.abs(opl.amount), opl.name);
    else {
      const gp = first(items, RULES.grossProfit);
      const sga = first(items, RULES.sga);
      if (gp && sga) set('opProfit', gp.amount - sga.amount, `${gp.name}−${sga.name}`);
    }

    const ord = first(items, RULES.ordinaryProfit);
    const ordl = first(items, RULES.ordinaryLoss);
    if (ord) set('ordinaryProfit', ord.amount, ord.name);
    else if (ordl) set('ordinaryProfit', -Math.abs(ordl.amount), ordl.name);

    const na = first(items, RULES.netAssets); if (na) set('netAssets', na.amount, na.name);

    const cash = first(items, RULES.cash);
    if (cash) set('cash', cash.amount, cash.name);
    else {
      const parts = all(items, RULES.cashParts);
      if (parts.length) set('cash', parts.reduce((t, p) => t + p.amount, 0), parts.map((p) => p.name).join('＋'));
    }

    const debts = all(items, RULES.debt);
    if (debts.length) {
      // 同名科目が複数行ある場合：どれかが他の合計なら合計行を採用、そうでなければ（銀行別など）合算
      const groups = {};
      debts.forEach((d) => (groups[d.name] = groups[d.name] || []).push(d.amount));
      let total = 0;
      Object.values(groups).forEach((vals) => {
        const sumAll = vals.reduce((t, v) => t + v, 0);
        const totalRow = vals.length > 1 ? vals.find((v) => Math.abs(v * 2 - sumAll) < 1) : undefined;
        total += totalRow !== undefined ? totalRow : sumAll;
      });
      set('debt', total, Object.keys(groups).join('＋'));
    }

    const ep = first(items, RULES.execPay); if (ep) set('execPayAnnual', ep.amount, ep.name);
    const rent = first(items, RULES.rent); if (rent) set('rentAnnual', rent.amount, rent.name);
    const ins = first(items, RULES.insuranceReserve); if (ins) set('insuranceReserve', ins.amount, ins.name);

    return { found, src, itemCount: items.length, amountHeader: col.amtHeader };
  }

  // 円→万円の単位を推定（年商または最大値から）
  function guessUnit(found) {
    // 会計ソフトのCSVは円単位がほとんどのため円を優先。確認画面で変更可能
    const ref = Math.abs(found.sales || Math.max(0, ...Object.values(found).map(Math.abs)));
    if (ref >= 1e6) return 'yen';       // 100万以上 → 円
    if (ref >= 1e3) return 'thousand';  // 千円表記の決算書
    return 'man';
  }

  const UNIT_DIV = { yen: 10000, thousand: 10, man: 1 };

  /*
   * クライアント項目への変換（万円）
   * 年額の役員報酬・地代家賃は月額へ。期中の試算表の場合は months で年換算する。
   */
  function toClientFields(found, unit, months) {
    const d = UNIT_DIV[unit] || 1;
    const m = Math.max(1, Math.min(12, Number(months) || 12));
    const annualize = 12 / m;
    const r = (v) => Math.round(v / d);
    const out = {};
    if (found.sales != null) out.sales = Math.round((found.sales / d) * annualize);
    if (found.opProfit != null) out.opProfit = Math.round((found.opProfit / d) * annualize);
    if (found.ordinaryProfit != null) out.ordinaryProfit = Math.round((found.ordinaryProfit / d) * annualize);
    if (found.netAssets != null) out.netAssets = r(found.netAssets);
    if (found.cash != null) out.cash = r(found.cash);
    if (found.debt != null) out.debt = r(found.debt);
    if (found.execPayAnnual != null) out.execPayMonthly = Math.round(found.execPayAnnual / d / m);
    if (found.rentAnnual != null) out.rentMonthly = Math.round(found.rentAnnual / d / m);
    if (found.insuranceReserve != null) out.retireReserve = r(found.insuranceReserve);
    return out;
  }

  const FIELD_LABELS = {
    sales: '年商', opProfit: '営業利益', ordinaryProfit: '経常利益', netAssets: '純資産',
    cash: '現預金', debt: '借入金残高', execPayMonthly: '役員報酬（月額）', rentMonthly: '月額家賃', retireReserve: '退職金準備額（保険積立金）',
  };

  // ファイル名から会社を推定
  const stripCorp = (s) => normName(toHalf(s).replace(/株式会社|有限会社|合同会社|医療法人社団|医療法人|社会福祉法人|一般社団法人|\(株\)|\(有\)|㈱|㈲/g, ''));
  function matchClient(fileName, clients) {
    const f = stripCorp(fileName.replace(/\.[^.]+$/, ''));
    let best = null;
    clients.forEach((c) => {
      const key = stripCorp(c.company);
      if (key.length >= 2 && f.includes(key) && (!best || key.length > best.len)) best = { id: c.id, len: key.length };
    });
    return best ? best.id : '';
  }

  global.FinanceImport = { decode, analyzeText, guessUnit, toClientFields, matchClient, FIELD_LABELS, parseAmount };
})(window);
