#!/usr/bin/env node
// インタビュー秘書のレポートを、写真入りの1枚画像（JPEG）とPDFにする。
// 使い方: node render_report.js <session.json> <写真フォルダ> <出力フォルダ>
//   session.json : interviews/<owner> の sessions.<sid> の中身（qa, report, photos など）
//   写真フォルダ : 写真の asset id で始まるファイル（例: <id>.jpg）を置いたフォルダ
//   出力         : <出力フォルダ>/report.jpg と report.pdf
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [, , sessionPath, photoDir, outDir] = process.argv;
if (!sessionPath || !outDir) {
  console.error("usage: node render_report.js <session.json> <photoDir> <outDir>");
  process.exit(1);
}
const s = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
const r = s.report || {};
const TYPE = { komon: "顧問先", consul: "コンサル先", seminar: "セミナー受講生" }[s.type] || "";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 写真を data URI に
const files = photoDir && fs.existsSync(photoDir) ? fs.readdirSync(photoDir) : [];
const photos = (s.photos || []).map((p) => {
  const f = files.find((n) => n.startsWith(p.id));
  if (!f) return null;
  const ext = path.extname(f).slice(1).toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(path.join(photoDir, f)).toString("base64")}`;
}).filter(Boolean);
const [hero, side, ...rest] = photos;

const list = (a) => (a && a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="none">なし</p>`);
const date = new Date(s.finishedAt || s.startedAt || Date.now()).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" });

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Zen+Old+Mincho:wght@600;700&display=swap">
<style>
:root{--ink:#1b2a27;--muted:#5b6c68;--line:#d6dfdc;--accent:#1f5c52;--soft:#e2eeeb;--gold:#9a6d22;--gold-soft:#f6ecd9;
  --body:"Zen Kaku Gothic New","IPAPGothic","IPAGothic",sans-serif;--display:"Zen Old Mincho","IPAPGothic",serif}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.8}
.page{width:1080px;margin:0 auto;padding:0 0 40px}
.top{background:var(--accent);color:#fff;padding:22px 48px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.top .brand small{display:block;font-size:12px;letter-spacing:.16em;opacity:.85}
.top .brand b{font-family:var(--display);font-size:24px;letter-spacing:.06em}
.top .meta{text-align:right;font-size:13px;opacity:.92;line-height:1.6}
.who{padding:22px 48px 0}
.who .t{font-size:12px;letter-spacing:.14em;color:var(--muted)}
.who h1{font-family:var(--display);font-size:30px;margin:2px 0 0;line-height:1.4}
.who h1 span{font-size:20px}
.hero{margin:18px 48px 0;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--soft)}
.hero img,.side img,.gal img{width:100%;height:100%;object-fit:cover;display:block}
.catch{margin:24px 48px 0;font-family:var(--display);font-size:28px;line-height:1.5;border-left:5px solid var(--gold);padding-left:16px}
.voice{margin:22px 48px 0;display:grid;grid-template-columns:${side ? "1fr 36%" : "1fr"};gap:24px;align-items:start}
.voice p{margin:0;font-size:16.5px;line-height:2;white-space:pre-wrap}
.side{aspect-ratio:4/5;border-radius:10px;overflow:hidden;background:var(--soft)}
.lbl{display:block;font-size:12px;letter-spacing:.14em;color:var(--muted);margin-bottom:4px}
.gal{margin:20px 48px 0;display:grid;grid-template-columns:repeat(${Math.min(rest.length, 3) || 1},1fr);gap:10px}
.gal figure{margin:0;aspect-ratio:4/3;border-radius:8px;overflow:hidden;background:var(--soft)}
.ba{margin:26px 48px 0;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ba div{border:1px solid var(--line);border-radius:10px;padding:14px 18px}
.ba div:last-child{border-color:var(--accent);background:var(--soft)}
.grid{margin:22px 48px 0;display:grid;grid-template-columns:1fr 1fr;gap:18px 28px}
ul{margin:0;padding-left:1.2em} .none{margin:0;color:var(--muted)}
.quotes p{margin:0 0 6px;border-left:3px solid var(--gold);padding-left:12px;font-family:var(--display);font-size:17px}
.chips{margin:22px 48px 0;display:flex;gap:10px;flex-wrap:wrap}
.chip{border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:2px 14px;font-size:13.5px;font-weight:500}
.chip.g{border-color:var(--gold);color:var(--gold);background:var(--gold-soft)}
.foot{margin:30px 48px 0;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);display:flex;justify-content:space-between}
</style></head><body><div class="page">
  <div class="top"><div class="brand"><small>税理士法人アクセス</small><b>インタビューレポート</b></div>
    <div class="meta">${esc(TYPE)}インタビュー<br>${esc(date)}</div></div>
  <div class="who"><div class="t">${esc([s.industry, s.theme].filter(Boolean).join("／"))}</div>
    <h1>${esc(s.company || "")} <span>${esc(s.name ? s.name + " 様" : "")}</span></h1></div>
  ${hero ? `<figure class="hero"><img src="${hero}"></figure>` : ""}
  ${r.headline ? `<div class="catch">${esc(r.headline)}</div>` : ""}
  <div class="voice"><div><span class="lbl">お客様の声</span><p>${esc(r.testimonial)}</p></div>${side ? `<figure class="side"><img src="${side}"></figure>` : ""}</div>
  ${rest.length ? `<div class="gal">${rest.map((p) => `<figure><img src="${p}"></figure>`).join("")}</div>` : ""}
  <div class="ba"><div><span class="lbl">BEFORE</span>${esc(r.before) || '<span class="none">なし</span>'}</div><div><span class="lbl">AFTER</span>${esc(r.after) || '<span class="none">なし</span>'}</div></div>
  <div class="grid">
    <div><span class="lbl">数字で語られた成果</span>${list(r.numbers)}</div>
    <div class="quotes"><span class="lbl">印象的な言葉</span>${(r.quotes || []).length ? r.quotes.map((q) => `<p>「${esc(q)}」</p>`).join("") : '<p class="none" style="border:0;padding:0;font-family:var(--body);font-size:15px">なし</p>'}</div>
    <div><span class="lbl">評価された点</span>${list(r.good)}</div>
    <div><span class="lbl">ご要望・改善点</span>${list(r.issues)}</div>
  </div>
  <div class="chips"><span class="chip">満足度 ${esc(r.satisfaction ?? "-")} / 10</span><span class="chip g">掲載：${esc(r.publish || "未確認")}</span>${photos.length ? `<span class="chip">写真 ${photos.length}枚</span>` : ""}</div>
  <div class="foot"><span>お客様の声は掲載前に必ずご本人の確認をとってください</span><span>税理士法人アクセス インタビュー秘書</span></div>
</div></body></html>`;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const scale of [2, 1.5, 1]) {
      const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: scale });
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const jpg = path.join(outDir, "report.jpg");
      await page.screenshot({ path: jpg, fullPage: true, type: "jpeg", quality: 85 });
      if (scale === 2 || !fs.existsSync(path.join(outDir, "report.pdf"))) {
        await page.pdf({ path: path.join(outDir, "report.pdf"), width: "1080px", height: `${await page.evaluate(() => document.documentElement.scrollHeight + 2)}px`, printBackground: true, pageRanges: "1" });
      }
      await page.close();
      if (fs.statSync(jpg).size < 4.8e6) break; // Chatwork の上限(5MB)に収める
    }
  } finally {
    await browser.close();
  }
  for (const f of ["report.jpg", "report.pdf"]) {
    const p = path.join(outDir, f);
    console.log(`${p}\t${(fs.statSync(p).size / 1024).toFixed(0)}KB`);
  }
})();
