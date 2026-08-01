import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'LOCAL_ONLY', 'node_modules']);
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.webmanifest', '.xml', '.yml', '.yaml'
]);
const explicitTextFiles = new Set(['.editorconfig', '.gitattributes', '.gitignore', '.nojekyll']);

function publicTextFiles(directory = root) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...publicTextFiles(absolute));
    else if (textExtensions.has(path.extname(entry.name)) || explicitTextFiles.has(entry.name)) results.push(absolute);
  }
  return results;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const genericPrivatePatterns = [
  { label: 'macOS user home path', pattern: /\/Users\/[^/\s"'`]+\//g },
  { label: 'Linux user home path', pattern: /\/home\/[^/\s"'`]+\//g },
  { label: 'Windows user home path', pattern: /[A-Za-z]:\\Users\\[^\\\s"'`]+\\/g },
  { label: 'local file URL', pattern: /file:\/\/\//gi },
  { label: 'personal email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { label: 'cloud-storage working path', pattern: /(?:Dropbox|CloudStorage|share_data|local_repo)[/\\]/gi }
];

function optionalPrivateTerms() {
  const file = path.join(root, 'LOCAL_ONLY', 'private-terms.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith('#'));
}

test('public package contains no generic personal paths or email addresses', () => {
  const findings = [];
  for (const file of publicTextFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { label, pattern } of genericPrivatePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) findings.push(`${relative(file)}: ${label}`);
    }
  }
  assert.deepEqual(findings, []);
});

test('optional owner-only private terms do not appear in public text files', () => {
  const terms = optionalPrivateTerms();
  if (!terms.length) return;
  const findings = [];
  for (const file of publicTextFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const term of terms) {
      if (text.includes(term)) findings.push(`${relative(file)}: owner-only term detected`);
    }
  }
  assert.deepEqual(findings, []);
});

test('location examples stay generic and do not request unnecessary detail', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  assert.match(app, /placeholder="例: 市区町村名 \/ 駅名・公共施設名"/);
  assert.match(app, /実名や部屋番号など、検索に不要な情報は入力しないでください。/);
  assert.doesNotMatch(app, /placeholder="例: [^"\n]*(?:丁目|番地|号室)[^"\n]*"/);
});
