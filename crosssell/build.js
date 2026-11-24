#!/usr/bin/env node
/*
 * 配布用の1ファイル版を作成する。
 *   node crosssell/build.js
 * → crosssell/dist/crosssell-navi.html（CSS・JSをすべて埋め込み。メール添付や共有フォルダでそのまま配布可能）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g, (m, href) => {
  const css = fs.readFileSync(path.join(dir, href), 'utf8');
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  // </script> を含む文字列で埋め込みが壊れないようにエスケープ
  const js = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n/* ${src} */\n${js}\n</script>`;
});

const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('<head>', `<head>\n  <!-- クロスセル・ナビ 配布版（${stamp} ビルド） -->`);

fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
const out = path.join(dir, 'dist', 'crosssell-navi.html');
fs.writeFileSync(out, html);
console.log(`built ${path.relative(process.cwd(), out)} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
