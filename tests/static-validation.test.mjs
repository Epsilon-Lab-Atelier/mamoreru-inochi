import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('service worker and manifest use GitHub Pages-safe relative paths', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.scope, './');
  assert.ok(manifest.start_url.startsWith('./'));
  assert.ok(manifest.screenshots.some((item) => item.form_factor === 'narrow'));
  assert.ok(manifest.screenshots.some((item) => item.form_factor === 'wide'));
  const worker = read('service-worker.js');
  assert.match(worker, /self\.registration\.scope/);
  assert.match(worker, /src\/share\.js/);
  assert.match(worker, /src\/map\.js/);
  assert.match(worker, /src\/drills\.js/);
  assert.match(worker, /vendor\/qrcode\.js/);
});

test('runtime HTML has no remote script or stylesheet dependencies', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i);
  assert.match(html, /vendor\/qrcode\.js/);
});

test('OGP metadata uses an absolute 1200x630 preview image and concise description', () => {
  const html = read('index.html');
  assert.match(html, /og:image" content="https:\/\/epsilon-lab-atelier\.github\.io\/mamoreru-inochi\/assets\/og-image\.png\?v=0\.3\.0/);
  assert.match(html, /og:image:width" content="1200"/);
  assert.match(html, /og:image:height" content="630"/);
  assert.match(html, /生活環境に合わせて、災害リスク・備蓄・緊急時の行動を確認できる無料の防災アプリです。/);
});

test('public URLs point to Epsilon-Lab-Atelier', () => {
  const expectedRepository = 'https://github.com/Epsilon-Lab-Atelier/mamoreru-inochi';
  const expectedPages = 'https://epsilon-lab-atelier.github.io/mamoreru-inochi/';
  assert.ok(read('src/app.js').includes(expectedRepository));
  assert.ok(read('README.md').includes(expectedPages));
  assert.ok(read('sitemap.xml').includes(expectedPages));
  assert.ok(read('robots.txt').includes(`${expectedPages}sitemap.xml`));
});

test('font-size and detailed accessibility settings apply without an obstructive toast', () => {
  const html = read('index.html');
  const app = read('src/app.js');
  assert.match(html, /id="font-size-panel"/);
  assert.match(html, /文字サイズ: 100%/);
  assert.match(app, /document\.documentElement\.style\.setProperty\('--font-scale'/);
  assert.match(app, /--content-line-height/);
  assert.match(app, /easyJapanese/);
  assert.match(app, /largeTargets/);
  assert.doesNotMatch(app, /文字サイズを[^。\n]{0,30}変更しました/);
});

test('update flow waits for user action before activating a new worker', () => {
  const app = read('src/app.js');
  const worker = read('service-worker.js');
  assert.match(app, /serviceWorkerRegistration\.update\(\)/);
  assert.match(app, /data-action="apply-update"/);
  assert.match(worker, /event\.data\?\.type === 'SKIP_WAITING'/);
  const install = worker.match(/addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] ?? '';
  assert.doesNotMatch(install, /skipWaiting/);
});

test('public-data communication is restricted to approved official providers', () => {
  const html = read('index.html');
  const publicData = read('src/public-data.js');
  const map = read('src/map.js');
  for (const host of ['www.j-shis.bosai.go.jp', 'cyberjapandata.gsi.go.jp', 'disaportaldata.gsi.go.jp', 'msearch.gsi.go.jp', 'mreversegeocoder.gsi.go.jp', 'www.jma.go.jp']) {
    assert.ok(html.includes(host));
    assert.ok(publicData.includes(host) || map.includes(host));
  }
  assert.doesNotMatch(read('src/app.js'), /\bfetch\s*\(/);
});

test('v0.3.0 exposes install, family sharing, drills, maps and call safeguards', () => {
  const app = read('src/app.js');
  const readme = read('README.md');
  assert.match(app, /スマホでこそ役立つ防災アプリ/);
  assert.match(app, /createFamilyShareBundle/);
  assert.match(app, /renderDrills/);
  assert.match(app, /showSelectedHazardMap/);
  assert.match(app, /まだ電話はかかっていません/);
  assert.match(app, /電話アプリを開く/);
  assert.match(readme, /やさしい日本語/);
});

test('dead police consultation link is absent and replacement is present', () => {
  const text = [read('src/data.js'), read('docs/EMERGENCY_CONTACTS.md')].join('\n');
  assert.doesNotMatch(text, /bureau\/safetylife\/soudan\/madoguchi\.html/);
  assert.match(text, /npa\.go\.jp\/goiken_notes\.html/);
});


test('location search examples are neutral and do not contain a specific residence area', () => {
  const app = read('src/app.js');
  assert.match(app, /placeholder="例: 市区町村名 \/ 駅名・公共施設名"/);
});

test('owner-only documents and release archives are ignored by Git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^\/LOCAL_ONLY\/$/m);
  assert.match(gitignore, /^\/mamoreru-inochi-\*\.zip$/m);
  assert.match(gitignore, /^\/mamoreru-inochi-\*\.zip\.sha256$/m);
});
