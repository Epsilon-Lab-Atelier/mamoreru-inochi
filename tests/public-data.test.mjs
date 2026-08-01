import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGsiMapUrl,
  buildJshisUrl,
  fetchJmaWarnings,
  fetchJshisHazard,
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
  assert.equal(url.searchParams.has('attr'), false);
  assert.doesNotThrow(() => buildJshisUrl(47, 139.76));
  assert.throws(() => buildJshisUrl(47.0001, 139.76), /日本周辺/);
  assert.throws(() => buildJshisUrl(19.9, 139.76), /日本周辺/);
  assert.throws(() => buildJshisUrl(35.68, 154.1), /日本周辺/);
});


test('J-SHIS fetch requests all attributes once and preserves provider metadata', async () => {
  let requestedUrl = '';
  let requestedOptions = null;
  const result = await fetchJshisHazard(35.68, 139.76, {
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: 'Success',
          type: 'FeatureCollection',
          features: [{ properties: {
            meshcode: '0000000000N',
            T30_I45_PS: '0.9',
            T30_I50_PS: '0.7',
            T30_I55_PS: '0.2',
            T30_I60_PS: '0.05'
          } }],
          metaData: { meshcode: '0000000000N', version: 'Y2024' }
        })
      };
    }
  });
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.has('attr'), false);
  assert.equal(requestedOptions.credentials, 'omit');
  assert.equal(result.meshcode, '0000000000N');
  assert.equal(result.dataVersion, 'Y2024');
  assert.equal(result.probabilities.intensity6Lower, 0.2);
});

test('J-SHIS HTTP errors retain the provider code and show a useful message', async () => {
  await assert.rejects(
    () => fetchJshisHazard(35.68, 139.76, {
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ status: 'Error', error: { code: 'INVALID_REQUEST', message: 'invalid attr' }, features: [] })
      })
    }),
    (error) => {
      assert.equal(error.name, 'PublicDataError');
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.match(error.message, /最新版/);
      assert.equal(error.providerMessage, 'invalid attr');
      return true;
    }
  );
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

test('GSI address search candidates and reverse geocode payloads are normalized', async () => {
  const {
    parseGsiAddressSearchPayload,
    parseGsiReverseGeocodePayload,
    searchGsiAddress
  } = await import('../src/public-data.js');
  const candidates = parseGsiAddressSearchPayload([
    { geometry: { coordinates: [139.767, 35.681] }, properties: { title: '東京駅' } },
    { geometry: { coordinates: ['bad', 35] }, properties: { title: '除外' } }
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].title, '東京駅');
  const reverse = parseGsiReverseGeocodePayload({ results: { muniCd: '13101', lv01Nm: '丸の内一丁目' } });
  assert.equal(reverse.address, '13101 丸の内一丁目');

  let requested = '';
  const result = await searchGsiAddress('東京駅', {
    fetchImpl: async (url) => {
      requested = String(url);
      return { ok: true, json: async () => [{ geometry: { coordinates: [139.767, 35.681] }, properties: { title: '東京駅' } }] };
    }
  });
  assert.match(requested, /msearch\.gsi\.go\.jp/);
  assert.equal(result.candidates.length, 1);
});

test('offline map tile helper only allows declared official hosts', async () => {
  const { fetchMapTile } = await import('../src/public-data.js');
  let options;
  const response = await fetchMapTile('https://cyberjapandata.gsi.go.jp/xyz/pale/1/1/1.png', {
    fetchImpl: async (_url, init) => { options = init; return { ok: true }; }
  });
  assert.equal(response.ok, true);
  assert.equal(options.mode, 'no-cors');
  assert.equal(options.credentials, 'omit');
  await assert.rejects(() => fetchMapTile('https://example.com/tile.png'), /許可されていない/);
});
