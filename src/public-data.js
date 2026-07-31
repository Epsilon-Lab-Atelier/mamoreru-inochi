import { uniqueBy } from './utils.js';

export const PUBLIC_DATA_PROVIDERS = Object.freeze({
  jshis: {
    id: 'jshis',
    name: 'J-SHIS（防災科学技術研究所）',
    host: 'www.j-shis.bosai.go.jp',
    purpose: '選択地点の地震ハザード確率を確認する'
  },
  gsi: {
    id: 'gsi',
    name: '国土地理院',
    host: 'cyberjapandata.gsi.go.jp',
    purpose: '選択地点の近くにある指定緊急避難場所・指定避難所・指定福祉避難所を確認する'
  },
  jma: {
    id: 'jma',
    name: '気象庁',
    host: 'www.jma.go.jp',
    purpose: '選択した地域の現在の警報・注意報を確認する'
  }
});

export const JMA_OFFICES = Object.freeze([
  ['011000', '宗谷地方'], ['012000', '上川・留萌地方'], ['013000', '網走・北見・紋別地方'],
  ['014030', '十勝地方'], ['014100', '釧路・根室地方'], ['015000', '胆振・日高地方'],
  ['016000', '石狩・空知地方'], ['017000', '渡島・檜山地方'],
  ['020000', '青森県'], ['030000', '岩手県'], ['040000', '宮城県'], ['050000', '秋田県'],
  ['060000', '山形県'], ['070000', '福島県'], ['080000', '茨城県'], ['090000', '栃木県'],
  ['100000', '群馬県'], ['110000', '埼玉県'], ['120000', '千葉県'], ['130000', '東京都'],
  ['140000', '神奈川県'], ['150000', '新潟県'], ['160000', '富山県'], ['170000', '石川県'],
  ['180000', '福井県'], ['190000', '山梨県'], ['200000', '長野県'], ['210000', '岐阜県'],
  ['220000', '静岡県'], ['230000', '愛知県'], ['240000', '三重県'], ['250000', '滋賀県'],
  ['260000', '京都府'], ['270000', '大阪府'], ['280000', '兵庫県'], ['290000', '奈良県'],
  ['300000', '和歌山県'], ['310000', '鳥取県'], ['320000', '島根県'], ['330000', '岡山県'],
  ['340000', '広島県'], ['350000', '山口県'], ['360000', '徳島県'], ['370000', '香川県'],
  ['380000', '愛媛県'], ['390000', '高知県'], ['400000', '福岡県'], ['410000', '佐賀県'],
  ['420000', '長崎県'], ['430000', '熊本県'], ['440000', '大分県'], ['450000', '宮崎県'],
  ['460100', '鹿児島県（奄美地方を除く）'], ['460040', '奄美地方'],
  ['471000', '沖縄本島地方'], ['472000', '大東島地方'], ['473000', '宮古島地方'], ['474000', '八重山地方']
].map(([code, name]) => Object.freeze({ code, name })));

export const GSI_HAZARD_LAYERS = Object.freeze({
  flood: { id: 'flood', name: '洪水', tile: 'skhb01' },
  landslide: { id: 'landslide', name: '崖崩れ・土石流・地滑り', tile: 'skhb02' },
  stormSurge: { id: 'stormSurge', name: '高潮', tile: 'skhb03' },
  earthquake: { id: 'earthquake', name: '地震', tile: 'skhb04' },
  tsunami: { id: 'tsunami', name: '津波', tile: 'skhb05' },
  fire: { id: 'fire', name: '大規模な火事', tile: 'skhb06' },
  inlandFlood: { id: 'inlandFlood', name: '内水氾濫', tile: 'skhb07' },
  volcano: { id: 'volcano', name: '火山現象', tile: 'skhb08' }
});

const JMA_WARNING_NAMES = Object.freeze({
  '00': '発表なし', '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報',
  '06': '大雪警報', '07': '波浪警報', '08': '高潮警報', '09': '土砂災害警戒情報',
  '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報',
  '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '18': '洪水注意報',
  '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
  '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報',
  '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報',
  '36': '大雪特別警報', '37': '波浪特別警報', '38': '高潮特別警報'
});

function assertCoordinate(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}を確認してください。`);
  }
  return number;
}

export function normalizeCoordinates(latitude, longitude) {
  return {
    latitude: assertCoordinate(latitude, -90, 90, '緯度'),
    longitude: assertCoordinate(longitude, -180, 180, '経度')
  };
}

export async function fetchJsonWithTimeout(url, { timeoutMs = 12000, signal, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs);
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) relayAbort();
    else signal.addEventListener('abort', relayAbort, { once: true });
  }
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: { Accept: 'application/json, application/geo+json;q=0.9' }
    });
    if (!response.ok) throw new Error(`情報提供元から応答を取得できませんでした（HTTP ${response.status}）。`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('情報の取得に時間がかかっています。通信状態を確認して、もう一度お試しください。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.('abort', relayAbort);
  }
}

export function buildJshisUrl(latitude, longitude) {
  const point = normalizeCoordinates(latitude, longitude);
  // J-SHIS地震ハザード情報APIが受け付ける経緯度範囲。
  if (point.longitude < 122 || point.longitude > 154 || point.latitude < 20 || point.latitude > 46) {
    throw new Error('J-SHISは日本周辺（経度122〜154度、緯度20〜46度）の地点で利用できます。');
  }
  const url = new URL('https://www.j-shis.bosai.go.jp/map/api/pshm/Y2024/AVR/TTL_MTTL/meshinfo.geojson');
  url.searchParams.set('position', `${point.longitude},${point.latitude}`);
  url.searchParams.set('epsg', '4326');
  url.searchParams.set('attr', 'T30_I45_PS,T30_I50_PS,T30_I55_PS,T30_I60_PS');
  return url.toString();
}

function firstProperties(payload) {
  if (payload?.type === 'FeatureCollection') return payload.features?.[0]?.properties ?? {};
  if (payload?.type === 'Feature') return payload.properties ?? {};
  return payload?.properties ?? payload ?? {};
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseJshisPayload(payload) {
  const properties = firstProperties(payload);
  const values = {
    intensity5Lower: optionalNumber(properties.T30_I45_PS),
    intensity5Upper: optionalNumber(properties.T30_I50_PS),
    intensity6Lower: optionalNumber(properties.T30_I55_PS),
    intensity6Upper: optionalNumber(properties.T30_I60_PS)
  };
  if (Object.values(values).every((value) => value === null)) {
    throw new Error('この地点の地震ハザード情報を確認できませんでした。');
  }
  return values;
}

export async function fetchJshisHazard(latitude, longitude, options = {}) {
  const url = buildJshisUrl(latitude, longitude);
  const payload = await fetchJsonWithTimeout(url, options);
  return {
    provider: 'jshis',
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    probabilities: parseJshisPayload(payload)
  };
}

export function longitudeToTileX(longitude, zoom) {
  return Math.floor(((Number(longitude) + 180) / 360) * (2 ** zoom));
}

export function latitudeToTileY(latitude, zoom) {
  const latRad = Number(latitude) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * (2 ** zoom));
}

export function surroundingTiles(latitude, longitude, zoom = 10, radius = 1) {
  const point = normalizeCoordinates(latitude, longitude);
  const centerX = longitudeToTileX(point.longitude, zoom);
  const centerY = latitudeToTileY(point.latitude, zoom);
  const size = 2 ** zoom;
  const tiles = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const x = (centerX + dx + size) % size;
      const y = Math.min(size - 1, Math.max(0, centerY + dy));
      tiles.push({ zoom, x, y });
    }
  }
  return tiles;
}

export function haversineKm(latitude1, longitude1, latitude2, longitude2) {
  const toRad = (value) => Number(value) * Math.PI / 180;
  const dLat = toRad(latitude2 - latitude1);
  const dLon = toRad(longitude2 - longitude1);
  const lat1 = toRad(latitude1);
  const lat2 = toRad(latitude2);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function featureName(properties = {}) {
  return properties.name || properties.Name || properties.NAME || properties['名称'] || '名称未登録';
}

function featureAddress(properties = {}) {
  return properties.address || properties.Address || properties.ADDRESS || properties['住所'] || '';
}

export function parseGsiFeatures(payload, { kind, hazardName, origin }) {
  const features = payload?.type === 'FeatureCollection' ? payload.features ?? [] : [];
  return features.flatMap((feature) => {
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const [longitude, latitude] = coordinates.map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const properties = feature.properties ?? {};
    return [{
      id: `${kind}-${featureName(properties)}-${latitude.toFixed(6)}-${longitude.toFixed(6)}`,
      kind,
      hazardName: hazardName || '',
      name: String(featureName(properties)),
      address: String(featureAddress(properties)),
      remarks: String(properties.remarks || properties.Remarks || properties['備考'] || ''),
      latitude,
      longitude,
      distanceKm: haversineKm(origin.latitude, origin.longitude, latitude, longitude)
    }];
  });
}

async function fetchGsiTile(layer, tile, options) {
  const url = `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${tile.zoom}/${tile.x}/${tile.y}.geojson`;
  try {
    const payload = await fetchJsonWithTimeout(url, options);
    return { payload, url };
  } catch (error) {
    // データのないタイルは404になるため、その場合だけ空として扱う。
    if (/HTTP 404/.test(String(error?.message))) return { payload: { type: 'FeatureCollection', features: [] }, url };
    throw error;
  }
}

export async function fetchGsiPlaces(latitude, longitude, hazardId = 'earthquake', options = {}) {
  const origin = normalizeCoordinates(latitude, longitude);
  const hazard = GSI_HAZARD_LAYERS[hazardId] ?? GSI_HAZARD_LAYERS.earthquake;
  const tiles = surroundingTiles(origin.latitude, origin.longitude, 10, 1);
  const requests = [];
  for (const tile of tiles) {
    requests.push(fetchGsiTile('sih', tile, options).then(({ payload }) => parseGsiFeatures(payload, { kind: 'shelter', origin })));
    requests.push(fetchGsiTile('sfh', tile, options).then(({ payload }) => parseGsiFeatures(payload, { kind: 'welfare-shelter', origin })));
    requests.push(fetchGsiTile(hazard.tile, tile, options).then(({ payload }) => parseGsiFeatures(payload, { kind: 'emergency', hazardName: hazard.name, origin })));
  }
  const settled = await Promise.allSettled(requests);
  const successes = settled.filter((entry) => entry.status === 'fulfilled').flatMap((entry) => entry.value);
  if (!successes.length && settled.some((entry) => entry.status === 'rejected')) {
    const firstError = settled.find((entry) => entry.status === 'rejected')?.reason;
    throw firstError instanceof Error ? firstError : new Error('避難場所情報を取得できませんでした。');
  }
  const uniquePlaces = uniqueBy(successes, (item) => `${item.kind}|${item.name}|${item.latitude.toFixed(5)}|${item.longitude.toFixed(5)}`)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  // 施設種別ごとに件数を確保し、近い緊急避難場所だけで避難所が押し出されるのを防ぐ。
  const places = ['emergency', 'shelter', 'welfare-shelter']
    .flatMap((kind) => uniquePlaces.filter((item) => item.kind === kind).slice(0, 20));
  return {
    provider: 'gsi',
    hazardId: hazard.id,
    hazardName: hazard.name,
    fetchedAt: new Date().toISOString(),
    places
  };
}

function collectJmaAreas(node, collected = []) {
  if (!node || typeof node !== 'object') return collected;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectJmaAreas(entry, collected));
    return collected;
  }

  // 気象庁の警報JSONは、時期や情報体系によって
  // { area: { code, name }, warnings } と { code, name?, warnings } の両方があり得ます。
  if (Array.isArray(node.warnings)) {
    const area = node.area && typeof node.area === 'object'
      ? node.area
      : { code: node.code ?? '', name: node.name ?? '' };
    collected.push({ area, warnings: node.warnings });
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'warnings' || key === 'area') continue;
    collectJmaAreas(value, collected);
  }
  return collected;
}

export function parseJmaWarningPayload(payload) {
  const reports = Array.isArray(payload) ? payload : [payload];
  const warnings = [];
  let reportDatetime = null;
  let headlineText = '';
  for (const report of reports) {
    reportDatetime ||= report?.reportDatetime || report?.reportDateTime || null;
    headlineText ||= String(report?.headlineText || report?.headline || '');
    for (const entry of collectJmaAreas(report)) {
      for (const warning of entry.warnings ?? []) {
        const status = String(warning.status || warning.state || '');
        if (status.includes('解除') || status.includes('なし')) continue;
        const code = String(warning.code || warning.type || '').padStart(2, '0');
        warnings.push({
          areaCode: String(entry.area?.code || ''),
          areaName: String(entry.area?.name || (entry.area?.code ? `地域コード ${entry.area.code}` : '地域名未取得')),
          code,
          name: JMA_WARNING_NAMES[code] || String(warning.name || `気象情報（コード${code}）`),
          status: status || '発表中'
        });
      }
    }
  }
  return {
    reportDatetime,
    headlineText,
    warnings: uniqueBy(warnings, (item) => `${item.areaCode}|${item.code}|${item.status}`)
  };
}

export async function fetchJmaWarnings(officeCode, options = {}) {
  if (!/^\d{6}$/.test(String(officeCode))) throw new Error('気象庁の地域を選択してください。');
  const candidates = [
    `https://www.jma.go.jp/bosai/warning/data/warning/${officeCode}.json`
  ];
  let lastError;
  for (const url of candidates) {
    try {
      const payload = await fetchJsonWithTimeout(url, options);
      return {
        provider: 'jma',
        officeCode: String(officeCode),
        sourceUrl: url,
        fetchedAt: new Date().toISOString(),
        ...parseJmaWarningPayload(payload)
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('警報・注意報を取得できませんでした。');
}

export function buildGsiMapUrl(latitude, longitude, zoom = 15) {
  const point = normalizeCoordinates(latitude, longitude);
  return `https://maps.gsi.go.jp/#${zoom}/${point.latitude}/${point.longitude}/&base=pale&ls=pale&disp=1`;
}

export function formatProbability(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '取得できません';
  // J-SHISの超過確率は0から1の割合で返るため、百分率へ換算します。
  const percentage = Number(value) * 100;
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(percentage)}%`;
}
