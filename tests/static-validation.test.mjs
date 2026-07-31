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
  const worker = read('service-worker.js');
  assert.match(worker, /self\.registration\.scope/);
});

test('runtime HTML has no remote script or stylesheet dependencies', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
});

test('public URLs point to Epsilon-Lab-Atelier', () => {
  const expectedRepository = 'https://github.com/Epsilon-Lab-Atelier/mamoreru-inochi';
  const expectedPages = 'https://epsilon-lab-atelier.github.io/mamoreru-inochi/';
  assert.ok(read('src/app.js').includes(expectedRepository));
  assert.ok(read('README.md').includes(expectedPages));
  assert.ok(read('sitemap.xml').includes(expectedPages));
  assert.ok(read('robots.txt').includes(`${expectedPages}sitemap.xml`));
});

test('owner-only package documents are ignored by Git', () => {
  assert.match(read('.gitignore'), /^\/LOCAL_ONLY\/$/m);
});
