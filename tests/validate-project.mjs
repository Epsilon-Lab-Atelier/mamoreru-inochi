import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const expectedOwner = 'Epsilon-Lab-Atelier';
const expectedRepository = 'mamoreru-inochi';
const expectedRepositoryUrl = `https://github.com/${expectedOwner}/${expectedRepository}`;
const expectedPagesUrl = 'https://epsilon-lab-atelier.github.io/mamoreru-inochi/';
const expectedDescription = '生活環境に合わせて、災害リスク・備蓄・緊急時の行動を確認できる無料の防災アプリです。';
const expectedManifestDescription = 'スマホに入れて、災害リスク・備蓄・家族の防災計画・緊急時の行動をいつでも確認できる無料の防災アプリです。';

const required = [
  '.github/ISSUE_TEMPLATE/accessibility.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/content-correction.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/test.yml',
  '.github/workflows/link-check.yml',
  '.gitignore', '.nojekyll', 'index.html', 'offline.html', 'manifest.webmanifest',
  'service-worker.js', 'version.json', 'robots.txt', 'sitemap.xml',
  'assets/styles.css', 'assets/og-image.png',
  'assets/icons/apple-touch-icon.png', 'assets/icons/icon-192.png',
  'assets/icons/icon-512.png', 'assets/icons/icon.svg', 'assets/icons/maskable-512.png',
  'assets/screenshots/home-mobile.png', 'assets/screenshots/family-wide.png',
  'vendor/qrcode.js',
  'src/app.js', 'src/data.js', 'src/public-data.js', 'src/share.js', 'src/map.js',
  'src/drills.js', 'src/risk-engine.js', 'src/stockpile-engine.js', 'src/storage.js',
  'src/crypto.js', 'src/utils.js',
  'tests/crypto.test.mjs', 'tests/public-data.test.mjs', 'tests/risk-engine.test.mjs',
  'tests/static-validation.test.mjs', 'tests/stockpile-engine.test.mjs',
  'tests/share.test.mjs', 'tests/map.test.mjs', 'tests/drills.test.mjs',
  'tests/check-links.mjs', 'tests/privacy-scan.test.mjs',
  'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/ACCESSIBILITY.md', 'docs/ARCHITECTURE.md', 'docs/DATA_SOURCES.md',
  'docs/DIAGNOSIS_RULES.md', 'docs/EMERGENCY_CONTACTS.md',
  'docs/OFFLINE_AND_UPDATES.md', 'docs/PRIVACY.md', 'docs/QA_REPORT.md',
  'docs/THREAT_MODEL.md', 'docs/FAMILY_SHARING.md', 'docs/MAP_AND_LOCATION.md',
  'docs/DRILLS.md', 'docs/EASY_JAPANESE.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing required public file: ${file}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walkPublicFiles(directory = root) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'LOCAL_ONLY' || entry.name === 'node_modules') continue;
    if (entry.name === 'app.v020.backup.js') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walkPublicFiles(absolute));
    else results.push(absolute);
  }
  return results;
}

function pngDimensions(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const index = read('index.html');
if (!index.includes('lang="ja"')) errors.push('index.html must declare Japanese language.');
if (!index.includes('Content-Security-Policy')) errors.push('index.html must include a CSP.');
if (!index.includes('id="main-content"')) errors.push('index.html must include a main landmark.');
if (!index.includes('skip-link')) errors.push('index.html must include a skip link.');
if (/<script[^>]+src=["']https?:/i.test(index)) errors.push('Remote scripts are not allowed.');
if (/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i.test(index)
  || /<link[^>]+href=["']https?:[^>]+rel=["']stylesheet["']/i.test(index)) errors.push('Remote stylesheets are not allowed.');
if (!index.includes('<script src="./vendor/qrcode.js"></script>')) errors.push('Local QR library is not loaded before the application module.');
if (!index.includes(`content="${expectedDescription}"`)) errors.push('Short public description is missing.');
if (!index.includes(`og:image" content="${expectedPagesUrl}assets/og-image.png?v=0.3.1`)) errors.push('Absolute v0.3.1 OGP image URL is missing.');
if (!index.includes('og:image:width" content="1200"') || !index.includes('og:image:height" content="630"')) errors.push('OGP image dimensions must be declared as 1200x630.');
const ogDimensions = pngDimensions('assets/og-image.png');
if (!ogDimensions || ogDimensions.width !== 1200 || ogDimensions.height !== 630) errors.push('assets/og-image.png must be a valid 1200x630 PNG.');
for (const [file, width, height] of [['assets/screenshots/home-mobile.png', 540, 960], ['assets/screenshots/family-wide.png', 1280, 720]]) {
  const dimensions = pngDimensions(file);
  if (!dimensions || dimensions.width !== width || dimensions.height !== height) errors.push(`${file} must be ${width}x${height}.`);
}

const cspMatch = index.match(/Content-Security-Policy" content="([^"]+)"/i);
const csp = cspMatch?.[1] ?? '';
const approvedHosts = [
  'https://www.j-shis.bosai.go.jp', 'https://cyberjapandata.gsi.go.jp',
  'https://disaportaldata.gsi.go.jp', 'https://msearch.gsi.go.jp',
  'https://mreversegeocoder.gsi.go.jp', 'https://www.jma.go.jp'
];
for (const host of approvedHosts) if (!csp.includes(host)) errors.push(`CSP does not allow approved public-data host: ${host}`);
if (!/script-src 'self'/.test(csp) || !/object-src 'none'/.test(csp)) errors.push('CSP must restrict scripts and objects.');

const app = read('src/app.js');
const data = read('src/data.js');
const publicData = read('src/public-data.js');
const nonNetworkSource = [
  app, data, read('src/share.js'), read('src/map.js'), read('src/drills.js'),
  read('src/risk-engine.js'), read('src/stockpile-engine.js'), read('src/storage.js'),
  read('src/crypto.js'), read('src/utils.js')
].join('\n');
if (/navigator\.sendBeacon|new\s+WebSocket\s*\(|new\s+EventSource\s*\(/i.test(nonNetworkSource + publicData)) errors.push('Unapproved outbound communication API found in application source.');
if (/\bfetch\s*\(/.test(nonNetworkSource)) errors.push('Direct runtime fetch must be isolated in src/public-data.js.');
for (const host of approvedHosts.map((item) => item.replace('https://', ''))) if (!publicData.includes(host) && !read('src/map.js').includes(host)) errors.push(`Public-data or map module is missing approved host: ${host}`);
if (/(google-analytics|googletagmanager|doubleclick|adsbygoogle|clarity\.ms|segment\.com)/i.test(nonNetworkSource + publicData + index)) errors.push('Analytics or advertising code is not allowed.');

const manifest = JSON.parse(read('manifest.webmanifest'));
if (manifest.display !== 'standalone') errors.push('PWA display must be standalone.');
if (manifest.scope !== './') errors.push('PWA scope must be relative for GitHub Pages.');
if (manifest.start_url !== './?source=pwa') errors.push('PWA start_url must be relative for GitHub Pages.');
if (manifest.description !== expectedManifestDescription) errors.push('Manifest description does not match the install-first description.');
if (!manifest.icons?.some((icon) => icon.sizes === '512x512')) errors.push('PWA needs a 512px icon.');
if (!manifest.screenshots?.some((item) => item.form_factor === 'narrow') || !manifest.screenshots?.some((item) => item.form_factor === 'wide')) errors.push('Manifest needs narrow and wide screenshots.');
if (!manifest.shortcuts?.some((item) => item.url === './#/family') || !manifest.shortcuts?.some((item) => item.url === './#/drills')) errors.push('Manifest shortcuts must include family plan and drills.');
for (const icon of manifest.icons ?? []) {
  const relativeIcon = icon.src.replace(/^\.\//, '');
  if (!fs.existsSync(path.join(root, relativeIcon))) errors.push(`Manifest icon is missing: ${icon.src}`);
}
for (const screenshot of manifest.screenshots ?? []) {
  const relative = screenshot.src.replace(/^\.\//, '');
  if (!fs.existsSync(path.join(root, relative))) errors.push(`Manifest screenshot is missing: ${screenshot.src}`);
}

const readme = read('README.md');
if (/git\s+push|git\s+init|git\s+config|gh\s+repo\s+create|Fine-grained|PAT|公開手順|運用者向け/i.test(readme)) errors.push('README must not contain owner push, authentication, or deployment procedures.');
if (!readme.includes(expectedPagesUrl)) errors.push('README must contain the correct GitHub Pages URL.');
for (const term of ['スマホに入れる', '家族の防災計画', 'QR', '防災訓練', 'やさしい日本語', '防災地図']) if (!readme.includes(term)) errors.push(`README must describe current feature: ${term}`);

const gitignore = read('.gitignore');
if (!/^\/LOCAL_ONLY\/$/m.test(gitignore)) errors.push('.gitignore must exclude /LOCAL_ONLY/.');
if (!/^\/mamoreru-inochi-\*\.zip$/m.test(gitignore) || !/^\/mamoreru-inochi-\*\.zip\.sha256$/m.test(gitignore)) errors.push('.gitignore must exclude release ZIP and checksum files.');

const serviceWorker = read('service-worker.js');
for (const module of [
  './version.json', './vendor/qrcode.js', './src/app.js', './src/data.js', './src/public-data.js',
  './src/share.js', './src/map.js', './src/drills.js', './src/risk-engine.js',
  './src/stockpile-engine.js', './src/storage.js', './src/crypto.js', './src/utils.js',
  './assets/screenshots/home-mobile.png', './assets/screenshots/family-wide.png'
]) if (!serviceWorker.includes(module)) errors.push(`Service worker does not precache ${module}`);
const installHandler = serviceWorker.match(/addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] ?? '';
if (/skipWaiting\s*\(/.test(installHandler)) errors.push('Service worker must not force activation during install.');
if (!serviceWorker.includes("event.data?.type === 'SKIP_WAITING'")) errors.push('Service worker must support user-triggered update activation.');
if (!serviceWorker.includes('mamoreru-inochi-map-')) errors.push('Service worker must preserve explicitly cached offline maps.');

const packageJson = JSON.parse(read('package.json'));
const versionJson = JSON.parse(read('version.json'));
const appVersionMatch = read('src/utils.js').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const schemaVersionMatch = read('src/utils.js').match(/SCHEMA_VERSION\s*=\s*(\d+)/);
const workerVersionMatch = serviceWorker.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
const versions = [packageJson.version, versionJson.version, appVersionMatch?.[1], workerVersionMatch?.[1]];
if (versions.some((version) => !version)) errors.push('Could not read all application versions.');
if (new Set(versions).size !== 1) errors.push(`Version mismatch: ${versions.join(', ')}`);
if (Number(versionJson.schemaVersion) !== Number(schemaVersionMatch?.[1])) errors.push('Schema version mismatch.');
if (!index.includes(`Version ${packageJson.version}`)) errors.push('index.html version does not match package.json.');
if (!read('CHANGELOG.md').includes(`## [${packageJson.version}]`)) errors.push('CHANGELOG is missing the current version.');

if (!app.includes(expectedRepositoryUrl)) errors.push('Application must link to the correct GitHub repository.');
if (!read('sitemap.xml').includes(expectedPagesUrl)) errors.push('sitemap.xml must contain the correct Pages URL.');
if (!read('robots.txt').includes(`${expectedPagesUrl}sitemap.xml`)) errors.push('robots.txt must contain the correct sitemap URL.');
if (!app.includes("document.documentElement.style.setProperty('--font-scale'")) errors.push('Font scale must be applied to the root element.');
for (const setting of ['--content-line-height', '--content-letter-spacing', 'easyJapanese', 'largeTargets', 'underlineLinks']) if (!app.includes(setting)) errors.push(`Detailed accessibility setting is missing: ${setting}`);
if (!index.includes('id="font-size-panel"') || !index.includes('文字サイズ: 100%')) errors.push('Compact font-size panel is missing.');
if (/文字サイズを[^。\n]{0,30}変更しました/.test(app)) errors.push('Obstructive font-size change toast must not be used.');
if (!app.includes('serviceWorkerRegistration.update()') || !app.includes('offlineStatus.updateAvailable')) errors.push('PWA update checking is incomplete.');
if (!app.includes('まだ電話はかかっていません') || !app.includes('電話アプリを開く')) errors.push('Emergency call confirmation wording is missing.');
if (!app.includes('発信前に確認する') || app.includes('>用途を確認する<')) errors.push('Emergency contact action label is not clear.');
if (!app.includes('家族の防災計画') || !index.includes('家族の防災計画') || !JSON.stringify(manifest).includes('家族の防災計画')) errors.push('Family disaster plan label is inconsistent.');
if (/searchParams\.set\(['"]attr['"]/.test(publicData)) errors.push('J-SHIS request must omit attr so all required attributes are returned in one request.');
if (!read('src/map.js').includes('DEFAULT_MAP_VIEW') || !app.includes('赤い照準')) errors.push('Map picker default and center indicator are incomplete.');
if (!read('assets/icons/icon.svg').includes('手を取り合う二人')) errors.push('Warm icon description must explain the two people joining hands.');
if (app.includes('https://www.npa.go.jp/bureau/safetylife/soudan/madoguchi.html') || data.includes('https://www.npa.go.jp/bureau/safetylife/soudan/madoguchi.html')) errors.push('Dead NPA consultation link remains.');

const deploy = read('.github/workflows/deploy.yml');
if (!deploy.includes('version.json') || !deploy.includes('npm run check') || !deploy.includes('vendor')) errors.push('Pages workflow must test and publish version.json and vendor assets.');
const linkWorkflow = read('.github/workflows/link-check.yml');
if (!linkWorkflow.includes('schedule:') || !linkWorkflow.includes('tests/check-links.mjs')) errors.push('Scheduled official-link check is incomplete.');

const forbiddenTextPatterns = [
  { pattern: /\/Users\//, label: 'absolute macOS user path' },
  { pattern: new RegExp(['EpsilonLab', 'Atelier'].join('')), label: 'GitHub account name without required hyphens' },
  { pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, label: 'private key material' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/, label: 'GitHub personal access token' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained token' },
  { pattern: new RegExp(['ブラウ', 'ザー'].join('')), label: 'non-standard browser terminology' },
  { pattern: new RegExp(['サーバ', 'ー'].join('')), label: 'non-standard server terminology' }
];

for (const absolutePath of walkPublicFiles()) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (!['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.webmanifest', '.xml', '.yml', '.yaml'].includes(extension)) continue;
  const text = fs.readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(root, absolutePath);
  for (const { pattern, label } of forbiddenTextPatterns) if (pattern.test(text)) errors.push(`${label} found in public file: ${relativePath}`);
}

if (fs.existsSync(path.join(root, 'src/app.v020.backup.js'))) errors.push('Development backup file must not be included in the release.');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Project validation passed for ${expectedOwner}/${expectedRepository} v${packageJson.version}.`);
