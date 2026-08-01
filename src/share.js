const SHARE_VERSION = 1;
const FAMILY_SHARE_PREFIX = 'MI-FAMILY:';

export const FAMILY_SHARE_FIELDS = Object.freeze([
  { id: 'primaryMeetingPlace', label: '第一の集合場所', group: 'basic', defaultSelected: true },
  { id: 'secondaryMeetingPlace', label: '第二の集合場所', group: 'basic', defaultSelected: true },
  { id: 'hazardDestinations', label: '災害別の避難先', group: 'basic', defaultSelected: true },
  { id: 'contactRule', label: '連絡できないときのルール', group: 'basic', defaultSelected: true },
  { id: 'pickupRule', label: '迎えのルール', group: 'basic', defaultSelected: true },
  { id: 'supportPlan', label: '支援が必要な人への対応', group: 'sensitive', defaultSelected: false },
  { id: 'petPlan', label: 'ペットの避難', group: 'basic', defaultSelected: true },
  { id: 'utilityRule', label: '電気・ガス・水のルール', group: 'basic', defaultSelected: true },
  { id: 'prohibitedRoutes', label: '通らない場所・経路', group: 'basic', defaultSelected: true },
  { id: 'outOfAreaContact', label: '遠方の連絡先・中継役', group: 'contact', defaultSelected: false },
  { id: 'notes', label: 'その他のメモ', group: 'sensitive', defaultSelected: false }
]);

function utf8ToBase64Url(text) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function pickPlan(plan, selectedFields) {
  const selected = new Set(selectedFields);
  const data = {};
  for (const field of FAMILY_SHARE_FIELDS) {
    if (!selected.has(field.id)) continue;
    const value = plan?.[field.id];
    if (field.id === 'hazardDestinations') {
      const destinations = value && typeof value === 'object' ? value : {};
      const compact = Object.fromEntries(Object.entries(destinations).filter(([, item]) => String(item || '').trim()));
      if (Object.keys(compact).length) data.h = compact;
      continue;
    }
    const text = String(value || '').trim();
    if (text) data[field.id] = text;
  }
  return data;
}

export function defaultFamilyShareFields() {
  return FAMILY_SHARE_FIELDS.filter((field) => field.defaultSelected).map((field) => field.id);
}

export function createFamilyShareBundle(plan, selectedFields = defaultFamilyShareFields()) {
  const fields = [...new Set(selectedFields)].filter((id) => FAMILY_SHARE_FIELDS.some((field) => field.id === id));
  const bundle = {
    type: 'mamoreru-inochi-family-plan',
    v: SHARE_VERSION,
    createdAt: new Date().toISOString(),
    fields,
    data: pickPlan(plan, fields)
  };
  return bundle;
}

export function encodeSharePayload(bundle) {
  if (!bundle || bundle.type !== 'mamoreru-inochi-family-plan') throw new Error('家族の防災計画の共有データではありません。');
  return `${FAMILY_SHARE_PREFIX}${utf8ToBase64Url(JSON.stringify(bundle))}`;
}

export function decodeSharePayload(payload) {
  const text = String(payload || '').trim();
  const encoded = text.startsWith(FAMILY_SHARE_PREFIX) ? text.slice(FAMILY_SHARE_PREFIX.length) : text;
  let parsed;
  try {
    parsed = JSON.parse(base64UrlToUtf8(encoded));
  } catch {
    throw new Error('共有データを読み取れませんでした。');
  }
  if (parsed?.type !== 'mamoreru-inochi-family-plan' || Number(parsed?.v) !== SHARE_VERSION || !parsed?.data) {
    throw new Error('対応していない家族の防災計画データです。');
  }
  return parsed;
}

export function buildFamilyShareUrl(bundle, baseUrl = location.href) {
  const url = new URL(baseUrl);
  url.hash = '#/family/import';
  url.searchParams.set('family', encodeSharePayload(bundle));
  return url.toString();
}

export function readFamilyShareFromLocation(urlLike = location.href) {
  const url = new URL(urlLike, location.href);
  const payload = url.searchParams.get('family');
  return payload ? decodeSharePayload(payload) : null;
}

export function clearFamilyShareFromUrl(urlLike = location.href) {
  const url = new URL(urlLike, location.href);
  url.searchParams.delete('family');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function familyShareSize(bundle, baseUrl = location.href) {
  const payload = encodeSharePayload(bundle);
  const url = buildFamilyShareUrl(bundle, baseUrl);
  return {
    payloadCharacters: payload.length,
    urlCharacters: url.length,
    suitableForQr: url.length <= 2200
  };
}

export function mergeFamilyPlan(currentPlan, bundle) {
  const decoded = bundle?.type ? bundle : decodeSharePayload(bundle);
  const next = { ...(currentPlan || {}) };
  const data = decoded.data || {};
  for (const field of FAMILY_SHARE_FIELDS) {
    if (!decoded.fields?.includes(field.id)) continue;
    if (field.id === 'hazardDestinations') {
      next.hazardDestinations = { ...(next.hazardDestinations || {}), ...(data.h || {}) };
    } else if (typeof data[field.id] === 'string') {
      next[field.id] = data[field.id];
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
