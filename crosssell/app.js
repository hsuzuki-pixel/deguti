(function () {
  'use strict';

  const { CATEGORIES, STATUSES, INDUSTRIES, NONLIFE_ITEMS, analyze, man } = window.Scoring;
  const STORE_KEY = 'crosssell.clients.v1';
  const THEME_KEY = 'crosssell.theme';
  const FILTER_KEY = 'crosssell.filters';

  // ---------- 永続化 ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存不可の環境でも動作は継続 */ }
    },
  };

  let clients = store.get(STORE_KEY, null) || JSON.parse(JSON.stringify(window.SAMPLE_CLIENTS));
  const save = () => store.set(STORE_KEY, clients);
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
    return clients.map((c) => ({ c, a: analyze(c) }));
  }

  function applyFilters(list) {
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
    const get = ({ c, a }) => {
      if (sort.key === 'total') return a.total;
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
    const opt = (list, val, label) => `<option value="">${label}</option>` + list.map((v) => `<option ${v === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
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
    box.addEventListener('input', (e) => {
      if (!e.target.name) return;
      filters[e.target.name] = e.target.value;
      store.set(FILTER_KEY, filters);
      rerender(e.target.name === 'q');
    });
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
  function renderDashboard(keepFocus) {
    const all = rows();
    const list = sortRows(applyFilters(all));
    const view = $('#view');

    const count = (key, lv) => list.filter(({ a }) => a[key].level === lv).length;
    const active = list.reduce((s, { c }) => s + CATEGORIES.filter((k) => ['提案準備', '提案中'].includes(c.status[k.key])).length, 0);
    const won = list.reduce((s, { c }) => s + CATEGORIES.filter((k) => c.status[k.key] === '成約').length, 0);
    const maValue = list.filter(({ a }) => a.ma.level === '高').reduce((s, { a }) => s + a.ma.metrics.value, 0);

    const kpis = `
      <div class="grid grid-kpi">
        <div class="card kpi"><div class="kpi-label">対象クライアント</div><div class="kpi-value">${list.length}<small>社</small></div><div class="kpi-note">全${clients.length}社中</div></div>
        ${CATEGORIES.map((k) => `
          <div class="card kpi"><div class="kpi-label"><span class="dot ${k.key}"></span>${k.label}：高ニーズ</div>
          <div class="kpi-value">${count(k.key, '高')}<small>社</small></div>
          <div class="kpi-note">中ニーズ ${count(k.key, '中')}社</div></div>`).join('')}
        <div class="card kpi"><div class="kpi-label">進行中 / 成約</div><div class="kpi-value">${active}<small>件</small> / ${won}<small>件</small></div><div class="kpi-note">提案準備＋提案中 / 成約</div></div>
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
    const body = list.map(({ c, a }) => `
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
          ${CATEGORIES.map((k) => th(k.key, k.short)).join('')}${th('total', '総合', 'num')}<th></th>
        </tr></thead>
        <tbody>${body || '<tr><td colspan="14" class="empty">条件に合うクライアントがいません</td></tr>'}</tbody>
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
        </dl>
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
      save();
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
      vehicles: 0, office: '賃貸', rentMonthly: 0,
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
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  function toCsv(list) {
    const head = CSV_COLS.map((c) => csvCell(c.label)).join(',');
    const body = list.map((cl) => CSV_COLS.map((col) => {
      const v = getPath(cl, col.key);
      return csvCell(col.type === 'check' ? (v ? '1' : '0') : v);
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
    const imported = data.slice(1).map((r, n) => {
      const c = blankClient();
      c.id = 'i' + Date.now().toString(36) + n;
      CSV_COLS.forEach((col, j) => {
        if (idx[j] < 0) return;
        const raw = (r[idx[j]] ?? '').trim();
        let v = raw;
        if (col.type === 'number') v = Number(raw.replace(/,/g, '')) || 0;
        if (col.type === 'check') v = ['1', 'true', 'TRUE', '○', 'あり', '有'].includes(raw);
        if (col.key === 'id' && !raw) return;
        if (col.key.startsWith('status.') && !STATUSES.includes(raw)) v = '未着手';
        setPath(c, col.key, v);
      });
      return c;
    }).filter((c) => c.company);
    if (mode === 'replace') clients = imported;
    else {
      imported.forEach((c) => {
        const i = clients.findIndex((x) => x.id === c.id || x.company === c.company);
        if (i >= 0) clients[i] = c; else clients.push(c);
      });
    }
    save();
    return imported.length;
  }

  // ---------- データ取込・出力 ----------
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
        <div class="card-head"><h2>出力・バックアップ</h2></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="csvOut" type="button">全件をCSV出力</button>
          <button class="btn" id="jsonOut" type="button">JSONバックアップ</button>
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
      const reader = new FileReader();
      reader.onload = () => {
        try { const n = importCsv(reader.result, $('#csvMode').value); toast(`${n}社を取り込みました`); }
        catch (err) { alert('取り込みに失敗しました：' + err.message); }
      };
      reader.readAsText(f, 'utf-8');
    });
    $('#jsonOut').addEventListener('click', () => download(`crosssell_backup_${today()}.json`, JSON.stringify(clients, null, 2), 'application/json'));
    $('#jsonIn').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error('形式が正しくありません');
          clients = data; save(); toast(`${data.length}社を復元しました`);
        } catch (err) { alert('復元に失敗しました：' + err.message); }
      };
      reader.readAsText(f, 'utf-8');
    });
    $('#resetSample').addEventListener('click', () => {
      if (!confirm('現在のデータを破棄してサンプルデータに戻しますか？')) return;
      clients = JSON.parse(JSON.stringify(window.SAMPLE_CLIENTS)); save(); toast('サンプルデータに戻しました');
    });
    $('#clearAll').addEventListener('click', () => {
      if (!confirm('全クライアントを削除しますか？（元に戻せません）')) return;
      clients = []; save(); toast('全データを削除しました');
    });
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
    else renderDashboard();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
