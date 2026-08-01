import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAZARD_MAP_LAYERS,
  buildMapTiles,
  clampZoom,
  markerPosition,
  moveMapCenter,
  pointFromViewport,
  urlsForMap
} from '../src/map.js';

test('map tile layout is bounded and uses public official tile hosts', () => {
  const center = { latitude: 35.681236, longitude: 139.767125, zoom: 14 };
  const layout = buildMapTiles(center, { width: 768, height: 512, padding: 0 });
  assert.ok(layout.tiles.length >= 6 && layout.tiles.length <= 20);
  const urls = urlsForMap(center, 'flood', { width: 768, height: 512, padding: 0 });
  assert.ok(urls.some((url) => url.includes('cyberjapandata.gsi.go.jp')));
  assert.ok(urls.some((url) => url.includes('disaportaldata.gsi.go.jp')));
  assert.equal(new Set(urls).size, urls.length);
});

test('map controls clamp zoom and support non-drag movement', () => {
  assert.equal(clampZoom(1), 5);
  assert.equal(clampZoom(30), 17);
  const center = { latitude: 35.68, longitude: 139.76, zoom: 14 };
  const moved = moveMapCenter(center, 'right');
  assert.ok(moved.longitude > center.longitude);
  const selected = pointFromViewport(center, 0.5, 0.5);
  assert.ok(Math.abs(selected.latitude - center.latitude) < 0.0001);
  assert.ok(Math.abs(selected.longitude - center.longitude) < 0.0001);
});

test('map markers return finite on-screen coordinates near the center', () => {
  const center = { latitude: 35.681, longitude: 139.767, zoom: 14 };
  const marker = markerPosition(center, { latitude: 35.682, longitude: 139.768 });
  assert.ok(Number.isFinite(marker.left));
  assert.ok(Number.isFinite(marker.top));
  assert.ok(marker.left > 0 && marker.left < 768);
  assert.ok(marker.top > 0 && marker.top < 512);
});

test('hazard layers cover the requested disaster types', () => {
  for (const id of ['flood', 'inlandFlood', 'landslide', 'tsunami', 'stormSurge']) {
    assert.ok(HAZARD_MAP_LAYERS[id]);
    assert.ok(HAZARD_MAP_LAYERS[id].templates.length >= 1);
  }
});
