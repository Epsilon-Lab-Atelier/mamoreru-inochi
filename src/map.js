export const BASE_MAP = Object.freeze({
  id: 'pale',
  name: '地理院淡色地図',
  template: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  attribution: '国土地理院'
});

export const HAZARD_MAP_LAYERS = Object.freeze({
  none: { id: 'none', name: '災害レイヤなし', templates: [], attribution: '' },
  flood: {
    id: 'flood', name: '洪水浸水想定区域',
    templates: ['https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png'],
    attribution: 'ハザードマップポータルサイト'
  },
  inlandFlood: {
    id: 'inlandFlood', name: '内水浸水想定区域',
    templates: ['https://disaportaldata.gsi.go.jp/raster/02_naisui_data/{z}/{x}/{y}.png'],
    attribution: 'ハザードマップポータルサイト'
  },
  landslide: {
    id: 'landslide', name: '土砂災害警戒区域',
    templates: [
      'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
      'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png',
      'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png'
    ],
    attribution: 'ハザードマップポータルサイト'
  },
  tsunami: {
    id: 'tsunami', name: '津波浸水想定',
    templates: ['https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png'],
    attribution: 'ハザードマップポータルサイト'
  },
  stormSurge: {
    id: 'stormSurge', name: '高潮浸水想定区域',
    templates: ['https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png'],
    attribution: 'ハザードマップポータルサイト'
  }
});

export const MAP_MIN_ZOOM = 5;
export const MAP_MAX_ZOOM = 17;
export const MAP_TILE_SIZE = 256;

export const DEFAULT_MAP_VIEW = Object.freeze({
  latitude: 36.2048,
  longitude: 138.2529,
  zoom: 5,
  hazardLayer: 'none',
  opacity: 0.62
});

export function clampLatitude(value) {
  return Math.max(-85.05112878, Math.min(85.05112878, Number(value)));
}

export function wrapLongitude(value) {
  const number = Number(value);
  return ((number + 180) % 360 + 360) % 360 - 180;
}

export function clampZoom(value) {
  return Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Math.round(Number(value) || 14)));
}

export function longitudeToWorldX(longitude, zoom) {
  return ((wrapLongitude(longitude) + 180) / 360) * (2 ** zoom) * MAP_TILE_SIZE;
}

export function latitudeToWorldY(latitude, zoom) {
  const latRad = clampLatitude(latitude) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * (2 ** zoom) * MAP_TILE_SIZE;
}

export function worldXToLongitude(worldX, zoom) {
  return wrapLongitude(worldX / ((2 ** zoom) * MAP_TILE_SIZE) * 360 - 180);
}

export function worldYToLatitude(worldY, zoom) {
  const normalized = Math.PI * (1 - 2 * worldY / ((2 ** zoom) * MAP_TILE_SIZE));
  return 180 / Math.PI * Math.atan(Math.sinh(normalized));
}

export function moveMapCenter(center, direction, ratio = 0.35) {
  const zoom = clampZoom(center.zoom);
  let worldX = longitudeToWorldX(center.longitude, zoom);
  let worldY = latitudeToWorldY(center.latitude, zoom);
  const delta = MAP_TILE_SIZE * Math.max(0.05, Number(ratio) || 0.35);
  if (direction === 'left') worldX -= delta;
  if (direction === 'right') worldX += delta;
  if (direction === 'up') worldY -= delta;
  if (direction === 'down') worldY += delta;
  return {
    latitude: clampLatitude(worldYToLatitude(worldY, zoom)),
    longitude: wrapLongitude(worldXToLongitude(worldX, zoom)),
    zoom
  };
}

// deltaX/deltaY are the visible map-content movement in CSS/viewBox pixels.
// Dragging the map to the right moves the geographic center to the west.
export function moveMapCenterByPixels(center, deltaX, deltaY) {
  const zoom = clampZoom(center.zoom);
  const centerX = longitudeToWorldX(center.longitude, zoom);
  const centerY = latitudeToWorldY(center.latitude, zoom);
  return {
    latitude: clampLatitude(worldYToLatitude(centerY - Number(deltaY || 0), zoom)),
    longitude: wrapLongitude(worldXToLongitude(centerX - Number(deltaX || 0), zoom)),
    zoom
  };
}

export function pointFromViewport(center, xRatio, yRatio, width = 768, height = 512) {
  const zoom = clampZoom(center.zoom);
  const centerX = longitudeToWorldX(center.longitude, zoom);
  const centerY = latitudeToWorldY(center.latitude, zoom);
  const worldX = centerX + (Number(xRatio) - 0.5) * width;
  const worldY = centerY + (Number(yRatio) - 0.5) * height;
  return {
    latitude: clampLatitude(worldYToLatitude(worldY, zoom)),
    longitude: wrapLongitude(worldXToLongitude(worldX, zoom)),
    zoom
  };
}

export function tileUrl(template, z, x, y) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export function buildMapTiles(center, { width = 768, height = 512, padding = 0 } = {}) {
  const zoom = clampZoom(center.zoom);
  const worldX = longitudeToWorldX(center.longitude, zoom);
  const worldY = latitudeToWorldY(center.latitude, zoom);
  const leftWorld = worldX - width / 2;
  const topWorld = worldY - height / 2;
  const startX = Math.floor(leftWorld / MAP_TILE_SIZE) - padding;
  const endX = Math.floor((leftWorld + width) / MAP_TILE_SIZE) + padding;
  const startY = Math.floor(topWorld / MAP_TILE_SIZE) - padding;
  const endY = Math.floor((topWorld + height) / MAP_TILE_SIZE) + padding;
  const count = 2 ** zoom;
  const tiles = [];
  for (let rawX = startX; rawX <= endX; rawX += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= count) continue;
      const x = ((rawX % count) + count) % count;
      tiles.push({
        z: zoom,
        x,
        y,
        left: rawX * MAP_TILE_SIZE - leftWorld,
        top: y * MAP_TILE_SIZE - topWorld
      });
    }
  }
  return { zoom, width, height, tiles };
}

export function urlsForMap(center, layerId, options = {}) {
  const layout = buildMapTiles(center, options);
  const layer = HAZARD_MAP_LAYERS[layerId] || HAZARD_MAP_LAYERS.none;
  const urls = [];
  for (const tile of layout.tiles) {
    urls.push(tileUrl(BASE_MAP.template, tile.z, tile.x, tile.y));
    for (const template of layer.templates) urls.push(tileUrl(template, tile.z, tile.x, tile.y));
  }
  return [...new Set(urls)];
}

export function mapCacheName(version = '0.3.1') {
  return `mamoreru-inochi-map-${version}`;
}

export function markerPosition(center, point, width = 768, height = 512) {
  const zoom = clampZoom(center.zoom);
  const centerX = longitudeToWorldX(center.longitude, zoom);
  const centerY = latitudeToWorldY(center.latitude, zoom);
  let pointX = longitudeToWorldX(point.longitude, zoom);
  const worldWidth = (2 ** zoom) * MAP_TILE_SIZE;
  while (pointX - centerX > worldWidth / 2) pointX -= worldWidth;
  while (pointX - centerX < -worldWidth / 2) pointX += worldWidth;
  const pointY = latitudeToWorldY(point.latitude, zoom);
  return { left: width / 2 + pointX - centerX, top: height / 2 + pointY - centerY };
}
