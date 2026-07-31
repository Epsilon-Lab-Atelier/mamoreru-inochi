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

const required = [
  '.github/ISSUE_TEMPLATE/accessibility.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/content-correction.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/test.yml',
  '.gitignore',
  '.nojekyll',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'service-worker.js',
  'robots.txt',
  'sitemap.xml',
  'assets/styles.css',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'src/app.js',
  'src/data.js',
  'src/risk-engine.js',
  'src/stockpile-engine.js',
  'src/storage.js',
  'src/crypto.js',
  'src/utils.js',
  'tests/crypto.test.mjs',
  'tests/risk-engine.test.mjs',
  'tests/static-validation.test.mjs',
  'tests/stockpile-engine.test.mjs',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/ACCESSIBILITY.md',
  'docs/ARCHITECTURE.md',
  'docs/DATA_SOURCES.md',
  'docs/DIAGNOSIS_RULES.md',
  'docs/PRIVACY.md',
  'docs/QA_REPORT.md',
  'docs/THREAT_MODEL.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing required public file: ${file}`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walkPublicFiles(directory = root) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'LOCAL_ONLY' || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkPublicFiles(absolute));
    } else {
      results.push(absolute);
    }
  }
  return results;
}

const index = read('index.html');
if (!index.includes('lang="ja"')) errors.push('index.html must declare Japanese language.');
if (!index.includes('Content-Security-Policy')) errors.push('index.html must include a CSP.');
if (!index.includes('id="main-content"')) errors.push('index.html must include a main landmark.');
if (!index.includes('skip-link')) errors.push('index.html must include a skip link.');
if (/<script[^>]+src=["']https?:/i.test(index)) errors.push('Remote scripts are not allowed.');
if (/<link[^>]+href=["']https?:/i.test(index)) errors.push('Remote styles or fonts are not allowed.');

const sourceText = [
  read('src/app.js'),
  read('src/data.js'),
  read('src/risk-engine.js'),
  read('src/stockpile-engine.js'),
  read('src/storage.js'),
  read('src/crypto.js'),
  read('src/utils.js')
].join('\n');
if (/fetch\s*\(\s*["']https?:/i.test(sourceText)) errors.push('Runtime remote fetch is not allowed in v0.1.0.');
if (/navigator\.sendBeacon|new\s+WebSocket\s*\(|new\s+EventSource\s*\(/i.test(sourceText)) {
  errors.push('Unapproved outbound communication API found in application source.');
}
if (/(google-analytics|googletagmanager|doubleclick|adsbygoogle|clarity\.ms|segment\.com)/i.test(sourceText + index)) {
  errors.push('Analytics or advertising code is not allowed.');
}

const manifest = JSON.parse(read('manifest.webmanifest'));
if (manifest.display !== 'standalone') errors.push('PWA display must be standalone.');
if (manifest.scope !== './') errors.push('PWA scope must be relative for GitHub Pages.');
if (manifest.start_url !== './?source=pwa') errors.push('PWA start_url must be relative for GitHub Pages.');
if (!manifest.icons?.some((icon) => icon.sizes === '512x512')) errors.push('PWA needs a 512px icon.');
for (const icon of manifest.icons ?? []) {
  const relativeIcon = icon.src.replace(/^\.\//, '');
  if (!fs.existsSync(path.join(root, relativeIcon))) errors.push(`Manifest icon is missing: ${icon.src}`);
}

const readme = read('README.md');
if (/git\s+push|git\s+init|gh\s+repo\s+create|公開手順|運用者向け|--local\s+user\./i.test(readme)) {
  errors.push('README must not contain owner push or deployment procedures.');
}
if (!readme.includes(expectedPagesUrl)) errors.push('README must contain the correct GitHub Pages URL.');

const gitignore = read('.gitignore');
if (!/^\/LOCAL_ONLY\/$/m.test(gitignore)) errors.push('.gitignore must exclude /LOCAL_ONLY/.');

const serviceWorker = read('service-worker.js');
for (const module of [
  './src/app.js',
  './src/data.js',
  './src/risk-engine.js',
  './src/stockpile-engine.js',
  './src/storage.js',
  './src/crypto.js',
  './src/utils.js'
]) {
  if (!serviceWorker.includes(module)) errors.push(`Service worker does not precache ${module}`);
}

const packageJson = JSON.parse(read('package.json'));
const appVersionMatch = read('src/utils.js').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const workerVersionMatch = serviceWorker.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
const versions = [packageJson.version, appVersionMatch?.[1], workerVersionMatch?.[1]];
if (versions.some((version) => !version)) errors.push('Could not read all application versions.');
if (new Set(versions).size !== 1) errors.push(`Version mismatch: ${versions.join(', ')}`);
if (!index.includes(`Version ${packageJson.version}`)) errors.push('index.html version does not match package.json.');

const app = read('src/app.js');
if (!app.includes(expectedRepositoryUrl)) errors.push('Application must link to the correct GitHub repository.');
if (!read('sitemap.xml').includes(expectedPagesUrl)) errors.push('sitemap.xml must contain the correct Pages URL.');
if (!read('robots.txt').includes(`${expectedPagesUrl}sitemap.xml`)) errors.push('robots.txt must contain the correct sitemap URL.');

const forbiddenTextPatterns = [
  { pattern: /\/Users\//, label: 'absolute macOS user path' },
  { pattern: new RegExp(['shogo', 'ishikawa'].join('-'), 'i'), label: 'obsolete GitHub account name' },
  { pattern: new RegExp(['EpsilonLab', 'Atelier'].join('')), label: 'GitHub account name without required hyphens' },
  { pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, label: 'private key material' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/, label: 'GitHub personal access token' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained token' }
];

for (const absolutePath of walkPublicFiles()) {
  const extension = path.extname(absolutePath).toLowerCase();
  if (!['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.xml', '.yml', '.yaml'].includes(extension)) continue;
  const text = fs.readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(root, absolutePath);
  for (const { pattern, label } of forbiddenTextPatterns) {
    if (pattern.test(text)) errors.push(`${label} found in public file: ${relativePath}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Project validation passed for ${expectedOwner}/${expectedRepository} v${packageJson.version}.`);
