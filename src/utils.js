export const APP_VERSION = '0.2.0';
export const SCHEMA_VERSION = 2;

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}

export function toNonNegativeInteger(value, fallback = 0) {
  return Math.round(toNonNegativeNumber(value, fallback));
}

export function formatNumber(value, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits }).format(Number(value) || 0);
}

export function formatDateTime(isoString) {
  if (!isoString) return '未実施';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '未実施';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function formatDate(isoDate) {
  if (!isoDate) return '期限なし';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '期限不明';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

export function daysUntil(isoDate, now = new Date()) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - base.getTime()) / 86_400_000);
}

export function createId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deepClone(value) {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function debounce(callback, delay = 250) {
  let timerId;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => callback(...args), delay);
  };
}

export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error('ファイルを読み込めませんでした。')));
    reader.readAsText(file);
  });
}

export function routeParts(hash = globalThis.location?.hash || '#/') {
  const normalized = hash.replace(/^#/, '') || '/';
  return normalized.split('/').filter(Boolean);
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON形式を確認できませんでした。正しいバックアップファイルを選んでください。');
  }
}

export function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
