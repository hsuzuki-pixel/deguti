(function () {
  'use strict';

  const { CATEGORIES, STATUSES, INDUSTRIES, NONLIFE_ITEMS, analyze, man } = window.Scoring;
  const { DEFAULT_ASSUMPTIONS, clientFees, simulate } = window.Economics;
  const FI = window.FinanceImport;
  const STORE_KEY = 'crosssell.clients.v1';
  const ASSUME_KEY = 'crosssell.assumptions';
  const THEME_KEY = 'crosssell.theme';
  const FILTER_KEY = 'crosssell.filters';

  // ---------- 永続化 ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
  };

  const BACKUP_KEY = 'crosssell.lastBackup';
  const DIRTY_KEY = 'crosssell.lastSaved';
  const NUM_KEYS = ['repAge', 'sales', 'opProfit', 'ordinaryProfit', 'netAssets', 'cash', 'debt', 'employees', 'execPayMonthly',
    'tenureYears', 'deathCover', 'retireReserve', 'vehicles', 'rentMonthly', 'advisoryFee'];

  // 取込・復元・旧バージョンのデータを、欠けた項目を補って正しい形に揃える
  function normalizeClient(raw, usedIds) {
    const base = blankClient();
    const c = Object.assign(base, raw && typeof raw === 'object' ? raw : {});
    NUM_KEYS.forEach((k) => { const v = Number(c[k]); c[k] = Number.isFinite(v) ? v : 0; });
    ['company', 'rep', 'industry', 'firm', 'staff', 'successor', 'office', 'notes', 'lastContact'].forEach((k) => { c[k] = c[k] == null ? '' : String(c[k]); });
    if (!INDUSTRIES.includes(c.industry)) c.industry = c.industry ? 'その他' : '建設業';
    if (!['あり', '候補あり', 'なし', '未定'].includes(c.successor)) c.successor = '未定';
    if (!['賃貸', '自社所有'].includes(c.office)) c.office = '賃貸';
    c.growth = !!c.growth;
    c.nonlife = Object.assign(blankClient().nonlife, c.nonlife && typeof c.nonlife === 'object' ? c.nonlife : {});
    Object.keys(c.nonlife).forEach((k) => (c.nonlife[k] = !!c.nonlife[k]));
    c.status = Object.assign(blankClient().status, c.status && typeof c.status === 'object' ? c.status : {});
    Object.keys(c.status).forEach((k) => { if (!STATUSES.includes(c.status[k])) c.status[k] = '未着手'; });
    if (raw && raw.advisoryFee == null) {
      const s = window.SAMPLE_CLIENTS.find((x) => x.id === c.id && x.company === c.company);
      if (s) c.advisoryFee = s.advisoryFee;
    }
    c.id = String(c.id || '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(c.id)) c.id = '';  // 画面のURL・属性に使うため安全な文字のみ
    if (!usedIds && !c.id) c.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (usedIds) {
      while (!c.id || usedIds.has(c.id)) c.id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      usedIds.add(c.id);
    }
    return c;
  }
  const normalizeAll = (list) => { const ids = new Set(); return (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object').map((x) => normalizeClient(x, ids)); };

  let clients = normalizeAll(store.get(STORE_KEY, null) || JSON.parse(JSON.stringify(window.SAMPLE_CLIENTS)));
  function save() {
    const ok = store.set(STORE_KEY, clients);
    if (!ok) { toast('⚠ ブラウザに保存できませんでした。容量不足か保存禁止の設定です。バックアップを出力してください'); return; }
    store.set(DIRTY_KEY, new Date().toISOString());
  }
  function markBackup() { store.set(BACKUP_KEY, new Date().toISOString()); }
  // 前提条件はすべて数値に揃える（復元ファイル経由の不正値対策も兼ねる）
  function normalizeAssumptions(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { firms: {} };
    Object.keys(DEFAULT_ASSUMPTIONS).forEach((k) => {
      if (k === 'firms') return;
      const v = Number(src[k]);
      out[k] = Number.isFinite(v) ? Math.max(0, v) : DEFAULT_ASSUMPTIONS[k];
    });
    out.years = Math.round(Math.max(1, Math.min(20, out.years || DEFAULT_ASSUMPTIONS.years)));
    ['churn', 'advisoryMargin', 'probHigh', 'probMid', 'probLow', 'probProposing', 'maShare', 'reShare'].forEach((k) => (out[k] = Math.min(100, out[k])));
    if (src.firms && typeof src.firms === 'object') {
      Object.keys(src.firms).forEach((name) => {
        const f = src.firms[name] || {};
        const o = {};
        ['price', 'integrationCost'].forEach((k) => { const v = Number(f[k]); if (f[k] != null && Number.isFinite(v)) o[k] = Math.max(0, v); });
        out.firms[name] = o;
      });
    }
    return out;
  }
  let assumptions = normalizeAssumptions(store.get(ASSUME_KEY, {}));
  const saveAssumptions = () => store.set(ASSUME_KEY, assumptions);
  const findClient = (id) => clients.find((c) => c.id === id);

  let filters = Object.assign({ q: '', firm: '', industry: '', staff: '', minLevel: '' }, store.get(FILTER_KEY, {}));
  let sort = { key: 'total', dir: -1 };

  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = (v) => Math.round(Number(v) || 0).toLocaleString('ja-JP');
  const heatClass = (s) => (s >= 80 ? 'h4' : s >= 60 ? 'h3' : s >= 40 ? 'h2' : s >= 20 ? 'h1' : 'h0');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  const today = () => new Date().toISOString().slice(0, 10);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.style.display = 'none'), 2200);
  }

  // ツールチップ
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    tip.innerHTML = el.getAttribute('data-tip');
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.style.display !== 'block') return;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });

  // ---------- テーマ ----------
  const themeBtn = $('#themeBtn');
  const themeLabels = { auto: '表示: 自動', light: '表示: ライト', dark: '表示: ダーク' };
  function applyTheme(mode) {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    themeBtn.textContent = themeLabels[mode];
  }
  let theme = store.get(THEME_KEY, 'auto');
  applyTheme(theme);
  themeBtn.addEventListener('click', () => {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    store.set(THEME_KEY, theme);
    applyTheme(theme);
  });

  // ---------- 分析結果のキャッシュ ----------
  function rows() {
    return clients.map((c) => { const a = analyze(c); return { c, a, f: clientFees(c, a, assumptions) }; });
  }

  // 該当する選択肢が無くなった絞込み条件は解除する（事務所名の変更・削除・復元後など）
  function pruneFilters() {
    let changed = false;
    ['firm', 'industry', 'staff'].forEach((k) => {
      if (filters[k] && !clients.some((c) => c[k] === filters[k])) { filters[k] = ''; changed = true; }
    });
    if (changed) store.set(FILTER_KEY, filters);
  }

  function applyFilters(list) {
    pruneFilters();
    const q = filters.q.trim().toLowerCase();
    const minScore = filters.minLevel === '高' ? 70 : filters.minLevel === '中' ? 40 : 0;
    return list.filter(({ c, a }) => {
      if (q && !(`${c.company} ${c.rep} ${c.notes}`.toLowerCase().includes(q))) return false;
      if (filters.firm && c.firm !== filters.firm) return false;
      if (filters.industry && c.industry !== filters.industry) return false;
      if (filters.staff && c.staff !== filters.staff) return false;
      if (minScore && !CATEGORIES.some((k) => a[k.key].score >= minScore)) return false;
      return true;
    });
  }

  function sortRows(list) {
    const get = ({ c, a, f }) => {
      if (sort.key === 'total') return a.total;
      if (sort.key === 'expected') return f.expTotal;
      if (a[sort.key]) return a[sort.key].score;
      return c[sort.key];
    };
    return list.slice().sort((x, y) => {
      const vx = get(x), vy = get(y);
      if (typeof vx === 'string' || typeof vy === 'string') return String(vx ?? '').localeCompare(String(vy ?? ''), 'ja') * sort.dir;
      return ((vx || 0) - (vy || 0)) * sort.dir;
    });
  }

  function filterBar() {
    const firms = uniq(clients.map((c) => c.firm));
    const inds = uniq(clients.map((c) => c.industry));
    const staffs = uniq(clients.map((c) => c.staff));
    const opt = (list, val, label) => `<option value="">${label}</option>` + list.map((v) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
    return `
      <div class="filters" id="filters">
        <input type="search" name="q" placeholder="会社名・代表者・メモで検索" value="${esc(filters.q)}" />
        <select name="firm">${opt(firms, filters.firm, '引継ぎ元：すべて')}</select>
        <select name="industry">${opt(inds, filters.industry, '業種：すべて')}</select>
        <select name="staff">${opt(staffs, filters.staff, '担当：すべて')}</select>
        <select name="minLevel">
          <option value="">ニーズ：すべて</option>
          <option value="中" ${filters.minLevel === '中' ? 'selected' : ''}>中以上が1つ以上</option>
          <option value="高" ${filters.minLevel === '高' ? 'selected' : ''}>高が1つ以上</option>
        </select>
        <button class="btn small" type="button" id="clearFilters">条件クリア</button>
      </div>`;
  }

  function bindFilters(rerender) {
    const box = $('#filters');
    if (!box) return;
    const apply = (e) => {
      if (!e.target.name) return;
      filters[e.target.name] = e.target.value;
      store.set(FILTER_KEY, filters);
      rerender(e.target.name === 'q');
    };
    box.addEventListener('input', (e) => { if (!e.isComposing) apply(e); }); // 日本語変換中は再描画しない
    box.addEventListener('compositionend', apply);
    $('#clearFilters').addEventListener('click', () => {
      filters = { q: '', firm: '', industry: '', staff: '', minLevel: '' };
      store.set(FILTER_KEY, filters);
      rerender(false);
    });
  }

  function tipFor(c, cat, r) {
    return `<b>${esc(c.company)}｜${esc(cat.label)} ${r.score}点（${r.level}）</b><ul>${r.reasons.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }

  // ---------- ダッシュボード ----------
  function emptyState() {
    $('#view').innerHTML = `
      <div class="page-head"><div><h1>ようこそ</h1><p>クライアントがまだ登録されていません。次のいずれかから始めてください。</p></div></div>
      <div class="grid grid-kpi">
        <a class="card kpi" href="#/settings" style="color:inherit"><h2>① 顧問先リストを一括登録</h2><p class="subline">引継ぎ元事務所の顧問先一覧をCSVで取り込みます</p></a>
        <a class="card kpi" href="#/finance" style="color:inherit"><h2>② 試算表から登録</h2><p class="subline">会計ソフトのCSVから財務数値ごと登録します</p></a>
        <a class="card kpi" href="#/new" style="color:inherit"><h2>③ 1社ずつ入力</h2><p class="subline">決算書を見ながら手入力します</p></a>
        <a class="card kpi" href="#/settings" style="color:inherit"><h2>サンプルで試す</h2><p class="subline">「データ取込・出力」→「サンプルデータに戻す」</p></a>
      </div>
      <p class="subline">使い方は <a href="#/help">操作ガイド</a> をご覧ください。</p>`;
  }

  function renderDashboard(keepFocus) {
    if (!clients.length) { emptyState(); return; }
    const all = rows();
    const list = sortRows(applyFilters(all));
    const view = $('#view');

    const count = (key, lv) => list.filter(({ a }) => a[key].level === lv).length;
    const active = list.reduce((s, { c }) => s + CATEGORIES.filter((k) => ['提案準備', '提案中'].includes(c.status[k.key])).length, 0);
    const won = list.reduce((s, { c }) => s + CATEGORIES.filter((k) => c.status[k.key] === '成約').length, 0);
    const maValue = list.filter(({ a }) => a.ma.level === '高').reduce((s, { a }) => s + a.ma.metrics.value, 0);
    const expOnce = list.reduce((s, { f }) => s + f.expOnce, 0);
    const expRec = list.reduce((s, { f }) => s + f.expRecurring, 0);

    const kpis = `
      <div class="grid grid-kpi">
        <div class="card kpi"><div class="kpi-label">対象クライアント</div><div class="kpi-value">${list.length}<small>社</small></div><div class="kpi-note">全${clients.length}社中</div></div>
        ${CATEGORIES.map((k) => `
          <div class="card kpi"><div class="kpi-label"><span class="dot ${k.key}"></span>${k.label}：高ニーズ</div>
          <div class="kpi-value">${count(k.key, '高')}<small>社</small></div>
          <div class="kpi-note">中ニーズ ${count(k.key, '中')}社</div></div>`).join('')}
        <div class="card kpi"><div class="kpi-label">進行中 / 成約</div><div class="kpi-value">${active}<small>件</small> / ${won}<small>件</small></div><div class="kpi-note">提案準備＋提案中 / 成約</div></div>
        <a class="card kpi" href="#/roi" style="color:inherit;text-decoration:none"><div class="kpi-label">クロスセル期待収益</div><div class="kpi-value">${num(expOnce)}<small>万円</small></div><div class="kpi-note">一時収益の期待値＋継続 年${num(expRec)}万円 →回収試算</div></a>
      </div>`;

    // カテゴリ別ニーズ分布（高＝濃色、中＝淡色）
    const maxTotal = Math.max(1, list.length);
    const bars = CATEGORIES.map((k) => {
      const hi = count(k.key, '高');
      const mid = count(k.key, '中');
      const color = `var(--cat-${k.key})`;
      return `
        <div class="bar-row">
          <div class="bar-label"><span class="dot ${k.key}"></span>${k.short}</div>
          <div class="bar-track">
            ${hi ? `<div class="bar-seg hi" style="width:${(hi / maxTotal) * 100}%;background:${color}" data-tip="<b>${k.label}：高ニーズ</b>${hi}社"></div>` : ''}
            ${mid ? `<div class="bar-seg mid" style="width:${(mid / maxTotal) * 100}%;background:${color}" data-tip="<b>${k.label}：中ニーズ</b>${mid}社"></div>` : ''}
          </div>
          <div class="bar-val">高${hi}・中${mid}</div>
        </div>`;
    }).join('');

    // 優先アクション（未着手・提案準備のうちスコアが高い順）
    const actions = [];
    list.forEach(({ c, a }) => CATEGORIES.forEach((k) => {
      if (['未着手', '提案準備'].includes(c.status[k.key]) && a[k.key].score >= 40) {
        actions.push({ c, k, r: a[k.key] });
      }
    }));
    actions.sort((x, y) => y.r.score - x.r.score);
    const top = actions.slice(0, 10).map(({ c, k, r }, i) => `
      <li data-go="${c.id}" data-tip="${esc(tipFor(c, k, r))}">
        <span class="rank">${i + 1}</span>
        <div><div class="company">${esc(c.company)}</div>
          <div class="what"><span class="dot ${k.key}"></span> ${k.label}：${esc(r.proposals[0] || r.reasons[0])}</div></div>
        <div style="text-align:right"><span class="badge lv-${r.level}">${r.level} ${r.score}</span><div class="subline">${esc(c.status[k.key])}</div></div>
      </li>`).join('') || '<li class="empty">該当する提案候補はありません</li>';

    // ニーズ・マトリクス
    const th = (key, label, cls = '') => `<th class="sortable ${cls}" data-sort="${key}">${label}${sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
    const matrix = list.map(({ c, a }) => `
      <tr data-go="${c.id}">
        <td><div class="company">${esc(c.company)}</div><div class="subline">${esc(c.rep)}（${c.repAge}歳）・${esc(c.industry)}</div></td>
        <td><div>${esc(c.firm)}</div><div class="subline">担当 ${esc(c.staff)}</div></td>
        <td class="num">${num(c.sales)}</td>
        ${CATEGORIES.map((k) => {
          const r = a[k.key];
          return `<td class="heat-cell"><div class="heat ${heatClass(r.score)}" data-tip="${esc(tipFor(c, k, r))}"><span class="v">${r.score}</span><span class="s">${esc(c.status[k.key])}</span></div></td>`;
        }).join('')}
        <td class="heat-cell"><div class="heat ${heatClass(a.total)}"><span class="v">${a.total}</span><span class="s">総合</span></div></td>
      </tr>`).join('');

    view.innerHTML = `
      <div class="page-head">
        <div><h1>ダッシュボード</h1><p>承継したクライアントごとに、生命保険・損害保険・M&A・不動産のニーズを自動判定しています。</p></div>
        <a class="btn primary" href="#/new">＋ クライアント追加</a>
      </div>
      ${backupBanner()}
      ${filterBar()}
      ${kpis}
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h2>カテゴリ別ニーズ分布</h2>
            <div class="legend"><span class="item"><span class="sw" style="background:var(--text-2)"></span>高（70点〜）</span><span class="item"><span class="sw" style="background:var(--text-2);opacity:.45"></span>中（40〜69点）</span></div>
          </div>
          <div class="bars">${bars}</div>
          ${maValue ? `<p class="notice" style="margin-top:14px">M&A高ニーズ先の簡易企業価値（時価純資産＋営業利益×3年）合計：<b>${man(maValue)}</b></p>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h2>優先アクション TOP10</h2><span class="sub">未着手・提案準備のうちスコア順</span></div>
          <ul class="actions">${top}</ul>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>ニーズ・マトリクス（クライアント × 商品）</h2>
          <div class="legend">
            <span>スコア</span>
            <span class="item"><span class="sw h0"></span>0-19</span>
            <span class="item"><span class="sw h1"></span>20-39</span>
            <span class="item"><span class="sw h2"></span>40-59</span>
            <span class="item"><span class="sw h3"></span>60-79</span>
            <span class="item"><span class="sw h4"></span>80-100</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${th('company', 'クライアント')}${th('firm', '引継ぎ元')}${th('sales', '年商（万円）', 'num')}
              ${CATEGORIES.map((k) => th(k.key, `<span class="dot ${k.key}"></span> ${k.label}`)).join('')}
              ${th('total', '総合')}
            </tr></thead>
            <tbody>${matrix || '<tr><td colspan="8" class="empty">条件に合うクライアントがいません</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    bindCommon(renderDashboard);
    if (keepFocus) { const q = $('#filters input[name=q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  // ---------- クライアント一覧 ----------
  function renderClients(keepFocus) {
    const list = sortRows(applyFilters(rows()));
    const th = (key, label, cls = '') => `<th class="sortable ${cls}" data-sort="${key}">${label}${sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`;
    const body = list.map(({ c, a, f }) => `
      <tr data-go="${c.id}">
        <td><div class="company">${esc(c.company)}</div><div class="subline">${esc(c.firm)}</div></td>
        <td>${esc(c.rep)}<div class="subline">${c.repAge}歳・後継者 ${esc(c.successor)}</div></td>
        <td>${esc(c.industry)}</td>
        <td>${esc(c.staff)}</td>
        <td class="num">${num(c.sales)}</td>
        <td class="num">${num(c.opProfit)}</td>
        <td class="num">${num(c.cash)}</td>
        <td class="num">${num(c.debt)}</td>
        ${CATEGORIES.map((k) => `<td><span class="badge lv-${a[k.key].level}" data-tip="${esc(tipFor(c, k, a[k.key]))}">${a[k.key].level} ${a[k.key].score}</span></td>`).join('')}
        <td class="num"><b>${a.total}</b></td>
        <td class="num" data-tip="${esc(`<b>期待収益（万円）</b>一時 ${num(f.expOnce)}＋継続 年${num(f.expRecurring)}×5年`)}">${num(f.expTotal)}</td>
        <td><a class="btn small" href="#/edit/${c.id}" data-stop>編集</a></td>
      </tr>`).join('');

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>クライアント一覧</h1><p>${list.length}社表示（全${clients.length}社）。金額単位は万円。行をクリックすると詳細・提案メモを表示します。</p></div>
        <div style="display:flex;gap:8px"><button class="btn" id="exportCsv" type="button">CSV出力</button><a class="btn primary" href="#/new">＋ 追加</a></div>
      </div>
      ${filterBar()}
      <div class="card"><div class="table-wrap"><table>
        <thead><tr>
          ${th('company', '会社名')}${th('repAge', '代表者')}${th('industry', '業種')}${th('staff', '担当')}
          ${th('sales', '年商', 'num')}${th('opProfit', '営業利益', 'num')}${th('cash', '現預金', 'num')}${th('debt', '借入金', 'num')}
          ${CATEGORIES.map((k) => th(k.key, k.short)).join('')}${th('total', '総合', 'num')}${th('expected', '期待収益', 'num')}<th></th>
        </tr></thead>
        <tbody>${body || '<tr><td colspan="15" class="empty">条件に合うクライアントがいません</td></tr>'}</tbody>
      </table></div></div>`;

    $('#exportCsv').addEventListener('click', () => downloadCsv(list.map((r) => r.c)));
    bindCommon(renderClients);
    if (keepFocus) { const q = $('#filters input[name=q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function bindCommon(rerender) {
    bindFilters(rerender);
    document.querySelectorAll('[data-sort]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.getAttribute('data-sort');
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: ['company', 'firm', 'industry', 'staff'].includes(key) ? 1 : -1 };
      rerender(false);
    }));
    document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return;
      location.hash = '#/client/' + el.getAttribute('data-go');
    }));
  }

  // ---------- クライアント詳細 ----------
  function renderDetail(id) {
    const c = findClient(id);
    if (!c) { $('#view').innerHTML = '<div class="empty">クライアントが見つかりません。<a href="#/clients">一覧へ戻る</a></div>'; return; }
    const a = analyze(c);
    const f = clientFees(c, a, assumptions);

    const metricText = (k, r) => {
      const m = r.metrics;
      if (k === 'life') return [`事業保障の必要額 ${man(m.need)}`, `不足 ${man(m.gap)}`, `退職金目安 ${man(m.retireTarget)}`, `準備不足 ${man(m.retireGap)}`];
      if (k === 'nonlife') return [`未加入の重要補償 ${m.missingCount}件`];
      if (k === 'ma') return [`方向性：${m.type}`, `簡易企業価値 ${man(m.value)}`, `譲渡ニーズ ${m.sell}点`, `買収ニーズ ${m.buy}点`];
      if (k === 're') return m.budget ? [`取得予算の目安 ${man(m.budget)}`] : [];
      return [];
    };

    const cards = CATEGORIES.map((k) => {
      const r = a[k.key];
      return `
        <div class="card need-card ${k.key}">
          <div class="card-head"><h2>${k.label}</h2><span class="badge lv-${r.level}">ニーズ ${r.level}</span></div>
          <div class="score-line"><span class="score-big">${r.score}</span><div class="meter"><span style="width:${r.score}%;background:var(--cat-${k.key})"></span></div></div>
          <div>${metricText(k.key, r).map((t) => `<span class="metric">${esc(t)}</span>`).join('')}</div>
          <div class="label-sm">判定理由</div>
          <ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <div class="label-sm">想定手数料</div>
          <div class="subline">${f[k.key].once ? `一時 ${num(f[k.key].once)}万円` : ''}${f[k.key].once && f[k.key].recurring ? '・' : ''}${f[k.key].recurring ? `継続 年${num(f[k.key].recurring)}万円` : ''}${!f[k.key].once && !f[k.key].recurring ? '—' : ''}　成約確率 ${Math.round(f[k.key].prob * 100)}%<br>${esc(f[k.key].basis)}</div>
          ${r.proposals.length ? `<div class="label-sm">提案メニュー</div><ul>${r.proposals.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="label-sm">進捗</div>
          <select data-status="${k.key}">${STATUSES.map((s) => `<option ${c.status[k.key] === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>`;
    }).join('');

    const nl = NONLIFE_ITEMS.map((i) => `${i.label}${c.nonlife[i.key] ? '○' : '×'}`).join('　');

    $('#view').innerHTML = `
      <div class="page-head">
        <div><a href="#/dashboard">← ダッシュボード</a><h1 style="margin-top:6px">${esc(c.company)}</h1>
          <p>${esc(c.rep)}（${c.repAge}歳）・${esc(c.industry)}・引継ぎ元 ${esc(c.firm)}・担当 ${esc(c.staff)}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" type="button" onclick="window.print()">提案メモを印刷</button>
          <a class="btn" href="#/edit/${c.id}">編集</a>
          <button class="btn danger" type="button" id="delBtn">削除</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>会社プロフィール</h2><span class="sub">金額単位：万円　総合スコア <b>${a.total}</b></span></div>
        <dl class="profile">
          <div><dt>年商</dt><dd>${num(c.sales)}</dd></div>
          <div><dt>営業利益 / 経常利益</dt><dd>${num(c.opProfit)} / ${num(c.ordinaryProfit)}</dd></div>
          <div><dt>純資産</dt><dd>${num(c.netAssets)}</dd></div>
          <div><dt>現預金 / 借入金</dt><dd>${num(c.cash)} / ${num(c.debt)}</dd></div>
          <div><dt>従業員 / 車両</dt><dd>${num(c.employees)}名 / ${num(c.vehicles)}台</dd></div>
          <div><dt>役員報酬（月額）/ 在任</dt><dd>${num(c.execPayMonthly)} / ${num(c.tenureYears)}年</dd></div>
          <div><dt>後継者 / 拡大志向</dt><dd>${esc(c.successor)} / ${c.growth ? 'あり' : 'なし'}</dd></div>
          <div><dt>事務所</dt><dd>${esc(c.office)}${c.office === '賃貸' ? `（家賃 月${num(c.rentMonthly)}）` : ''}</dd></div>
          <div><dt>死亡保障 / 退職金準備</dt><dd>${num(c.deathCover)} / ${num(c.retireReserve)}</dd></div>
          <div><dt>顧問料（年額）</dt><dd>${num(c.advisoryFee)}</dd></div>
        </dl>
        ${c.finSource ? `<p class="subline">財務数値：${esc(c.finSource.file)}（${esc(c.finSource.date)} 取込）</p>` : ''}
        <p class="subline" style="margin-top:10px">損保加入状況：${esc(nl)}</p>
      </div>
      <div class="detail-grid" style="margin-top:16px">${cards}</div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>面談メモ</h2>
          <label class="subline">最終接触日 <input type="date" id="lastContact" value="${esc(c.lastContact)}" /></label></div>
        <textarea id="notes" placeholder="社長の関心事、家族構成、次回アポ予定など">${esc(c.notes)}</textarea>
        <div style="margin-top:8px"><button class="btn primary" type="button" id="saveNotes">メモを保存</button></div>
      </div>`;

    document.querySelectorAll('[data-status]').forEach((sel) => sel.addEventListener('change', () => {
      c.status[sel.getAttribute('data-status')] = sel.value;
      if (!c.lastContact) c.lastContact = today();
      c.notes = $('#notes').value; // 入力中のメモを失わない
      save();
      const y = window.scrollY;
      renderDetail(c.id);
      window.scrollTo(0, y);
      toast('進捗を更新しました');
    }));
    $('#saveNotes').addEventListener('click', () => {
      c.notes = $('#notes').value;
      c.lastContact = $('#lastContact').value;
      save();
      toast('メモを保存しました');
    });
    $('#delBtn').addEventListener('click', () => {
      if (!confirm(`${c.company} を削除しますか？`)) return;
      clients = clients.filter((x) => x.id !== c.id);
      save();
      location.hash = '#/clients';
    });
  }

  // ---------- 追加・編集フォーム ----------
  const FIELDS = [
    { sec: '基本情報', key: 'company', label: '会社名', type: 'text', req: true },
    { sec: '基本情報', key: 'rep', label: '代表者名', type: 'text' },
    { sec: '基本情報', key: 'repAge', label: '代表者年齢', type: 'number', unit: '歳' },
    { sec: '基本情報', key: 'industry', label: '業種', type: 'select', options: INDUSTRIES },
    { sec: '基本情報', key: 'firm', label: '引継ぎ元事務所', type: 'text', hint: 'M&Aで承継した事務所名' },
    { sec: '基本情報', key: 'staff', label: '担当者', type: 'text' },
    { sec: '基本情報', key: 'advisoryFee', label: '顧問料（年額・万円）', type: 'number', hint: '決算料込み。回収シミュレーションに使用' },
    { sec: '財務（万円）', key: 'sales', label: '年商', type: 'number' },
    { sec: '財務（万円）', key: 'opProfit', label: '営業利益', type: 'number' },
    { sec: '財務（万円）', key: 'ordinaryProfit', label: '経常利益', type: 'number' },
    { sec: '財務（万円）', key: 'netAssets', label: '純資産（時価目安）', type: 'number' },
    { sec: '財務（万円）', key: 'cash', label: '現預金', type: 'number' },
    { sec: '財務（万円）', key: 'debt', label: '借入金残高', type: 'number' },
    { sec: '財務（万円）', key: 'employees', label: '従業員数', type: 'number', unit: '名' },
    { sec: '社長・承継', key: 'execPayMonthly', label: '役員報酬（月額・万円）', type: 'number' },
    { sec: '社長・承継', key: 'tenureYears', label: '役員在任年数', type: 'number', unit: '年' },
    { sec: '社長・承継', key: 'successor', label: '後継者', type: 'select', options: ['あり', '候補あり', 'なし', '未定'] },
    { sec: '社長・承継', key: 'growth', label: '拡大志向（買収・新規出店等に意欲）', type: 'check' },
    { sec: '生命保険の加入状況（万円）', key: 'deathCover', label: '法人契約の死亡保障額', type: 'number' },
    { sec: '生命保険の加入状況（万円）', key: 'retireReserve', label: '退職金準備額（解約返戻金等）', type: 'number' },
    { sec: '損害保険の加入状況', key: 'vehicles', label: '保有車両数', type: 'number', unit: '台' },
    { sec: '不動産', key: 'office', label: '本社・事務所', type: 'select', options: ['賃貸', '自社所有'] },
    { sec: '不動産', key: 'rentMonthly', label: '月額家賃（万円）', type: 'number' },
  ];

  function blankClient() {
    return {
      id: 'c' + Date.now().toString(36), company: '', rep: '', repAge: 55, industry: '建設業', firm: '', staff: '',
      sales: 0, opProfit: 0, ordinaryProfit: 0, netAssets: 0, cash: 0, debt: 0, employees: 0,
      execPayMonthly: 0, tenureYears: 0, successor: '未定', growth: false, deathCover: 0, retireReserve: 0,
      nonlife: { liability: false, property: false, auto: false, workers: false, cyber: false },
      vehicles: 0, office: '賃貸', rentMonthly: 0, advisoryFee: 0,
      status: { life: '未着手', nonlife: '未着手', ma: '未着手', re: '未着手' }, notes: '', lastContact: '',
    };
  }

  function renderForm(id) {
    const existing = id ? findClient(id) : null;
    if (id && !existing) { $('#view').innerHTML = '<div class="empty">クライアントが見つかりません。</div>'; return; }
    const c = existing ? JSON.parse(JSON.stringify(existing)) : blankClient();
    const secs = [...new Set(FIELDS.map((f) => f.sec))];

    const fieldHtml = (f) => {
      const v = c[f.key];
      if (f.type === 'check') return `<div class="field"><label>&nbsp;</label><div class="checks"><label><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}/> ${f.label}</label></div></div>`;
      if (f.type === 'select') return `<div class="field"><label>${f.label}</label><select name="${f.key}">${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
      return `<div class="field"><label>${f.label}${f.unit ? `（${f.unit}）` : ''}${f.req ? ' *' : ''}</label><input type="${f.type}" name="${f.key}" value="${esc(v)}" ${f.req ? 'required' : ''} ${f.type === 'number' ? 'step="any"' : ''}/>${f.hint ? `<div class="hint">${f.hint}</div>` : ''}</div>`;
    };

    const sections = secs.map((s) => {
      let inner = `<div class="form-grid">${FIELDS.filter((f) => f.sec === s).map(fieldHtml).join('')}</div>`;
      if (s === '損害保険の加入状況') {
        inner = `<div class="checks" style="margin-bottom:12px">${NONLIFE_ITEMS.map((i) => `<label><input type="checkbox" name="nl_${i.key}" ${c.nonlife[i.key] ? 'checked' : ''}/> ${i.label}</label>`).join('')}</div>` + inner;
      }
      return `<fieldset class="card form-section"><div class="card-head"><h2>${s}</h2></div>${inner}</fieldset>`;
    }).join('');

    $('#view').innerHTML = `
      <div class="page-head"><div><h1>${existing ? 'クライアント編集' : 'クライアント追加'}</h1><p>決算書・申告書から転記してください。入力内容から各ニーズを自動判定します。</p></div></div>
      <form id="clientForm">${sections}
        <div style="margin-top:16px;display:flex;gap:8px"><button class="btn primary" type="submit">保存してニーズを判定</button><a class="btn" href="${existing ? '#/client/' + c.id : '#/clients'}">キャンセル</a></div>
      </form>`;

    $('#clientForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      FIELDS.forEach((f) => {
        if (f.type === 'check') c[f.key] = fd.has(f.key);
        else if (f.type === 'number') c[f.key] = Number(fd.get(f.key)) || 0;
        else c[f.key] = String(fd.get(f.key) || '').trim();
      });
      NONLIFE_ITEMS.forEach((i) => (c.nonlife[i.key] = fd.has('nl_' + i.key)));
      if (!c.company) { toast('会社名を入力してください'); e.target.company.focus(); return; }
      if (c.office !== '賃貸') c.rentMonthly = 0;
      if (existing) Object.assign(existing, c); else clients.push(c);
      save();
      toast('保存しました');
      location.hash = '#/client/' + c.id;
    });
  }

  // ---------- 提案パイプライン ----------
  let pipeCat = '';
  function renderPipeline(keepFocus) {
    const list = applyFilters(rows());
    const items = [];
    list.forEach(({ c, a }) => CATEGORIES.forEach((k) => {
      if (pipeCat && pipeCat !== k.key) return;
      const st = c.status[k.key];
      if (st === '未着手' && a[k.key].score < 40) return; // ニーズ低の未着手は表示しない
      items.push({ c, k, r: a[k.key], st });
    }));

    const cols = STATUSES.map((s) => {
      const its = items.filter((i) => i.st === s).sort((x, y) => y.r.score - x.r.score);
      return `<div class="col"><div class="col-head">${s}<span>${its.length}件</span></div>
        ${its.map(({ c, k, r }) => `
          <div class="kcard ${k.key}" data-go="${c.id}" data-tip="${esc(tipFor(c, k, r))}">
            <div class="t">${esc(c.company)}</div>
            <div class="m"><span>${k.label}</span><span class="badge lv-${r.level}">${r.level} ${r.score}</span></div>
            <select data-stop data-pid="${c.id}" data-pk="${k.key}" style="margin-top:6px;width:100%;padding:3px 6px;font-size:12px">
              ${STATUSES.map((x) => `<option ${x === s ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>`;
    }).join('');

    $('#view').innerHTML = `
      <div class="page-head"><div><h1>提案パイプライン</h1><p>ニーズ「中」以上の未着手案件と、着手済みの全案件を進捗別に表示します。</p></div>
        <select id="pipeCat"><option value="">商品：すべて</option>${CATEGORIES.map((k) => `<option value="${k.key}" ${pipeCat === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
      </div>
      ${filterBar()}
      <div class="kanban">${cols}</div>`;

    $('#pipeCat').addEventListener('change', (e) => { pipeCat = e.target.value; renderPipeline(false); });
    document.querySelectorAll('select[data-pid]').forEach((sel) => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => {
        const c = findClient(sel.getAttribute('data-pid'));
        c.status[sel.getAttribute('data-pk')] = sel.value;
        if (!c.lastContact) c.lastContact = today();
        save();
        toast('進捗を更新しました');
        renderPipeline(false);
      });
    });
    bindCommon(renderPipeline);
    if (keepFocus) { const q = $('#filters input[name=q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  // ---------- CSV ----------
  const CSV_COLS = [
    ...FIELDS.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    ...NONLIFE_ITEMS.map((i) => ({ key: 'nonlife.' + i.key, label: '加入_' + i.label, type: 'check' })),
    ...CATEGORIES.map((k) => ({ key: 'status.' + k.key, label: '進捗_' + k.label, type: 'text' })),
    { key: 'lastContact', label: '最終接触日', type: 'text' },
    { key: 'notes', label: 'メモ', type: 'text' },
    { key: 'id', label: 'ID', type: 'text' },
  ];
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => (x[k] = x[k] || {}), o)[last] = v; };
  const csvCell = (v, text) => {
    let s = String(v ?? '');
    if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excelでの数式実行を防ぐ
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function toCsv(list) {
    const head = CSV_COLS.map((c) => csvCell(c.label)).join(',');
    const body = list.map((cl) => CSV_COLS.map((col) => {
      const v = getPath(cl, col.key);
      return csvCell(col.type === 'check' ? (v ? '1' : '0') : v, col.type === 'text' || col.type === 'select');
    }).join(','));
    return [head, ...body].join('\r\n');
  }

  function download(name, text, type) {
    const blob = new Blob([type.includes('csv') ? '﻿' + text : text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const downloadCsv = (list) => download(`クライアント一覧_${today()}.csv`, toCsv(list), 'text/csv;charset=utf-8');

  function parseCsv(text) {
    const out = [];
    let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); out.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); out.push(row); }
    return out.filter((r) => r.some((x) => x.trim() !== ''));
  }

  function importCsv(text, mode) {
    const data = parseCsv(text);
    if (data.length < 2) throw new Error('データ行がありません');
    const head = data[0].map((h) => h.trim());
    const idx = CSV_COLS.map((col) => head.indexOf(col.label));
    if (idx[0] < 0) throw new Error('「会社名」列が見つかりません。テンプレートの見出しを使用してください');
    const cell = (r, key) => { const j = idx[CSV_COLS.findIndex((col) => col.key === key)]; return j >= 0 ? String(r[j] ?? '').trim() : ''; };
    const imported = data.slice(1).map((r, n) => {
      // 追加・上書きモードでは既存データを土台にし、CSVに無い列は既存値を残す
      const id = cell(r, 'id');
      const company = cell(r, 'company');
      const existing = mode === 'merge' ? clients.find((x) => (id && x.id === id) || (company && x.company === company)) : null;
      const c = existing ? JSON.parse(JSON.stringify(existing)) : blankClient();
      if (!existing) c.id = id || 'i' + Date.now().toString(36) + n;
      CSV_COLS.forEach((col, j) => {
        if (idx[j] < 0 || col.key === 'id') return;
        let raw = String(r[idx[j]] ?? '').trim();
        if (existing && raw === '') return; // 空欄は既存値を残す
        if (/^'[=+\-@]/.test(raw)) raw = raw.slice(1); // 出力時に付けた数式よけの記号を外す
        let v = raw;
        if (col.type === 'number') { const a = FI.parseAmount(raw.replace(/万円?$/, '')); v = a == null ? (existing ? getPath(existing, col.key) : 0) : a; }
        if (col.type === 'check') v = ['1', 'true', 'TRUE', '○', 'あり', '有'].includes(raw);
        if (col.key.startsWith('status.') && !STATUSES.includes(raw)) v = existing ? getPath(existing, col.key) : '未着手';
        setPath(c, col.key, v);
      });
      return { c, existing };
    }).filter(({ c }) => c.company);
    if (mode === 'replace') clients = normalizeAll(imported.map((x) => x.c));
    else {
      imported.forEach(({ c, existing }) => {
        const i = existing ? clients.indexOf(existing) : -1;
        if (i >= 0) clients[i] = c; else clients.push(c);
      });
      clients = normalizeAll(clients);
    }
    save();
    return imported.length;
  }

  // ---------- データ取込・出力 ----------
  function lastBackupText() {
    const d = store.get(BACKUP_KEY, null);
    return d ? d.slice(0, 10) : '未実施';
  }
  function backupBanner() {
    const saved = store.get(DIRTY_KEY, null);
    if (!saved) return '';
    const last = store.get(BACKUP_KEY, null);
    if (last && last >= saved) return '';
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (last && days < 7) return '';
    return `<div class="notice warn-box" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>⚠ ${last ? `最後のバックアップから${days}日経過しています。` : 'まだバックアップがありません。'}データはこのブラウザの中だけに保存されています。</span>
      <a class="btn small" href="#/settings">バックアップする</a></div>`;
  }

  function renderSettings() {
    $('#view').innerHTML = `
      <div class="page-head"><div><h1>データ取込・出力</h1><p>データはこのブラウザ内（localStorage）に保存されます。定期的にバックアップを出力してください。</p></div></div>
      <div class="card">
        <div class="card-head"><h2>CSVで取り込む</h2><span class="sub">引継ぎ元事務所の顧問先リストを一括登録</span></div>
        <p>テンプレートをダウンロードし、Excel等で入力してから取り込んでください（金額は万円、加入状況は 1/0）。同じ会社名・IDの行は上書きされます。</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn" id="tpl" type="button">テンプレートCSVをダウンロード</button>
          <input type="file" id="csvFile" accept=".csv,text/csv" />
          <select id="csvMode"><option value="merge">追加・上書き</option><option value="replace">全件入れ替え</option></select>
          <button class="btn primary" id="csvImport" type="button">取り込む</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>出力・バックアップ</h2><span class="sub">最終バックアップ：${lastBackupText()}</span></div>
        <p>バックアップには全クライアントと回収シミュレーションの前提条件が含まれます。別のパソコンへの移行もこのファイルで行えます。</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="csvOut" type="button">全件をCSV出力</button>
          <button class="btn primary" id="jsonOut" type="button">バックアップを保存（JSON）</button>
          <label class="btn">JSONから復元<input type="file" id="jsonIn" accept=".json,application/json" hidden /></label>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>初期化</h2></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="resetSample" type="button">サンプルデータに戻す</button>
          <button class="btn danger" id="clearAll" type="button">全データを削除</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>判定ロジックと留意事項</h2></div>
        <ul>
          <li><b>生命保険</b>：事業保障必要額（借入金＋年商15%−現預金×50%）と加入保障額の差、役員退職金目安（月額報酬×65歳時の在任年数×功績倍率3.0）と準備額の差、利益水準、相続納税資金。</li>
          <li><b>損害保険</b>：業種別の重要補償（賠償・財物休業・自動車・労災上乗せ・サイバー）の未加入割合、従業員数・車両台数。</li>
          <li><b>M&A・事業承継</b>：社長年齢×後継者の有無による譲渡・承継ニーズと、拡大志向×利益×現預金による買収ニーズの高い方。簡易企業価値は時価純資産＋営業利益×3年。</li>
          <li><b>不動産購入</b>：賃貸事務所の家賃水準（自社ビル）、月商3ヶ月超の余剰資金（収益不動産）、社長年齢×純資産（相続対策）、利益水準。</li>
        </ul>
        <p class="notice">本アプリのスコアは提案の優先順位付けのための目安です。保険募集は保険募集人登録、不動産の売買仲介は宅地建物取引業免許、M&A仲介は中小M&Aガイドラインに沿った体制が必要です。税理士としての守秘義務の観点から、クライアント情報を提携先へ共有する際は事前に本人同意を得てください。</p>
      </div>`;

    $('#tpl').addEventListener('click', () => download('クライアント取込テンプレート.csv', toCsv([Object.assign(blankClient(), { company: '（例）株式会社サンプル', rep: '見本 太郎', firm: '旧〇〇会計事務所', id: '' })]), 'text/csv;charset=utf-8'));
    $('#csvOut').addEventListener('click', () => downloadCsv(clients));
    $('#csvImport').addEventListener('click', () => {
      const f = $('#csvFile').files[0];
      if (!f) { toast('CSVファイルを選択してください'); return; }
      f.arrayBuffer().then((buf) => {
        try { const n = importCsv(FI.decode(buf).text, $('#csvMode').value); toast(`${n}社を取り込みました`); }
        catch (err) { alert('取り込みに失敗しました：' + err.message); }
      });
    });
    $('#jsonOut').addEventListener('click', () => {
      download(`crosssell_backup_${today()}.json`, JSON.stringify({ app: 'crosssell', version: 1, exportedAt: new Date().toISOString(), clients, assumptions }, null, 2), 'application/json');
      markBackup();
    });
    $('#jsonIn').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.arrayBuffer().then((buf) => {
        try {
          const data = JSON.parse(FI.decode(buf).text);
          const list = Array.isArray(data) ? data : data && Array.isArray(data.clients) ? data.clients : null;
          if (!list) throw new Error('形式が正しくありません');
          if (!confirm(`現在のデータを、バックアップの${list.length}社で置き換えますか？`)) return;
          clients = normalizeAll(list);
          if (data.assumptions) { assumptions = normalizeAssumptions(data.assumptions); saveAssumptions(); }
          save(); toast(`${clients.length}社を復元しました`);
        } catch (err) { alert('復元に失敗しました：' + err.message); }
        e.target.value = '';
      });
    });
    $('#resetSample').addEventListener('click', () => {
      if (!confirm('現在のデータを破棄してサンプルデータに戻しますか？')) return;
      clients = normalizeAll(JSON.parse(JSON.stringify(window.SAMPLE_CLIENTS))); save(); toast('サンプルデータに戻しました');
    });
    $('#clearAll').addEventListener('click', () => {
      if (!confirm('全クライアントを削除しますか？（元に戻せません）')) return;
      clients = []; save(); toast('全データを削除しました');
    });
  }

  // ---------- グラフ部品（SVG） ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
    return ticks;
  }
  const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };

  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  function drawFrame(el, H, yTicks, xs, xLabel) {
    const W = Math.max(320, el.clientWidth);
    const m = { l: 64, r: 70, t: 26, b: 30 };
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const y0 = yTicks[0], y1 = yTicks[yTicks.length - 1];
    const Y = (v) => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));
    yTicks.forEach((t) => {
      svg.appendChild(svgEl('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--text-2)' : 'var(--border)', 'stroke-width': t === 0 ? 1.5 : 1 }));
      const tx = svgEl('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
      tx.textContent = t.toLocaleString('ja-JP');
      svg.appendChild(tx);
    });
    const unit = svgEl('text', { x: m.l - 8, y: 11, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
    unit.textContent = '万円';
    svg.appendChild(unit);
    xs.forEach(({ x, label }) => {
      const tx = svgEl('text', { x, y: H - 10, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' });
      tx.textContent = label;
      svg.appendChild(tx);
    });
    el.innerHTML = '';
    el.appendChild(svg);
    return { svg, W, H, m, Y };
  }

  // 累計キャッシュフローの折れ線（買収価格を0年目にマイナス計上）
  function lineChart(el, sim, series) {
    const start = -sim.price - sim.integration;
    const pts = [{ year: 0 }, ...sim.rows].map((r) => {
      const o = { year: r.year };
      series.forEach((s) => (o[s.key] = r.year === 0 ? start : r[s.key]));
      return o;
    });
    const vals = pts.flatMap((p) => series.map((s) => p[s.key])).concat([0]);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const N = sim.rows.length;
    const W0 = Math.max(320, el.clientWidth);
    const X = (t) => 64 + (W0 - 64 - 70) * (t / N);
    const f = drawFrame(el, 280, ticks, pts.map((p) => ({ x: X(p.year), label: p.year === 0 ? '買収時' : `${p.year}年` })));
    series.forEach((s) => {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.year)},${f.Y(p[s.key])}`).join(' ');
      f.svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash || '' }));
      const last = pts[pts.length - 1];
      const lab = svgEl('text', { x: X(last.year) + 6, y: f.Y(last[s.key]) + 4, 'font-size': 11, fill: 'var(--text-2)' });
      lab.textContent = s.short;
      f.svg.appendChild(lab);
    });
    // 回収ポイント
    series.forEach((s) => {
      const pb = s.payback;
      if (pb == null) return;
      const cx = X(pb), cy = f.Y(0);
      f.svg.appendChild(svgEl('circle', { cx, cy, r: 5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    });
    // ホバー
    const guide = svgEl('line', { y1: f.m.t, y2: f.H - f.m.b, stroke: 'var(--text-2)', 'stroke-width': 1, visibility: 'hidden' });
    f.svg.appendChild(guide);
    const dots = series.map((s) => { const c = svgEl('circle', { r: 5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }); f.svg.appendChild(c); return c; });
    const hit = svgEl('rect', { x: f.m.l, y: 0, width: f.W - f.m.l - f.m.r, height: f.H, fill: 'transparent' });
    f.svg.appendChild(hit);
    hit.addEventListener('mousemove', (ev) => {
      const box = f.svg.getBoundingClientRect();
      const t = Math.max(0, Math.min(N, Math.round(((ev.clientX - box.left - 64) / (f.W - 64 - 70)) * N)));
      const p = pts[t];
      guide.setAttribute('x1', X(t)); guide.setAttribute('x2', X(t)); guide.setAttribute('visibility', 'visible');
      series.forEach((s, i) => { dots[i].setAttribute('cx', X(t)); dots[i].setAttribute('cy', f.Y(p[s.key])); dots[i].setAttribute('visibility', 'visible'); });
      showTip(`<b>${t === 0 ? '買収時' : t + '年目'}　累計収支</b>` + series.map((s) => `<div><span class="dot" style="background:${s.color}"></span> ${s.label}：${num(p[s.key])}万円</div>`).join(''), ev);
    });
    hit.addEventListener('mouseleave', () => { guide.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.style.display = 'none'; });
  }

  // 年度別収益の積み上げ棒
  function stackChart(el, sim, keys) {
    const totals = sim.rows.map((r) => keys.reduce((s, k) => s + Math.max(0, r[k.key]), 0));
    const ticks = niceTicks(0, Math.max(1, ...totals));
    const N = sim.rows.length;
    const W0 = Math.max(320, el.clientWidth);
    const slot = (W0 - 64 - 70) / N;
    const X = (i) => 64 + slot * i + slot / 2;
    const f = drawFrame(el, 260, ticks, sim.rows.map((r, i) => ({ x: X(i), label: `${r.year}年` })));
    const bw = Math.min(36, slot * 0.6);
    sim.rows.forEach((r, i) => {
      let acc = 0;
      const g = svgEl('g', {});
      keys.forEach((k, j) => {
        const v = Math.max(0, r[k.key]);
        if (v <= 0) return;
        const yTop = f.Y(acc + v), yBot = f.Y(acc);
        const h = Math.max(0, yBot - yTop - (acc > 0 ? 2 : 0));
        g.appendChild(svgEl('rect', { x: X(i) - bw / 2, y: yTop, width: bw, height: h, fill: k.color, rx: 0 }));
        acc += v;
      });
      f.svg.appendChild(g);
      const hit = svgEl('rect', { x: X(i) - slot / 2, y: f.m.t, width: slot, height: f.H - f.m.t - f.m.b, fill: 'transparent' });
      hit.addEventListener('mousemove', (ev) => showTip(`<b>${r.year}年目の収益（粗利ベース）</b>` + keys.map((k) => `<div><span class="dot" style="background:${k.color}"></span> ${k.label}：${num(r[k.key])}万円</div>`).join('') + `<div style="margin-top:4px">合計：<b>${num(totals[i])}万円</b></div>`, ev));
      hit.addEventListener('mouseleave', () => (tip.style.display = 'none'));
      f.svg.appendChild(hit);
    });
  }

  // ---------- 回収シミュレーション ----------
  let roiScope = '';
  function firmSetting(name, list) {
    const s = assumptions.firms[name] || {};
    const advisory = list.reduce((t, { c }) => t + (Number(c.advisoryFee) || 0), 0);
    return {
      price: s.price != null ? s.price : Math.round(advisory * 1.2),
      integrationCost: s.integrationCost != null ? s.integrationCost : 0,
    };
  }

  function renderROI() {
    const all = rows();
    const firms = uniq(clients.map((c) => c.firm));
    if (roiScope && !firms.includes(roiScope)) roiScope = '';
    const byFirm = firms.map((name) => {
      const list = all.filter(({ c }) => c.firm === name);
      const fs = firmSetting(name, list);
      return { name, list, fs, sim: simulate(list, fs, assumptions) };
    });
    const scopeList = roiScope ? all.filter(({ c }) => c.firm === roiScope) : all.filter(({ c }) => firms.includes(c.firm));
    const scopeFirm = roiScope ? byFirm.find((b) => b.name === roiScope).fs
      : byFirm.reduce((t, b) => ({ price: t.price + b.fs.price, integrationCost: t.integrationCost + b.fs.integrationCost }), { price: 0, integrationCost: 0 });
    const sim = simulate(scopeList, scopeFirm, assumptions);
    const yrs = (v) => (v == null ? `${assumptions.years}年で未回収` : `${v.toFixed(1)}年`);
    const shorten = sim.paybackBase != null && sim.paybackAll != null ? sim.paybackBase - sim.paybackAll : null;

    const A = assumptions;
    const inp = (key, label, unit, step = 1) => `<div class="field"><label>${label}</label><div style="display:flex;align-items:center;gap:6px"><input type="number" step="${step}" data-a="${key}" value="${esc(A[key])}" style="width:100%"/><span class="subline">${unit}</span></div></div>`;

    const firmRows = byFirm.map((b) => `
      <tr class="${roiScope === b.name ? 'sel' : ''}">
        <td><a href="#" data-scope="${esc(b.name)}" class="company">${esc(b.name)}</a><div class="subline">${b.list.length}社</div></td>
        <td class="num">${num(b.sim.advisory)}</td>
        <td class="num"><input type="number" data-firm="${esc(b.name)}" data-fk="price" value="${b.fs.price}" style="width:110px;text-align:right"/></td>
        <td class="num"><input type="number" data-firm="${esc(b.name)}" data-fk="integrationCost" value="${b.fs.integrationCost}" style="width:90px;text-align:right"/></td>
        <td class="num">${b.sim.advisory ? (b.fs.price / b.sim.advisory).toFixed(2) + '倍' : '—'}</td>
        <td class="num">${yrs(b.sim.paybackBase)}</td>
        <td class="num"><b>${yrs(b.sim.paybackAll)}</b></td>
      </tr>`).join('');

    const top = scopeList.slice().sort((x, y) => y.f.expTotal - x.f.expTotal).slice(0, 8).map(({ c, f }) => `
      <tr data-go="${c.id}"><td class="company">${esc(c.company)}</td>
        ${CATEGORIES.map((k) => `<td class="num">${num(f[k.key].expOnce + f[k.key].expRecurring * 5)}</td>`).join('')}
        <td class="num"><b>${num(f.expTotal)}</b></td></tr>`).join('');

    const yearRows = sim.rows.map((r) => `<tr><td>${r.year}年目</td><td class="num">${num(r.advisory)}</td><td class="num">${num(r.life)}</td><td class="num">${num(r.nonlife)}</td><td class="num">${num(r.ma)}</td><td class="num">${num(r.re)}</td><td class="num">${num(r.cumBase)}</td><td class="num"><b>${num(r.cumAll)}</b></td></tr>`).join('');

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>買収価格の回収シミュレーション</h1><p>承継した顧問料の粗利に、クロスセル手数料の期待値（成約確率込み）を加えて、買収価格を何年で回収できるかを試算します。単位：万円</p></div>
        <select id="roiScope"><option value="">全事務所の合計</option>${firms.map((f) => `<option value="${esc(f)}" ${f === roiScope ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      </div>
      <div class="grid grid-kpi">
        <div class="card kpi"><div class="kpi-label">買収価格＋統合コスト</div><div class="kpi-value">${num(sim.price + sim.integration)}<small>万円</small></div><div class="kpi-note">承継顧問料 年${num(sim.advisory)}万円</div></div>
        <div class="card kpi"><div class="kpi-label">回収年数：顧問料のみ</div><div class="kpi-value">${sim.paybackBase == null ? '未回収' : sim.paybackBase.toFixed(1) + '<small>年</small>'}</div><div class="kpi-note">粗利率${A.advisoryMargin}%・解約率${A.churn}%/年</div></div>
        <div class="card kpi"><div class="kpi-label">回収年数：＋クロスセル</div><div class="kpi-value">${sim.paybackAll == null ? '未回収' : sim.paybackAll.toFixed(1) + '<small>年</small>'}</div><div class="kpi-note">${shorten != null ? `${shorten.toFixed(1)}年短縮` : '　'}</div></div>
        <div class="card kpi"><div class="kpi-label">${A.years}年間のクロスセル収益</div><div class="kpi-value">${num(sim.crossTotal)}<small>万円</small></div><div class="kpi-note">顧問料粗利 ${num(sim.advisoryTotal)}万円</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><div class="card-head"><h2>累計収支の推移</h2>
          <div class="legend"><span class="item"><span class="sw" style="background:var(--muted)"></span>顧問料のみ</span><span class="item"><span class="sw" style="background:var(--accent)"></span>顧問料＋クロスセル</span><span class="item">● 回収時点</span></div></div>
          <div id="lineChart"></div></div>
        <div class="card"><div class="card-head"><h2>年度別の収益内訳</h2>
          <div class="legend"><span class="item"><span class="sw" style="background:var(--muted)"></span>顧問料粗利</span>${CATEGORIES.map((k) => `<span class="item"><span class="sw" style="background:var(--cat-${k.key})"></span>${k.short}</span>`).join('')}</div></div>
          <div id="stackChart"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>事務所別の前提と結果</h2><span class="sub">買収価格は未入力時「顧問料年額×1.2倍」を仮置き。事務所名をクリックすると個別表示</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>引継ぎ元事務所</th><th class="num">顧問料（年）</th><th class="num">買収価格</th><th class="num">統合コスト</th><th class="num">顧問料倍率</th><th class="num">回収：顧問料のみ</th><th class="num">回収：＋クロスセル</th></tr></thead>
          <tbody>${firmRows || '<tr><td colspan="7" class="empty">クライアントに引継ぎ元事務所が設定されていません</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><div class="card-head"><h2>収益貢献の大きいクライアント</h2><span class="sub">期待値（継続収益は5年分）</span></div>
          <div class="table-wrap"><table><thead><tr><th>クライアント</th>${CATEGORIES.map((k) => `<th class="num">${k.short}</th>`).join('')}<th class="num">合計</th></tr></thead><tbody>${top}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>前提条件</h2><button class="btn small" id="resetAssume" type="button">初期値に戻す</button></div>
          <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
            ${inp('years', '試算期間', '年')}${inp('churn', '顧問先の解約率', '%/年', 0.5)}${inp('advisoryMargin', '顧問料の粗利率', '%')}
            ${inp('probHigh', '成約確率：ニーズ高', '%')}${inp('probMid', '成約確率：ニーズ中', '%')}${inp('probLow', '成約確率：ニーズ低', '%')}${inp('probProposing', '成約確率：提案中', '%')}
            ${inp('lifeFirstRate', '生保 初年度手数料率', '%')}${inp('lifeRenewRate', '生保 次年度以降', '%/年', 0.5)}${inp('lifeTermRate', '定期保険料率（保障額比）', '%', 0.1)}
            ${inp('nlPremiumPerItem', '損保 1補償あたり保険料', '万円/年')}${inp('nlRate', '損保 代理店手数料率', '%')}
            ${inp('maShare', 'M&A 報酬の取り分', '%')}${inp('maMinFee', 'M&A 最低報酬', '万円')}${inp('reShare', '不動産 仲介手数料の取り分', '%')}
            ${inp('ramp1', '一時収益の実現 1年目', '%')}${inp('ramp2', '同 2年目', '%')}${inp('ramp3', '同 3年目', '%')}
          </div>
          <p class="notice" style="margin-top:12px">生保・損保の手数料は保険会社・商品・代理店の格付により大きく異なります。M&A報酬はレーマン方式（企業価値ベースの簡易計算）、不動産は宅建業法の上限（3%＋6万円）を基準に、提携先との配分を「取り分」で調整してください。</p>
        </div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>年度別の明細</h2><span class="sub">万円</span></div>
        <div class="table-wrap"><table><thead><tr><th>年度</th><th class="num">顧問料粗利</th><th class="num">生保</th><th class="num">損保</th><th class="num">M&A</th><th class="num">不動産</th><th class="num">累計：顧問料のみ</th><th class="num">累計：＋クロスセル</th></tr></thead><tbody>${yearRows}</tbody></table></div></div>`;

    lineChart($('#lineChart'), sim, [
      { key: 'cumBase', label: '顧問料のみ', short: '顧問料のみ', color: 'var(--muted)', dash: '6 4', payback: sim.paybackBase },
      { key: 'cumAll', label: '顧問料＋クロスセル', short: '＋クロスセル', color: 'var(--accent)', payback: sim.paybackAll },
    ]);
    stackChart($('#stackChart'), sim, [
      { key: 'advisory', label: '顧問料粗利', color: 'var(--muted)' },
      ...CATEGORIES.map((k) => ({ key: k.key === 're' ? 're' : k.key, label: k.label, color: `var(--cat-${k.key})` })),
    ]);

    $('#roiScope').addEventListener('change', (e) => { roiScope = e.target.value; renderROI(); });
    document.querySelectorAll('[data-scope]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); roiScope = a.getAttribute('data-scope'); renderROI(); }));
    document.querySelectorAll('[data-a]').forEach((el) => el.addEventListener('change', () => {
      assumptions = normalizeAssumptions(Object.assign({}, assumptions, { [el.getAttribute('data-a')]: el.value }));
      saveAssumptions(); renderROI();
    }));
    document.querySelectorAll('[data-firm]').forEach((el) => el.addEventListener('change', () => {
      const name = el.getAttribute('data-firm');
      assumptions.firms[name] = Object.assign({}, assumptions.firms[name], { [el.getAttribute('data-fk')]: Number(el.value) || 0 });
      saveAssumptions(); renderROI();
    }));
    $('#resetAssume').addEventListener('click', () => {
      if (!confirm('前提条件を初期値に戻しますか？（事務所別の買収価格は残ります）')) return;
      assumptions = normalizeAssumptions(Object.assign({}, DEFAULT_ASSUMPTIONS, { firms: assumptions.firms }));
      saveAssumptions(); renderROI();
    });
    document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => (location.hash = '#/client/' + el.getAttribute('data-go'))));
  }

  // ---------- 会計データ取込 ----------
  let finResults = [];
  function renderFinance() {
    finResults.forEach((r) => { if (r.target && r.target !== '__new' && !findClient(r.target)) r.target = ''; });
    const clientOpts = (sel) => `<option value="">（反映しない）</option><option value="__new" ${sel === '__new' ? 'selected' : ''}>＋ 新規クライアントとして追加</option>` +
      clients.slice().sort((a, b) => a.company.localeCompare(b.company, 'ja')).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.company)}</option>`).join('');

    const cards = finResults.map((r, i) => {
      const c = findClient(r.target);
      const fields = FI.toClientFields(r.found, r.unit, r.months);
      const keys = Object.keys(fields);
      const rowsHtml = keys.map((k) => {
        const cur = c ? c[k] : null;
        const changed = !c || Number(cur) !== fields[k];
        return `<tr><td><input type="checkbox" data-fi="${i}" data-fk="${k}" ${r.skip[k] ? '' : 'checked'}/></td>
          <td>${FI.FIELD_LABELS[k]}</td>
          <td class="num">${c ? num(cur) : '—'}</td>
          <td class="num" style="${changed ? 'font-weight:700' : ''}">${num(fields[k])}</td>
          <td class="subline">${esc(r.src[{ execPayMonthly: 'execPayAnnual', rentMonthly: 'rentAnnual', retireReserve: 'insuranceReserve' }[k] || k] || '')}</td></tr>`;
      }).join('');
      const officeHint = c && fields.rentMonthly > 0 && c.office !== '賃貸'
        ? `<label class="subline" style="display:block;margin-top:8px"><input type="checkbox" data-office="${i}" ${r.setRented ? 'checked' : ''}/> 地代家賃があるため、事務所区分を「賃貸」に変更する</label>` : '';
      return `
        <div class="card">
          <div class="card-head"><h2>${esc(r.file)}</h2><span class="sub">${r.encoding}・読取 ${r.itemCount}科目${r.amountHeader ? `・金額列「${esc(r.amountHeader)}」` : ''}</span></div>
          <div class="filters" style="margin-bottom:10px">
            <label class="subline">反映先 <select data-target="${i}">${clientOpts(r.target)}</select></label>
            <label class="subline">金額の単位 <select data-unit="${i}">
              ${[['yen', '円'], ['thousand', '千円'], ['man', '万円']].map(([v, l]) => `<option value="${v}" ${r.unit === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="subline">対象月数 <input type="number" min="1" max="12" data-months="${i}" value="${r.months}" style="width:70px"/>（期中の試算表は年換算）</label>
          </div>
          ${keys.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>項目</th><th class="num">現在値</th><th class="num">取込値（万円）</th><th>元の勘定科目</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : '<p class="notice">対応する勘定科目が見つかりませんでした。試算表または決算書（BS・PL）のCSVか確認してください。</p>'}
          ${officeHint}
        </div>`;
    }).join('');

    $('#view').innerHTML = `
      <div class="page-head"><div><h1>会計データ取込</h1><p>会計ソフトから出力した試算表・決算書のCSVを読み込み、財務数値を自動でクライアントに反映します。</p></div></div>
      <div class="card">
        <div class="card-head"><h2>ファイルを選択</h2><span class="sub">複数ファイル可・Shift_JIS／UTF-8 自動判別</span></div>
        <p>弥生会計・freee・マネーフォワード・勘定奉行・JDL などの<b>残高試算表</b>または<b>決算書（貸借対照表・損益計算書）</b>のCSVに対応します。勘定科目名で判定するため、BSとPLが別ファイルでもそれぞれ取り込めます。ファイル名に会社名が含まれていれば反映先を自動で選びます。</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="file" id="finFiles" accept=".csv,.txt,.tsv,text/csv" multiple />
          <button class="btn" type="button" id="finSample">サンプル試算表CSVをダウンロード</button>
        </div>
        <p class="subline" style="margin-top:10px">読み取る科目：売上高（完成工事高・医業収益等）、営業利益、経常利益、純資産合計、現金及び預金、借入金（短期・長期・1年以内返済）、役員報酬、地代家賃、保険積立金。△・▲表記のマイナスにも対応。</p>
      </div>
      ${cards}
      ${finResults.length ? `<div style="margin-top:16px;display:flex;gap:8px"><button class="btn primary" type="button" id="finApply">チェックした項目を反映</button><button class="btn" type="button" id="finClear">クリア</button></div>` : ''}`;

    $('#finFiles').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      for (const file of files) {
        let text, encoding;
        try { ({ text, encoding } = FI.decode(await file.arrayBuffer())); }
        catch (err) { console.error(err); toast(`${file.name} を読み込めませんでした`); continue; }
        const res = FI.analyzeText(text);
        finResults.push({ file: file.name, encoding, ...res, unit: FI.guessUnit(res.found), months: 12, target: FI.matchClient(file.name, clients), skip: {}, setRented: true });
      }
      renderFinance();
    });
    $('#finSample').addEventListener('click', () => {
      const csv = ['勘定科目,前期末残高,借方金額,貸方金額,期末残高', '現金,0,0,0,"1,250,300"', '普通預金,0,0,0,"176,800,000"', '定期預金,0,0,0,"12,000,000"',
        '保険積立金,0,0,0,"8,400,000"', '短期借入金,0,0,0,"20,000,000"', '長期借入金,0,0,0,"38,500,000"', '1年以内返済長期借入金,0,0,0,"9,600,000"',
        '純資産合計,0,0,0,"221,400,000"', '完成工事高,0,0,0,"534,000,000"', '完成工事総利益,0,0,0,"96,120,000"', '役員報酬,0,0,0,"19,200,000"',
        '地代家賃,0,0,0,"10,800,000"', '販売費及び一般管理費合計,0,0,0,"51,300,000"', '営業利益,0,0,0,"44,820,000"', '経常利益,0,0,0,"45,960,000"'].join('\r\n');
      download('山田建設_残高試算表_サンプル.csv', csv, 'text/csv;charset=utf-8');
    });
    document.querySelectorAll('[data-target]').forEach((el) => el.addEventListener('change', () => { finResults[+el.getAttribute('data-target')].target = el.value; renderFinance(); }));
    document.querySelectorAll('[data-unit]').forEach((el) => el.addEventListener('change', () => { finResults[+el.getAttribute('data-unit')].unit = el.value; renderFinance(); }));
    document.querySelectorAll('[data-months]').forEach((el) => el.addEventListener('change', () => { finResults[+el.getAttribute('data-months')].months = Number(el.value) || 12; renderFinance(); }));
    document.querySelectorAll('[data-fi]').forEach((el) => el.addEventListener('change', () => { finResults[+el.getAttribute('data-fi')].skip[el.getAttribute('data-fk')] = !el.checked; }));
    document.querySelectorAll('[data-office]').forEach((el) => el.addEventListener('change', () => { finResults[+el.getAttribute('data-office')].setRented = el.checked; }));
    if ($('#finClear')) $('#finClear').addEventListener('click', () => { finResults = []; renderFinance(); });
    if ($('#finApply')) $('#finApply').addEventListener('click', () => {
      let applied = 0;
      finResults.forEach((r) => {
        if (!r.target) return;
        let c = findClient(r.target);
        if (r.target !== '__new' && !c) return;
        if (r.target === '__new') {
          c = blankClient();
          c.company = r.file.replace(/\.[^.]+$/, '').replace(/[_\-\s].*$/, '') || '新規クライアント';
          clients.push(c);
          r.target = c.id;
        }
        const fields = FI.toClientFields(r.found, r.unit, r.months);
        Object.keys(fields).forEach((k) => { if (!r.skip[k]) c[k] = fields[k]; });
        if (fields.rentMonthly > 0 && c.office !== '賃貸' && r.setRented) c.office = '賃貸';
        c.finSource = { file: r.file, date: today() };
        applied++;
      });
      save();
      if (!applied) { toast('反映先が選択されていません'); return; }
      toast(`${applied}件を反映しました。ニーズ判定を再計算しました`);
      finResults = [];
      renderFinance();
    });
  }


  // ---------- 操作ガイド ----------
  function renderHelp() {
    $('#view').innerHTML = `
      <div class="page-head"><div><h1>操作ガイド</h1><p>承継した顧問先へのクロスセル提案を、データ登録から回収管理まで進める手順です。</p></div>
        <button class="btn" type="button" onclick="window.print()">印刷</button></div>
      <div class="card help">
        <h2>基本の流れ</h2>
        <ol>
          <li><b>顧問先を登録する</b>（<a href="#/settings">データ取込・出力</a>）<br>テンプレートCSVをダウンロードし、引継ぎ元事務所の顧問先リストを貼り付けて取り込みます。会社名・代表者・年齢・業種・引継ぎ元・担当・顧問料が最低限あれば始められます。</li>
          <li><b>財務数値を入れる</b>（<a href="#/finance">会計データ取込</a>）<br>会計ソフトから残高試算表（または決算書BS・PL）をCSVで出力し、まとめて選択します。ファイル名に会社名を入れておくと反映先が自動で選ばれます。確認画面で取込値を見て「反映」を押します。</li>
          <li><b>保険・事務所の状況を補う</b>（各クライアントの「編集」）<br>死亡保障額、損保の加入状況、後継者の有無、拡大志向、車両台数など、決算書に出ない情報を面談で確認して入力します。判定の精度が上がります。</li>
          <li><b>優先順位を決める</b>（<a href="#/dashboard">ダッシュボード</a>）<br>「優先アクションTOP10」とニーズ・マトリクスで、どの社長に何を提案するかを決めます。セルにマウスを乗せると判定理由が出ます。</li>
          <li><b>提案して進捗を記録する</b>（クライアント詳細・<a href="#/pipeline">提案パイプライン</a>）<br>詳細画面の判定理由・提案メニューを面談メモとして印刷できます。進捗（提案準備→提案中→成約／見送り）を更新します。</li>
          <li><b>買収の採算を確認する</b>（<a href="#/roi">回収シミュレーション</a>）<br>事務所ごとの買収価格を入力し、顧問料だけの場合とクロスセル込みの場合の回収年数を比較します。手数料率・成約確率は実績に合わせて調整してください。</li>
          <li><b>バックアップする</b>（<a href="#/settings">データ取込・出力</a>）<br>データはこのパソコンのこのブラウザの中にだけ保存されます。週1回はバックアップを保存してください。</li>
        </ol>
      </div>
      <div class="card help">
        <h2>ニーズ判定の考え方</h2>
        <table>
          <thead><tr><th>商品</th><th>主な判定材料</th><th>代表的な提案</th></tr></thead>
          <tbody>
            <tr><td>生命保険</td><td>借入金・固定費に対する保障不足、役員退職金の準備不足、利益水準、社長年齢と純資産</td><td>定期・収入保障保険、退職金原資の積立、納税資金の終身保険</td></tr>
            <tr><td>損害保険</td><td>業種ごとの重要補償の未加入、従業員数、車両台数</td><td>請負賠償・工事保険（建設）、PL（製造）、柔整師賠償（整骨院）、サイバー（IT・医療）</td></tr>
            <tr><td>M&A・事業承継</td><td>社長年齢×後継者の有無（譲渡）、拡大志向×利益×現預金（買収）</td><td>出口戦略の整理、株価算定、事業承継税制、買収候補のマッチング</td></tr>
            <tr><td>不動産購入</td><td>家賃水準、月商3ヶ月超の余剰資金、社長年齢×純資産、利益水準</td><td>自社ビル購入、収益不動産、個人資産の組換え</td></tr>
          </tbody>
        </table>
        <p class="subline">スコア：70点以上＝高、40〜69点＝中、39点以下＝低。判定ルールは <code>scoring.js</code> で調整できます。</p>
      </div>
      <div class="card help">
        <h2>よくある質問</h2>
        <dl>
          <dt>別のパソコンでも使いたい</dt><dd>元のパソコンで「バックアップを保存」し、移行先で「バックアップから復元」してください。</dd>
          <dt>試算表の取込で数字が1万倍・千分の一になる</dt><dd>確認画面の「金額の単位」を円／千円／万円から正しいものに変更してください。</dd>
          <dt>期中（例：6ヶ月）の試算表を取り込みたい</dt><dd>「対象月数」に6と入れると、売上・利益・役員報酬・家賃を年額に換算します（BSの残高はそのまま）。</dd>
          <dt>PDFの決算書は読めますか</dt><dd>読めません。会計ソフトからCSVで出力してください。</dd>
        </dl>
      </div>
      <div class="card help">
        <h2>コンプライアンス上の注意</h2>
        <ul>
          <li>保険募集には保険募集人登録、不動産の売買仲介には宅地建物取引業免許が必要です。登録・免許のない立場では紹介に留め、紹介料の受領条件を確認してください。</li>
          <li>M&A支援は中小M&Aガイドラインに沿った体制（利益相反の説明、手数料体系の開示など）で行ってください。</li>
          <li>クライアント情報を提携先（保険会社・不動産会社・M&A会社）に共有する際は、守秘義務の観点から事前に本人の同意を得てください。</li>
          <li>スコアと試算値は提案の優先順位付けの目安です。個別の提案内容は専門家が確認してください。</li>
        </ul>
      </div>`;
  }

  // ---------- ルーティング ----------
  function route() {
    const [, name = 'dashboard', id] = (location.hash || '#/dashboard').split('/');
    tip.style.display = 'none';
    document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-route') === name || (name === 'client' && a.getAttribute('data-route') === 'clients')));
    if (name === 'clients') renderClients();
    else if (name === 'client') renderDetail(id);
    else if (name === 'edit') renderForm(id);
    else if (name === 'new') renderForm(null);
    else if (name === 'pipeline') renderPipeline();
    else if (name === 'settings') renderSettings();
    else if (name === 'roi') renderROI();
    else if (name === 'finance') renderFinance();
    else if (name === 'help') renderHelp();
    else renderDashboard();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
