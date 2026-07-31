import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGsiMapUrl,
  buildJshisUrl,
  fetchJmaWarnings,
  formatProbability,
  haversineKm,
  normalizeCoordinates,
  parseGsiFeatures,
  parseJmaWarningPayload,
  parseJshisPayload,
  surroundingTiles
} from '../src/public-data.js';

test('coordinates are validated and J-SHIS URL uses longitude,latitude', () => {
  assert.deepEqual(normalizeCoordinates(35.68, 139.76), { latitude: 35.68, longitude: 139.76 });
  assert.throws(() => normalizeCoordinates(91, 139), /緯度/);
  const url = new URL(buildJshisUrl(35.68, 139.76));
  assert.equal(url.searchParams.get('position'), '139.76,35.68');
  assert.equal(url.searchParams.get('epsg'), '4326');
  assert.match(url.searchParams.get('attr'), /T30_I55_PS/);
  assert.throws(() => buildJshisUrl(19.9, 139.76), /日本周辺/);
  assert.throws(() => buildJshisUrl(35.68, 154.1), /日本周辺/);
});

test('J-SHIS probabilities are parsed as ratios and formatted as percent', () => {
  const parsed = parseJshisPayload({
    type: 'FeatureCollection',
    features: [{ properties: { T30_I45_PS: '0.999005', T30_I50_PS: '0.75', T30_I55_PS: '0.12654', T30_I60_PS: '0.031' } }]
  });
  assert.equal(parsed.intensity6Lower, 0.12654);
  assert.equal(formatProbability(parsed.intensity5Lower), '99.9%');
  assert.equal(formatProbability(parsed.intensity6Lower), '12.65%');
});

test('surrounding GSI tile set is bounded and stable', () => {
  const tiles = surroundingTiles(35.681236, 139.767125, 10, 1);
  assert.equal(tiles.length, 9);
  assert.equal(new Set(tiles.map((tile) => `${tile.x}/${tile.y}`)).size, 9);
  assert.ok(tiles.every((tile) => tile.zoom === 10 && tile.x >= 0 && tile.y >= 0));
});

test('GSI point features are normalized and sorted by caller distance', () => {
  const features = parseGsiFeatures({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [139.77, 35.68] },
      properties: { name: 'テスト避難所', address: 'テスト市1-2-3', remarks: '要確認' }
    }]
  }, { kind: 'shelter', hazardName: '', origin: { latitude: 35.681, longitude: 139.767 } });
  assert.equal(features.length, 1);
  assert.equal(features[0].name, 'テスト避難所');
  assert.ok(features[0].distanceKm >= 0);
  assert.ok(haversineKm(35.681, 139.767, 35.68, 139.77) < 1);
});

test('JMA warning parser supports current areaTypes structure', () => {
  const parsed = parseJmaWarningPayload({
    reportDatetime: '2026-07-31T12:00:00+09:00',
    headlineText: '大雨に注意してください。',
    areaTypes: [{
      areas: [
        { code: '120010', warnings: [{ code: '03', status: '発表' }, { code: '18', status: '解除' }] },
        { code: '120020', warnings: [{ code: '20', status: '発表' }] }
      ]
    }]
  });
  assert.equal(parsed.reportDatetime, '2026-07-31T12:00:00+09:00');
  assert.equal(parsed.warnings.length, 2);
  assert.equal(parsed.warnings[0].areaName, '地域コード 120010');
  assert.ok(parsed.warnings.some((item) => item.name === '大雨警報'));
  assert.ok(parsed.warnings.some((item) => item.name === '濃霧注意報'));
});

test('JMA fetch uses the official warning endpoint and omits credentials', async () => {
  let requestedUrl = '';
  let requestedOptions = null;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    requestedOptions = options;
    return {
      ok: true,
      json: async () => ({ reportDatetime: '2026-07-31T00:00:00+09:00', areaTypes: [] })
    };
  };
  const result = await fetchJmaWarnings('120000', { fetchImpl });
  assert.equal(requestedUrl, 'https://www.jma.go.jp/bosai/warning/data/warning/120000.json');
  assert.equal(requestedOptions.credentials, 'omit');
  assert.equal(requestedOptions.referrerPolicy, 'no-referrer');
  assert.equal(result.provider, 'jma');
});

test('GSI map URL contains the selected point', () => {
  const url = buildGsiMapUrl(35.681236, 139.767125);
  assert.match(url, /maps\.gsi\.go\.jp/);
  assert.match(url, /35\.681236\/139\.767125/);
});
