import {
  ANSWER_OPTIONS,
  CUSTOM_CONTACT_TYPES,
  EMERGENCY_CONTACTS,
  EMERGENCY_CONTACT_EASY_TEXT,
  EMERGENCY_GUIDES,
  EMERGENCY_GUIDE_EASY_TEXT,
  HAZARDS,
  HOME_SAFETY_GROUPS,
  INVENTORY_CATEGORIES,
  INVENTORY_STORAGE_LOCATIONS,
  OFFICIAL_SOURCES,
  PREPAREDNESS_ARTICLES,
  RISK_QUESTIONS,
  RISK_SECTIONS,
  STOCKPILE_FIELDS
} from './data.js';
import {
  GSI_HAZARD_LAYERS,
  JMA_OFFICES,
  PUBLIC_DATA_PROVIDERS,
  buildGsiMapUrl,
  fetchGsiPlaces,
  fetchJmaWarnings,
  fetchJshisHazard,
  formatProbability,
  normalizeCoordinates,
  fetchMapTile,
  reverseGeocodeGsi,
  searchGsiAddress
} from './public-data.js';
import { calculateRiskAssessment, emptyRiskAnswers, RISK_LEVELS } from './risk-engine.js';
import {
  FAMILY_SHARE_FIELDS,
  buildFamilyShareUrl,
  clearFamilyShareFromUrl,
  createFamilyShareBundle,
  decodeSharePayload,
  defaultFamilyShareFields,
  familyShareSize,
  mergeFamilyPlan,
  readFamilyShareFromLocation
} from './share.js';
import {
  BASE_MAP,
  HAZARD_MAP_LAYERS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  buildMapTiles,
  clampZoom,
  mapCacheName,
  markerPosition,
  moveMapCenter,
  pointFromViewport,
  tileUrl,
  urlsForMap
} from './map.js';
import {
  DRILL_DURATIONS,
  DRILL_SCENARIOS,
  completeDrillSession,
  createDefaultDrillState,
  createDrillCalendarIcs,
  createDrillSession,
  drillProgress
} from './drills.js';

import {
  STOCKPILE_SCENARIOS,
  analyzeInventory,
  applyStockpileScenario,
  calculateStockpile,
  createDefaultHousehold,
  createDefaultStockpile,
  householdPeople,
  stockpileScenario
} from './stockpile-engine.js';
import {
  changeStorageMode,
  clearSavedData,
  exportBackup,
  getStorageMetadata,
  importBackup,
  loadSavedState,
  requestPersistentStorage,
  saveState,
  storageEstimate,
  unlockSavedState
} from './storage.js';
import {
  APP_VERSION,
  SCHEMA_VERSION,
  createId,
  debounce,
  deepClone,
  downloadText,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatNumber,
  percent,
  readFileText,
  routeParts,
  safeJsonParse,
  toNonNegativeInteger,
  toNonNegativeNumber,
  todayIso
} from './utils.js';

const main = document.querySelector('#main-content');
const statusStrip = document.querySelector('#persistent-status');
const toastRegion = document.querySelector('#toast-region');
const dialogRoot = document.querySelector('#dialog-root');
const updateBanner = document.querySelector('#app-update-banner');
const fontMenuButton = document.querySelector('#font-menu-button');
const fontSizePanel = document.querySelector('#font-size-panel');

let state = createDefaultState();
let protectedPassphrase = '';
let isLocked = false;
let lockedMetadata = null;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let editingInventoryId = null;
let editingCustomContactId = null;
let updateCheckTimer = null;
let lastUpdateCheckAt = 0;
const sessionNetworkConsents = new Set();
let visibleMapLocationId = null;
let locationDraft = null;
let addressSearchResults = [];
let familySharePreview = null;
let mapView = { latitude: 35.681236, longitude: 139.767125, zoom: 14, hazardLayer: 'none', opacity: 0.62 };
const INSTALL_GUIDE_ARTICLE_URL = '';
let offlineStatus = {
  online: navigator.onLine,
  serviceWorkerSupported: 'serviceWorker' in navigator,
  controlled: Boolean(navigator.serviceWorker?.controller),
  cacheReady: false,
  updateAvailable: false
};

const persistDebounced = debounce(() => persistCurrentState(), 350);

function createDefaultState() {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    onboardingComplete: false,
    storageMode: 'none',
    preferences: {
      fontScale: 100,
      lineHeight: 1.7,
      letterSpacing: 0,
      highContrast: false,
      darkMode: false,
      reducedMotion: false,
      simpleLayout: false,
      easyJapanese: false,
      largeTargets: false,
      underlineLinks: false
    },
    install: {
      dismissedAt: null,
      manuallyInstalled: false,
      lastPromptAt: null
    },
    diagnosis: {
      answers: emptyRiskAnswers(),
      result: null,
      completedAt: null,
      skipped: false,
      postChoicePending: false
    },
    household: createDefaultHousehold(),
    stockpile: createDefaultStockpile(),
    homeSafety: {
      items: {},
      updatedAt: null
    },
    familyPlan: {
      primaryMeetingPlace: '',
      secondaryMeetingPlace: '',
      evacuationPlace: '',
      hazardDestinations: {
        earthquake: '',
        flood: '',
        tsunami: '',
        landslide: '',
        fire: ''
      },
      prohibitedRoutes: '',
      contactRule: '',
      outOfAreaContact: '',
      pickupRule: '',
      supportPlan: '',
      petPlan: '',
      utilityRule: '',
      notes: '',
      reviewDate: '',
      nextReviewDate: '',
      updatedAt: null
    },
    drills: createDefaultDrillState(),
    locations: {
      items: [],
      activeId: null,
      selectedHazard: 'earthquake',
      map: {
        hazardLayer: 'none',
        opacity: 0.62,
        showShelters: true
      },
      offlineMaps: []
    },
    network: {
      consents: {},
      logs: []
    },
    contacts: {
      custom: [],
      strongCallLock: false,
      unlockedUntil: null
    },
    audit: {
      createdAt: now,
      lastSavedAt: null,
      lastExportAt: null,
      lastImportAt: null,
      migratedAt: null,
      migratedFromSchema: null
    }
  };
}

function mergeWithDefaults(saved) {
  const defaults = createDefaultState();
  if (!saved || typeof saved !== 'object') return defaults;
  const previousSchema = Number(saved.schemaVersion || 1);
  const oldEasyMode = Boolean(saved.preferences?.easyMode);
  const oldEvacuation = String(saved.familyPlan?.evacuationPlace || '');
  const next = {
    ...defaults,
    ...saved,
    preferences: {
      ...defaults.preferences,
      ...(saved.preferences ?? {}),
      simpleLayout: saved.preferences?.simpleLayout ?? oldEasyMode,
      easyJapanese: saved.preferences?.easyJapanese ?? false
    },
    install: { ...defaults.install, ...(saved.install ?? {}) },
    diagnosis: {
      ...defaults.diagnosis,
      ...(saved.diagnosis ?? {}),
      answers: { ...defaults.diagnosis.answers, ...(saved.diagnosis?.answers ?? {}) }
    },
    household: { ...defaults.household, ...(saved.household ?? {}) },
    stockpile: {
      ...defaults.stockpile,
      ...(saved.stockpile ?? {}),
      quantities: {
        ...defaults.stockpile.quantities,
        ...(saved.stockpile?.quantities ?? {})
      },
      advanced: {
        ...defaults.stockpile.advanced,
        ...(saved.stockpile?.advanced ?? {})
      },
      inventory: Array.isArray(saved.stockpile?.inventory)
        ? saved.stockpile.inventory.map((item) => ({ storageArea: item.storageArea || '自宅', ...item }))
        : []
    },
    homeSafety: {
      ...defaults.homeSafety,
      ...(saved.homeSafety ?? {}),
      items: { ...defaults.homeSafety.items, ...(saved.homeSafety?.items ?? {}) }
    },
    familyPlan: {
      ...defaults.familyPlan,
      ...(saved.familyPlan ?? {}),
      hazardDestinations: {
        ...defaults.familyPlan.hazardDestinations,
        ...(saved.familyPlan?.hazardDestinations ?? {}),
        ...(oldEvacuation && !saved.familyPlan?.hazardDestinations
          ? { earthquake: oldEvacuation, flood: oldEvacuation }
          : {})
      }
    },
    drills: {
      ...defaults.drills,
      ...(saved.drills ?? {}),
      history: Array.isArray(saved.drills?.history) ? saved.drills.history.slice(0, 50) : []
    },
    locations: {
      ...defaults.locations,
      ...(saved.locations ?? {}),
      map: { ...defaults.locations.map, ...(saved.locations?.map ?? {}) },
      offlineMaps: Array.isArray(saved.locations?.offlineMaps) ? saved.locations.offlineMaps : [],
      items: Array.isArray(saved.locations?.items)
        ? saved.locations.items.map((item) => ({
            ...item,
            addressLabel: String(item?.addressLabel || ''),
            publicData: {
              jshis: item?.publicData?.jshis ?? null,
              gsi: item?.publicData?.gsi ?? null,
              jma: item?.publicData?.jma ?? null
            }
          }))
        : []
    },
    network: {
      ...defaults.network,
      ...(saved.network ?? {}),
      consents: { ...defaults.network.consents, ...(saved.network?.consents ?? {}) },
      logs: Array.isArray(saved.network?.logs) ? saved.network.logs.slice(0, 100) : []
    },
    contacts: {
      ...defaults.contacts,
      ...(saved.contacts ?? {}),
      custom: Array.isArray(saved.contacts?.custom) ? saved.contacts.custom : []
    },
    audit: { ...defaults.audit, ...(saved.audit ?? {}) },
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION
  };
  delete next.preferences.easyMode;
  if (previousSchema < SCHEMA_VERSION) {
    next.audit.migratedAt = new Date().toISOString();
    next.audit.migratedFromSchema = previousSchema;
  }
  return next;
}

async function initialize() {
  bindGlobalEvents();
  await registerServiceWorker();
  await refreshOfflineStatus();

  try {
    const saved = await loadSavedState();
    lockedMetadata = saved.metadata;
    if (saved.locked) {
      isLocked = true;
      state.storageMode = 'protected';
      if (saved.metadata?.preferences) {
        state.preferences = { ...state.preferences, ...saved.metadata.preferences };
      }
    } else if (saved.state) {
      state = mergeWithDefaults(saved.state);
      if (state.audit.migratedFromSchema && state.storageMode !== 'none') {
        try {
          await saveState(state, '');
        } catch {
          showToast('以前の版のデータを読み込みましたが、新形式での保存は完了していません。バックアップを書き出してから、もう一度保存してください。', 'error');
        }
      }
    }
  } catch (error) {
    showToast(error.message || '保存データの読み込みに失敗しました。', 'error');
  }

  try {
    familySharePreview = readFamilyShareFromLocation(location.href);
  } catch (error) {
    familySharePreview = { error: error.message || '家族計画の共有データを読み取れませんでした。' };
  }

  const selected = activeLocation();
  if (selected) {
    mapView = {
      latitude: Number(selected.latitude),
      longitude: Number(selected.longitude),
      zoom: 14,
      hazardLayer: state.locations.map?.hazardLayer || 'none',
      opacity: Number(state.locations.map?.opacity ?? 0.62)
    };
  }

  applyPreferences();
  render();
  scheduleUpdateChecks();
  if (state.audit.migratedAt && state.storageMode !== 'none' && !isLocked) {
    persistCurrentState().catch(() => {});
  }
}

function bindGlobalEvents() {
  window.addEventListener('hashchange', render);
  window.addEventListener('online', async () => {
    offlineStatus.online = true;
    await refreshOfflineStatus();
    renderOfflineIndicatorOnly();
    checkForUpdate({ quiet: true, minIntervalMs: 0 });
  });
  window.addEventListener('offline', () => {
    offlineStatus.online = false;
    renderOfflineIndicatorOnly();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    renderOfflineIndicatorOnly();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    state.install.manuallyInstalled = true;
    state.install.dismissedAt = null;
    persistDebounced();
    showToast('ホーム画面への追加が完了しました。');
    render();
  });

  fontMenuButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = fontSizePanel?.hidden !== false;
    if (fontSizePanel) fontSizePanel.hidden = !willOpen;
    fontMenuButton.setAttribute('aria-expanded', String(willOpen));
  });


  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate({ quiet: true, minIntervalMs: 60_000 });
  });
  window.addEventListener('focus', () => checkForUpdate({ quiet: true, minIntervalMs: 60_000 }));

  document.addEventListener('click', handleGlobalClick);
}

async function handleGlobalClick(event) {
  const fontOption = event.target.closest('[data-font-scale]');
  if (fontOption) {
    event.preventDefault();
    setFontScale(Number(fontOption.dataset.fontScale));
    return;
  }
  if (!event.target.closest('.font-menu-wrap')) closeFontMenu();

  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'install-pwa') {
    event.preventDefault();
    await installPwa();
  } else if (action === 'dismiss-install') {
    event.preventDefault();
    state.install.dismissedAt = new Date().toISOString();
    persistDebounced();
    render();
  } else if (action === 'mark-installed') {
    event.preventDefault();
    state.install.manuallyInstalled = true;
    state.install.dismissedAt = null;
    persistDebounced();
    render();
  } else if (action === 'unlock-calls-temporarily') {
    event.preventDefault();
    state.contacts.unlockedUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    persistDebounced();
    showToast('緊急電話の追加ロックを10分間解除しました。');
    render();
  } else if (action === 'redo-diagnosis') {
    event.preventDefault();
    const confirmed = await confirmDialog(
      '診断を最初からやり直しますか？',
      '現在の回答と診断結果を消去し、新しい回答を始めます。備蓄や家族計画は消えません。',
      'やり直す'
    );
    if (confirmed) {
      state.diagnosis = {
        answers: emptyRiskAnswers(),
        result: null,
        completedAt: null,
        skipped: false,
        postChoicePending: false
      };
      persistDebounced();
      location.hash = '#/diagnosis/area';
    }
  } else if (action === 'skip-diagnosis') {
    event.preventDefault();
    state.diagnosis.skipped = true;
    state.diagnosis.postChoicePending = false;
    persistDebounced();
    location.hash = '#/';
  } else if (action === 'mark-unanswered') {
    event.preventDefault();
    for (const question of RISK_QUESTIONS) {
      if (!state.diagnosis.answers[question.id]) state.diagnosis.answers[question.id] = 'later';
    }
    persistDebounced();
    render();
    showToast('未回答の項目を「あとで確認」にしました。');
  } else if (action === 'print') {
    event.preventDefault();
    window.print();
  } else if (action === 'request-persistence') {
    event.preventDefault();
    await handlePersistentStorageRequest();
  } else if (action === 'export-backup') {
    event.preventDefault();
    await handleBackupExport();
  } else if (action === 'delete-all-data') {
    event.preventDefault();
    await handleDeleteAllData();
  } else if (action === 'check-update') {
    event.preventDefault();
    await checkForUpdate();
  } else if (action === 'apply-update') {
    event.preventDefault();
    if (serviceWorkerRegistration?.waiting) {
      serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } else if (action === 'dismiss-update') {
    event.preventDefault();
    updateBanner.hidden = true;
  } else if (action === 'use-current-location') {
    event.preventDefault();
    await fillCurrentLocation();
  } else if (action === 'location-select') {
    event.preventDefault();
    state.locations.activeId = target.dataset.id || null;
    locationDraft = null;
    addressSearchResults = [];
    visibleMapLocationId = null;
    const selected = activeLocation();
    if (selected) resetMapViewFromPoint(selected.latitude, selected.longitude, 14);
    persistDebounced();
    render();
  } else if (action === 'location-delete') {
    event.preventDefault();
    await deleteLocation(target.dataset.id);
  } else if (action === 'fetch-jshis') {
    event.preventDefault();
    await fetchLocationPublicData('jshis');
  } else if (action === 'fetch-gsi') {
    event.preventDefault();
    await fetchLocationPublicData('gsi');
  } else if (action === 'fetch-jma') {
    event.preventDefault();
    await fetchLocationPublicData('jma');
  } else if (action === 'show-gsi-map') {
    event.preventDefault();
    await showLocationMap();
  } else if (action === 'clear-location-data') {
    event.preventDefault();
    await clearActiveLocationPublicData();
  } else if (action === 'clear-network-log') {
    event.preventDefault();
    state.network.logs = [];
    persistDebounced();
    render();
  } else if (action === 'contact-call') {
    event.preventDefault();
    await confirmPhoneCall(target.dataset.contactId, target.dataset.customId);
  } else if (action === 'contact-edit') {
    event.preventDefault();
    editingCustomContactId = target.dataset.id || null;
    render();
  } else if (action === 'contact-cancel') {
    event.preventDefault();
    editingCustomContactId = null;
    render();
  } else if (action === 'contact-delete') {
    event.preventDefault();
    await deleteCustomContact(target.dataset.id);
  } else if (action === 'inventory-edit') {
    event.preventDefault();
    editingInventoryId = target.dataset.id || null;
    render();
  } else if (action === 'inventory-cancel') {
    event.preventDefault();
    editingInventoryId = null;
    render();
  } else if (action === 'inventory-delete') {
    event.preventDefault();
    await deleteInventoryItem(target.dataset.id);
  } else if (action === 'stockpile-recalculate') {
    event.preventDefault();
    state.stockpile.result = calculateStockpile(state.household, state.stockpile);
    state.stockpile.lastCheckedAt = new Date().toISOString();
    persistDebounced();
    location.hash = '#/stockpile/results';
  } else if (action === 'post-diagnosis-choice') {
    state.diagnosis.postChoicePending = false;
    persistDebounced();
    if (target.tagName === 'BUTTON') {
      event.preventDefault();
      render();
    }
  }
}

function setFontScale(scale) {
  const allowed = [85, 100, 115, 130, 150, 175, 200];
  const normalized = allowed.includes(Number(scale)) ? Number(scale) : 100;
  state.preferences.fontScale = normalized;
  applyPreferences();
  persistDebounced();
}

function closeFontMenu() {
  if (fontSizePanel) fontSizePanel.hidden = true;
  fontMenuButton?.setAttribute('aria-expanded', 'false');
}

function applyPreferences() {
  const scale = Number(state.preferences.fontScale) || 100;
  const lineHeight = Math.max(1.4, Math.min(2.2, Number(state.preferences.lineHeight) || 1.7));
  const letterSpacing = Math.max(0, Math.min(0.16, Number(state.preferences.letterSpacing) || 0));
  document.documentElement.style.setProperty('--font-scale', String(scale / 100));
  document.documentElement.style.setProperty('--content-line-height', String(lineHeight));
  document.documentElement.style.setProperty('--content-letter-spacing', `${letterSpacing}em`);
  document.body.classList.toggle('high-contrast', Boolean(state.preferences.highContrast));
  document.body.classList.toggle('dark-mode', Boolean(state.preferences.darkMode));
  document.body.classList.toggle('reduced-motion', Boolean(state.preferences.reducedMotion));
  document.body.classList.toggle('easy-mode', Boolean(state.preferences.simpleLayout));
  document.body.classList.toggle('easy-japanese', Boolean(state.preferences.easyJapanese));
  document.body.classList.toggle('large-targets', Boolean(state.preferences.largeTargets));
  document.body.classList.toggle('underline-links', Boolean(state.preferences.underlineLinks));
  document.documentElement.lang = 'ja';
  if (fontMenuButton) fontMenuButton.textContent = `文字 ${scale}%`;
  const current = document.querySelector('#font-size-current');
  if (current) current.innerHTML = `<strong>文字サイズ: ${scale}%</strong>`;
  document.querySelectorAll('[data-font-scale]').forEach((button) => {
    const selected = Number(button.dataset.fontScale) === scale;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function uiText(normal, easy) {
  return state.preferences.easyJapanese && easy ? easy : normal;
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || state.install.manuallyInstalled;
}

function installPromptRecentlyDismissed() {
  const dismissed = Date.parse(state.install.dismissedAt || '');
  return Number.isFinite(dismissed) && Date.now() - dismissed < 14 * 86_400_000;
}

async function persistCurrentState() {
  if (state.storageMode === 'none') return;
  try {
    await saveState(state, protectedPassphrase);
    state.audit.lastSavedAt = new Date().toISOString();
  } catch (error) {
    showToast(error.message || '端末への保存に失敗しました。', 'error');
  }
}

function currentRoute() {
  const parts = routeParts();
  return {
    parts,
    first: parts[0] || 'home',
    second: parts[1] || '',
    third: parts[2] || ''
  };
}

function render() {
  const route = currentRoute();
  updateNavigation(route.first);
  renderPersistentStatus(route);

  if (isLocked && !['emergency', 'contacts', 'help', 'about', 'sources', 'install'].includes(route.first)) {
    main.innerHTML = renderUnlockPage();
    bindUnlockPage();
    focusPageHeading();
    return;
  }

  if (!state.onboardingComplete && !['emergency', 'contacts', 'help', 'about', 'sources', 'install'].includes(route.first)) {
    main.innerHTML = renderOnboarding();
    bindOnboarding();
    focusPageHeading();
    return;
  }

  let html;
  switch (route.first) {
    case 'home':
      html = renderDashboard();
      break;
    case 'diagnosis':
      html = route.second === 'results' ? renderDiagnosisResults() : renderDiagnosis(route.second || 'area');
      break;
    case 'stockpile':
      html = renderStockpileRoute(route.second || 'household');
      break;
    case 'inventory':
      html = renderInventory();
      break;
    case 'safety':
      html = renderHomeSafety();
      break;
    case 'family':
      html = renderFamilyPlan(route.second || 'edit');
      break;
    case 'drills':
      html = renderDrills(route.second || 'home');
      break;
    case 'locations':
      html = renderLocations();
      break;
    case 'contacts':
      html = renderContacts();
      break;
    case 'install':
      html = renderInstallAndUpdates();
      break;
    case 'emergency':
      html = route.second ? renderEmergencyDetail(route.second) : renderEmergencyOverview();
      break;
    case 'learn':
      html = renderPreparednessGuide();
      break;
    case 'help':
      html = renderHelp();
      break;
    case 'settings':
      html = renderSettings();
      break;
    case 'print':
      html = renderPrintPage();
      break;
    case 'sources':
      html = renderSources();
      break;
    case 'about':
      html = renderAbout();
      break;
    default:
      html = renderNotFound();
  }
  main.innerHTML = html;
  bindPage(route);
  focusPageHeading();
}

function updateNavigation(route) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.dataset.nav === route || (route === 'inventory' && link.dataset.nav === 'stockpile');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderPersistentStatus(route) {
  if (!state.onboardingComplete || route.first === 'emergency' || isLocked) {
    statusStrip.innerHTML = '';
    return;
  }
  const result = state.diagnosis.result;
  if (!result) {
    statusStrip.innerHTML = `
      <div class="persistent-status-inner">
        <p><strong>生活環境のリスク診断:</strong> まだ完了していません。</p>
        <nav><a href="#/diagnosis/area">診断する</a></nav>
      </div>`;
    return;
  }
  statusStrip.innerHTML = `
    <div class="persistent-status-inner">
      <p><strong>診断:</strong> 備えの優先度 ${result.overallPriority}/5 / 判定の確かさ ${escapeHtml(result.confidence)} / ${escapeHtml(formatDateTime(result.completedAt || state.diagnosis.completedAt))}</p>
      <nav>
        <a href="#/diagnosis/results">詳しく見る</a>
        <a href="#/diagnosis/area" data-action="redo-diagnosis">もう一度診断</a>
      </nav>
    </div>`;
}

function pageHeader(eyebrow, title, description) {
  return `
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1 id="page-title" tabindex="-1">${escapeHtml(title)}</h1>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    </header>`;
}

function focusPageHeading() {
  requestAnimationFrame(() => {
    const heading = document.querySelector('#page-title');
    if (heading) heading.focus({ preventScroll: true });
  });
}

function showToast(message, tone = 'normal') {
  const toast = document.createElement('div');
  toast.className = `toast${tone === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4500);
}

function renderOnboarding() {
  return `
    <div class="page-container onboarding-shell">
      ${pageHeader('はじめに', '守れるいのち', '知る。備える。迷わず動く。生活環境に合わせて、防災の優先順位を整理します。')}

      <div class="notice danger">
        <h2>いま危険が迫っていますか？</h2>
        <p>初期設定や診断をせず、すぐに災害別の行動を確認できます。</p>
        <div class="button-row">
          <a class="button danger" href="#/emergency">今すぐ災害時の行動を見る</a>
        </div>
      </div>

      <section class="card section" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">診断や備蓄の入力は外部へ送信しません</h2>
        <div class="notice privacy">
          <p><strong>診断や備蓄チェックで入力した内容は、この端末のブラウザ内だけで処理します。</strong></p>
          <p>地域情報は、送信先・目的・内容を確認して許可した場合だけ、公的機関へ問い合わせます。EpsilonLabへ位置情報や回答を送る処理はありません。広告、アクセス解析、外部JavaScriptも使用していません。</p>
        </div>
        <p>同じ端末・同じブラウザを使う人は、保存内容を開ける場合があります。共有端末では「保存しない」または「パスフレーズで保護」を選んでください。ブラウザのデータ消去や端末故障で失われることがあるため、必要に応じてバックアップを書き出せます。</p>
      </section>

      <form id="onboarding-form" class="section" novalidate>
        <fieldset class="card form-section">
          <legend>1. 保存方法を選ぶ</legend>
          <div class="grid two">
            ${storageOption('none', '保存しない', 'この画面を開いている間だけ使います。再読み込みや終了で回答は消えます。')}
            ${storageOption('result', '診断結果だけ保存', '回答そのものは残さず、優先度・理由・確認項目だけを保存します。途中の回答は再読み込みで消えます。')}
            ${storageOption('full', 'この端末に保存', '診断回答、備蓄、家の安全、家族計画、地域情報、任意連絡先をブラウザ内へ保存します。', true)}
            ${storageOption('protected', 'パスフレーズで保護して保存', '保存内容を暗号化します。開くたびにパスフレーズが必要です。忘れると復元できません。')}
          </div>

          <div id="protected-fields" class="grid two section" hidden>
            <div class="form-field">
              <label for="onboarding-passphrase">パスフレーズ（8文字以上）</label>
              <input id="onboarding-passphrase" name="passphrase" type="password" autocomplete="new-password" minlength="8">
            </div>
            <div class="form-field">
              <label for="onboarding-passphrase-confirm">パスフレーズをもう一度</label>
              <input id="onboarding-passphrase-confirm" name="passphraseConfirm" type="password" autocomplete="new-password" minlength="8">
            </div>
            <p class="hint form-field full">パスフレーズはEpsilonLabへ送信されず、端末にもそのまま保存されません。再設定用の仕組みはないため、ご自身で安全に管理してください。</p>
          </div>
        </fieldset>

        <fieldset class="card form-section">
          <legend>2. 表示を選ぶ</legend>
          <div class="form-grid">
            <div class="form-field">
              <label for="initial-font-scale">文字サイズ</label>
              <select id="initial-font-scale" name="fontScale">
                ${[85,100,115,130,150,175,200].map((size) => `<option value="${size}"${Number(state.preferences.fontScale) === size ? ' selected' : ''}>${size === 85 ? '小さめ（85%）' : `${size}%`}</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <span class="form-label">表示補助</span>
              <label><input type="checkbox" name="highContrast"> コントラストを強くする</label>
              <label><input type="checkbox" name="reducedMotion"> 動きを減らす</label>
              <label><input type="checkbox" name="simpleLayout"> シンプル表示（1列中心）</label>
              <label><input type="checkbox" name="easyJapanese"> やさしい日本語を使う</label>
            </div>
          </div>
        </fieldset>

        <div class="notice warning section">
          <h2>診断結果について</h2>
          <p>このアプリは、入力内容から「備えの優先順位」を整理します。災害の発生や個人の被害を予測したり、安全を保証したりするものではありません。過度に不安をあおらず、次に確認できる行動を示します。</p>
        </div>

        <div class="button-row">
          <button class="button" type="submit" name="next" value="diagnosis">生活環境を診断する</button>
          <button class="button secondary" type="submit" name="next" value="home">後で診断してアプリを開く</button>
        </div>
      </form>
    </div>`;
}

function storageOption(value, title, description, checked = false) {
  return `
    <label class="storage-option">
      <input type="radio" name="storageMode" value="${value}"${checked ? ' checked' : ''}>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>
    </label>`;
}

function bindOnboarding() {
  const form = document.querySelector('#onboarding-form');
  const protectedFields = document.querySelector('#protected-fields');
  if (!form) return;

  form.addEventListener('change', (event) => {
    if (event.target.name === 'storageMode') {
      protectedFields.hidden = event.target.value !== 'protected';
    }
    if (event.target.name === 'fontScale') {
      state.preferences.fontScale = Number(event.target.value);
      applyPreferences();
    }
    if (['highContrast', 'reducedMotion', 'simpleLayout', 'easyJapanese'].includes(event.target.name)) {
      state.preferences[event.target.name] = event.target.checked;
      applyPreferences();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const mode = String(data.get('storageMode') || 'full');
    const passphrase = String(data.get('passphrase') || '');
    const confirmation = String(data.get('passphraseConfirm') || '');

    if (mode === 'protected') {
      if (passphrase.length < 8) {
        showToast('パスフレーズは8文字以上にしてください。', 'error');
        document.querySelector('#onboarding-passphrase')?.focus();
        return;
      }
      if (passphrase !== confirmation) {
        showToast('2つのパスフレーズが一致しません。', 'error');
        document.querySelector('#onboarding-passphrase-confirm')?.focus();
        return;
      }
      protectedPassphrase = passphrase;
    }

    state.storageMode = mode;
    state.onboardingComplete = true;
    state.preferences = {
      fontScale: Number(data.get('fontScale') || 100),
      highContrast: data.has('highContrast'),
      reducedMotion: data.has('reducedMotion'),
      simpleLayout: data.has('simpleLayout'),
      easyJapanese: data.has('easyJapanese'),
      darkMode: false,
      largeTargets: false,
      underlineLinks: false,
      lineHeight: 1.7,
      letterSpacing: 0
    };
    state.diagnosis.skipped = event.submitter?.value === 'home';
    applyPreferences();

    try {
      if (mode !== 'none') {
        await saveState(state, protectedPassphrase);
        requestPersistentStorage().catch(() => {});
      } else {
        await clearSavedData();
      }
    } catch (error) {
      showToast(error.message || '保存方法を設定できませんでした。', 'error');
      return;
    }

    location.hash = event.submitter?.value === 'diagnosis' ? '#/diagnosis/area' : '#/';
  });
}

function renderUnlockPage() {
  return `
    <div class="page-container onboarding-shell">
      ${pageHeader('保護された保存データ', 'パスフレーズで開く', '診断・備蓄・家族計画は暗号化され、この端末のブラウザ内に保存されています。')}
      <div class="notice privacy">
        <p>パスフレーズは外部へ送信されません。正しいパスフレーズで復号できたときだけ、保存内容を表示します。</p>
      </div>
      <form id="unlock-form" class="card section">
        <div class="form-field">
          <label for="unlock-passphrase">パスフレーズ</label>
          <input id="unlock-passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus>
        </div>
        <div class="button-row">
          <button class="button" type="submit">保存データを開く</button>
          <a class="button danger" href="#/emergency">保存データを開かず災害時ガイドを見る</a>
        </div>
      </form>
      <details class="section">
        <summary>パスフレーズを忘れた場合</summary>
        <p>パスフレーズを復元する仕組みはありません。保存データを削除すると、この端末で初期設定からやり直せます。</p>
        <button class="button secondary" type="button" id="locked-delete">保存データを削除する</button>
      </details>
    </div>`;
}

function bindUnlockPage() {
  const form = document.querySelector('#unlock-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passphrase = String(new FormData(form).get('passphrase') || '');
    try {
      const unlocked = await unlockSavedState(passphrase);
      protectedPassphrase = passphrase;
      state = mergeWithDefaults(unlocked);
      state.storageMode = 'protected';
      if (state.audit.migratedFromSchema) await saveState(state, passphrase);
      isLocked = false;
      applyPreferences();
      showToast('保存データを開きました。');
      render();
    } catch (error) {
      showToast(error.message || '保存データを開けませんでした。', 'error');
      document.querySelector('#unlock-passphrase')?.select();
    }
  });

  document.querySelector('#locked-delete')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      '保護された保存データを削除しますか？',
      '診断、備蓄、家族計画を含む、このアプリの保存内容がすべて消えます。元に戻せません。',
      '削除する'
    );
    if (!confirmed) return;
    await clearSavedData();
    state = createDefaultState();
    isLocked = false;
    lockedMetadata = null;
    protectedPassphrase = '';
    location.hash = '#/';
    render();
  });
}

function storageModeLabel(mode = state.storageMode) {
  return {
    none: '保存しない',
    result: '診断結果だけ保存',
    full: 'この端末に保存',
    protected: '暗号化して保存'
  }[mode] || '未設定';
}

function homeSafetySummary() {
  const items = HOME_SAFETY_GROUPS.flatMap((group) => group.items);
  const complete = items.filter((item) => state.homeSafety.items[item.id]).length;
  return { total: items.length, complete, rate: percent(complete, items.length) };
}

function nextRecommendedAction() {
  const stockpile = state.stockpile.result;
  if (stockpile?.deficits?.length) {
    const item = stockpile.deficits[0];
    return {
      title: `${item.label}を3日分へ近づける`,
      text: `最低3日分まで、あと${formatNumber(item.missingMinimum, 1)}${item.unit}です。無理のない量から追加してください。`,
      href: '#/stockpile/results',
      label: '不足を確認する'
    };
  }
  if (!state.diagnosis.result) {
    return { title: '生活環境のリスクを確認する', text: '3〜5分ほどの質問で、優先したい備えを整理できます。', href: '#/diagnosis/area', label: '診断を始める' };
  }
  const planFields = ['primaryMeetingPlace', 'contactRule', 'pickupRule'];
  if (!planFields.every((key) => String(state.familyPlan[key] || '').trim())) {
    return { title: '家族の集合場所と連絡方法を決める', text: '電話がつながらない場合にも、同じ判断ができるよう短いルールを残します。', href: '#/family', label: '家族計画を作る' };
  }
  if (!state.drills.lastCompletedAt) {
    return { title: '3分の防災訓練を試す', text: '実物を確認すると、チェックリストだけでは気づきにくい不足が見つかります。', href: '#/drills', label: '訓練を選ぶ' };
  }
  return { title: '備蓄の期限を確認する', text: '期限の近い食品や電池を普段使いし、使った分を補充します。', href: '#/inventory', label: '備蓄リストを見る' };
}

function renderInstallPromotion() {
  if (isStandaloneApp() || installPromptRecentlyDismissed()) return '';
  return `
    <section class="install-promotion section" aria-labelledby="install-promotion-title">
      <div class="install-promotion-icon" aria-hidden="true"><img src="./assets/icons/icon-192.png" alt=""></div>
      <div class="install-promotion-content">
        <p class="eyebrow">スマホでこそ役立つ防災アプリ</p>
        <h2 id="install-promotion-title">ホーム画面に入れて、いざという時すぐ開けるようにする</h2>
        <p>URLを探さず1回で開けます。主要な行動ガイド、診断結果、備蓄、家族計画は、通信が不安定なときも確認できます。</p>
        <ul class="install-benefits">
          <li>アプリストア不要</li><li>無料・広告なし</li><li>アカウント不要</li><li>主要機能はオフライン対応</li>
        </ul>
        <div class="button-row">
          <a class="button install-primary" href="#/install">スマホに入れる</a>
          <button class="button subtle small" type="button" data-action="dismiss-install">今は表示しない</button>
        </div>
      </div>
    </section>`;
}

function renderDashboard() {
  const diagnosis = state.diagnosis.result;
  const stockpile = state.stockpile.result;
  const safety = homeSafetySummary();
  const familyDone = ['primaryMeetingPlace', 'contactRule', 'pickupRule']
    .some((key) => String(state.familyPlan[key] || '').trim());
  const today = nextRecommendedAction();
  const installed = isStandaloneApp();
  const regionalStamp = activeLocation()?.publicData?.jma?.fetchedAt || activeLocation()?.publicData?.gsi?.fetchedAt || activeLocation()?.publicData?.jshis?.fetchedAt;

  return `
    <div class="page-container">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-content">
          <p class="eyebrow">無料・広告なし・オフライン対応</p>
          <h1 id="page-title" tabindex="-1">守れるいのち</h1>
          <p class="subtitle">暮らしの防災アプリ</p>
          <p class="tagline">知る。備える。迷わず動く。</p>
          <p class="description">${escapeHtml(uiText('生活環境のリスクを確認し、家族に必要な備蓄と、災害時に取る行動を一つずつ整理します。', 'あなたの家で気をつける災害と、必要な物、逃げるときの行動を確認します。'))}</p>
          <div class="button-row">
            <a class="button primary-light" href="#/emergency">今、災害が起きている</a>
            <a class="button secondary-light" href="${diagnosis ? '#/diagnosis/results' : '#/diagnosis/area'}">${diagnosis ? '診断結果を見る' : '生活環境を診断する'}</a>
          </div>
        </div>
        <div class="hero-mark" aria-hidden="true"><img src="./assets/icons/icon-512.png" alt=""></div>
      </section>

      ${renderInstallPromotion()}

      <section class="today-action card section" aria-labelledby="today-action-title">
        <div class="section-heading">
          <div><p class="eyebrow">少しずつ整える</p><h2 id="today-action-title">今日できること</h2></div>
          <span class="badge brand">1つだけ</span>
        </div>
        <h3>${escapeHtml(today.title)}</h3>
        <p>${escapeHtml(today.text)}</p>
        <a class="button small" href="${escapeHtml(today.href)}">${escapeHtml(today.label)}</a>
      </section>

      ${state.audit.migratedFromSchema ? `<div class="notice success section"><p>以前の版で保存したデータをv${APP_VERSION}用に引き継ぎました。念のため、家族計画と地点情報を一度確認してください。</p></div>` : ''}

      <div class="grid dashboard-grid">
        <section class="card wide" aria-labelledby="diagnosis-card-title">
          <div class="section-heading"><div><p class="eyebrow">生活環境</p><h2 id="diagnosis-card-title">リスク診断</h2></div>${diagnosis ? `<span class="badge ${diagnosis.overallPriority >= 4 ? 'warning' : 'brand'}">優先度 ${diagnosis.overallPriority}/5</span>` : '<span class="badge">未診断</span>'}</div>
          ${diagnosis ? renderDashboardDiagnosis(diagnosis) : `<p>地形、住宅、家族、ライフライン、避難計画から、災害別に確認したい点を整理します。</p><div class="button-row"><a class="button" href="#/diagnosis/area">診断を始める</a></div>`}
        </section>

        <section class="card" aria-labelledby="stock-card-title">
          <p class="eyebrow">生活継続</p><h2 id="stock-card-title">備蓄チェック</h2>
          ${stockpile ? `<div class="kpi"><strong>${escapeHtml(stockpile.level.label)}</strong><small>重要項目の7日分達成度 ${stockpile.score}%</small></div><p>${stockpile.deficits.length ? `3日分までに不足: ${escapeHtml(stockpile.deficits.slice(0,2).map((item) => item.label).join('、'))}` : '水・食料・トイレなどの最低3日分を確認済みです。'}</p><a class="button small" href="#/stockpile/results">結果と不足を見る</a>` : `<p>家族構成に合わせ、3日分・7日分と、生活環境別の想定日数を計算します。</p><a class="button small" href="#/stockpile/household">備蓄を確認する</a>`}
        </section>

        <section class="card clickable"><a class="card-link" href="#/safety"><div class="card-icon" aria-hidden="true">家</div><h2>家の安全</h2><p>家具、寝室、窓、火災、停電、大雨の対策を確認します。</p><p class="link-label">${safety.complete}/${safety.total}項目を確認済み</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/family"><div class="card-icon" aria-hidden="true">人</div><h2>家族の防災計画</h2><p>集合場所、災害別の避難先、連絡方法、迎えを記録し、QRで共有できます。</p><p class="link-label">${familyDone ? '計画を確認・共有する' : '計画を作る'}</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/drills"><div class="card-icon" aria-hidden="true">練</div><h2>防災訓練</h2><p>3分から始められる状況別の訓練で、実物と家族の行動を確認します。</p><p class="link-label">${state.drills.lastCompletedAt ? `最終 ${escapeHtml(formatDate(state.drills.lastCompletedAt.slice(0,10)))}` : '訓練を選ぶ'}</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/inventory"><div class="card-icon" aria-hidden="true">庫</div><h2>備蓄リスト</h2><p>食品や用品の数量、保管場所、賞味期限を更新できます。</p><p class="link-label">${state.stockpile.inventory.length}品を登録中</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/locations"><div class="card-icon" aria-hidden="true">地</div><h2>地域情報・防災地図</h2><p>現在地、住所、地図から地点を選び、災害別の地図と避難場所を確認します。</p><p class="link-label">${state.locations.items.length}地点を登録中</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/contacts"><div class="card-icon" aria-hidden="true">電</div><h2>緊急連絡先</h2><p>119・110・118の使い分けと、相談・道路・災害伝言を確認します。</p><p class="link-label">用途を確認してから電話アプリへ</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/learn"><div class="card-icon" aria-hidden="true">知</div><h2>災害への備え</h2><p>平常時の準備、避難、情報の確かめ方を短い項目で読めます。</p><p class="link-label">防災ガイドを読む</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/install"><div class="card-icon" aria-hidden="true">＋</div><h2>スマホに入れる</h2><p>ホーム画面への追加、オフライン準備、新しい版への更新を案内します。</p><p class="link-label">${installed ? 'スマホアプリとして利用中' : '端末別の手順を見る'}</p></a></section>
        <section class="card clickable"><a class="card-link" href="#/help"><div class="card-icon" aria-hidden="true">?</div><h2>使い方とヘルプ</h2><p>保存、バックアップ、オフライン利用、表示設定を案内します。</p><p class="link-label">ガイドを見る</p></a></section>

        <section class="card full app-status-card" id="offline-card">
          ${renderOfflineCardContent()}
          <hr class="divider">
          <div class="grid four">
            <div class="kpi"><small>アプリ</small><strong>v${APP_VERSION}</strong></div>
            <div class="kpi"><small>保存方法</small><strong>${escapeHtml(storageModeLabel())}</strong></div>
            <div class="kpi"><small>最終バックアップ</small><strong>${escapeHtml(formatDateTime(state.audit.lastExportAt))}</strong></div>
            <div class="kpi"><small>地域情報</small><strong>${escapeHtml(formatDateTime(regionalStamp))}</strong></div>
          </div>
        </section>
      </div>

      <div class="notice privacy section">
        <h2>入力内容は、選んだ方法でこの端末に保存します</h2>
        <p>診断回答や備蓄情報は外部へ送信しません。地域情報は、送信先・目的・内容を確認して許可した場合だけ、公的機関へ問い合わせます。</p>
        <div class="button-row"><a class="button secondary small" href="#/settings">データと表示設定</a><a class="button secondary small" href="#/print">防災計画を印刷</a></div>
      </div>
    </div>`;
}

function renderDashboardDiagnosis(result) {
  const top = result.topHazards.slice(0, 3);
  return `
    <div class="score-box">
      <div class="score-number level-${result.overallPriority}" aria-label="備えの優先度 ${result.overallPriority}、5段階中">${result.overallPriority}/5</div>
      <div>
        <p><strong>${escapeHtml(result.overallLevelInfo.label)}</strong></p>
        <p class="muted">判定の確かさ ${escapeHtml(result.confidence)} / 回答 ${result.completion}%</p>
      </div>
    </div>
    ${top.length ? `<p><strong>特に確認したい分野:</strong> ${top.map((hazard) => escapeHtml(hazard.name)).join('、')}</p>` : '<p>回答を増やすと、災害別の優先順位が表示されます。</p>'}
    <div class="button-row">
      <a class="button small" href="#/diagnosis/results">詳しい理由を見る</a>
      <a class="button secondary small" href="#/diagnosis/area" data-action="redo-diagnosis">もう一度診断</a>
    </div>`;
}

function renderDiagnosis(sectionId) {
  const sectionIndex = Math.max(0, RISK_SECTIONS.findIndex((section) => section.id === sectionId));
  const section = RISK_SECTIONS[sectionIndex];
  const questions = RISK_QUESTIONS.filter((question) => question.section === section.id);
  const answered = RISK_QUESTIONS.filter((question) => state.diagnosis.answers[question.id]).length;
  const progressValue = percent(answered, RISK_QUESTIONS.length);

  return `
    <div class="page-container">
      ${pageHeader('生活環境のリスク診断', section.name, section.description)}
      <div class="notice privacy">
        <p><strong>回答は外部へ送信されません。</strong> 「わからない」「あとで確認」も選べます。不明な項目を危険または安全と決めつけず、判定の確かさと確認リストへ反映します。</p>
      </div>

      <div class="progress-wrap" aria-label="診断の進み具合">
        <div class="progress-meta"><span>全${RISK_QUESTIONS.length}問中 ${answered}問を選択</span><span>${progressValue}%</span></div>
        <progress class="native-progress" max="100" value="${progressValue}">${progressValue}%</progress>
      </div>

      <nav class="tabs" aria-label="診断の分野">
        ${RISK_SECTIONS.map((item, index) => {
          const count = RISK_QUESTIONS.filter((question) => question.section === item.id && state.diagnosis.answers[question.id]).length;
          const total = RISK_QUESTIONS.filter((question) => question.section === item.id).length;
          return `<a class="button ${item.id === section.id ? '' : 'secondary'} small" href="#/diagnosis/${item.id}"${item.id === section.id ? ' aria-current="step"' : ''}>${index + 1}. ${escapeHtml(item.name)} (${count}/${total})</a>`;
        }).join('')}
      </nav>

      <form id="diagnosis-form" novalidate>
        <input type="hidden" name="section" value="${escapeHtml(section.id)}">
        <div class="section">
          ${questions.map((question, index) => renderQuestion(question, index + 1, questions.length)).join('')}
        </div>
        <div class="button-row">
          ${sectionIndex > 0 ? `<a class="button secondary" href="#/diagnosis/${RISK_SECTIONS[sectionIndex - 1].id}">前の分野</a>` : '<a class="button secondary" href="#/">ホームへ戻る</a>'}
          ${sectionIndex < RISK_SECTIONS.length - 1
            ? `<button class="button" type="submit" name="move" value="next">次の分野へ</button>`
            : '<button class="button" type="submit" name="move" value="finish">診断結果を見る</button>'}
          <button class="button subtle" type="button" data-action="mark-unanswered">未回答を「あとで確認」にする</button>
        </div>
      </form>

      <div class="notice section">
        <p>途中でホームへ戻っても、保存方法が「この端末に保存」または「暗号化して保存」なら回答を続きから開けます。「診断結果だけ保存」では、診断が完了するまで途中回答は保存されません。</p>
      </div>
    </div>`;
}

function renderQuestion(question, number, total) {
  const selected = state.diagnosis.answers[question.id] || '';
  return `
    <fieldset class="card question-card">
      <legend>
        <span class="question-number">この分野の質問 ${number}/${total}</span>
        <span class="question-title">${escapeHtml(question.title)}</span>
      </legend>
      <p class="question-help">${escapeHtml(question.help)}</p>
      <div class="choice-grid">
        ${ANSWER_OPTIONS.map((option) => `
          <label class="choice">
            <input type="radio" name="${escapeHtml(question.id)}" value="${option.value}"${selected === option.value ? ' checked' : ''}>
            <span>${escapeHtml(option.label)}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

function bindDiagnosis(sectionId) {
  const form = document.querySelector('#diagnosis-form');
  if (!form) return;
  form.addEventListener('change', (event) => {
    if (event.target.type !== 'radio') return;
    state.diagnosis.answers[event.target.name] = event.target.value;
    state.diagnosis.skipped = false;
    persistDebounced();
    const answered = RISK_QUESTIONS.filter((question) => state.diagnosis.answers[question.id]).length;
    const progress = document.querySelector('.native-progress');
    const meta = document.querySelector('.progress-meta');
    const value = percent(answered, RISK_QUESTIONS.length);
    if (progress) progress.value = value;
    if (meta) meta.innerHTML = `<span>全${RISK_QUESTIONS.length}問中 ${answered}問を選択</span><span>${value}%</span>`;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sectionIndex = Math.max(0, RISK_SECTIONS.findIndex((section) => section.id === sectionId));
    if (event.submitter?.value === 'finish') {
      const result = calculateRiskAssessment(state.diagnosis.answers);
      const completedAt = new Date().toISOString();
      result.completedAt = completedAt;
      state.diagnosis.result = result;
      state.diagnosis.completedAt = completedAt;
      state.diagnosis.skipped = false;
      state.diagnosis.postChoicePending = true;
      await persistCurrentState();
      location.hash = '#/diagnosis/results';
      return;
    }
    const next = RISK_SECTIONS[Math.min(sectionIndex + 1, RISK_SECTIONS.length - 1)];
    location.hash = `#/diagnosis/${next.id}`;
  });
}

function renderDiagnosisResults() {
  const result = state.diagnosis.result;
  if (!result) {
    return `
      <div class="page-container">
        ${pageHeader('生活環境のリスク診断', '診断結果はまだありません', '質問へ回答すると、災害別の優先順位と具体的な確認事項を表示します。')}
        <div class="empty-state card">
          <h2>診断を始めましょう</h2>
          <p>わからない項目があっても進められます。</p>
          <a class="button" href="#/diagnosis/area">診断を始める</a>
        </div>
      </div>`;
  }

  return `
    <div class="page-container">
      ${pageHeader('診断結果', 'わが家で優先したい備え', '危険を断定するのではなく、入力内容から次に確認したいことを整理しています。')}

      ${result.postChoicePending || state.diagnosis.postChoicePending ? `
        <section class="notice success" aria-labelledby="next-choice-title">
          <h2 id="next-choice-title">診断が完了しました。次に何をしますか？</h2>
          <p>備蓄チェックは今行わず、後からホームで始めることもできます。</p>
          <div class="button-row">
            <a class="button" href="#/stockpile/household" data-action="post-diagnosis-choice">続けて備蓄を確認する</a>
            <a class="button secondary" href="#/" data-action="post-diagnosis-choice">ホームを開く</a>
            <button class="button subtle" type="button" data-action="post-diagnosis-choice">まず結果を読む</button>
          </div>
        </section>` : ''}

      <section class="grid two section">
        <div class="card">
          <p class="eyebrow">備えの優先度</p>
          <div class="score-box">
            <div class="score-number level-${result.overallPriority}">${result.overallPriority}/5</div>
            <div>
              <h2>${escapeHtml(result.overallLevelInfo.label)}</h2>
              <p>${escapeHtml(result.overallLevelInfo.guidance)}</p>
            </div>
          </div>
          <p class="hint">これは発生確率や安全度ではありません。最も優先度の高い分野を5段階で示しています。</p>
        </div>
        <div class="card">
          <p class="eyebrow">判定の確かさ</p>
          <div class="score-box">
            <div class="score-number">${escapeHtml(result.confidence)}</div>
            <div>
              <h2>回答 ${result.completion}%</h2>
              <p>「はい・いいえ」で確認できた項目は${result.knownCompletion}%です。不明な項目は確認リストへ残しています。</p>
            </div>
          </div>
        </div>
      </section>

      <div class="notice warning section">
        <p>${escapeHtml(result.disclaimer)}</p>
      </div>

      <section class="section" aria-labelledby="priority-title">
        <div class="section-heading">
          <div><p class="eyebrow">災害別</p><h2 id="priority-title">優先度と理由</h2></div>
          <span class="badge">低い表示も安全保証ではありません</span>
        </div>
        <div class="risk-list">
          ${result.hazards.map(renderRiskCard).join('')}
        </div>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>まず行いたいこと</h2>
          ${result.recommendations.length ? `<ol class="action-list">${result.recommendations.slice(0, 6).map((item) => `<li>${escapeHtml(item.text)}</li>`).join('')}</ol>` : '<p>回答を増やすと、具体的な行動が表示されます。</p>'}
        </div>
        <div class="card">
          <h2>すでにできていること</h2>
          ${result.strengths.length ? `<ul class="check-list">${result.strengths.map((item) => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>` : '<p>今回は確認できた項目が少なめでした。対策ができている項目も、次の診断で「はい」を選ぶと記録されます。</p>'}
        </div>
      </section>

      <section class="card section" aria-labelledby="followup-title">
        <div class="section-heading">
          <div><p class="eyebrow">あとで確認</p><h2 id="followup-title">判定に使えなかった項目</h2></div>
          <span class="badge ${result.followUps.length ? 'warning' : 'success'}">${result.followUps.length}項目</span>
        </div>
        ${result.followUps.length ? `
          <ul class="plain-list">
            ${result.followUps.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.text)}</span></li>`).join('')}
          </ul>` : '<p>すべての項目を確認できています。</p>'}
      </section>

      <div class="button-row section">
        <a class="button" href="#/stockpile/household">備蓄チェックへ</a>
        <a class="button secondary" href="#/diagnosis/area" data-action="redo-diagnosis">もう一度診断する</a>
        <a class="button secondary" href="#/print">印刷用ページ</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function renderRiskCard(hazard) {
  const level = RISK_LEVELS[hazard.level];
  const meterValue = hazard.level || 0;
  return `
    <article class="card risk-card level-${hazard.level}">
      <div class="risk-head">
        <h3>${escapeHtml(hazard.name)}</h3>
        <div class="inline-actions">
          <span class="badge ${hazard.level >= 4 ? 'warning' : hazard.level === 0 ? '' : 'brand'}">${hazard.level ? `優先度 ${hazard.level}/5` : '情報不足'}</span>
          <span class="badge">確かさ ${escapeHtml(hazard.confidence)}</span>
        </div>
      </div>
      <progress class="native-progress level-${hazard.level}" max="5" value="${meterValue}" aria-label="${escapeHtml(hazard.name)}の備えの優先度 ${meterValue}/5">${meterValue}/5</progress>
      <p><strong>${escapeHtml(level.label)}</strong> - ${escapeHtml(level.guidance)}</p>
      ${hazard.reasons.length ? `<ul class="plain-list">${hazard.reasons.map((reason) => `<li>${escapeHtml(reason.text)}</li>`).join('')}</ul>` : '<p class="muted">回答から強い注意条件は確認されていません。ただし、地域の公的ハザード情報は別に確認してください。</p>'}
      ${hazard.recommendations.length ? `<p><strong>次の行動:</strong> ${escapeHtml(hazard.recommendations[0].text)}</p>` : ''}
    </article>`;
}

function renderStockpileRoute(step) {
  if (step === 'items') return renderStockpileItems();
  if (step === 'results') return renderStockpileResults();
  return renderStockpileHousehold();
}

function stockpileTabs(active) {
  return `
    <nav class="tabs" aria-label="備蓄チェックの手順">
      <a class="button ${active === 'household' ? '' : 'secondary'} small" href="#/stockpile/household"${active === 'household' ? ' aria-current="step"' : ''}>1. 家族構成</a>
      <a class="button ${active === 'items' ? '' : 'secondary'} small" href="#/stockpile/items"${active === 'items' ? ' aria-current="step"' : ''}>2. 現在の備蓄</a>
      <a class="button ${active === 'results' ? '' : 'secondary'} small" href="#/stockpile/results"${active === 'results' ? ' aria-current="step"' : ''}>3. 結果</a>
      <a class="button secondary small" href="#/inventory">備蓄リスト・期限</a>
    </nav>`;
}

function renderStockpileHousehold() {
  const h = state.household;
  return `
    <div class="page-container">
      ${pageHeader('備蓄チェック', '家族構成と必要な支援', '人数と生活上の条件から、3日分と7日分の備蓄目安を計算します。')}
      ${stockpileTabs('household')}
      <div class="notice privacy">
        <p><strong>ここで入力する人数や支援情報も外部へ送信しません。</strong> 氏名、生年月日、病名、薬名は入力不要です。</p>
      </div>

      <form id="household-form" class="card section" novalidate>
        <fieldset class="form-section">
          <legend>家族の人数</legend>
          <p class="hint">妊娠中、移動支援、薬などの人数は、この人数の内数です。合計人数へ二重に加えません。</p>
          <div class="form-grid">
            ${numberField('adults', '大人', h.adults, '人', 0, 20)}
            ${numberField('children', '子ども', h.children, '人', 0, 20)}
            ${numberField('infants', '乳幼児', h.infants, '人', 0, 20)}
            ${numberField('olderAdults', '高齢者', h.olderAdults, '人', 0, 20)}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>個別に考えたい条件</legend>
          <div class="form-grid">
            ${numberField('pregnant', '妊娠中の人', h.pregnant, '人', 0, 20)}
            ${numberField('mobilitySupport', '移動に支援が必要な人', h.mobilitySupport, '人', 0, 20)}
            ${numberField('regularMedication', '常用薬・医療用品が必要な人', h.regularMedication, '人', 0, 20)}
            ${numberField('medicalPower', '電源が必要な医療機器を使う人', h.medicalPower, '人', 0, 20)}
            ${numberField('allergies', 'アレルギー対応食が必要な人', h.allergies, '人', 0, 20)}
            ${numberField('pets', '一緒に備えるペット', h.pets, '匹', 0, 30)}
          </div>
        </fieldset>

        <div class="notice warning section">
          <p>薬や医療機器の必要量は、このアプリだけでは決められません。医師、薬剤師、機器事業者と停電・交通途絶時の対応を確認してください。</p>
        </div>

        <div class="button-row">
          <button class="button" type="submit">現在の備蓄を入力する</button>
          <a class="button secondary" href="#/">後で確認する</a>
        </div>
      </form>
    </div>`;
}

function numberField(id, label, value, unit, min = 0, max = 999, step = 1, description = '') {
  return `
    <div class="form-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}（${escapeHtml(unit)}）</label>
      <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}">
      ${description ? `<p class="hint">${escapeHtml(description)}</p>` : ''}
    </div>`;
}

function renderStockpileItems() {
  const people = householdPeople(state.household);
  const preview = calculateStockpile(state.household, state.stockpile);
  if (people <= 0) {
    return `
      <div class="page-container">
        ${pageHeader('備蓄チェック', '先に家族構成を入力してください', '必要量を計算するため、備える人数を確認します。')}
        ${stockpileTabs('items')}
        <div class="empty-state card"><a class="button" href="#/stockpile/household">家族構成を入力する</a></div>
      </div>`;
  }

  const advanced = state.stockpile.advanced;
  const scenario = stockpileScenario(advanced.scenarioId);
  return `
    <div class="page-container">
      ${pageHeader('備蓄チェック', '現在ある物を入力する', `${people}人分として、最低3日と安心7日の目安を比較します。`)}
      ${stockpileTabs('items')}
      <div class="notice privacy">
        <p>数量、備蓄状況、賞味期限は、選択した保存方法に応じてこの端末のブラウザ内だけで扱います。</p>
      </div>

      <form id="stockpile-form" class="section" novalidate>
        <div class="grid two">
          ${preview.items.map((item) => renderStockpileInput(item)).join('')}
        </div>

        <details class="section"${advanced.enabled ? ' open' : ''}>
          <summary>アドバンス備蓄: 暮らしに合う想定へ変更する</summary>
          <div class="card advanced-stockpile-card">
            <label class="storage-option">
              <input id="advanced-enabled" type="checkbox" name="advancedEnabled"${advanced.enabled ? ' checked' : ''}>
              <span><strong>アドバンス備蓄を使う</strong><small>断水、停電、道路寸断、高層住宅などを想定して必要量を調整します。</small></span>
            </label>

            <div class="form-field section">
              <label for="stockpile-scenario">想定する状況</label>
              <select id="stockpile-scenario" name="scenarioId">
                ${STOCKPILE_SCENARIOS.map((item) => `<option value="${escapeHtml(item.id)}"${scenario.id === item.id ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
              </select>
              <p id="stockpile-scenario-description" class="hint">${escapeHtml(scenario.description)}</p>
            </div>

            <details class="subpanel"${advanced.enabled ? '' : ' open'}>
              <summary>日数をさらに細かく調整する</summary>
              <div class="form-grid section" id="advanced-fields">
                ${numberField('waterDays', '断水を想定する日数', advanced.waterDays, '日', 1, 30)}
                ${numberField('foodDays', '食料を自力で確保する日数', advanced.foodDays, '日', 1, 30)}
                ${numberField('powerDays', '停電を想定する日数', advanced.powerDays, '日', 1, 30)}
                ${numberField('gasDays', '加熱手段が限られる日数', advanced.gasDays, '日', 1, 30)}
                ${numberField('isolationDays', '物流・道路寸断を想定する日数', advanced.isolationDays, '日', 1, 30)}
                ${numberField('elevatorDays', 'エレベータ停止を想定する日数', advanced.elevatorDays, '日', 1, 30)}
              </div>
            </details>
            <p class="hint">長い日数を設定するほど、保管量と重量が増えます。水は1Lで約1kgです。保管場所を分散し、非常持出袋と自宅用備蓄を分けてください。</p>
          </div>
        </details>

        <div class="button-row">
          <a class="button secondary" href="#/stockpile/household">家族構成へ戻る</a>
          <button class="button" type="submit">結果を計算する</button>
          <a class="button subtle" href="#/">後で続ける</a>
        </div>
      </form>
    </div>`;
}

function renderStockpileInput(item) {
  return `
    <div class="card form-field">
      <label for="stock-${escapeHtml(item.id)}">${escapeHtml(item.label)}（${escapeHtml(item.unit)}）</label>
      <input id="stock-${escapeHtml(item.id)}" name="${escapeHtml(item.id)}" type="number" inputmode="decimal" min="0" step="${item.step}" value="${escapeHtml(item.current)}">
      <p class="hint">${escapeHtml(item.description)}</p>
      <p class="small-text"><strong>3日目安:</strong> ${formatNumber(item.minimum)} ${escapeHtml(item.unit)} / <strong>7日目安:</strong> ${formatNumber(item.comfort)} ${escapeHtml(item.unit)}</p>
    </div>`;
}

function renderStockpileResults() {
  const result = state.stockpile.result;
  if (!result) {
    return `
      <div class="page-container">
        ${pageHeader('備蓄チェック', '結果はまだありません', '家族構成と現在の数量を入力すると、不足を項目ごとに表示します。')}
        ${stockpileTabs('results')}
        <div class="empty-state card"><a class="button" href="#/stockpile/household">備蓄チェックを始める</a></div>
      </div>`;
  }
  const inventory = analyzeInventory(state.stockpile.inventory);
  const advancedHeading = result.advanced.enabled ? '<th>設定した目安</th>' : '';

  return `
    <div class="page-container">
      ${pageHeader('備蓄チェック結果', result.level.label, `${result.people}人分 / 最終確認 ${formatDateTime(state.stockpile.lastCheckedAt)}`)}
      ${stockpileTabs('results')}

      <section class="grid two section">
        <div class="card">
          <p class="eyebrow">重要項目</p>
          <div class="score-box">
            <div class="score-number ${result.minimumMet ? '' : 'level-5'}">${result.score}%</div>
            <div>
              <h2>${escapeHtml(result.level.label)}</h2>
              <p>水・食料・トイレなど、代えにくい重要項目の7日分達成度です。</p>
            </div>
          </div>
          <p class="hint">総合安全度ではありません。重要項目が一つでも3日分未満なら「最低ライン達成」にはしません。</p>
        </div>
        <div class="card">
          <h2>判定</h2>
          <div class="status-line"><span>最低3日ライン</span><span class="status-value ${result.minimumMet ? 'ok' : 'bad'}">${result.minimumMet ? '達成' : '未達'}</span></div>
          <div class="status-line"><span>安心7日ライン</span><span class="status-value ${result.comfortMet ? 'ok' : 'warn'}">${result.comfortMet ? '達成' : '整えている途中'}</span></div>
          ${result.advanced.enabled ? `<div class="status-line"><span>${escapeHtml(result.scenario.label)}</span><span class="status-value ${result.advancedMet ? 'ok' : 'warn'}">${result.advancedMet ? '達成' : '不足あり'}</span></div>` : ''}
          <div class="status-line"><span>飲料水目標の重さ</span><strong>約${formatNumber(result.waterWeightKg)}kg</strong></div>
        </div>
      </section>

      ${result.advanced.enabled ? `<section class="notice privacy section"><h2>今回の想定: ${escapeHtml(result.scenario.label)}</h2><p>${escapeHtml(result.scenario.description)}</p><p>自宅用備蓄、非常持出袋、職場や車などへ分散し、持ち運べる量も確認してください。</p></section>` : ''}

      <section class="card section">
        <h2>項目ごとの数量</h2>
        <div class="table-wrap">
          <table class="summary-table">
            <thead><tr><th>項目</th><th>現在</th><th>3日目安</th><th>7日目安</th>${advancedHeading}<th>状態</th></tr></thead>
            <tbody>
              ${result.items.map((item) => `
                <tr>
                  <td><strong>${escapeHtml(item.label)}</strong><br><span class="small-text muted">${escapeHtml(item.description)}</span></td>
                  <td class="number">${formatNumber(item.current)} ${escapeHtml(item.unit)}</td>
                  <td class="number">${formatNumber(item.minimum)} ${escapeHtml(item.unit)}</td>
                  <td class="number">${formatNumber(item.comfort)} ${escapeHtml(item.unit)}</td>
                  ${result.advanced.enabled ? `<td class="number">${formatNumber(item.advancedTarget)} ${escapeHtml(item.unit)}</td>` : ''}
                  <td>${stockStatusBadge(item, result.advanced.enabled)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>詳しいコメント</h2>
          <ul class="plain-list">${result.comments.map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}</ul>
        </div>
        <div class="card">
          <h2>ローリングストック</h2>
          <p>登録済み: ${inventory.items.length}品 / 期限切れ: ${inventory.expired.length}品 / 30日以内: ${inventory.within30.length}品</p>
          ${inventory.suggestions.length ? `<ul class="plain-list">${inventory.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>備蓄リストへ賞味期限・使用期限を登録すると、交換時期を確認できます。</p>'}
          <a class="button secondary small" href="#/inventory">備蓄リストと期限を開く</a>
        </div>
      </section>

      <section class="notice warning section">
        <h2>この結果の使い方</h2>
        <ul class="plain-list">${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
      </section>

      <div class="button-row section">
        <a class="button" href="#/stockpile/items">数量を更新する</a>
        <a class="button secondary" href="#/inventory">保管場所と期限を管理する</a>
        <button class="button subtle" type="button" data-action="print">印刷・PDF保存</button>
      </div>
    </div>`;
}

function stockStatusBadge(item, advancedEnabled = false) {
  if (advancedEnabled && Number(item.current) >= Number(item.advancedTarget || 0)) return '<span class="badge success">設定目安達成</span>';
  if (item.status === 'comfort') return '<span class="badge success">7日分達成</span>';
  if (item.status === 'minimum') return '<span class="badge warning">3日分達成</span>';
  if (item.status === 'partial') return `<span class="badge danger">3日分まであと ${formatNumber(item.missingMinimum)} ${escapeHtml(item.unit)}</span>`;
  return `<span class="badge danger">未備蓄 / 3日分 ${formatNumber(item.minimum)} ${escapeHtml(item.unit)}</span>`;
}

function bindStockpileHousehold() {
  const form = document.querySelector('#household-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const keys = Object.keys(createDefaultHousehold());
    for (const key of keys) state.household[key] = toNonNegativeInteger(data.get(key), 0);
    if (householdPeople(state.household) <= 0) {
      showToast('備える人数を1人以上入力してください。', 'error');
      return;
    }
    state.stockpile.result = null;
    await persistCurrentState();
    location.hash = '#/stockpile/items';
  });
}

function bindStockpileItems() {
  const form = document.querySelector('#stockpile-form');
  if (!form) return;

  const scenarioSelect = document.querySelector('#stockpile-scenario');
  scenarioSelect?.addEventListener('change', (event) => {
    state.stockpile = applyStockpileScenario(state.stockpile, String(event.target.value));
    const advanced = state.stockpile.advanced;
    for (const key of ['waterDays', 'foodDays', 'powerDays', 'gasDays', 'isolationDays', 'elevatorDays']) {
      const input = form.elements.namedItem(key);
      if (input) input.value = String(advanced[key]);
    }
    const description = document.querySelector('#stockpile-scenario-description');
    if (description) description.textContent = stockpileScenario(advanced.scenarioId).description;
    const enabled = document.querySelector('#advanced-enabled');
    if (enabled) enabled.checked = true;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    for (const field of STOCKPILE_FIELDS) {
      state.stockpile.quantities[field.id] = toNonNegativeNumber(data.get(field.id), 0);
    }
    state.stockpile.advanced = {
      ...state.stockpile.advanced,
      enabled: data.has('advancedEnabled'),
      scenarioId: String(data.get('scenarioId') || state.stockpile.advanced.scenarioId || 'comfort-7'),
      waterDays: toNonNegativeInteger(data.get('waterDays'), 7),
      foodDays: toNonNegativeInteger(data.get('foodDays'), 7),
      powerDays: toNonNegativeInteger(data.get('powerDays'), 3),
      gasDays: toNonNegativeInteger(data.get('gasDays'), 7),
      isolationDays: toNonNegativeInteger(data.get('isolationDays'), 7),
      elevatorDays: toNonNegativeInteger(data.get('elevatorDays'), 3)
    };
    state.stockpile.result = calculateStockpile(state.household, state.stockpile);
    state.stockpile.lastCheckedAt = new Date().toISOString();
    persistDebounced();
    location.hash = '#/stockpile/results';
  });
}

function renderInventory() {
  const analysis = analyzeInventory(state.stockpile.inventory);
  const editing = editingInventoryId
    ? state.stockpile.inventory.find((item) => item.id === editingInventoryId)
    : null;
  const formItem = editing || {
    name: '', category: '食品', quantity: 1, unit: '個', expirationDate: '',
    storageArea: '自宅', storageLocation: '', opened: false, notes: ''
  };
  const byArea = INVENTORY_STORAGE_LOCATIONS.map((area) => ({
    area,
    count: analysis.items.filter((item) => (item.storageArea || '自宅') === area).length
  })).filter((item) => item.count > 0);

  return `
    <div class="page-container">
      ${pageHeader('備蓄管理', '備蓄リストと賞味期限', '自宅用、非常持出袋、職場や車などに分けて、期限と保管場所を更新します。')}
      <div class="notice privacy">
        <p>品名、数量、賞味期限、保管場所は外部へ送信しません。共有端末では保存方法を確認してください。</p>
      </div>

      <section class="grid four section">
        ${inventoryKpi('登録', analysis.items.length, '品', '')}
        ${inventoryKpi('期限切れ', analysis.expired.length, '品', analysis.expired.length ? 'danger' : 'success')}
        ${inventoryKpi('30日以内', analysis.within30.length, '品', analysis.within30.length ? 'warning' : 'success')}
        ${inventoryKpi('保管区分', byArea.length, 'か所', '')}
      </section>

      <section class="card section" aria-labelledby="inventory-form-title">
        <h2 id="inventory-form-title">${editing ? '備蓄品を編集する' : '備蓄品を追加する'}</h2>
        <form id="inventory-form" novalidate>
          <input type="hidden" name="id" value="${editing ? escapeHtml(editing.id) : ''}">
          <div class="form-grid">
            <div class="form-field">
              <label for="inventory-name">品名</label>
              <input id="inventory-name" name="name" type="text" maxlength="80" value="${escapeHtml(formItem.name)}" required placeholder="例: パックごはん">
            </div>
            <div class="form-field">
              <label for="inventory-category">分類</label>
              <select id="inventory-category" name="category">
                ${INVENTORY_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}"${formItem.category === category ? ' selected' : ''}>${escapeHtml(category)}</option>`).join('')}
              </select>
            </div>
            ${numberField('inventory-quantity', '数量', formItem.quantity, '入力した単位', 0, 99999, 0.1)}
            <div class="form-field">
              <label for="inventory-unit">単位</label>
              <input id="inventory-unit" name="unit" type="text" maxlength="20" value="${escapeHtml(formItem.unit)}" placeholder="個、袋、L、食など">
            </div>
            <div class="form-field">
              <label for="inventory-expiration">賞味期限・使用期限</label>
              <input id="inventory-expiration" name="expirationDate" type="date" value="${escapeHtml(formItem.expirationDate)}">
            </div>
            <div class="form-field">
              <label for="inventory-storage-area">保管区分</label>
              <select id="inventory-storage-area" name="storageArea">
                ${INVENTORY_STORAGE_LOCATIONS.map((area) => `<option value="${escapeHtml(area)}"${(formItem.storageArea || '自宅') === area ? ' selected' : ''}>${escapeHtml(area)}</option>`).join('')}
              </select>
            </div>
            <div class="form-field full">
              <label for="inventory-location">詳しい保管場所</label>
              <input id="inventory-location" name="storageLocation" type="text" maxlength="80" value="${escapeHtml(formItem.storageLocation)}" placeholder="例: キッチン上段、玄関の赤い袋">
            </div>
            <div class="form-field full">
              <label><input type="checkbox" name="opened"${formItem.opened ? ' checked' : ''}> 開封済み</label>
            </div>
            <div class="form-field full">
              <label for="inventory-notes">メモ</label>
              <textarea id="inventory-notes" name="notes" maxlength="300" placeholder="加熱に水が必要、乳幼児用など">${escapeHtml(formItem.notes)}</textarea>
            </div>
          </div>
          <div class="button-row">
            <button class="button" type="submit">${editing ? '変更を保存する' : 'リストへ追加する'}</button>
            ${editing ? '<button class="button secondary" type="button" data-action="inventory-cancel">編集をやめる</button>' : ''}
          </div>
        </form>
      </section>

      ${byArea.length ? `<section class="card section"><h2>保管場所の分散</h2><div class="inventory-area-summary">${byArea.map((item) => `<span class="badge brand">${escapeHtml(item.area)} ${item.count}品</span>`).join('')}</div><p class="hint">水や食料を一か所へ集めすぎず、浸水や家具転倒の影響を受けにくい場所にも分けてください。</p></section>` : ''}

      <section class="card section">
        <div class="section-heading">
          <div><p class="eyebrow">期限の短い順</p><h2>登録済みの備蓄</h2></div>
          <span class="badge">${analysis.items.length}品</span>
        </div>
        ${analysis.items.length ? `<div class="grid two">${analysis.items.map(renderInventoryItem).join('')}</div>` : `
          <div class="empty-state"><h3>まだ登録がありません</h3><p>食品、水、薬、電池など、期限を忘れやすい物から登録すると便利です。</p></div>`}
      </section>

      <section class="notice success section">
        <h2>ローリングストックの提案</h2>
        <ul class="plain-list">${analysis.suggestions.map((suggestion) => `<li>${escapeHtml(suggestion)}</li>`).join('') || '<li>品物を登録すると、期限に応じた提案を表示します。</li>'}</ul>
      </section>

      <div class="button-row section">
        <a class="button secondary" href="#/stockpile/results">備蓄チェック結果へ</a>
        <a class="button secondary" href="#/print">リストを印刷</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function inventoryKpi(label, value, unit, tone) {
  return `<div class="card kpi"><small>${escapeHtml(label)}</small><strong class="${tone ? `status-value ${tone === 'danger' ? 'bad' : tone === 'warning' ? 'warn' : 'ok'}` : ''}">${formatNumber(value)}${escapeHtml(unit)}</strong></div>`;
}

function renderInventoryItem(item) {
  const days = item.daysRemaining;
  let badge = '<span class="badge">期限未登録</span>';
  if (days !== null && days < 0) badge = `<span class="badge danger">${Math.abs(days)}日超過</span>`;
  else if (days !== null && days <= 30) badge = `<span class="badge warning">あと${days}日</span>`;
  else if (days !== null && days <= 90) badge = `<span class="badge info">あと${days}日</span>`;
  else if (days !== null) badge = `<span class="badge success">あと${days}日</span>`;

  return `
    <article class="card inventory-item">
      <div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${formatNumber(item.quantity)} ${escapeHtml(item.unit || '個')} / ${escapeHtml(item.category || 'その他')}</p>
        <div class="inventory-meta">
          ${badge}
          ${item.expirationDate ? `<span class="badge">期限 ${escapeHtml(formatDate(item.expirationDate))}</span>` : ''}
          <span class="badge brand">${escapeHtml(item.storageArea || '自宅')}</span>
          ${item.storageLocation ? `<span class="badge">${escapeHtml(item.storageLocation)}</span>` : ''}
          ${item.opened ? '<span class="badge warning">開封済み</span>' : ''}
        </div>
        ${item.notes ? `<p class="small-text muted">${escapeHtml(item.notes)}</p>` : ''}
      </div>
      <div class="inventory-actions">
        <button class="button secondary small" type="button" data-action="inventory-edit" data-id="${escapeHtml(item.id)}">編集</button>
        <button class="button danger small" type="button" data-action="inventory-delete" data-id="${escapeHtml(item.id)}">削除</button>
      </div>
    </article>`;
}

function bindInventory() {
  const form = document.querySelector('#inventory-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) {
      showToast('品名を入力してください。', 'error');
      document.querySelector('#inventory-name')?.focus();
      return;
    }
    const existingId = String(data.get('id') || '');
    const item = {
      id: existingId || createId('stock'),
      name,
      category: String(data.get('category') || 'その他'),
      quantity: toNonNegativeNumber(data.get('inventory-quantity'), 0),
      unit: String(data.get('unit') || '個').trim() || '個',
      expirationDate: String(data.get('expirationDate') || ''),
      storageArea: String(data.get('storageArea') || '自宅'),
      storageLocation: String(data.get('storageLocation') || '').trim(),
      opened: data.has('opened'),
      notes: String(data.get('notes') || '').trim(),
      updatedAt: new Date().toISOString()
    };
    const index = state.stockpile.inventory.findIndex((entry) => entry.id === existingId);
    if (index >= 0) state.stockpile.inventory[index] = item;
    else state.stockpile.inventory.push(item);
    editingInventoryId = null;
    await persistCurrentState();
    render();
    showToast(index >= 0 ? '備蓄品を更新しました。' : '備蓄品を追加しました。');
  });
}

async function deleteInventoryItem(id) {
  const item = state.stockpile.inventory.find((entry) => entry.id === id);
  if (!item) return;
  const confirmed = await confirmDialog('備蓄品を削除しますか？', `「${item.name}」をリストから削除します。`, '削除する');
  if (!confirmed) return;
  state.stockpile.inventory = state.stockpile.inventory.filter((entry) => entry.id !== id);
  if (editingInventoryId === id) editingInventoryId = null;
  await persistCurrentState();
  render();
  showToast('備蓄品を削除しました。');
}

function renderHomeSafety() {
  const summary = homeSafetySummary();
  const remaining = HOME_SAFETY_GROUPS.flatMap((group) => group.items)
    .filter((item) => !state.homeSafety.items[item.id]);
  return `
    <div class="page-container">
      ${pageHeader('家の安全', '部屋ごとの防災チェック', '費用のかからない配置変更から始め、寝室と避難経路を優先します。')}
      <section class="card">
        <div class="section-heading">
          <div><h2>${summary.complete}/${summary.total}項目を確認済み</h2><p>一度にすべて行う必要はありません。</p></div>
          <span class="badge ${summary.rate === 100 ? 'success' : 'brand'}">${summary.rate}%</span>
        </div>
        <progress class="native-progress" max="100" value="${summary.rate}">${summary.rate}%</progress>
      </section>

      <div class="notice warning section">
        <p>チェックは住宅の安全を保証するものではありません。建物の耐震性、電気・ガス設備、崖や浸水については、自治体・管理会社・専門家の確認を利用してください。</p>
      </div>

      <form id="safety-form" class="section">
        ${HOME_SAFETY_GROUPS.map((group) => `
          <fieldset class="form-section">
            <legend>${escapeHtml(group.name)}</legend>
            <div class="grid two">
              ${group.items.map((item) => `
                <div class="card check-card${state.homeSafety.items[item.id] ? ' completed' : ''}">
                  <label>
                    <input type="checkbox" name="${escapeHtml(item.id)}"${state.homeSafety.items[item.id] ? ' checked' : ''}>
                    <span>${escapeHtml(item.label)}</span>
                  </label>
                </div>`).join('')}
            </div>
          </fieldset>`).join('')}
      </form>

      <section class="card section">
        <h2>次に取り組む候補</h2>
        ${remaining.length ? `<ol class="action-list">${remaining.slice(0, 6).map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')}</ol>` : '<p class="badge success">すべて確認済みです。季節の変わり目や家具の移動後にもう一度見直してください。</p>'}
      </section>

      <div class="button-row section">
        <a class="button" href="#/family">家族の防災計画へ</a>
        <a class="button secondary" href="#/print">チェック結果を印刷</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function bindHomeSafety() {
  const form = document.querySelector('#safety-form');
  form?.addEventListener('change', async (event) => {
    if (event.target.type !== 'checkbox') return;
    state.homeSafety.items[event.target.name] = event.target.checked;
    state.homeSafety.updatedAt = new Date().toISOString();
    await persistCurrentState();
    render();
  });
}

function familyPlanCompletion(plan = state.familyPlan) {
  const checks = [
    ['第一の集合場所', plan.primaryMeetingPlace],
    ['第二の集合場所', plan.secondaryMeetingPlace],
    ['災害別の避難先', Object.values(plan.hazardDestinations || {}).some((value) => String(value || '').trim())],
    ['連絡できないときのルール', plan.contactRule],
    ['迎えのルール', plan.pickupRule],
    ['支援が必要な人への対応', plan.supportPlan || state.household.mobilitySupport <= 0],
    ['ペットの対応', plan.petPlan || state.household.pets <= 0],
    ['通らない場所・経路', plan.prohibitedRoutes]
  ].map(([label, value]) => ({ label, complete: typeof value === 'boolean' ? value : Boolean(String(value || '').trim()) }));
  return { checks, complete: checks.filter((item) => item.complete).length, total: checks.length };
}

function renderFamilyTabs(active) {
  return `<nav class="tabs" aria-label="家族計画のメニュー">
    <a class="button ${active === 'edit' ? '' : 'secondary'} small" href="#/family">計画を作る</a>
    <a class="button ${active === 'share' ? '' : 'secondary'} small" href="#/family/share">家族へ共有</a>
    <a class="button ${active === 'import' ? '' : 'secondary'} small" href="#/family/import">共有を受け取る</a>
  </nav>`;
}

function renderFamilyPlan(mode = 'edit') {
  if (mode === 'share') return renderFamilyShare();
  if (mode === 'import') return renderFamilyImport();
  const plan = state.familyPlan;
  const completion = familyPlanCompletion(plan);
  return `
    <div class="page-container">
      ${pageHeader('家族の防災計画', '連絡できないときも、同じ判断をする', uiText('集合場所、災害別の避難先、迎え、支援、ペットを短い言葉で記録します。', '家族が離れているときも、どこへ行くか、どう連絡するかを決めます。'))}
      ${renderFamilyTabs('edit')}
      <div class="notice privacy">
        <p><strong>氏名、電話番号、病名は必須ではありません。</strong>「保護者A」「学校」「近くの親族」のような役割だけでも作れます。内容は外部へ送信しません。</p>
      </div>

      <section class="card section">
        <div class="section-heading"><div><p class="eyebrow">現在の計画</p><h2>確認できている項目</h2></div><span class="badge ${completion.complete === completion.total ? 'success' : 'brand'}">${completion.complete}/${completion.total}</span></div>
        <div class="family-check-grid">${completion.checks.map((item) => `<p class="family-check ${item.complete ? 'complete' : 'pending'}"><span aria-hidden="true">${item.complete ? '✓' : '○'}</span>${escapeHtml(item.label)}: ${item.complete ? '確認済み' : '未確認'}</p>`).join('')}</div>
        ${plan.updatedAt ? `<p class="data-source-stamp">最終更新: ${escapeHtml(formatDateTime(plan.updatedAt))}</p>` : ''}
      </section>

      <form id="family-plan-form" class="card section" novalidate>
        <fieldset class="form-section">
          <legend>集合場所</legend>
          <div class="form-grid">
            ${textField('primaryMeetingPlace', '第一の集合場所', plan.primaryMeetingPlace, '例: 自宅近くの公園北側。洪水時は使わない。')}
            ${textField('secondaryMeetingPlace', '第二の集合場所', plan.secondaryMeetingPlace, '例: 高台の指定緊急避難場所')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>災害別の避難先</legend>
          <p class="hint">指定緊急避難場所は災害の種類ごとに対応が異なります。地域情報と自治体の最新情報も確認してください。</p>
          <div class="form-grid">
            ${textField('hazard-earthquake', '地震・大規模火災', plan.hazardDestinations.earthquake, '例: ○○公園')}
            ${textField('hazard-flood', '洪水・内水氾濫', plan.hazardDestinations.flood, '例: ○○小学校3階')}
            ${textField('hazard-tsunami', '津波・高潮', plan.hazardDestinations.tsunami, '例: 高台の○○広場')}
            ${textField('hazard-landslide', '土砂災害', plan.hazardDestinations.landslide, '例: 斜面から離れた○○公民館')}
            ${textField('hazard-fire', '自宅や近隣の火災', plan.hazardDestinations.fire, '例: 風上側の○○通り')}
            ${textareaField('prohibitedRoutes', '通らない場所・経路', plan.prohibitedRoutes, '例: 大雨時は地下道と川沿いを通らない。地震後は古いブロック塀を避ける。')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>連絡と役割</legend>
          <div class="form-grid">
            ${textField('outOfAreaContact', '遠方の連絡先・中継役', plan.outOfAreaContact, '例: 県外の親族へSMS。実名を書かなくても構いません。')}
            ${textareaField('contactRule', '電話がつながらないときの連絡順', plan.contactRule, '例: SMS → 171 → 災害用伝言板。既読だけでも返す。')}
            ${textareaField('pickupRule', '学校・施設・職場からの迎え', plan.pickupRule, '例: 第一担当が行けない場合は第二担当。危険区域を横断しない。')}
            ${textareaField('supportPlan', '支援が必要な人への役割', plan.supportPlan, '例: 階段移動は二人で支援。早めに近隣へ連絡。')}
            ${textareaField('petPlan', 'ペットの避難と担当', plan.petPlan, '例: ケージは玄関。フードと薬は持出袋の横。')}
            ${textareaField('utilityRule', '電気・ガス・水の確認ルール', plan.utilityRule, '例: 安全にできる場合のみ、避難時にブレーカーを落とす。')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>見直し</legend>
          <div class="form-grid">
            <div class="form-field"><label for="family-review-date">今回確認した日</label><input id="family-review-date" name="reviewDate" type="date" value="${escapeHtml(plan.reviewDate)}"></div>
            <div class="form-field"><label for="family-next-review-date">次に見直す日</label><input id="family-next-review-date" name="nextReviewDate" type="date" value="${escapeHtml(plan.nextReviewDate)}"></div>
            ${textareaField('notes', 'その他のメモ', plan.notes, '家族だけが分かる短いルールや、季節ごとの注意を書けます。')}
          </div>
        </fieldset>

        <div class="button-row">
          <button class="button" type="submit">家族計画を保存する</button>
          <a class="button secondary" href="#/family/share">家族へ共有する</a>
          <a class="button secondary" href="#/print">印刷用ページを見る</a>
          <a class="button subtle" href="#/">ホームへ</a>
        </div>
      </form>

      <div class="notice warning section"><p>現在地の常時共有や、家族への自動通知は行いません。災害時は通信が使えない前提で、紙にも残し、171や災害用伝言板も確認してください。</p></div>
    </div>`;
}

function textField(id, label, value, placeholder = '') {
  return `<div class="form-field"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="text" maxlength="240" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></div>`;
}

function textareaField(id, label, value, placeholder = '') {
  return `<div class="form-field full"><label for="${escapeHtml(id)}">${escapeHtml(label)}</label><textarea id="${escapeHtml(id)}" name="${escapeHtml(id)}" maxlength="800" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></div>`;
}

function createQrSvgMarkup(text, { size = 320 } = {}) {
  if (!globalThis.MamoreruQRCode || !globalThis.MamoreruQRErrorCorrectLevel) return '<p>QRコード生成機能を読み込めませんでした。ファイル共有をご利用ください。</p>';
  try {
    const qr = new globalThis.MamoreruQRCode(-1, globalThis.MamoreruQRErrorCorrectLevel.L);
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const total = count + margin * 2;
    const cells = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) cells.push(`<rect x="${col + margin}" y="${row + margin}" width="1" height="1"/>`);
      }
    }
    return `<svg class="share-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" role="img" aria-label="家族計画を受け取るQRコード"><rect width="100%" height="100%" fill="#fff"/><g fill="#1f3d34">${cells.join('')}</g></svg>`;
  } catch (error) {
    return `<p class="error-text">QRコードを作成できませんでした。共有項目を減らすか、ファイル共有をご利用ください。</p>`;
  }
}

function renderFamilyShare() {
  const selected = familySharePreview?.selectedFields || defaultFamilyShareFields();
  const bundle = familySharePreview?.bundle || null;
  const url = familySharePreview?.url || '';
  const size = bundle ? familyShareSize(bundle, location.href) : null;
  return `<div class="page-container">
    ${pageHeader('家族の防災計画', '必要な項目だけ家族へ共有する', '共有する内容を選び、QRコード、共有リンク、ファイルのいずれかで渡せます。')}
    ${renderFamilyTabs('share')}
    <div class="notice privacy"><p><strong>QRコードはこの端末内で作ります。</strong> EpsilonLabのサーバへ家族計画を送信しません。QRを撮影した人は内容を読み取れるため、電話番号・正確な位置・支援情報は標準で共有しません。</p></div>
    <form id="family-share-form" class="card section">
      <fieldset><legend>共有する情報</legend>
        <div class="share-field-grid">${FAMILY_SHARE_FIELDS.map((field) => `<label class="storage-option"><input type="checkbox" name="shareField" value="${field.id}"${selected.includes(field.id) ? ' checked' : ''}><span><strong>${escapeHtml(field.label)}</strong><small>${field.group === 'sensitive' ? '個人情報を含まないか確認してください。' : field.group === 'contact' ? '連絡先を含む場合は慎重に共有してください。' : '家族で共有しやすい項目です。'}</small></span></label>`).join('')}</div>
      </fieldset>
      <div class="button-row"><button class="button" type="submit">共有用QRを作る</button><a class="button secondary" href="#/family">計画を編集する</a></div>
    </form>
    ${bundle ? `<section class="card section share-result"><div class="section-heading"><div><p class="eyebrow">端末内で生成</p><h2>共有用QRコード</h2></div><span class="badge ${size.suitableForQr ? 'success' : 'warning'}">${size.urlCharacters}文字</span></div>
      ${size.suitableForQr ? createQrSvgMarkup(url) : '<div class="notice warning"><p>情報量が多く、読み取りにくいQRコードになるため表示していません。共有項目を減らすか、ファイルを利用してください。</p></div>'}
      <p>受け取る側は「守れるいのち」で内容を確認してから端末へ追加できます。既存の計画を自動で上書きしません。</p>
      <div class="button-row"><button class="button" type="button" id="family-share-system">端末の共有機能を使う</button><button class="button secondary" type="button" id="family-share-copy">共有リンクをコピー</button><button class="button secondary" type="button" id="family-share-download">共有ファイルを保存</button></div>
      <details><summary>共有リンクを表示</summary><p class="break-all"><code>${escapeHtml(url)}</code></p></details>
    </section>` : ''}
    <div class="notice warning section"><p>QRコードや共有ファイルは、家族計画の控えです。リアルタイム同期や安否確認ではありません。計画を更新したら、もう一度共有してください。</p></div>
  </div>`;
}

function renderFamilyImport() {
  const preview = familySharePreview;
  const hasData = preview && !preview.error && preview.type === 'mamoreru-inochi-family-plan';
  const entries = hasData ? FAMILY_SHARE_FIELDS.flatMap((field) => {
    if (!preview.fields?.includes(field.id)) return [];
    const value = field.id === 'hazardDestinations' ? preview.data?.h : preview.data?.[field.id];
    if (!value || (typeof value === 'object' && !Object.keys(value).length)) return [];
    const display = typeof value === 'object' ? Object.values(value).filter(Boolean).join(' / ') : value;
    return [{ label: field.label, value: display }];
  }) : [];
  return `<div class="page-container">
    ${pageHeader('家族の防災計画', '共有された計画を確認する', '内容を見てから、この端末の家族計画へ追加します。')}
    ${renderFamilyTabs('import')}
    ${preview?.error ? `<div class="notice danger"><p>${escapeHtml(preview.error)}</p></div>` : ''}
    ${hasData ? `<section class="card section"><h2>受け取った内容</h2><dl class="summary-list">${entries.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl><p class="data-source-stamp">作成: ${escapeHtml(formatDateTime(preview.createdAt))}</p><div class="button-row"><button class="button" type="button" id="family-import-apply">この端末へ追加する</button><button class="button secondary" type="button" id="family-import-discard">取り込まない</button></div></section>` : `<section class="card section"><h2>共有コードまたはファイルを読み込む</h2><p>QRコードを読み取ってこのページを開くほか、共有コードの貼り付けやJSONファイルの読み込みができます。</p><form id="family-import-form"><div class="form-field"><label for="family-import-text">共有コード</label><textarea id="family-import-text" name="payload" rows="6" placeholder="MI-FAMILY:... または共有リンク"></textarea></div><div class="form-field"><label for="family-import-file">共有ファイル</label><input id="family-import-file" type="file" accept="application/json,.json"></div><div class="button-row"><button class="button" type="submit">内容を確認する</button></div></form></section>`}
    <div class="notice privacy section"><p>取り込む前に内容を表示します。共有リンクを開いただけでは、端末へ保存しません。</p></div>
  </div>`;
}

function bindFamilyPlan(mode = 'edit') {
  if (mode === 'share') {
    const form = document.querySelector('#family-share-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const fields = new FormData(form).getAll('shareField').map(String);
      if (!fields.length) { showToast('共有する項目を1つ以上選んでください。', 'error'); return; }
      const bundle = createFamilyShareBundle(state.familyPlan, fields);
      familySharePreview = { selectedFields: fields, bundle, url: buildFamilyShareUrl(bundle, location.href) };
      render();
    });
    document.querySelector('#family-share-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(familySharePreview.url); showToast('共有リンクをコピーしました。'); }
      catch { showToast('コピーできませんでした。リンクを長押ししてコピーしてください。', 'error'); }
    });
    document.querySelector('#family-share-system')?.addEventListener('click', async () => {
      if (!navigator.share) { showToast('この端末では共有メニューを利用できません。', 'error'); return; }
      try { await navigator.share({ title: '守れるいのち 家族の防災計画', text: '家族の防災計画を共有します。内容を確認してから追加してください。', url: familySharePreview.url }); } catch {}
    });
    document.querySelector('#family-share-download')?.addEventListener('click', () => {
      downloadText(`mamoreru-inochi-family-plan-${todayIso()}.json`, `${JSON.stringify(familySharePreview.bundle, null, 2)}\n`);
    });
    return;
  }
  if (mode === 'import') {
    document.querySelector('#family-import-apply')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog('共有された内容を追加しますか？', '共有された項目だけを現在の家族計画へ追加します。同じ項目は共有内容で更新されます。', '追加する');
      if (!confirmed) return;
      state.familyPlan = mergeFamilyPlan(state.familyPlan, familySharePreview);
      familySharePreview = null;
      history.replaceState(null, '', clearFamilyShareFromUrl(location.href));
      await persistCurrentState();
      location.hash = '#/family';
      render();
      showToast('共有された家族計画を追加しました。');
    });
    document.querySelector('#family-import-discard')?.addEventListener('click', () => {
      familySharePreview = null;
      history.replaceState(null, '', clearFamilyShareFromUrl(location.href));
      location.hash = '#/family';
      render();
    });
    document.querySelector('#family-import-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const text = String(new FormData(event.currentTarget).get('payload') || '').trim();
        const file = document.querySelector('#family-import-file')?.files?.[0];
        if (file) familySharePreview = JSON.parse(await readFileText(file));
        else if (/^https?:/i.test(text)) familySharePreview = readFamilyShareFromLocation(text);
        else familySharePreview = decodeSharePayload(text);
        render();
      } catch (error) { showToast(error.message || '共有データを読み取れませんでした。', 'error'); }
    });
    return;
  }

  const form = document.querySelector('#family-plan-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const simpleFields = ['primaryMeetingPlace','secondaryMeetingPlace','outOfAreaContact','contactRule','pickupRule','supportPlan','petPlan','utilityRule','prohibitedRoutes','notes','reviewDate','nextReviewDate'];
    for (const key of simpleFields) state.familyPlan[key] = String(data.get(key) || '').trim();
    state.familyPlan.hazardDestinations = {
      earthquake: String(data.get('hazard-earthquake') || '').trim(),
      flood: String(data.get('hazard-flood') || '').trim(),
      tsunami: String(data.get('hazard-tsunami') || '').trim(),
      landslide: String(data.get('hazard-landslide') || '').trim(),
      fire: String(data.get('hazard-fire') || '').trim()
    };
    state.familyPlan.evacuationPlace = Object.values(state.familyPlan.hazardDestinations).filter(Boolean).join(' / ');
    state.familyPlan.updatedAt = new Date().toISOString();
    await persistCurrentState();
    showToast('家族の防災計画を保存しました。');
    render();
  });
}


function renderDrills(mode = 'home') {
  if (mode === 'run') return renderDrillRun();
  if (mode === 'result') return renderDrillResult();
  const history = state.drills.history || [];
  return `<div class="page-container">
    ${pageHeader('防災訓練', '3分から、実物を確認する', uiText('点数を競う訓練ではありません。気づいた不足を、備蓄や家族計画へ反映します。', '短い時間で、家にある物と家族の行動を確認します。'))}
    <div class="notice privacy"><p>訓練の記録は、この端末だけに保存します。位置情報や結果を外部へ送りません。</p></div>
    <form id="drill-start-form" class="card section">
      <div class="form-grid">
        <div class="form-field full"><label for="drill-scenario">想定する状況</label><select id="drill-scenario" name="scenarioId">${DRILL_SCENARIOS.map((item) => `<option value="${item.id}">${escapeHtml(item.title)} - ${escapeHtml(item.summary)}</option>`).join('')}</select></div>
        <div class="form-field"><label for="drill-duration">使う時間</label><select id="drill-duration" name="duration">${DRILL_DURATIONS.map((duration) => `<option value="${duration}"${duration === 5 ? ' selected' : ''}>${duration}分</option>`).join('')}</select></div>
      </div>
      <div class="button-row"><button class="button" type="submit">訓練を始める</button><a class="button secondary" href="#/family">家族計画を見る</a></div>
    </form>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">これまで</p><h2>訓練の記録</h2></div><span class="badge">${history.length}件</span></div>
      ${history.length ? `<div class="grid two">${history.slice(0, 10).map((item) => `<article class="card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(formatDateTime(item.completedAt))} / ${item.duration}分</p><p>確認 ${item.completedCount}/${item.totalCount}</p>${item.actionItem ? `<p><strong>次にすること:</strong> ${escapeHtml(item.actionItem)}</p>` : ''}</article>`).join('')}</div>` : '<div class="empty-state card"><p>まだ訓練の記録はありません。まず3分から始められます。</p></div>'}
    </section>
    <section class="card section"><h2>次回の予定</h2><form id="drill-calendar-form"><div class="form-grid"><div class="form-field"><label for="drill-next-date">次に確認する日</label><input id="drill-next-date" name="nextDate" type="date" value="${escapeHtml(state.drills.nextReviewDate || '')}"></div></div><div class="button-row"><button class="button secondary" type="submit">カレンダー用ファイルを保存</button></div></form><p class="hint">ブラウザの不確実な定期通知には依存せず、端末のカレンダーへ予定を追加できます。</p></section>
  </div>`;
}

function renderDrillRun() {
  const session = state.drills.active;
  if (!session) return `<div class="page-container">${pageHeader('防災訓練', '訓練が選ばれていません', '')}<a class="button" href="#/drills">訓練を選ぶ</a></div>`;
  const scenario = DRILL_SCENARIOS.find((item) => item.id === session.scenarioId);
  const progress = drillProgress(session);
  return `<div class="page-container">
    ${pageHeader('防災訓練', scenario.title, `${session.duration}分を目安に、実際の場所や物を確認します。`)}
    <div class="progress-wrap"><div class="progress-meta"><span>${progress.completed}/${progress.total}項目</span><span>${progress.percent}%</span></div><progress class="native-progress" max="100" value="${progress.percent}">${progress.percent}%</progress></div>
    <form id="drill-run-form" class="section">
      <div class="drill-steps">${scenario.steps.map((step, index) => `<label class="drill-step"><input type="checkbox" name="step" value="${index}"${session.completedSteps.includes(index) ? ' checked' : ''}><span><strong>${index + 1}</strong>${escapeHtml(step)}</span></label>`).join('')}</div>
      <section class="card section"><h2>気づいたこと</h2><div class="form-field"><label for="drill-reflection">${escapeHtml(scenario.reflection)}</label><textarea id="drill-reflection" name="reflection" maxlength="500">${escapeHtml(session.reflection || '')}</textarea></div><div class="form-field"><label for="drill-action">次回までに行うことを1つ</label><input id="drill-action" name="actionItem" type="text" maxlength="240" value="${escapeHtml(session.actionItem || '')}" placeholder="例: 携帯トイレを20回分追加する"></div></section>
      <div class="button-row"><button class="button" type="submit">訓練を完了する</button><button class="button secondary" type="button" id="drill-save-later">途中まで保存</button><a class="button subtle" href="#/drills">中止して戻る</a></div>
    </form>
  </div>`;
}

function renderDrillResult() {
  const latest = state.drills.history?.[0];
  if (!latest) return renderDrills('home');
  return `<div class="page-container">
    ${pageHeader('防災訓練', '確認したことを、次の備えへつなげる', '点数ではなく、実際に確認できたことと次の一歩を残します。')}
    <section class="card"><p class="eyebrow">${escapeHtml(latest.title)}</p><h2>${latest.completedCount}/${latest.totalCount}項目を確認しました</h2>${latest.reflection ? `<p><strong>気づいたこと:</strong> ${escapeHtml(latest.reflection)}</p>` : ''}${latest.actionItem ? `<div class="notice warning"><p><strong>次回までに行うこと:</strong> ${escapeHtml(latest.actionItem)}</p></div>` : ''}<p class="data-source-stamp">完了: ${escapeHtml(formatDateTime(latest.completedAt))}</p></section>
    <div class="grid three section"><a class="card clickable card-link" href="#/stockpile/results"><h2>備蓄へ反映</h2><p>不足していた物や日数を確認します。</p></a><a class="card clickable card-link" href="#/family"><h2>家族計画へ反映</h2><p>集合場所、連絡、役割を更新します。</p></a><a class="card clickable card-link" href="#/safety"><h2>家の安全へ反映</h2><p>家具や避難経路を確認します。</p></a></div>
    <div class="button-row"><a class="button" href="#/drills">別の訓練をする</a><a class="button secondary" href="#/">ホームへ</a></div>
  </div>`;
}

function bindDrills(mode = 'home') {
  if (mode === 'home') {
    document.querySelector('#drill-start-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.drills.active = createDrillSession(String(data.get('scenarioId') || ''), Number(data.get('duration') || 5));
      await persistCurrentState();
      location.hash = '#/drills/run';
    });
    document.querySelector('#drill-calendar-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const date = String(new FormData(event.currentTarget).get('nextDate') || '');
      try {
        const ics = createDrillCalendarIcs(date);
        state.drills.nextReviewDate = date;
        await persistCurrentState();
        downloadText(`mamoreru-inochi-drill-${date}.ics`, ics, 'text/calendar;charset=utf-8');
        showToast('カレンダー用ファイルを保存しました。');
      } catch (error) { showToast(error.message, 'error'); }
    });
    return;
  }
  if (mode === 'run') {
    const form = document.querySelector('#drill-run-form');
    const updateSession = () => {
      if (!form || !state.drills.active) return;
      const data = new FormData(form);
      state.drills.active.completedSteps = data.getAll('step').map(Number);
      state.drills.active.reflection = String(data.get('reflection') || '').trim();
      state.drills.active.actionItem = String(data.get('actionItem') || '').trim();
    };
    form?.addEventListener('change', () => { updateSession(); persistDebounced(); });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault(); updateSession();
      const completed = completeDrillSession(state.drills.active);
      state.drills.history.unshift(completed);
      state.drills.history = state.drills.history.slice(0, 50);
      state.drills.lastCompletedAt = completed.completedAt;
      state.drills.active = null;
      await persistCurrentState();
      location.hash = '#/drills/result';
    });
    document.querySelector('#drill-save-later')?.addEventListener('click', async () => { updateSession(); await persistCurrentState(); showToast('途中まで保存しました。'); });
  }
}


function activeLocation() {
  return state.locations.items.find((item) => item.id === state.locations.activeId) ?? null;
}

function blankLocation() {
  return {
    id: '',
    name: '',
    addressLabel: '',
    latitude: '',
    longitude: '',
    jmaOfficeCode: '',
    publicData: { jshis: null, gsi: null, jma: null }
  };
}

function locationFormValue() {
  if (locationDraft) return locationDraft;
  const selected = activeLocation();
  return selected ? { ...selected } : blankLocation();
}

function renderLocations() {
  const selected = activeLocation();
  const formLocation = locationFormValue();
  const canUseLocation = 'geolocation' in navigator;
  return `
    <div class="page-container">
      ${pageHeader('地域情報', '現在地・住所・地図から場所を登録する', '自宅、職場、学校、実家などを登録し、災害別の地図、避難場所、警報・注意報を確認します。')}

      <section class="notice privacy">
        <h2>位置や住所は、許可するまで外部へ送りません</h2>
        <p>現在地の取得だけでは公的機関へ問い合わせません。住所検索、地図、J-SHIS、避難場所、警報・注意報は、送信先・目的・内容を確認して許可した場合だけ取得します。EpsilonLabへ位置情報を送信する処理はありません。</p>
      </section>

      <section class="grid two section location-editor-grid">
        <div class="card">
          <div class="section-heading"><div><p class="eyebrow">地点を登録</p><h2>${formLocation.id ? '選択中の地点を編集' : '新しい地点を追加'}</h2></div>${formLocation.id ? '<button class="button subtle small" type="button" data-action="location-new">新規追加へ</button>' : ''}</div>

          <div class="location-methods" role="group" aria-label="地点の探し方">
            <button class="location-method" type="button" data-location-method="current"${canUseLocation ? '' : ' disabled'}><span aria-hidden="true">◎</span><strong>現在地から探す</strong><small>端末の位置情報を一度だけ使います</small></button>
            <button class="location-method" type="button" data-location-method="address"><span aria-hidden="true">〒</span><strong>住所・施設名から探す</strong><small>候補を地図で確認して選びます</small></button>
            <button class="location-method" type="button" data-location-method="map"><span aria-hidden="true">地</span><strong>地図から探す</strong><small>地図を動かして中央の場所を選びます</small></button>
          </div>

          <form id="address-search-form" class="subpanel section" hidden>
            <div class="form-field"><label for="address-search-query">住所・施設名</label><input id="address-search-query" name="query" type="search" minlength="2" maxlength="120" placeholder="例: 市区町村名 / 駅名・公共施設名"><p class="hint">入力した検索語を国土地理院の住所検索へ送信します。実名や部屋番号など、検索に不要な情報は入力しないでください。</p></div>
            <div class="button-row"><button class="button" type="submit">候補を探す</button></div>
          </form>

          ${addressSearchResults.length ? `<section class="address-results section" aria-labelledby="address-results-title"><h3 id="address-results-title">検索候補</h3><div class="choice-list">${addressSearchResults.map((item) => `<button class="choice-row" type="button" data-address-result="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>候補の場所をフォームと地図へ入力</small></button>`).join('')}</div></section>` : ''}

          ${visibleMapLocationId === 'picker' ? renderLocationPickerMap(formLocation) : ''}

          <form id="location-form" novalidate>
            <input type="hidden" name="id" value="${escapeHtml(formLocation.id)}">
            <div class="form-grid">
              <div class="form-field full"><label for="location-name">地点名</label><input id="location-name" name="name" type="text" maxlength="60" required value="${escapeHtml(formLocation.name)}" placeholder="例: 自宅、職場、実家"></div>
              <div class="form-field full"><label for="location-address-label">住所・目印（任意）</label><input id="location-address-label" name="addressLabel" type="text" maxlength="160" value="${escapeHtml(formLocation.addressLabel || '')}" placeholder="例: ○○駅の北側"><p class="hint">端末内の表示用です。公的情報の取得時には送信しません。</p></div>
              <div class="form-field full"><label for="location-jma-office">警報・注意報を確認する地域</label><select id="location-jma-office" name="jmaOfficeCode"><option value="">選択してください</option>${JMA_OFFICES.map((office) => `<option value="${office.code}"${formLocation.jmaOfficeCode === office.code ? ' selected' : ''}>${escapeHtml(office.name)}</option>`).join('')}</select></div>
            </div>
            <details class="section"><summary>詳細設定: 座標を直接確認・入力する</summary><div class="form-grid"><div class="form-field"><label for="location-latitude">緯度</label><input id="location-latitude" name="latitude" type="number" min="-90" max="90" step="0.000001" required value="${escapeHtml(formLocation.latitude)}" placeholder="35.681236"></div><div class="form-field"><label for="location-longitude">経度</label><input id="location-longitude" name="longitude" type="number" min="-180" max="180" step="0.000001" required value="${escapeHtml(formLocation.longitude)}" placeholder="139.767125"></div></div></details>
            <div class="button-row"><button class="button" type="submit">${formLocation.id ? '地点を更新する' : 'この地点を登録する'}</button></div>
          </form>
        </div>

        <div class="card">
          <div class="section-heading"><div><p class="eyebrow">登録済み</p><h2>よく使う場所</h2></div><span class="badge">${state.locations.items.length}件</span></div>
          ${state.locations.items.length ? `<div class="location-list">${state.locations.items.map((item) => `<article class="card location-card${item.id === state.locations.activeId ? ' selected' : ''}"><h3>${escapeHtml(item.name)}</h3>${item.addressLabel ? `<p>${escapeHtml(item.addressLabel)}</p>` : ''}<p class="location-coordinates">位置は詳細画面で確認できます</p><p>${escapeHtml(JMA_OFFICES.find((office) => office.code === item.jmaOfficeCode)?.name || '警報地域は未設定')}</p><div class="button-row"><button class="button small" type="button" data-action="location-select" data-id="${escapeHtml(item.id)}">${item.id === state.locations.activeId ? '選択中' : 'この地点を見る'}</button><button class="button danger small" type="button" data-action="location-delete" data-id="${escapeHtml(item.id)}">削除</button></div></article>`).join('')}</div>` : '<div class="empty-state"><h3>まだ地点がありません</h3><p>現在地、住所、地図のいずれかから場所を選べます。</p></div>'}
        </div>
      </section>

      ${selected ? renderLocationDataPanel(selected) : `<section class="empty-state card section"><h2>地点を追加すると、防災地図と公的情報を確認できます</h2><p>災害別のハザードマップ、J-SHISの地震動確率、避難場所、警報・注意報を、個別に許可して取得できます。</p></section>`}
      ${renderCommunicationLog()}
    </div>`;
}

function renderLocationPickerMap(formLocation) {
  const hasPoint = Number.isFinite(Number(formLocation.latitude)) && Number.isFinite(Number(formLocation.longitude)) && formLocation.latitude !== '' && formLocation.longitude !== '';
  if (hasPoint) mapView = { ...mapView, latitude: Number(formLocation.latitude), longitude: Number(formLocation.longitude) };
  return `<section class="map-picker section"><div class="section-heading"><div><p class="eyebrow">地図から選ぶ</p><h3>中央の印へ場所を合わせる</h3></div><span class="badge">拡大 ${mapView.zoom}</span></div>
    ${renderMapCanvas(mapView, null, true)}
    ${renderMapNavigationControls(true)}
    <div class="button-row"><button class="button" type="button" id="map-use-center">中央の場所をフォームへ入力</button><button class="button subtle" type="button" id="map-picker-close">地図を閉じる</button></div>
  </section>`;
}

function renderLocationDataPanel(locationItem) {
  const jshis = locationItem.publicData?.jshis;
  const gsi = locationItem.publicData?.gsi;
  const jma = locationItem.publicData?.jma;
  const hazard = GSI_HAZARD_LAYERS[state.locations.selectedHazard] ?? GSI_HAZARD_LAYERS.earthquake;
  const mapVisible = visibleMapLocationId === locationItem.id;
  return `<section class="section" aria-labelledby="public-data-title">
    <div class="section-heading"><div><p class="eyebrow">選択中: ${escapeHtml(locationItem.name)}</p><h2 id="public-data-title">防災地図と公的情報</h2></div><span class="badge ${navigator.onLine ? 'success' : 'warning'}">${navigator.onLine ? 'オンライン' : 'オフライン'}</span></div>
    <p>取得時刻を必ず確認し、最新情報は自治体・各機関の公式情報を優先してください。地図上に色がないことは、安全を保証しません。</p>

    <article class="card hazard-map-card">
      <div class="section-heading"><div><p class="eyebrow">選択地点の周辺</p><h3>災害別の防災地図</h3></div>${mapVisible ? `<span class="badge brand">${escapeHtml(HAZARD_MAP_LAYERS[state.locations.map.hazardLayer]?.name || '災害レイヤなし')}</span>` : ''}</div>
      ${mapVisible ? `${renderMapCanvas({ latitude: Number(locationItem.latitude), longitude: Number(locationItem.longitude), zoom: mapView.zoom, hazardLayer: state.locations.map.hazardLayer, opacity: state.locations.map.opacity }, locationItem, false)}${renderMapNavigationControls(false)}${renderMapLayerControls()}${renderOfflineMapControls(locationItem)}` : `<p>「防災地図を表示」を押すと、国土地理院の背景地図と、選んだ災害レイヤを画面内に表示します。</p><div class="button-row"><button class="button" type="button" id="location-map-show"${navigator.onLine ? '' : ' disabled'}>防災地図を表示</button></div>`}
      <p class="small-text">出典: 国土地理院 / ハザードマップポータルサイト。未整備・未提供の区域があります。自治体の最新ハザードマップも確認してください。</p>
      <div class="button-row"><a class="button secondary small" href="${escapeHtml(buildGsiMapUrl(locationItem.latitude, locationItem.longitude))}" target="_blank" rel="noopener noreferrer">地理院地図で詳しく見る</a><a class="button secondary small" href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener noreferrer">公式ハザードマップを開く</a></div>
    </article>

    <div class="public-data-grid section">
      <article class="card"><p class="eyebrow">J-SHIS</p><h3>今後30年間の地震動確率</h3>${jshis ? renderJshisResult(jshis) : '<p>まだ取得していません。選択地点の緯度・経度を防災科学技術研究所へ送信します。</p>'}<div class="button-row"><button class="button small" type="button" data-action="fetch-jshis"${navigator.onLine ? '' : ' disabled'}>${jshis ? '地震情報を更新' : '地震情報を取得'}</button></div></article>
      <article class="card"><p class="eyebrow">国土地理院</p><h3>近くの避難先</h3><div class="form-field"><label for="gsi-hazard">対応する災害</label><select id="gsi-hazard" name="gsiHazard">${Object.values(GSI_HAZARD_LAYERS).map((item) => `<option value="${item.id}"${item.id === hazard.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>${gsi ? renderGsiResult(gsi) : '<p>指定緊急避難場所は災害の種類ごとに対応が異なります。</p>'}<div class="button-row"><button class="button small" type="button" data-action="fetch-gsi"${navigator.onLine ? '' : ' disabled'}>${gsi ? '避難先を更新' : '避難先を取得'}</button></div></article>
      <article class="card"><p class="eyebrow">気象庁</p><h3>警報・注意報</h3>${locationItem.jmaOfficeCode ? (jma ? renderJmaResult(jma) : '<p>まだ取得していません。選択した地域コードだけを気象庁へ送信します。</p>') : '<p>地点の編集画面で警報・注意報を確認する地域を選んでください。</p>'}<div class="button-row"><button class="button small" type="button" data-action="fetch-jma"${navigator.onLine && locationItem.jmaOfficeCode ? '' : ' disabled'}>${jma ? '警報・注意報を更新' : '警報・注意報を取得'}</button></div></article>
    </div>
    <div class="button-row"><button class="button danger small" type="button" data-action="clear-location-data">この地点の取得済み情報を削除</button></div>
  </section>`;
}


function renderJshisResult(result) {
  const values = result.probabilities ?? {};
  return `
    <dl class="summary-list">
      <div><dt>震度5弱以上</dt><dd>${escapeHtml(formatProbability(values.intensity5Lower))}</dd></div>
      <div><dt>震度5強以上</dt><dd>${escapeHtml(formatProbability(values.intensity5Upper))}</dd></div>
      <div><dt>震度6弱以上</dt><dd><strong>${escapeHtml(formatProbability(values.intensity6Lower))}</strong></dd></div>
      <div><dt>震度6強以上</dt><dd>${escapeHtml(formatProbability(values.intensity6Upper))}</dd></div>
    </dl>
    <p class="small-text">確率が低くても地震が起きないことを意味しません。建物・家具・避難の備えとは分けて確認してください。</p>
    <p class="data-source-stamp">取得: ${escapeHtml(formatDateTime(result.fetchedAt))} / 防災科学技術研究所 J-SHIS</p>`;
}

function renderGsiResult(result) {
  const emergency = (result.places ?? []).filter((item) => item.kind === 'emergency').slice(0, 8);
  const shelters = (result.places ?? []).filter((item) => item.kind === 'shelter').slice(0, 8);
  const welfareShelters = (result.places ?? []).filter((item) => item.kind === 'welfare-shelter').slice(0, 8);
  const list = (items, empty) => items.length ? `<ul class="shelter-list">${items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><br><span>${escapeHtml(item.address || '住所情報なし')} / 約${formatNumber(item.distanceKm, 2)}km</span>${item.remarks ? `<br><small>${escapeHtml(item.remarks)}</small>` : ''}</li>`).join('')}</ul>` : `<p>${escapeHtml(empty)}</p>`;
  return `
    <p><strong>${escapeHtml(result.hazardName || '選択した災害')}に対応する指定緊急避難場所</strong></p>
    ${list(emergency, '周辺タイルから該当する指定緊急避難場所を確認できませんでした。')}
    <details><summary>指定避難所も見る</summary>${list(shelters, '周辺タイルから指定避難所を確認できませんでした。')}</details>
    <details><summary>指定福祉避難所も見る</summary>${list(welfareShelters, '周辺タイルから指定福祉避難所を確認できませんでした。')}</details>
    <p class="small-text">指定緊急避難場所、指定避難所、指定福祉避難所は役割が異なります。最新でない場合や未掲載の場合があるため、自治体の最新情報と受入条件を必ず確認してください。</p>
    <p class="data-source-stamp">取得: ${escapeHtml(formatDateTime(result.fetchedAt))} / 国土地理院</p>`;
}

function renderJmaResult(result) {
  const warnings = result.warnings ?? [];
  return `
    ${result.headlineText ? `<p>${escapeHtml(result.headlineText)}</p>` : ''}
    ${warnings.length ? `<ul class="plain-list">${warnings.slice(0, 30).map((item) => `<li><strong>${escapeHtml(item.name)}</strong> - ${escapeHtml(item.areaName)}（${escapeHtml(item.status)}）</li>`).join('')}</ul>` : '<div class="notice success"><p>取得した情報では、表示対象となる警報・注意報は確認されませんでした。</p></div>'}
    <p class="data-source-stamp">発表: ${escapeHtml(formatDateTime(result.reportDatetime))} / 取得: ${escapeHtml(formatDateTime(result.fetchedAt))} / 気象庁</p>
    <p class="small-text">発表後に状況が変わることがあります。避難情報は自治体の公式情報も確認してください。</p>`;
}

function renderMapCanvas(centerInput, locationItem = null, interactive = false) {
  const center = {
    latitude: Number(centerInput.latitude),
    longitude: Number(centerInput.longitude),
    zoom: clampZoom(centerInput.zoom)
  };
  const layout = buildMapTiles(center, { width: 768, height: 512, padding: 1 });
  const layerId = centerInput.hazardLayer || state.locations.map.hazardLayer || 'none';
  const layer = HAZARD_MAP_LAYERS[layerId] || HAZARD_MAP_LAYERS.none;
  const opacity = Math.max(0.2, Math.min(0.9, Number(centerInput.opacity ?? state.locations.map.opacity ?? 0.62)));
  const baseImages = layout.tiles.map((tile) => `<image href="${escapeHtml(tileUrl(BASE_MAP.template, tile.z, tile.x, tile.y))}" x="${tile.left}" y="${tile.top}" width="256" height="256" preserveAspectRatio="none"/>`).join('');
  const hazardImages = layer.templates.flatMap((template) => layout.tiles.map((tile) => `<image href="${escapeHtml(tileUrl(template, tile.z, tile.x, tile.y))}" x="${tile.left}" y="${tile.top}" width="256" height="256" opacity="${opacity}" preserveAspectRatio="none"/>`)).join('');
  const markerPoint = locationItem ? { latitude: Number(locationItem.latitude), longitude: Number(locationItem.longitude) } : center;
  const marker = markerPosition(center, markerPoint, 768, 512);
  const places = state.locations.map.showShelters && locationItem?.publicData?.gsi?.places
    ? locationItem.publicData.gsi.places.filter((item) => ['emergency', 'shelter', 'welfare-shelter'].includes(item.kind)).slice(0, 30)
    : [];
  const shelterMarkers = places.map((place) => {
    const position = markerPosition(center, place, 768, 512);
    if (position.left < -20 || position.left > 788 || position.top < -20 || position.top > 532) return '';
    const label = place.kind === 'emergency' ? '避' : place.kind === 'welfare-shelter' ? '福' : '所';
    return `<g class="map-shelter-marker" aria-label="${escapeHtml(place.name)}"><circle cx="${position.left}" cy="${position.top}" r="12"/><text x="${position.left}" y="${position.top + 4}" text-anchor="middle">${label}</text><title>${escapeHtml(place.name)}</title></g>`;
  }).join('');
  return `<div class="hazard-map-wrap">
    <svg class="hazard-map${interactive ? ' map-interactive' : ''}" viewBox="0 0 768 512" role="img" aria-label="${interactive ? '場所を選ぶ地図' : `${escapeHtml(locationItem?.name || '選択地点')}周辺の防災地図`}" data-map-interactive="${interactive ? 'true' : 'false'}">
      <rect width="768" height="512" fill="#e9e4da"/>
      ${baseImages}${hazardImages}${shelterMarkers}
      ${interactive ? '<g class="map-crosshair" aria-hidden="true"><circle cx="384" cy="256" r="18"/><path d="M384 226v60M354 256h60"/></g>' : `<g class="map-location-marker"><circle cx="${marker.left}" cy="${marker.top}" r="15"/><circle cx="${marker.left}" cy="${marker.top}" r="5"/><title>${escapeHtml(locationItem?.name || '選択地点')}</title></g>`}
    </svg>
    <p class="map-attribution">地図: 国土地理院${layer.attribution ? ` / ${escapeHtml(layer.attribution)}` : ''}</p>
  </div>`;
}

function renderMapNavigationControls(picker = false) {
  return `<div class="map-controls" aria-label="地図操作">
    <div class="map-pan-grid"><span></span><button type="button" class="button secondary small" data-map-move="up" aria-label="地図を北へ移動">↑</button><span></span><button type="button" class="button secondary small" data-map-move="left" aria-label="地図を西へ移動">←</button><button type="button" class="button secondary small" data-map-reset="${picker ? 'picker' : 'location'}" aria-label="登録地点へ戻す">●</button><button type="button" class="button secondary small" data-map-move="right" aria-label="地図を東へ移動">→</button><span></span><button type="button" class="button secondary small" data-map-move="down" aria-label="地図を南へ移動">↓</button><span></span></div>
    <div class="button-row"><button class="button secondary small" type="button" data-map-zoom="out"${mapView.zoom <= MAP_MIN_ZOOM ? ' disabled' : ''}>縮小 −</button><span class="badge">拡大 ${mapView.zoom}</span><button class="button secondary small" type="button" data-map-zoom="in"${mapView.zoom >= MAP_MAX_ZOOM ? ' disabled' : ''}>拡大 ＋</button></div>
  </div>`;
}

function renderMapLayerControls() {
  return `<div class="map-layer-controls section">
    <div class="form-field"><label for="hazard-map-layer">表示する災害</label><select id="hazard-map-layer">${Object.values(HAZARD_MAP_LAYERS).map((layer) => `<option value="${layer.id}"${state.locations.map.hazardLayer === layer.id ? ' selected' : ''}>${escapeHtml(layer.name)}</option>`).join('')}</select></div>
    <div class="form-field"><label for="hazard-map-opacity">災害レイヤの濃さ: ${Math.round(Number(state.locations.map.opacity || 0.62) * 100)}%</label><input id="hazard-map-opacity" type="range" min="20" max="90" step="5" value="${Math.round(Number(state.locations.map.opacity || 0.62) * 100)}"></div>
    <label><input id="map-show-shelters" type="checkbox"${state.locations.map.showShelters ? ' checked' : ''}> 取得済みの避難場所を地図に重ねる</label>
    <div class="notice warning"><p>色が付いていない場所も、安全を保証するものではありません。データ未整備、縮尺、区域外などの可能性があります。</p></div>
  </div>`;
}

function renderOfflineMapControls(locationItem) {
  const saved = state.locations.offlineMaps.find((item) => item.locationId === locationItem.id && item.layerId === state.locations.map.hazardLayer && Number(item.zoom) === Number(mapView.zoom));
  return `<div class="offline-map-controls section"><h4>この周辺をオフライン用に保存</h4><p>現在の縮尺と災害レイヤの小さな範囲だけを保存します。全国地図や最新の警報は保存しません。</p>${saved ? `<p class="badge success">保存済み: ${escapeHtml(formatDateTime(saved.savedAt))} / ${saved.urlCount}枚</p>` : ''}<div class="button-row"><button class="button secondary small" type="button" id="map-save-offline"${navigator.onLine ? '' : ' disabled'}>${saved ? '地図を保存し直す' : '周辺地図を保存'}</button>${saved ? '<button class="button danger small" type="button" id="map-clear-offline">保存した地図を削除</button>' : ''}</div></div>`;
}


function renderCommunicationLog() {
  const logs = state.network.logs ?? [];
  return `
    <section class="card section communication-log">
      <div class="section-heading"><div><p class="eyebrow">この端末だけ</p><h2>外部通信の履歴</h2></div><span class="badge">${logs.length}件</span></div>
      <p>公的情報を取得したときの送信先・目的・内容を、この端末内だけに記録します。EpsilonLabへ送信しません。</p>
      ${logs.length ? `<div class="table-wrap"><table class="summary-table"><thead><tr><th>日時</th><th>提供元</th><th>目的・送信内容</th><th>結果</th></tr></thead><tbody>${logs.slice(0, 30).map((log) => `<tr><td>${escapeHtml(formatDateTime(log.at))}</td><td>${escapeHtml(log.providerName)}</td><td>${escapeHtml(log.purpose)}<br><small>${escapeHtml(log.sent)}</small></td><td>${escapeHtml(log.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p>まだ外部通信はありません。</p>'}
      ${logs.length ? '<div class="button-row"><button class="button danger small" type="button" data-action="clear-network-log">履歴を削除</button></div>' : ''}
    </section>`;
}

function captureLocationFormDraft() {
  const form = document.querySelector('#location-form');
  if (!form) return locationDraft || locationFormValue();
  const data = new FormData(form);
  return {
    ...(locationDraft || locationFormValue()),
    id: String(data.get('id') || ''),
    name: String(data.get('name') || ''),
    addressLabel: String(data.get('addressLabel') || ''),
    latitude: String(data.get('latitude') || ''),
    longitude: String(data.get('longitude') || ''),
    jmaOfficeCode: String(data.get('jmaOfficeCode') || '')
  };
}

function resetMapViewFromPoint(latitude, longitude, zoom = 14) {
  mapView = { ...mapView, latitude: Number(latitude), longitude: Number(longitude), zoom: clampZoom(zoom) };
}

function bindMapControls({ picker = false } = {}) {
  document.querySelectorAll('[data-map-move]').forEach((button) => button.addEventListener('click', () => {
    mapView = { ...mapView, ...moveMapCenter(mapView, button.dataset.mapMove) };
    if (picker) {
      locationDraft = { ...captureLocationFormDraft(), latitude: mapView.latitude.toFixed(6), longitude: mapView.longitude.toFixed(6) };
    }
    render();
  }));
  document.querySelectorAll('[data-map-zoom]').forEach((button) => button.addEventListener('click', () => {
    mapView.zoom = clampZoom(mapView.zoom + (button.dataset.mapZoom === 'in' ? 1 : -1));
    render();
  }));
  document.querySelectorAll('[data-map-reset]').forEach((button) => button.addEventListener('click', () => {
    const source = picker ? captureLocationFormDraft() : activeLocation();
    if (source && source.latitude !== '' && source.longitude !== '') resetMapViewFromPoint(source.latitude, source.longitude, 14);
    render();
  }));
  document.querySelector('.map-interactive')?.addEventListener('click', (event) => {
    if (!picker) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = pointFromViewport(mapView, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, 768, 512);
    mapView = { ...mapView, ...point };
    locationDraft = { ...captureLocationFormDraft(), latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) };
    render();
  });
}

function bindLocations() {
  document.querySelector('[data-action="location-new"]')?.addEventListener('click', () => {
    state.locations.activeId = null;
    locationDraft = blankLocation();
    addressSearchResults = [];
    visibleMapLocationId = null;
    render();
  });

  document.querySelectorAll('[data-location-method]').forEach((button) => button.addEventListener('click', async () => {
    const method = button.dataset.locationMethod;
    locationDraft = captureLocationFormDraft();
    if (method === 'current') await fillCurrentLocation();
    if (method === 'address') {
      const panel = document.querySelector('#address-search-form');
      if (panel) { panel.hidden = false; document.querySelector('#address-search-query')?.focus(); }
    }
    if (method === 'map') await openLocationPicker();
  }));

  document.querySelector('#address-search-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('query') || '').trim();
    if (query.length < 2) { showToast('住所または施設名を2文字以上入力してください。', 'error'); return; }
    const allowed = await requestNetworkPermission('geocode', null, `入力した検索語「${query}」`);
    if (!allowed) return;
    try {
      main.setAttribute('aria-busy', 'true');
      const result = await searchGsiAddress(query);
      addressSearchResults = result.candidates;
      recordNetworkLog('geocode', '住所・施設名から地点候補を探す', '検索語（内容は通信履歴へ保存しない）', result.candidates.length ? `候補${result.candidates.length}件` : '候補なし');
      persistDebounced();
      render();
      if (!result.candidates.length) showToast('候補を確認できませんでした。表記を変えるか、地図・現在地から選んでください。');
    } catch (error) {
      recordNetworkLog('geocode', '住所・施設名から地点候補を探す', '検索語（内容は通信履歴へ保存しない）', `取得失敗: ${error.message}`);
      showToast(error.message || '住所検索を利用できませんでした。', 'error');
    } finally { main.removeAttribute('aria-busy'); }
  });

  document.querySelectorAll('[data-address-result]').forEach((button) => button.addEventListener('click', async () => {
    const result = addressSearchResults.find((item) => item.id === button.dataset.addressResult);
    if (!result) return;
    locationDraft = {
      ...captureLocationFormDraft(),
      name: captureLocationFormDraft().name || result.title,
      addressLabel: result.title,
      latitude: result.latitude.toFixed(6),
      longitude: result.longitude.toFixed(6)
    };
    resetMapViewFromPoint(result.latitude, result.longitude, 15);
    const allowed = await requestNetworkPermission('map', null, `候補地点周辺の地図タイル（緯度 ${result.latitude.toFixed(5)}、経度 ${result.longitude.toFixed(5)}）`);
    visibleMapLocationId = allowed ? 'picker' : null;
    render();
  }));

  const form = document.querySelector('#location-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) { showToast('地点名を入力してください。', 'error'); document.querySelector('#location-name')?.focus(); return; }
    let point;
    try { point = normalizeCoordinates(data.get('latitude'), data.get('longitude')); }
    catch (error) { showToast('現在地、住所、地図のいずれかで場所を選んでください。', 'error'); return; }
    const id = String(data.get('id') || '') || createId('location');
    const existing = state.locations.items.find((item) => item.id === id);
    const pointChanged = existing && (Number(existing.latitude) !== point.latitude || Number(existing.longitude) !== point.longitude);
    const officeChanged = existing && String(existing.jmaOfficeCode || '') !== String(data.get('jmaOfficeCode') || '');
    const retainedData = existing?.publicData ?? { jshis: null, gsi: null, jma: null };
    const next = {
      id,
      name,
      addressLabel: String(data.get('addressLabel') || '').trim(),
      latitude: point.latitude,
      longitude: point.longitude,
      jmaOfficeCode: String(data.get('jmaOfficeCode') || ''),
      publicData: { jshis: pointChanged ? null : retainedData.jshis, gsi: pointChanged ? null : retainedData.gsi, jma: officeChanged ? null : retainedData.jma },
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const index = state.locations.items.findIndex((item) => item.id === id);
    if (index >= 0) state.locations.items[index] = next; else state.locations.items.push(next);
    state.locations.activeId = id;
    locationDraft = null;
    addressSearchResults = [];
    visibleMapLocationId = null;
    resetMapViewFromPoint(point.latitude, point.longitude, 14);
    await persistCurrentState();
    render();
    showToast(index >= 0 ? '地点を更新しました。' : '地点を追加しました。');
  });

  document.querySelector('#gsi-hazard')?.addEventListener('change', (event) => { state.locations.selectedHazard = event.target.value; persistDebounced(); });

  if (visibleMapLocationId === 'picker') {
    bindMapControls({ picker: true });
    document.querySelector('#map-use-center')?.addEventListener('click', () => {
      locationDraft = { ...captureLocationFormDraft(), latitude: Number(mapView.latitude).toFixed(6), longitude: Number(mapView.longitude).toFixed(6) };
      visibleMapLocationId = null;
      render();
      showToast('地図中央の場所をフォームへ入力しました。地点名を確認して登録してください。');
    });
    document.querySelector('#map-picker-close')?.addEventListener('click', () => { visibleMapLocationId = null; render(); });
  }

  document.querySelector('#location-map-show')?.addEventListener('click', showSelectedHazardMap);
  if (activeLocation() && visibleMapLocationId === activeLocation().id) {
    bindMapControls({ picker: false });
    document.querySelector('#hazard-map-layer')?.addEventListener('change', async (event) => {
      const nextLayer = event.target.value;
      if (nextLayer !== 'none') {
        const allowed = await requestNetworkPermission('hazardMap', activeLocation(), `選択地点周辺の「${HAZARD_MAP_LAYERS[nextLayer]?.name || nextLayer}」地図タイル`);
        if (!allowed) { event.target.value = state.locations.map.hazardLayer; return; }
      }
      state.locations.map.hazardLayer = nextLayer;
      mapView.hazardLayer = nextLayer;
      persistDebounced();
      render();
    });
    document.querySelector('#hazard-map-opacity')?.addEventListener('input', (event) => {
      state.locations.map.opacity = Number(event.target.value) / 100;
      mapView.opacity = state.locations.map.opacity;
      persistDebounced();
      render();
    });
    document.querySelector('#map-show-shelters')?.addEventListener('change', (event) => { state.locations.map.showShelters = event.target.checked; persistDebounced(); render(); });
    document.querySelector('#map-save-offline')?.addEventListener('click', () => saveOfflineMap(activeLocation()));
    document.querySelector('#map-clear-offline')?.addEventListener('click', () => clearOfflineMap(activeLocation()));
  }
}

async function openLocationPicker() {
  const draft = captureLocationFormDraft();
  let latitude = Number(draft.latitude);
  let longitude = Number(draft.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { latitude = 35.681236; longitude = 139.767125; }
  const allowed = await requestNetworkPermission('map', null, `地図中央付近のタイル（緯度 ${latitude.toFixed(5)}、経度 ${longitude.toFixed(5)}）`);
  if (!allowed) return;
  locationDraft = { ...draft, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) };
  resetMapViewFromPoint(latitude, longitude, 14);
  visibleMapLocationId = 'picker';
  render();
}

async function fillCurrentLocation() {
  if (!navigator.geolocation) { showToast('この端末では現在地を利用できません。', 'error'); return; }
  const confirmed = await confirmDialog('現在地を使いますか？', '端末の位置情報機能を一度だけ使います。この操作だけでは、公的機関やEpsilonLabへ位置情報を送りません。', '現在地を使う');
  if (!confirmed) return;
  navigator.geolocation.getCurrentPosition(async (position) => {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    locationDraft = { ...captureLocationFormDraft(), latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) };
    resetMapViewFromPoint(latitude, longitude, 15);
    visibleMapLocationId = null;
    render();
    showToast('現在地をフォームへ入力しました。地点名を確認して登録してください。');
  }, (error) => {
    const message = error.code === 1 ? '位置情報の利用が許可されませんでした。' : '現在地を取得できませんでした。';
    showToast(message, 'error');
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
}

async function showSelectedHazardMap() {
  const item = activeLocation();
  if (!item) return;
  const allowed = await requestNetworkPermission('map', item, `選択地点周辺の地図タイル（緯度 ${Number(item.latitude).toFixed(5)}、経度 ${Number(item.longitude).toFixed(5)}）`);
  if (!allowed) return;
  const layerId = state.locations.map.hazardLayer;
  if (layerId !== 'none') {
    const hazardAllowed = await requestNetworkPermission('hazardMap', item, `「${HAZARD_MAP_LAYERS[layerId]?.name || layerId}」の地図タイル`);
    if (!hazardAllowed) return;
  }
  visibleMapLocationId = item.id;
  resetMapViewFromPoint(item.latitude, item.longitude, 14);
  recordNetworkLog('map', '選択地点周辺の防災地図を表示する', '選択地点周辺の地図タイル番号', '表示を開始');
  persistDebounced();
  render();
}

async function saveOfflineMap(item) {
  if (!item || !('caches' in window)) { showToast('このブラウザでは地図を保存できません。', 'error'); return; }
  const layerId = state.locations.map.hazardLayer;
  const urls = urlsForMap({ latitude: mapView.latitude, longitude: mapView.longitude, zoom: mapView.zoom }, layerId, { width: 768, height: 512, padding: 0 });
  const allowed = await requestNetworkPermission('map', item, `周辺地図 ${urls.length}枚をオフライン用に保存`);
  if (!allowed) return;
  if (layerId !== 'none') {
    const hazardAllowed = await requestNetworkPermission('hazardMap', item, `「${HAZARD_MAP_LAYERS[layerId]?.name || layerId}」を含む周辺地図`);
    if (!hazardAllowed) return;
  }
  try {
    main.setAttribute('aria-busy', 'true');
    const cache = await caches.open(mapCacheName(APP_VERSION));
    let savedCount = 0;
    for (const url of urls) {
      try {
        const response = await fetchMapTile(url);
        await cache.put(url, response.clone());
        savedCount += 1;
      } catch {}
    }
    state.locations.offlineMaps = state.locations.offlineMaps.filter((entry) => !(entry.locationId === item.id && entry.layerId === layerId && Number(entry.zoom) === Number(mapView.zoom)));
    state.locations.offlineMaps.push({ id: createId('offline-map'), locationId: item.id, layerId, zoom: mapView.zoom, savedAt: new Date().toISOString(), urlCount: savedCount, urls });
    await persistCurrentState();
    recordNetworkLog('map', '周辺地図をオフライン用に保存する', `${urls.length}枚の地図タイル`, `${savedCount}枚保存`);
    render();
    showToast(`${savedCount}枚の地図をオフライン用に保存しました。`);
  } catch (error) { showToast('地図を保存できませんでした。通信状態と空き容量を確認してください。', 'error'); }
  finally { main.removeAttribute('aria-busy'); }
}

async function clearOfflineMap(item) {
  const entry = state.locations.offlineMaps.find((saved) => saved.locationId === item.id && saved.layerId === state.locations.map.hazardLayer && Number(saved.zoom) === Number(mapView.zoom));
  if (!entry) return;
  const confirmed = await confirmDialog('保存した周辺地図を削除しますか？', '登録地点や取得済みの文字情報は残り、この縮尺の地図タイルだけを削除します。', '削除する');
  if (!confirmed) return;
  try {
    const cache = await caches.open(mapCacheName(APP_VERSION));
    await Promise.all((entry.urls || []).map((url) => cache.delete(url)));
    state.locations.offlineMaps = state.locations.offlineMaps.filter((saved) => saved.id !== entry.id);
    await persistCurrentState();
    render();
  } catch { showToast('保存した地図を削除できませんでした。', 'error'); }
}

async function deleteLocation(id) {
  const item = state.locations.items.find((entry) => entry.id === id);
  if (!item) return;
  const confirmed = await confirmDialog('地点を削除しますか？', `「${item.name}」と、この地点で取得・保存した地域情報を端末内から削除します。`, '削除する');
  if (!confirmed) return;
  const offlineEntries = state.locations.offlineMaps.filter((entry) => entry.locationId === id);
  if ('caches' in window) {
    const cache = await caches.open(mapCacheName(APP_VERSION));
    for (const entry of offlineEntries) await Promise.all((entry.urls || []).map((url) => cache.delete(url)));
  }
  state.locations.offlineMaps = state.locations.offlineMaps.filter((entry) => entry.locationId !== id);
  state.locations.items = state.locations.items.filter((entry) => entry.id !== id);
  if (state.locations.activeId === id) state.locations.activeId = state.locations.items[0]?.id ?? null;
  locationDraft = null;
  visibleMapLocationId = null;
  await persistCurrentState();
  render();
}


async function requestNetworkPermission(providerId, locationItem, sent) {
  const provider = PUBLIC_DATA_PROVIDERS[providerId];
  if (!provider) return false;
  if (sessionNetworkConsents.has(providerId) || state.network.consents?.[providerId]) return true;
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="network-dialog-title" aria-describedby="network-dialog-message">
          <p class="eyebrow">外部通信の確認</p>
          <h2 id="network-dialog-title">${escapeHtml(provider.name)}へ問い合わせますか？</h2>
          <div id="network-dialog-message">
            <dl class="summary-list">
              <div><dt>目的</dt><dd>${escapeHtml(provider.purpose)}</dd></div>
              <div><dt>送信先</dt><dd><code>${escapeHtml(provider.host)}</code></dd></div>
              <div><dt>送信内容</dt><dd>${escapeHtml(sent)}</dd></div>
            </dl>
            <p><strong>地点名、診断回答、家族構成、備蓄情報は送りません。EpsilonLabはこの通信を受信・保存しません。</strong></p>
          </div>
          <div class="modal-actions">
            <button class="button secondary" type="button" id="network-cancel">許可しない</button>
            <button class="button secondary" type="button" id="network-once">今回だけ許可</button>
            <button class="button" type="button" id="network-always">この端末で許可</button>
          </div>
        </section>
      </div>`;
    const close = (mode) => {
      dialogRoot.innerHTML = '';
      if (mode === 'once') sessionNetworkConsents.add(providerId);
      if (mode === 'always') {
        state.network.consents[providerId] = true;
        persistDebounced();
      }
      resolve(Boolean(mode));
    };
    document.querySelector('#network-cancel')?.addEventListener('click', () => close(null));
    document.querySelector('#network-once')?.addEventListener('click', () => close('once'));
    document.querySelector('#network-always')?.addEventListener('click', () => close('always'));
    document.querySelector('#network-cancel')?.focus();
  });
}

function recordNetworkLog(providerId, purpose, sent, status) {
  const provider = PUBLIC_DATA_PROVIDERS[providerId];
  state.network.logs.unshift({
    id: createId('network'),
    at: new Date().toISOString(),
    providerId,
    providerName: provider?.name || providerId,
    purpose,
    sent,
    status
  });
  state.network.logs = state.network.logs.slice(0, 100);
}

async function fetchLocationPublicData(providerId) {
  const item = activeLocation();
  if (!item) return;
  if (!navigator.onLine) {
    showToast('オフラインです。最後に取得した情報を確認してください。', 'error');
    return;
  }
  let sent;
  if (providerId === 'jma') sent = `気象庁地域コード ${item.jmaOfficeCode || '未設定'}`;
  else sent = `緯度 ${Number(item.latitude).toFixed(5)}、経度 ${Number(item.longitude).toFixed(5)}`;
  const allowed = await requestNetworkPermission(providerId, item, sent);
  if (!allowed) return;
  const provider = PUBLIC_DATA_PROVIDERS[providerId];
  try {
    main.setAttribute('aria-busy', 'true');
    let result;
    if (providerId === 'jshis') result = await fetchJshisHazard(item.latitude, item.longitude);
    if (providerId === 'gsi') result = await fetchGsiPlaces(item.latitude, item.longitude, state.locations.selectedHazard);
    if (providerId === 'jma') result = await fetchJmaWarnings(item.jmaOfficeCode);
    item.publicData[providerId] = result;
    recordNetworkLog(providerId, provider.purpose, sent, '取得成功');
    await persistCurrentState();
    render();
    showToast('公的情報を更新しました。');
  } catch (error) {
    recordNetworkLog(providerId, provider.purpose, sent, `取得失敗: ${error.message || '不明なエラー'}`);
    persistDebounced();
    render();
    showToast(error.message || '公的情報を取得できませんでした。', 'error');
  } finally {
    main.removeAttribute('aria-busy');
  }
}

async function showLocationMap() {
  const item = activeLocation();
  if (!item) return;
  const sent = `地図タイル番号の計算に使用する緯度 ${Number(item.latitude).toFixed(5)}、経度 ${Number(item.longitude).toFixed(5)}`;
  const allowed = await requestNetworkPermission('gsi', item, sent);
  if (!allowed) return;
  visibleMapLocationId = item.id;
  recordNetworkLog('gsi', '選択地点周辺の小さな地図を表示する', sent, '表示を開始');
  persistDebounced();
  render();
}

async function clearActiveLocationPublicData() {
  const item = activeLocation();
  if (!item) return;
  const confirmed = await confirmDialog('取得済みの地域情報を削除しますか？', '地点そのものは残し、J-SHIS・国土地理院・気象庁から取得した結果だけを端末内から削除します。', '削除する');
  if (!confirmed) return;
  item.publicData = { jshis: null, gsi: null, jma: null };
  visibleMapLocationId = null;
  await persistCurrentState();
  render();
}

function renderContacts() {
  const categories = [...new Set(EMERGENCY_CONTACTS.map((item) => item.category))];
  const custom = isLocked ? [] : state.contacts.custom;
  const editing = custom.find((item) => item.id === editingCustomContactId) ?? null;
  return `
    <div class="page-container">
      ${pageHeader('緊急連絡先', '災害・事故・急病で役立つ連絡先', '状況に合う番号を確認してから発信できます。命に危険があるときは、相談窓口を待たず緊急通報を優先してください。')}

      <section class="notice danger">
        <h2>緊急時の基本</h2>
        <p><strong>火災・救急・消防による救助は119、事件・交通事故は110、海上の事件・事故は118です。</strong> 川・湖・池・用水路・プールなどで消防の救助が必要な場合は119へ通報します。</p>
      </section>

      ${!isLocked && state.onboardingComplete ? `<section class="card section call-safety-settings"><div class="section-heading"><div><p class="eyebrow">誤操作防止</p><h2>電話をかける前に必ず確認します</h2></div><span class="badge ${state.contacts.strongCallLock ? 'warning' : 'success'}">${state.contacts.strongCallLock ? '追加ロックあり' : '2段階確認'}</span></div><p>番号を押しただけでは電話はかかりません。用途を確認した後に「電話アプリを開く」を選びます。</p><label class="storage-option"><input id="call-lock-toggle" type="checkbox"${state.contacts.strongCallLock ? ' checked' : ''}><span><strong>誤操作防止を強くする</strong><small>小さな子どもが触る端末などでは、確認画面でもう一度ロックを解除します。</small></span></label>${state.contacts.strongCallLock ? `<div class="button-row"><button class="button secondary small" type="button" data-action="unlock-calls-temporarily">10分間だけ追加ロックを解除</button></div>` : ''}</section>` : ''}

      ${categories.map((category) => `
        <section class="section" aria-labelledby="contact-${escapeHtml(category)}">
          <h2 id="contact-${escapeHtml(category)}">${escapeHtml(category)}</h2>
          <div class="contact-grid">
            ${EMERGENCY_CONTACTS.filter((item) => item.category === category).map(renderOfficialContactCard).join('')}
          </div>
        </section>`).join('')}

      ${!isLocked && state.onboardingComplete ? `
        <section class="card section">
          <p class="eyebrow">この端末だけ</p>
          <h2>${editing ? '登録した連絡先を編集' : '自分に必要な連絡先を追加'}</h2>
          <p>自治体、水道、電力、ガス、管理会社、学校、かかりつけ医などを登録できます。保存方法に応じて端末内へ保存されます。</p>
          <form id="custom-contact-form" novalidate>
            <input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}">
            <div class="form-grid">
              <div class="form-field"><label for="custom-contact-type">分類</label><select id="custom-contact-type" name="type">${CUSTOM_CONTACT_TYPES.map((type) => `<option value="${escapeHtml(type)}"${editing?.type === type ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></div>
              <div class="form-field"><label for="custom-contact-name">名称</label><input id="custom-contact-name" name="name" type="text" maxlength="80" required value="${escapeHtml(editing?.name || '')}" placeholder="例: ○○市 防災窓口"></div>
              <div class="form-field"><label for="custom-contact-number">電話番号</label><input id="custom-contact-number" name="number" type="tel" maxlength="40" required value="${escapeHtml(editing?.number || '')}" placeholder="例: 000-000-0000"></div>
              <div class="form-field full"><label for="custom-contact-note">使う場面・受付時間など</label><textarea id="custom-contact-note" name="note" maxlength="300">${escapeHtml(editing?.note || '')}</textarea></div>
            </div>
            <div class="button-row"><button class="button" type="submit">${editing ? '変更を保存' : '連絡先を追加'}</button>${editing ? '<button class="button secondary" type="button" data-action="contact-cancel">編集をやめる</button>' : ''}</div>
          </form>
        </section>

        <section class="card section">
          <div class="section-heading"><div><p class="eyebrow">登録済み</p><h2>自分の連絡先</h2></div><span class="badge">${custom.length}件</span></div>
          ${custom.length ? `<div class="contact-grid">${custom.map(renderCustomContactCard).join('')}</div>` : '<p>まだ登録がありません。</p>'}
        </section>` : `
        <section class="notice privacy section"><p>暗号化保存がロックされている間は、個人で登録した連絡先を表示しません。公的な連絡先はこのまま確認できます。</p></section>`}

      <section class="notice warning section">
        <h2>番号・受付時間は変わる場合があります</h2>
        <p>#7119と#8000は、地域・時間帯によって利用条件が異なります。平常時に自治体の案内を確認し、地域固有の連絡先を登録しておくと安心です。</p>
      </section>
    </div>`;
}

function renderOfficialContactCard(item) {
  const easy = state.preferences.easyJapanese ? EMERGENCY_CONTACT_EASY_TEXT[item.id] : null;
  const summary = easy?.summary || item.summary;
  const cautions = easy?.cautions || item.cautions;
  return `
    <article class="card contact-card${item.urgent ? ' emergency' : ''}">
      <p class="eyebrow">${escapeHtml(item.category)}</p>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="contact-number">${escapeHtml(item.number)}</p>
      <p class="contact-use">${escapeHtml(summary)}</p>
      ${cautions?.length ? `<ul class="contact-caution">${cautions.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : ''}
      <div class="button-row"><button class="button${item.urgent ? ' danger' : ''} small" type="button" data-action="contact-call" data-contact-id="${escapeHtml(item.id)}">用途を確認する</button><a class="button subtle small" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式情報</a></div>
    </article>`;
}

function renderCustomContactCard(item) {
  return `
    <article class="card contact-card">
      <p class="eyebrow">${escapeHtml(item.type)}</p>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="contact-number">${escapeHtml(item.number)}</p>
      ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
      <div class="button-row"><button class="button small" type="button" data-action="contact-call" data-custom-id="${escapeHtml(item.id)}">用途を確認する</button><button class="button secondary small" type="button" data-action="contact-edit" data-id="${escapeHtml(item.id)}">編集</button><button class="button danger small" type="button" data-action="contact-delete" data-id="${escapeHtml(item.id)}">削除</button></div>
    </article>`;
}

function bindContacts() {
  document.querySelector('#call-lock-toggle')?.addEventListener('change', async (event) => {
    state.contacts.strongCallLock = event.target.checked;
    if (!event.target.checked) state.contacts.unlockedUntil = null;
    await persistCurrentState();
    render();
  });
  const form = document.querySelector('#custom-contact-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const number = String(data.get('number') || '').trim();
    if (!name || !number) {
      showToast('名称と電話番号を入力してください。', 'error');
      return;
    }
    const id = String(data.get('id') || '') || createId('contact');
    const existing = state.contacts.custom.find((item) => item.id === id);
    const next = {
      id,
      type: String(data.get('type') || 'その他'),
      name,
      number,
      note: String(data.get('note') || '').trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const index = state.contacts.custom.findIndex((item) => item.id === id);
    if (index >= 0) state.contacts.custom[index] = next;
    else state.contacts.custom.push(next);
    editingCustomContactId = null;
    await persistCurrentState();
    render();
  });
}

async function deleteCustomContact(id) {
  const item = state.contacts.custom.find((entry) => entry.id === id);
  if (!item) return;
  const confirmed = await confirmDialog('連絡先を削除しますか？', `「${item.name}」をこの端末から削除します。`, '削除する');
  if (!confirmed) return;
  state.contacts.custom = state.contacts.custom.filter((entry) => entry.id !== id);
  if (editingCustomContactId === id) editingCustomContactId = null;
  await persistCurrentState();
  render();
}

async function confirmPhoneCall(contactId, customId) {
  const contact = contactId
    ? EMERGENCY_CONTACTS.find((item) => item.id === contactId)
    : state.contacts.custom.find((item) => item.id === customId);
  if (!contact) return;
  const number = contact.number;
  const easyContact = contactId && state.preferences.easyJapanese ? EMERGENCY_CONTACT_EASY_TEXT[contactId] : null;
  const contactSummary = easyContact?.summary || contact.summary || contact.note || '登録した連絡先です。';
  const contactCautions = easyContact?.cautions || contact.cautions || [];
  const sanitized = number.replace(/[^0-9+#*]/g, '');
  const unlockedUntil = Date.parse(state.contacts.unlockedUntil || '');
  const extraLockActive = Boolean(state.contacts.strongCallLock)
    && !(Number.isFinite(unlockedUntil) && unlockedUntil > Date.now());
  return new Promise((resolve) => {
    const renderFinal = () => {
      const action = document.querySelector('#phone-action-area');
      if (!action) return;
      action.innerHTML = `<a class="button${contact.urgent ? ' danger' : ''}" id="phone-call" href="tel:${escapeHtml(sanitized)}">電話アプリを開く</a>`;
      document.querySelector('#phone-call')?.addEventListener('click', () => setTimeout(close, 100));
    };
    const close = () => { dialogRoot.innerHTML = ''; resolve(); };
    dialogRoot.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="phone-dialog-title" aria-describedby="phone-dialog-note">
          <p class="eyebrow">発信前の確認</p>
          <div class="notice warning"><p id="phone-dialog-note"><strong>まだ電話はかかっていません。</strong></p></div>
          <h2 id="phone-dialog-title">${escapeHtml(contact.name)}</h2>
          <p class="contact-number">${escapeHtml(number)}</p>
          <p>${escapeHtml(contactSummary)}</p>
          ${contactCautions.length ? `<ul>${contactCautions.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : ''}
          <p><strong>現在の状況に合う番号か、もう一度確認してください。</strong></p>
          <div class="modal-actions"><button class="button secondary" type="button" id="phone-cancel">戻る</button><span id="phone-action-area">${extraLockActive ? '<button class="button warning" type="button" id="phone-unlock">追加ロックを解除</button>' : `<a class="button${contact.urgent ? ' danger' : ''}" id="phone-call" href="tel:${escapeHtml(sanitized)}">電話アプリを開く</a>`}</span></div>
        </section>
      </div>`;
    document.querySelector('#phone-cancel')?.addEventListener('click', close);
    document.querySelector('#phone-unlock')?.addEventListener('click', renderFinal);
    document.querySelector('#phone-call')?.addEventListener('click', () => setTimeout(close, 100));
    document.querySelector('#phone-cancel')?.focus();
  });
}

function detectInstallEnvironment() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobile/i.test(ua);
  const inApp = /(Line|FBAN|FBAV|Instagram|Twitter|X\b|Note)/i.test(ua) || (/wv\)/i.test(ua) && android);
  return { ios, android, mobile, inApp };
}

function renderInstallAndUpdates() {
  const standalone = isStandaloneApp();
  const env = detectInstallEnvironment();
  const publicUrl = 'https://epsilon-lab-atelier.github.io/mamoreru-inochi/';
  const appQr = createQrSvgMarkup(publicUrl, { size: 260 });
  const instructions = env.ios
    ? ['Safariで「守れるいのち」を開きます。', '共有ボタン（四角から上向きの矢印）を押します。', '「ホーム画面に追加」を選びます。', '「Webアプリとして開く」が表示された場合は有効にし、「追加」を押します。']
    : env.android
      ? ['Chromeなどの標準ブラウザで開きます。', '下の「スマホに入れる」を押します。表示されない場合はブラウザのメニューを開きます。', '「アプリをインストール」または「ホーム画面に追加」を選びます。', '追加された「守れるいのち」のアイコンを一度開きます。']
      : ['ChromeまたはEdgeで開きます。', 'アドレスバー付近のインストールアイコン、またはブラウザメニューを開きます。', '「守れるいのちをインストール」を選びます。'];
  return `<div class="page-container">
    ${pageHeader('スマホに入れる', '災害時に、ホーム画面からすぐ開く', 'アプリストアを使わず、無料でホーム画面へ追加できます。主要機能はオフラインでも使えます。')}

    ${env.inApp ? `<div class="notice warning"><h2>標準ブラウザで開いてください</h2><p>note、LINE、SNS内の画面では「ホーム画面に追加」が見つからない場合があります。メニューからSafariまたはChromeで開いてください。</p></div>` : ''}

    <section class="install-hero-card section">
      <div class="install-device-preview"><img src="./assets/icons/icon-512.png" alt="守れるいのちのアプリアイコン" width="160" height="160"><p>ホーム画面にこのアイコンが追加されます</p></div>
      <div>
        <p class="eyebrow">スマホでこそ役立つ理由</p>
        <h2>URLを探す時間をなくし、備えを持ち歩く</h2>
        <ul class="install-reasons"><li>災害時にアイコンを1回押して開ける</li><li>行動ガイドをオフラインでも確認できる</li><li>診断、備蓄、家族計画を持ち歩ける</li><li>更新版を同じアイコンから利用できる</li><li>無料・広告なし・アカウント不要</li></ul>
        <div class="button-row">${!standalone && deferredInstallPrompt ? '<button class="button install-primary" type="button" data-action="install-pwa">スマホに入れる</button>' : ''}${!standalone && !deferredInstallPrompt ? '<a class="button install-primary" href="#install-steps">追加手順を見る</a>' : ''}${standalone ? '<span class="badge success">スマホアプリとして利用中</span>' : ''}</div>
      </div>
    </section>

    <section class="grid two section">
      <article class="card"><p class="eyebrow">現在の状態</p><h2>${standalone ? 'ホーム画面から起動しています' : 'ブラウザで開いています'}</h2><dl class="summary-list"><div><dt>アプリ版</dt><dd>v${APP_VERSION}</dd></div><div><dt>オフライン準備</dt><dd>${offlineStatus.cacheReady ? '準備済み' : '準備中または未対応'}</dd></div><div><dt>更新</dt><dd>${offlineStatus.updateAvailable ? '新しい版があります' : '確認済みの版を使用中'}</dd></div><div><dt>通信</dt><dd>${navigator.onLine ? 'オンライン' : 'オフライン'}</dd></div></dl><div class="button-row"><button class="button secondary" type="button" data-action="check-update">更新を確認</button>${offlineStatus.updateAvailable ? '<button class="button warning" type="button" data-action="apply-update">新しい版へ更新</button>' : ''}${!standalone ? '<button class="button subtle" type="button" data-action="mark-installed">すでに追加しました</button>' : ''}</div></article>
      <article class="card" id="install-steps"><p class="eyebrow">この端末での手順</p><h2>ホーム画面へ追加する</h2><ol class="install-steps">${instructions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>${!standalone && deferredInstallPrompt ? '<button class="button" type="button" data-action="install-pwa">スマホに入れる</button>' : '<p class="hint">ブラウザやOSの版によって、メニュー名が少し異なる場合があります。</p>'}${INSTALL_GUIDE_ARTICLE_URL ? `<p><a href="${escapeHtml(INSTALL_GUIDE_ARTICLE_URL)}" target="_blank" rel="noopener noreferrer">画像つきの詳しいインストール方法を見る</a></p>` : ''}</article>
    </section>

    ${!env.mobile ? `<section class="card section pc-to-phone"><div><p class="eyebrow">PCで見ている方へ</p><h2>スマホへ送る</h2><p>スマホのカメラでQRコードを読み取るか、URLを共有してください。</p><div class="button-row"><button class="button secondary" type="button" id="copy-app-url">URLをコピー</button>${navigator.share ? '<button class="button secondary" type="button" id="share-app-url">共有する</button>' : ''}</div><p class="break-all"><code>${publicUrl}</code></p></div><div>${appQr}</div></section>` : ''}

    <section class="card section"><p class="eyebrow">更新のしくみ</p><h2>GitHub Pagesが更新された後</h2><ol class="install-steps"><li>オンラインでアプリを開くと、起動時・オンライン復帰時・画面へ戻ったときに新しい版を確認します。</li><li>新しい版が見つかると、画面上部に案内します。入力中に強制再読込しません。</li><li>「更新する」を押すと新しい版へ切り替わります。診断・備蓄などの保存データは別の領域にあり、v0.3.0では旧形式を確認してから移行します。</li></ol><div class="notice warning"><p>ブラウザのサイトデータを削除した場合や端末故障では、保存内容が失われる場合があります。大切な内容はバックアップと紙にも残してください。</p></div></section>

    <section class="card section"><h2>オフライン動作を確かめる</h2><ol class="install-steps"><li>オンラインで一度アプリを開き、「オフライン準備: 準備済み」を確認します。</li><li>機内モードをオンにします。</li><li>アプリを閉じて開き直し、災害時ガイド、診断結果、備蓄、家族計画を確認します。</li><li>確認後は機内モードを戻します。</li></ol></section>
  </div>`;
}

function bindInstallPage() {
  document.querySelector('#copy-app-url')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('https://epsilon-lab-atelier.github.io/mamoreru-inochi/'); showToast('アプリのURLをコピーしました。'); }
    catch { showToast('URLをコピーできませんでした。', 'error'); }
  });
  document.querySelector('#share-app-url')?.addEventListener('click', async () => {
    try { await navigator.share({ title: '守れるいのち', text: '無料・広告なし・オフライン対応の防災アプリです。', url: 'https://epsilon-lab-atelier.github.io/mamoreru-inochi/' }); } catch {}
  });
}


function renderEmergencyContactButtons(contactIds = ['119', '110']) {
  const contacts = contactIds.map((id) => EMERGENCY_CONTACTS.find((item) => item.id === id)).filter(Boolean);
  return `<div class="phone-actions">${contacts.map((item) => `<button class="phone-link" type="button" data-action="contact-call" data-contact-id="${escapeHtml(item.id)}">${escapeHtml(item.number)} ${escapeHtml(item.name)}</button>`).join('')}</div>`;
}

function renderEmergencyOverview() {
  return `
    <div class="page-container">
      ${pageHeader('災害時モード', '今すぐ必要な行動を選ぶ', '初期設定や保存データを開かなくても利用できます。通信がなくても主要内容を表示します。')}

      <section class="card emergency-intro">
        <h2>命に危険が迫っている場合</h2>
        <p>まず目の前の危険から離れてください。火災・救急・消防による救助は119、事件・交通事故は110、海上の事件・事故は118へ通報します。川・湖・池・用水路・プールなどで消防の救助が必要な場合は119です。</p>
        ${renderEmergencyContactButtons(['119', '110', '118'])}
        <div class="button-row"><a class="button secondary" href="#/contacts">緊急連絡先をすべて見る</a></div>
      </section>

      <section class="section" aria-labelledby="emergency-types-title">
        <div class="section-heading"><div><p class="eyebrow">状況を選ぶ</p><h2 id="emergency-types-title">災害別の行動</h2></div><span class="badge ${navigator.onLine ? 'success' : 'warning'}">${navigator.onLine ? '通信あり' : 'オフライン'}</span></div>
        <div class="emergency-grid">
          ${EMERGENCY_GUIDES.map((guide) => {
            const guideText = state.preferences.easyJapanese ? EMERGENCY_GUIDE_EASY_TEXT[guide.id] : null;
            return `
            <article class="card emergency-card clickable">
              <a class="card-link" href="#/emergency/${escapeHtml(guide.id)}">
                <div class="emergency-symbol" aria-hidden="true">${escapeHtml(guide.symbol)}</div>
                <h2>${escapeHtml(guide.name)}</h2>
                <p>${escapeHtml(guideText?.summary || guide.summary)}</p>
                <p class="link-label">行動を確認する</p>
              </a>
            </article>`;
          }).join('')}
        </div>
      </section>

      <section class="notice warning section">
        <h2>このガイドの位置づけ</h2>
        <p>一般的な行動を短くまとめたものです。現在地の危険、建物、けが、自治体の避難情報、消防・警察の指示を優先してください。このアプリは警報を独自配信しません。地域情報で取得する場合も、発表時刻を確認し、自治体・気象庁などの公式情報を優先してください。</p>
      </section>

      <div class="button-row section no-print">
        <a class="button secondary" href="#/">通常のホームへ</a>
        <a class="button secondary" href="#/sources">根拠と出典</a>
      </div>
    </div>`;
}

function renderEmergencyDetail(id) {
  const guide = EMERGENCY_GUIDES.find((item) => item.id === id);
  if (!guide) return renderEmergencyOverview();
  const easy = state.preferences.easyJapanese ? EMERGENCY_GUIDE_EASY_TEXT[id] : null;
  const guideText = {
    summary: easy?.summary || guide.summary,
    immediate: easy?.immediate || guide.immediate,
    avoid: easy?.avoid || guide.avoid,
    after: easy?.after || guide.after
  };
  return `
    <div class="page-container">
      ${pageHeader('災害時モード', guide.name, guideText.summary)}
      <section class="card emergency-intro">
        <h2>最初に</h2>
        <p><strong>目の前の危険から離れ、自分の命を守ってください。</strong> 現在地の状況と公的機関の指示が、この一般ガイドより優先されます。</p>
        ${renderEmergencyContactButtons(guide.contactIds?.slice(0, 4) || ['119', '110'])}
      </section>

      <section class="card section">
        <p class="eyebrow">今すぐすること</p>
        <h2>安全を確保する</h2>
        <div class="emergency-steps">
          ${guideText.immediate.map((item) => `<p class="emergency-step">${escapeHtml(item)}</p>`).join('')}
        </div>
      </section>

      <section class="notice danger section">
        <h2>避けること</h2>
        <ul class="plain-list">${guideText.avoid.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>

      <section class="card section">
        <p class="eyebrow">安全を確保した後</p>
        <h2>次に確認する</h2>
        <ul class="plain-list">${guideText.after.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>

      <section class="card section">
        <p class="eyebrow">この状況で役立つ連絡先</p>
        <h2>用途を確認して連絡する</h2>
        ${renderEmergencyContactButtons(guide.contactIds || ['119', '110'])}
        <p class="small-text">命に危険がある場合は、相談窓口の返答を待たず緊急通報を優先してください。</p>
        <a class="button secondary small" href="#/contacts">連絡先の説明を詳しく見る</a>
      </section>

      <div class="button-row section no-print">
        <a class="button danger" href="#/emergency">別の状況を選ぶ</a>
        <button class="button secondary" type="button" data-action="print">この画面を印刷</button>
        <a class="button subtle" href="#/">通常のホームへ</a>
      </div>
    </div>`;
}

function renderPreparednessGuide() {
  return `
    <div class="page-container">
      ${pageHeader('防災ガイド', '災害への備えと、災害時にすること', '長い文章を読まなくても、要点から確認できるようにまとめています。')}

      <section class="grid three">
        <div class="card"><div class="card-icon" aria-hidden="true">1</div><h2>命を守る</h2><p>揺れ、煙、水、斜面、飛来物など、目の前の危険から離れる行動を最優先にします。</p></div>
        <div class="card"><div class="card-icon" aria-hidden="true">2</div><h2>生活を続ける</h2><p>水、食料、トイレ、薬、電源、温度管理を、家族構成に合わせて整えます。</p></div>
        <div class="card"><div class="card-icon" aria-hidden="true">3</div><h2>迷いを減らす</h2><p>避難先、連絡方法、支援、情報源を平常時に決め、紙にも残します。</p></div>
      </section>

      <section class="section" aria-labelledby="guide-articles-title">
        <div class="section-heading"><div><p class="eyebrow">短く読む</p><h2 id="guide-articles-title">実践ガイド</h2></div></div>
        ${PREPAREDNESS_ARTICLES.map((article) => `
          <details>
            <summary><span class="badge brand">${escapeHtml(article.category)}</span>&nbsp; ${escapeHtml(article.title)}</summary>
            <p>${escapeHtml(article.summary)}</p>
            <ul class="plain-list">${article.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
          </details>`).join('')}
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>平常時の優先順位</h2>
          <ol class="action-list">
            <li>寝室と避難経路から、倒れる家具や割れ物を減らす。</li>
            <li>災害別の避難先と、昼・夜の経路を確認する。</li>
            <li>水・食料・携帯トイレを、まず3日分へ近づける。</li>
            <li>常用薬、医療機器、乳幼児、アレルギー、ペットを個別に考える。</li>
            <li>家族の集合場所と、電話以外の連絡方法を決める。</li>
          </ol>
        </div>
        <div class="card">
          <h2>定期的に見直す時期</h2>
          <ul class="plain-list">
            <li>引っ越し、家族構成、勤務先、学校が変わったとき</li>
            <li>家具や家電を移動したとき</li>
            <li>台風・大雨・大雪の季節に入る前</li>
            <li>薬、電池、食品の期限を確認するとき</li>
            <li>自治体のハザードマップや避難先が更新されたとき</li>
          </ul>
        </div>
      </section>

      <div class="notice warning section">
        <h2>現在の警報・避難情報について</h2>
        <p>地域情報は、利用者が通信内容を確認して許可したときだけ、公的機関から取得します。取得済み情報には時刻を表示しますが、災害時は自治体、気象庁、消防、警察、ライフライン事業者などの最新情報を優先してください。</p>
      </div>

      <div class="button-row section">
        <a class="button danger" href="#/emergency">災害時の行動を見る</a>
        <a class="button secondary" href="#/sources">根拠と出典</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function renderHelp() {
  return `
    <div class="page-container">
      ${pageHeader('ヘルプ', '「守れるいのち」の使い方', '最初の診断からオフライン利用、保存、バックアップまで案内します。')}

      <section class="grid three">
        <div class="card"><div class="card-icon" aria-hidden="true">1</div><h2>リスクを知る</h2><p>地形、住まい、家族、ライフライン、避難を質問形式で確認します。</p><a class="button small" href="#/diagnosis/area">診断へ</a></div>
        <div class="card"><div class="card-icon" aria-hidden="true">2</div><h2>備蓄を整える</h2><p>3日分と7日分を比較し、不足を一項目ずつ表示します。</p><a class="button small" href="#/stockpile/household">備蓄へ</a></div>
        <div class="card"><div class="card-icon" aria-hidden="true">3</div><h2>家族で確認する</h2><p>家族計画を作り、必要な項目だけQRやファイルで共有します。</p><a class="button small" href="#/family">家族計画へ</a></div>
      </section>

      <section class="grid three section">
        <div class="card"><div class="card-icon" aria-hidden="true">練</div><h2>3分から訓練</h2><p>地震、大雨、停電などを想定し、実際の物と行動を確認します。</p><a class="button small" href="#/drills">訓練へ</a></div>
        <div class="card"><div class="card-icon" aria-hidden="true">地</div><h2>防災地図</h2><p>現在地、住所、地図から地点を登録し、災害別の地図を確認します。</p><a class="button small" href="#/locations">地域情報へ</a></div>
        <div class="card"><div class="card-icon" aria-hidden="true">文</div><h2>読みやすくする</h2><p>やさしい日本語、大きな文字、行間、コントラストなどを調整できます。</p><a class="button small" href="#/settings">表示設定へ</a></div>
      </section>

      <section class="card section" id="offline-help-card">
        ${renderOfflineCardContent(true)}
      </section>

      <section class="section" aria-labelledby="install-title">
        <div class="section-heading"><div><p class="eyebrow">スマートフォン・PC</p><h2 id="install-title">ホーム画面へ追加する</h2></div><a class="button small" href="#/install">端末別の詳しい手順</a></div>
        <div class="grid two">
          <div class="card">
            <h3>iPhone / iPad</h3>
            <ol class="action-list">
              <li>Safariなどでこのページを開きます。</li>
              <li>共有ボタンを押します。</li>
              <li>「ホーム画面に追加」を選びます。</li>
              <li>追加後、一度アプリを開いてオフライン準備を確認します。</li>
            </ol>
          </div>
          <div class="card">
            <h3>Android / PC</h3>
            <ol class="action-list">
              <li>ブラウザのメニューまたはアドレス欄のインストール表示を選びます。</li>
              <li>「アプリをインストール」「ホーム画面に追加」などを選びます。</li>
              <li>追加後、一度開いてオフライン準備を確認します。</li>
            </ol>
            ${deferredInstallPrompt ? '<button class="button small" type="button" data-action="install-pwa">この端末へインストール</button>' : '<p class="hint">インストールボタンが表示されない場合は、ブラウザのメニューを確認してください。</p>'}
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="privacy-help-title">
        <div class="section-heading"><div><p class="eyebrow">プライバシー</p><h2 id="privacy-help-title">保存方法の違い</h2></div></div>
        <div class="grid two">
          ${helpStorageCard('保存しない', '入力はメモリー上だけです。再読み込みや終了で消えます。')}
          ${helpStorageCard('診断結果だけ保存', '回答そのものを残さず、診断結果と表示設定だけを保存します。')}
          ${helpStorageCard('この端末に保存', '診断、備蓄、家の安全、家族計画をIndexedDBへ保存します。')}
          ${helpStorageCard('暗号化して保存', 'AES-GCMで暗号化し、開くたびにパスフレーズを入力します。パスフレーズは復元できません。')}
        </div>
      </section>

      <section class="section" aria-labelledby="faq-title">
        <div class="section-heading"><div><p class="eyebrow">よくある質問</p><h2 id="faq-title">困ったとき</h2></div></div>
        <details><summary>診断の数字は、災害に遭う確率ですか？</summary><p>いいえ。公的な発生確率ではなく、入力内容から「備えを優先したい分野」を5段階で整理したアプリ独自の指標です。低い表示も安全を保証しません。</p></details>
        <details><summary>「わからない」が多くても使えますか？</summary><p>使えます。不明な回答を危険とも安全とも決めず、判定の確かさを下げ、「あとで確認すること」へ残します。</p></details>
        <details><summary>データはGitHub Pagesへ保存されますか？</summary><p>保存されません。GitHub Pagesはアプリ本体を配信するだけです。入力内容は、選択した方法に応じて、この端末のブラウザ内だけで扱います。</p></details>
        <details><summary>オフラインで何が使えますか？</summary><p>一度正常に読み込み、オフライン準備が完了すれば、診断、備蓄、家の安全、家族計画、災害時ガイドを利用できます。最後に取得した地域情報は確認できますが、最新の警報・避難先情報を更新するには通信が必要です。</p></details>
        <details><summary>端末を変えるにはどうしますか？</summary><p>「データと設定」からバックアップを書き出し、新しい端末で読み込みます。バックアップファイルには個人情報が含まれる場合があるため、安全に保管してください。</p></details>
        <details><summary>パスフレーズを忘れました</summary><p>アプリ開発者にも復元できません。保存データを削除してやり直す必要があります。重要な内容は暗号化バックアップや紙にも残してください。</p></details>
      </section>

      <section class="notice warning section">
        <h2>アプリの限界</h2>
        <ul class="plain-list">
          <li>警報や避難指示を独自に配信せず、取得した公的情報も完全性や即時性を保証しません。</li>
          <li>建物の安全性、医療上の必要量、個人の被害確率を判定しません。</li>
          <li>端末故障、ブラウザデータ消去、パスフレーズ忘れによる消失を防げません。</li>
          <li>緊急時は、現在地の状況、公的機関、消防・警察の指示を優先してください。</li>
        </ul>
      </section>

      <div class="button-row section">
        <a class="button" href="#/settings">データと設定</a>
        <a class="button secondary" href="#/sources">根拠と出典</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function helpStorageCard(title, text) {
  return `<div class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function renderOfflineCardContent(detailed = false) {
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ready = offlineStatus.controlled && offlineStatus.cacheReady;
  return `
    <div class="section-heading">
      <div><p class="eyebrow">通信が止まったとき</p><h2>オフライン利用の準備</h2></div>
      <span class="badge ${ready ? 'success' : 'warning'}">${ready ? '主要データ保存済み' : '準備を確認'}</span>
    </div>
    <div class="grid ${detailed ? 'two' : 'three'}">
      <div class="kpi"><small>現在の通信</small><strong>${offlineStatus.online ? 'オンライン' : 'オフライン'}</strong></div>
      <div class="kpi"><small>オフライン制御</small><strong>${offlineStatus.controlled ? '有効' : '準備中'}</strong></div>
      <div class="kpi"><small>ホーム画面</small><strong>${installed ? '追加済み' : '未確認'}</strong></div>
    </div>
    <p>${ready ? '主要な画面は、この端末へ保存されています。念のため一度機内モードで災害時ガイドが開くか確認してください。' : 'ページをオンラインで一度開き直すと、主要ファイルの保存が完了します。初回アクセス直後は、Service Workerが有効になるまで再読み込みが必要な場合があります。'}</p>
    <div class="button-row">
      ${deferredInstallPrompt ? '<button class="button small" type="button" data-action="install-pwa">この端末へインストール</button>' : ''}
      <button class="button secondary small" type="button" data-action="check-update">更新を確認</button>
      ${offlineStatus.updateAvailable ? '<button class="button warning small" type="button" data-action="apply-update">新しい版を適用</button>' : ''}
    </div>`;
}

function renderOfflineIndicatorOnly() {
  const dashboardCard = document.querySelector('#offline-card');
  if (dashboardCard) dashboardCard.innerHTML = renderOfflineCardContent();
  const helpCard = document.querySelector('#offline-help-card');
  if (helpCard) helpCard.innerHTML = renderOfflineCardContent(true);
  renderUpdateBanner();
}

function renderSettings() {
  const diagnosisAnswers = Object.values(state.diagnosis.answers).filter(Boolean).length;
  const safety = homeSafetySummary();
  const p = state.preferences;
  return `
    <div class="page-container">
      ${pageHeader('データと設定', '保存、表示、バックアップ', 'この端末にあるアプリデータと、読みやすさ・操作しやすさを自分で管理できます。')}

      <section class="card">
        <h2>この端末にある内容</h2>
        <div class="grid four">
          <div class="kpi"><small>保存方法</small><strong>${escapeHtml(storageModeLabel())}</strong></div>
          <div class="kpi"><small>診断回答</small><strong>${diagnosisAnswers}/${RISK_QUESTIONS.length}</strong></div>
          <div class="kpi"><small>備蓄リスト</small><strong>${state.stockpile.inventory.length}品</strong></div>
          <div class="kpi"><small>家の安全</small><strong>${safety.complete}/${safety.total}</strong></div>
        </div>
        <p id="storage-estimate" class="hint">使用容量を確認しています...</p>
      </section>

      <section class="card section" aria-labelledby="display-settings-title">
        <div class="section-heading"><div><p class="eyebrow">アクセシビリティ</p><h2 id="display-settings-title">表示と操作を調整する</h2></div></div>
        <p>設定はすぐに画面へ反映されます。地図だけでなく、一覧や文章でも情報を確認できる設計です。</p>

        <div class="accessibility-presets section" role="group" aria-label="表示プリセット">
          <button class="button secondary small" type="button" data-preference-preset="standard">標準</button>
          <button class="button secondary small" type="button" data-preference-preset="large">大きな文字</button>
          <button class="button secondary small" type="button" data-preference-preset="visible">見やすさ優先</button>
          <button class="button secondary small" type="button" data-preference-preset="easy">やさしい表示</button>
        </div>

        <form id="preferences-form" class="section">
          <div class="form-grid">
            <div class="form-field">
              <label for="settings-font-scale">文字サイズ</label>
              <select id="settings-font-scale" name="fontScale">
                <option value="85"${Number(p.fontScale) === 85 ? ' selected' : ''}>小さめ（85%）</option>
                ${[100,115,130,150,175,200].map((size) => `<option value="${size}"${Number(p.fontScale) === size ? ' selected' : ''}>${size}%</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label for="settings-line-height">行間</label>
              <select id="settings-line-height" name="lineHeight">
                ${[[1.5,'狭め'],[1.7,'標準'],[1.9,'広め'],[2.1,'とても広い']].map(([value,label]) => `<option value="${value}"${Number(p.lineHeight) === value ? ' selected' : ''}>${label}（${value}）</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <label for="settings-letter-spacing">文字間隔</label>
              <select id="settings-letter-spacing" name="letterSpacing">
                ${[[0,'標準'],[0.04,'少し広い'],[0.08,'広い'],[0.12,'とても広い']].map(([value,label]) => `<option value="${value}"${Number(p.letterSpacing) === value ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <fieldset class="form-field">
              <legend>見やすさ</legend>
              <label><input type="checkbox" name="highContrast"${p.highContrast ? ' checked' : ''}> コントラストを強くする</label>
              <label><input type="checkbox" name="darkMode"${p.darkMode ? ' checked' : ''}> 暗い背景にする</label>
              <label><input type="checkbox" name="underlineLinks"${p.underlineLinks ? ' checked' : ''}> リンクに下線を付ける</label>
            </fieldset>
            <fieldset class="form-field">
              <legend>操作と文章</legend>
              <label><input type="checkbox" name="largeTargets"${p.largeTargets ? ' checked' : ''}> ボタンを大きくする</label>
              <label><input type="checkbox" name="reducedMotion"${p.reducedMotion ? ' checked' : ''}> 動きを減らす</label>
              <label><input type="checkbox" name="simpleLayout"${p.simpleLayout ? ' checked' : ''}> シンプル表示（1列中心）</label>
              <label><input type="checkbox" name="easyJapanese"${p.easyJapanese ? ' checked' : ''}> やさしい日本語を使う</label>
            </fieldset>
          </div>
          <div class="notice privacy section">
            <p><strong>やさしい日本語</strong>は、災害時の行動、緊急連絡先、インストール案内などの重要文を、短く分かりやすい表現へ切り替えます。シンプル表示は画面の並びを1列中心にします。</p>
          </div>
          <div class="button-row"><button class="button" type="submit">表示設定を保存</button></div>
        </form>
      </section>

      <section class="card section" aria-labelledby="storage-settings-title">
        <h2 id="storage-settings-title">保存方法を変更する</h2>
        <form id="storage-mode-form">
          <div class="grid two">
            ${storageOption('none', '保存しない', '変更後に端末内の保存データを削除します。現在の画面を閉じるまでは利用できます。', state.storageMode === 'none')}
            ${storageOption('result', '診断結果だけ保存', '診断回答、備蓄、家族計画は端末へ残しません。', state.storageMode === 'result')}
            ${storageOption('full', 'この端末に保存', '入力内容をブラウザ内へ保存します。', state.storageMode === 'full')}
            ${storageOption('protected', '暗号化して保存', '8文字以上のパスフレーズで保存内容を保護します。', state.storageMode === 'protected')}
          </div>
          <div class="button-row"><button class="button" type="submit">保存方法を変更</button></div>
        </form>
        <p class="hint">同じ端末・同じブラウザを使う人は、暗号化していない保存内容を開ける場合があります。パスフレーズを忘れると、暗号化データは復元できません。</p>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>バックアップ</h2>
          <p>診断、備蓄、家の安全、家族計画、訓練記録をJSONファイルへ書き出します。端末変更やブラウザデータ消去に備えられます。</p>
          <button class="button" type="button" data-action="export-backup">バックアップを書き出す</button>
          <p class="hint">暗号化保存を使っている場合、バックアップも暗号化します。それ以外のバックアップには個人情報が含まれる場合があります。</p>
        </div>
        <div class="card">
          <h2>バックアップを読み込む</h2>
          <p>以前に「守れるいのち」から書き出したJSONファイルを選びます。現在の内容は置き換わります。</p>
          <div class="form-field">
            <label for="backup-file">バックアップファイル</label>
            <input id="backup-file" type="file" accept="application/json,.json">
          </div>
          <button class="button secondary" id="import-backup-button" type="button">選んだファイルを読み込む</button>
        </div>
      </section>

      <section class="card section" aria-labelledby="offline-settings-title">
        <div id="settings-offline-content">${renderOfflineCardContent(true)}</div>
        <hr class="divider">
        <h3>端末へ残りやすくする</h3>
        <p>対応ブラウザでは、保存領域を自動削除しにくくするよう要求できます。ブラウザが必ず許可するとは限りません。</p>
        <button class="button secondary small" type="button" data-action="request-persistence">永続保存を要求する</button>
      </section>

      <section class="notice danger section">
        <h2>すべてのアプリデータを削除</h2>
        <p>診断、備蓄、賞味期限、家の安全、家族計画、訓練記録、設定をこの端末から削除します。元に戻せません。</p>
        <button class="button danger" type="button" data-action="delete-all-data">すべて削除する</button>
      </section>

      <div class="button-row section"><a class="button subtle" href="#/">ホームへ</a></div>
    </div>`;
}

function preferencePreset(id) {
  const base = {
    fontScale: 100, lineHeight: 1.7, letterSpacing: 0,
    highContrast: false, darkMode: false, reducedMotion: false,
    simpleLayout: false, easyJapanese: false, largeTargets: false, underlineLinks: false
  };
  if (id === 'large') return { ...base, fontScale: 150, lineHeight: 1.9, largeTargets: true };
  if (id === 'visible') return { ...base, fontScale: 130, lineHeight: 1.9, letterSpacing: 0.04, highContrast: true, largeTargets: true, underlineLinks: true };
  if (id === 'easy') return { ...base, fontScale: 130, lineHeight: 1.9, simpleLayout: true, easyJapanese: true, largeTargets: true, underlineLinks: true };
  return base;
}

function bindSettings() {
  const preferencesForm = document.querySelector('#preferences-form');

  const updatePreferencesFromForm = () => {
    if (!preferencesForm) return;
    const data = new FormData(preferencesForm);
    state.preferences = {
      fontScale: Number(data.get('fontScale') || 100),
      lineHeight: Number(data.get('lineHeight') || 1.7),
      letterSpacing: Number(data.get('letterSpacing') || 0),
      highContrast: data.has('highContrast'),
      darkMode: data.has('darkMode'),
      reducedMotion: data.has('reducedMotion'),
      simpleLayout: data.has('simpleLayout'),
      easyJapanese: data.has('easyJapanese'),
      largeTargets: data.has('largeTargets'),
      underlineLinks: data.has('underlineLinks')
    };
    applyPreferences();
  };

  preferencesForm?.addEventListener('change', updatePreferencesFromForm);
  preferencesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    updatePreferencesFromForm();
    await persistCurrentState();
    showToast('表示設定を保存しました。');
  });

  document.querySelectorAll('[data-preference-preset]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.preferences = preferencePreset(button.dataset.preferencePreset);
      applyPreferences();
      await persistCurrentState();
      render();
      showToast('表示プリセットを適用しました。');
    });
  });

  const storageForm = document.querySelector('#storage-mode-form');
  storageForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const newMode = String(new FormData(storageForm).get('storageMode') || 'none');
    if (newMode === state.storageMode) {
      showToast('保存方法は変更されていません。');
      return;
    }

    if (newMode === 'none') {
      const confirmed = await confirmDialog(
        '保存しないモードへ変更しますか？',
        '端末内の保存データを削除します。現在の画面を閉じるまでは利用できますが、再読み込みすると消えます。',
        '保存をやめる'
      );
      if (!confirmed) return;
    }

    let passphrase = '';
    if (newMode === 'protected') {
      passphrase = await askNewPassphrase();
      if (!passphrase) return;
    }

    try {
      state = await changeStorageMode(state, newMode, passphrase);
      protectedPassphrase = newMode === 'protected' ? passphrase : '';
      if (newMode !== 'none') requestPersistentStorage().catch(() => {});
      showToast(`保存方法を「${storageModeLabel(newMode)}」へ変更しました。`);
      render();
    } catch (error) {
      showToast(error.message || '保存方法を変更できませんでした。', 'error');
    }
  });

  document.querySelector('#import-backup-button')?.addEventListener('click', handleBackupImport);
  updateStorageEstimate();
}

async function updateStorageEstimate() {
  const target = document.querySelector('#storage-estimate');
  if (!target) return;
  try {
    const estimate = await storageEstimate();
    if (!estimate) {
      target.textContent = 'このブラウザでは使用容量を取得できません。';
      return;
    }
    const usageMb = estimate.usage / 1024 / 1024;
    const quotaMb = estimate.quota / 1024 / 1024;
    target.textContent = `ブラウザ内の使用量: 約${formatNumber(usageMb, 2)}MB / 利用可能な上限の目安: 約${formatNumber(quotaMb, 0)}MB`;
  } catch {
    target.textContent = '使用容量を取得できませんでした。';
  }
}

function renderSources() {
  return `
    <div class="page-container">
      ${pageHeader('根拠と出典', '判定方法と公的資料', 'アプリ独自の指標と、公的機関の数値・行動ガイドを区別して公開します。')}

      <section class="notice warning">
        <h2>「備えの優先度」は確率ではありません</h2>
        <p>質問ごとに災害分野への重みを設定し、被害や避難へ大きく影響しうる条件には最低優先度を設定しています。同じ回答には同じ結果を返す決定論的な計算です。個人の被災確率、死亡確率、建物倒壊確率は計算しません。</p>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>診断の4つの表示</h2>
          <ul class="plain-list">
            <li><strong>災害別の優先度:</strong> 地震、洪水、津波、土砂、暴風、火災、生活継続、避難を別々に表示。</li>
            <li><strong>理由:</strong> どの回答が優先度へ影響したかを平易な言葉で表示。</li>
            <li><strong>判定の確かさ:</strong> 「はい・いいえ」で確認できた割合をA〜Cで表示。</li>
            <li><strong>あとで確認:</strong> 不明・未回答を、危険とも安全とも決めず確認リストへ残す。</li>
          </ul>
        </div>
        <div class="card">
          <h2>備蓄計算の基本</h2>
          <ul class="plain-list">
            <li>飲料水: 1人1日3L</li>
            <li>食料: 1人1日3食</li>
            <li>携帯トイレ: 1人1日5回</li>
            <li>最低ライン: 3日分</li>
            <li>安心ライン: 7日分</li>
          </ul>
          <p class="hint">照明、電源、ボンベなどは家庭差が大きいため、アプリ内の実用目安として明示しています。</p>
        </div>
      </section>

      <section class="section" aria-labelledby="sources-list-title">
        <div class="section-heading"><div><p class="eyebrow">内容確認日 2026年8月1日</p><h2 id="sources-list-title">主な公的資料</h2></div></div>
        <div class="grid two">
          ${OFFICIAL_SOURCES.map((source) => `
            <article class="card">
              <p class="eyebrow">${escapeHtml(source.organization)}</p>
              <h3>${escapeHtml(source.title)}</h3>
              <p>${escapeHtml(source.usedFor)}</p>
              <p class="small-text">確認日: ${escapeHtml(source.checkedAt)}</p>
              <a class="button secondary small" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">公式資料を開く</a>
            </article>`).join('')}
        </div>
      </section>

      <section class="card section">
        <h2>診断ルールの版</h2>
        <div class="status-line"><span>アプリ</span><span class="status-value">v${APP_VERSION}</span></div>
        <div class="status-line"><span>データ形式</span><span class="status-value">Schema ${SCHEMA_VERSION}</span></div>
        <div class="status-line"><span>診断質問</span><span class="status-value">${RISK_QUESTIONS.length}問</span></div>
        <p>ソースコードと詳しい診断規則は、公開リポジトリの <code>src/risk-engine.js</code>、<code>src/data.js</code>、<code>docs/DIAGNOSIS_RULES.md</code> で確認できます。</p>
      </section>

      <div class="button-row section"><a class="button subtle" href="#/">ホームへ</a></div>
    </div>`;
}

function renderAbout() {
  return `
    <div class="page-container">
      ${pageHeader('このアプリについて', '守れるいのち', '知る。備える。迷わず動く。')}
      <section class="hero">
        <div class="hero-content">
          <h2>暮らしに合わせて、次の一歩を見つける</h2>
          <p>「守れるいのち」は、災害への不安をあおるのではなく、地域、住まい、家族、備蓄、避難を一つずつ確認し、今できる行動へつなげるための防災アプリです。</p>
        </div>
        <div class="hero-mark" aria-hidden="true"><img src="./assets/icons/icon-512.png" alt=""></div>
      </section>

      <section class="grid two section">
        <div class="card"><h2>無料・広告なし</h2><p>命や安全に関わる中核機能を制限せず、待たせる広告、追跡型広告、課金機能を設けません。</p></div>
        <div class="card"><h2>アカウント不要</h2><p>氏名やメールアドレスを登録せず使えます。入力内容は端末内処理を基本とします。</p></div>
        <div class="card"><h2>オフライン対応</h2><p>一度準備すれば、通信がなくても主要な診断、備蓄、計画、災害時ガイドを開けます。</p></div>
        <div class="card"><h2>検証可能</h2><p>診断規則、根拠、出典、ソースコード、更新履歴を公開します。</p></div>
      </section>

      <section class="card section">
        <h2>開発</h2>
        <p><strong>EpsilonLab</strong> / 科学 × 探究 × 日常設計</p>
        <p>公開リポジトリでは、不具合報告や改善提案を受け付けます。報告時は、住所、氏名、病歴、家族構成、正確な位置情報などを書かないでください。</p>
        <div class="button-row">
          <a class="button secondary" href="https://github.com/Epsilon-Lab-Atelier/mamoreru-inochi" target="_blank" rel="noopener noreferrer">GitHubリポジトリ</a>
          <a class="button secondary" href="#/sources">根拠と出典</a>
        </div>
      </section>

      <section class="notice warning section">
        <h2>免責とお願い</h2>
        <p>本アプリは行政機関の公式アプリではなく、安全、救助、情報の完全性を保証しません。緊急時は、現在地の状況と公的機関・消防・警察の指示を優先してください。誤りや古い情報に気づいた場合は、個人情報を含めず公開リポジトリへお知らせください。</p>
      </section>

      <p class="small-text muted">Version ${APP_VERSION} / 無料・広告なしの公開版</p>
    </div>`;
}

function renderPrintPage() {
  const diagnosis = state.diagnosis.result;
  const stockpile = state.stockpile.result;
  const inventory = analyzeInventory(state.stockpile.inventory);
  const safety = homeSafetySummary();
  const familyRows = [
    ['第一の集合場所', state.familyPlan.primaryMeetingPlace],
    ['第二の集合場所', state.familyPlan.secondaryMeetingPlace],
    ['災害別の避難先', state.familyPlan.evacuationPlace],
    ['電話がつながらないとき', state.familyPlan.contactRule],
    ['遠方の連絡先・中継役', state.familyPlan.outOfAreaContact],
    ['学校・施設等の迎え', state.familyPlan.pickupRule],
    ['支援が必要な人への役割', state.familyPlan.supportPlan],
    ['ペット', state.familyPlan.petPlan],
    ['電気・ガス・水のルール', state.familyPlan.utilityRule],
    ['その他', state.familyPlan.notes]
  ].filter(([, value]) => String(value || '').trim());

  return `
    <div class="page-container">
      ${pageHeader('印刷・保存', 'わが家の防災計画', 'A4印刷またはPDF保存に向けて、現在の情報を一つのページへまとめます。')}
      <div class="notice warning no-print">
        <p>印刷物やPDFには、集合場所、支援情報、備蓄場所などが含まれる場合があります。共有範囲と保管場所を確認してください。</p>
      </div>
      <div class="button-row no-print">
        <button class="button" type="button" data-action="print">印刷・PDF保存</button>
        <a class="button secondary" href="#/settings">データと設定</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>

      <section class="print-only">
        <h1>守れるいのち - わが家の防災計画</h1>
        <p>作成日: ${escapeHtml(new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long' }).format(new Date()))}</p>
        <p>この用紙の内容は、現在地の状況や公的機関の指示より優先されません。</p>
      </section>

      <section class="card section">
        <h2>緊急時の連絡</h2>
        <div class="grid three">
          <div><strong>119</strong><br>火災・救急・救助</div>
          <div><strong>110</strong><br>事件・事故</div>
          <div><strong>171</strong><br>災害用伝言ダイヤル</div>
        </div>
      </section>

      <section class="card section">
        <h2>生活環境のリスク診断</h2>
        ${diagnosis ? `
          <p><strong>備えの優先度:</strong> ${diagnosis.overallPriority}/5（${escapeHtml(diagnosis.overallLevelInfo.label)}）</p>
          <p><strong>判定の確かさ:</strong> ${escapeHtml(diagnosis.confidence)} / <strong>診断日:</strong> ${escapeHtml(formatDateTime(state.diagnosis.completedAt))}</p>
          <h3>特に確認したい分野</h3>
          <ul class="plain-list">${diagnosis.topHazards.map((hazard) => `<li>${escapeHtml(hazard.name)}: 優先度 ${hazard.level}/5</li>`).join('')}</ul>
          <h3>次に行うこと</h3>
          <ol class="action-list">${diagnosis.recommendations.slice(0, 6).map((item) => `<li>${escapeHtml(item.text)}</li>`).join('')}</ol>
          ${diagnosis.followUps.length ? `<h3>あとで確認すること</h3><ul class="plain-list">${diagnosis.followUps.slice(0, 8).map((item) => `<li>${escapeHtml(item.text)}</li>`).join('')}</ul>` : ''}
        ` : '<p>診断は未実施です。</p>'}
      </section>

      <section class="card section">
        <h2>備蓄チェック</h2>
        ${stockpile ? `
          <p><strong>${escapeHtml(stockpile.level.label)}</strong> / ${stockpile.people}人分</p>
          <div class="table-wrap">
            <table class="summary-table">
              <thead><tr><th>項目</th><th>現在</th><th>3日</th><th>7日</th></tr></thead>
              <tbody>${stockpile.items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${formatNumber(item.current)} ${escapeHtml(item.unit)}</td><td>${formatNumber(item.minimum)}</td><td>${formatNumber(item.comfort)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        ` : '<p>備蓄チェックは未実施です。</p>'}
      </section>

      <section class="card section">
        <h2>期限が近い備蓄</h2>
        ${inventory.items.length ? `
          <table class="summary-table">
            <thead><tr><th>品名</th><th>数量</th><th>期限</th><th>保管場所</th></tr></thead>
            <tbody>${inventory.items.slice(0, 30).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.quantity)} ${escapeHtml(item.unit)}</td><td>${escapeHtml(formatDate(item.expirationDate))}</td><td>${escapeHtml(item.storageLocation || '-')}</td></tr>`).join('')}</tbody>
          </table>
        ` : '<p>備蓄リストは未登録です。</p>'}
      </section>

      <section class="card section">
        <h2>家の安全</h2>
        <p>${safety.complete}/${safety.total}項目を確認済みです。</p>
        <h3>未確認の項目</h3>
        ${safety.complete < safety.total ? `<ul class="plain-list">${HOME_SAFETY_GROUPS.flatMap((group) => group.items).filter((item) => !state.homeSafety.items[item.id]).slice(0, 12).map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')}</ul>` : '<p>すべて確認済みです。</p>'}
      </section>

      <section class="card section">
        <h2>家族の防災計画</h2>
        ${familyRows.length ? `<table class="summary-table"><tbody>${familyRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>` : '<p>家族計画は未登録です。</p>'}
      </section>

      <section class="notice section">
        <p>この用紙は一般的な備えの整理に使うものです。最新の警報・避難情報、自治体のハザードマップ、消防・警察・医療機関の案内を優先してください。</p>
      </section>
    </div>`;
}

function renderNotFound() {
  return `
    <div class="page-container">
      ${pageHeader('ページが見つかりません', 'お探しの画面を開けませんでした', 'URLが変わったか、入力が違っている可能性があります。')}
      <div class="empty-state card"><a class="button" href="#/">ホームへ戻る</a></div>
    </div>`;
}

function bindPage(route) {
  if (route.first === 'diagnosis' && route.second !== 'results') bindDiagnosis(route.second || 'area');
  if (route.first === 'stockpile' && (!route.second || route.second === 'household')) bindStockpileHousehold();
  if (route.first === 'stockpile' && route.second === 'items') bindStockpileItems();
  if (route.first === 'inventory') bindInventory();
  if (route.first === 'safety') bindHomeSafety();
  if (route.first === 'family') bindFamilyPlan(route.second || 'edit');
  if (route.first === 'drills') bindDrills(route.second || 'home');
  if (route.first === 'locations') bindLocations();
  if (route.first === 'contacts') bindContacts();
  if (route.first === 'install') bindInstallPage();
  if (route.first === 'settings') bindSettings();
}

function renderUpdateBanner() {
  if (!updateBanner) return;
  if (!offlineStatus.updateAvailable) {
    updateBanner.hidden = true;
    updateBanner.innerHTML = '';
    return;
  }
  updateBanner.hidden = false;
  updateBanner.innerHTML = `
    <div class="app-update-inner">
      <p><strong>新しい版を利用できます。</strong> 入力中の内容を確認してから更新してください。</p>
      <div class="button-row">
        <button class="button warning small" type="button" data-action="apply-update">更新する</button>
        <button class="button subtle small" type="button" data-action="dismiss-update">後で</button>
      </div>
    </div>`;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    offlineStatus.controlled = Boolean(navigator.serviceWorker.controller);
    offlineStatus.updateAvailable = Boolean(serviceWorkerRegistration.waiting);
    renderUpdateBanner();

    serviceWorkerRegistration.addEventListener('updatefound', () => {
      const worker = serviceWorkerRegistration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          offlineStatus.updateAvailable = true;
          renderOfflineIndicatorOnly();
          renderUpdateBanner();
        }
      });
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  } catch {
    offlineStatus.controlled = false;
  }
}

async function refreshOfflineStatus() {
  offlineStatus.online = navigator.onLine;
  offlineStatus.controlled = Boolean(navigator.serviceWorker?.controller);
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      offlineStatus.cacheReady = keys.some((key) => key.startsWith('mamoreru-inochi-static-'));
    } catch {
      offlineStatus.cacheReady = false;
    }
  }
  offlineStatus.updateAvailable = Boolean(serviceWorkerRegistration?.waiting);
  renderUpdateBanner();
}

function scheduleUpdateChecks() {
  clearInterval(updateCheckTimer);
  updateCheckTimer = window.setInterval(() => {
    checkForUpdate({ quiet: true, minIntervalMs: 30 * 60_000 });
  }, 30 * 60_000);
  window.setTimeout(() => checkForUpdate({ quiet: true, minIntervalMs: 0 }), 4000);
}

async function checkForUpdate({ quiet = false, minIntervalMs = 0 } = {}) {
  if (!serviceWorkerRegistration) {
    if (!quiet) showToast('この環境では更新確認を利用できません。', 'error');
    return;
  }
  if (!navigator.onLine) {
    if (!quiet) showToast('オフラインのため更新を確認できません。', 'error');
    return;
  }
  const now = Date.now();
  if (minIntervalMs && now - lastUpdateCheckAt < minIntervalMs) return;
  lastUpdateCheckAt = now;
  try {
    await serviceWorkerRegistration.update();
    await refreshOfflineStatus();
    renderOfflineIndicatorOnly();
    if (!quiet) showToast(offlineStatus.updateAvailable ? '新しい版があります。画面上部から更新できます。' : '現在の版は最新です。');
  } catch {
    if (!quiet) showToast('更新を確認できませんでした。通信状態を確認してください。', 'error');
  }
}

async function installPwa() {
  if (!deferredInstallPrompt) {
    showToast('ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。');
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  renderOfflineIndicatorOnly();
}

async function handlePersistentStorageRequest() {
  try {
    const result = await requestPersistentStorage();
    if (!result.supported) {
      showToast('このブラウザは永続保存の要求に対応していません。');
    } else if (result.persisted) {
      showToast('ブラウザが永続保存を許可しました。');
    } else {
      showToast('永続保存は許可されませんでした。定期的にバックアップしてください。');
    }
  } catch {
    showToast('永続保存を確認できませんでした。', 'error');
  }
}

async function handleBackupExport() {
  if (state.storageMode !== 'protected') {
    const confirmed = await confirmDialog(
      'バックアップを書き出しますか？',
      'このバックアップは暗号化されません。家族計画や備蓄場所などが含まれる場合があるため、安全な場所へ保管してください。',
      '書き出す'
    );
    if (!confirmed) return;
  }
  try {
    const bundle = await exportBackup(state, protectedPassphrase);
    const filename = `mamoreru-inochi-backup-${todayIso()}.json`;
    downloadText(filename, `${JSON.stringify(bundle, null, 2)}\n`);
    state.audit.lastExportAt = new Date().toISOString();
    persistDebounced();
    showToast('バックアップを書き出しました。');
  } catch (error) {
    showToast(error.message || 'バックアップを書き出せませんでした。', 'error');
  }
}

async function handleBackupImport() {
  const input = document.querySelector('#backup-file');
  const file = input?.files?.[0];
  if (!file) {
    showToast('バックアップファイルを選んでください。', 'error');
    return;
  }
  const confirmed = await confirmDialog(
    'バックアップを読み込みますか？',
    '現在の診断、備蓄、家族計画、設定は、バックアップの内容に置き換わります。先に現在のバックアップを書き出すことを勧めます。',
    '読み込む'
  );
  if (!confirmed) return;

  try {
    const text = await readFileText(file);
    const bundle = safeJsonParse(text);
    let passphrase = '';
    if (bundle.protected) {
      passphrase = await promptForPassphrase('暗号化バックアップを開く', '書き出したときのパスフレーズを入力してください。');
      if (!passphrase) return;
    }
    const restored = await importBackup(bundle, passphrase);
    state = mergeWithDefaults(restored);
    state.onboardingComplete = true;
    state.audit.lastImportAt = new Date().toISOString();
    protectedPassphrase = state.storageMode === 'protected' ? passphrase : '';
    applyPreferences();
    if (state.storageMode === 'none') await clearSavedData();
    else await saveState(state, protectedPassphrase);
    showToast('バックアップを読み込みました。');
    location.hash = '#/';
    render();
  } catch (error) {
    showToast(error.message || 'バックアップを読み込めませんでした。', 'error');
  }
}

async function handleDeleteAllData() {
  const confirmed = await confirmDialog(
    'すべてのアプリデータを削除しますか？',
    '診断、備蓄、賞味期限、家の安全、家族計画、表示設定を削除します。元に戻せません。',
    'すべて削除'
  );
  if (!confirmed) return;
  const finalConfirmed = await confirmDialog(
    '本当に削除しますか？',
    '必要なバックアップを書き出していることを確認してください。オフライン用のアプリ本体は残ります。',
    '削除を実行'
  );
  if (!finalConfirmed) return;

  try {
    await clearSavedData();
    state = createDefaultState();
    protectedPassphrase = '';
    isLocked = false;
    lockedMetadata = null;
    applyPreferences();
    location.hash = '#/';
    render();
    showToast('この端末のアプリデータを削除しました。');
  } catch (error) {
    showToast(error.message || '保存データを削除できませんでした。', 'error');
  }
}

async function askNewPassphrase() {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="new-passphrase-title">
          <h2 id="new-passphrase-title">新しいパスフレーズ</h2>
          <p>8文字以上で設定してください。EpsilonLabにも分からず、忘れた場合は復元できません。</p>
          <form id="new-passphrase-form">
            <div class="form-field">
              <label for="new-passphrase">パスフレーズ</label>
              <input id="new-passphrase" name="passphrase" type="password" minlength="8" autocomplete="new-password" required>
            </div>
            <div class="form-field section">
              <label for="new-passphrase-confirm">もう一度入力</label>
              <input id="new-passphrase-confirm" name="confirmation" type="password" minlength="8" autocomplete="new-password" required>
            </div>
            <p class="error-text" id="passphrase-error" aria-live="polite"></p>
            <div class="modal-actions">
              <button class="button secondary" type="button" id="passphrase-cancel">キャンセル</button>
              <button class="button" type="submit">設定する</button>
            </div>
          </form>
        </section>
      </div>`;
    const form = document.querySelector('#new-passphrase-form');
    const close = (value) => {
      dialogRoot.innerHTML = '';
      resolve(value);
    };
    document.querySelector('#passphrase-cancel')?.addEventListener('click', () => close(''));
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const passphrase = String(data.get('passphrase') || '');
      const confirmation = String(data.get('confirmation') || '');
      const error = document.querySelector('#passphrase-error');
      if (passphrase.length < 8) {
        error.textContent = '8文字以上にしてください。';
        return;
      }
      if (passphrase !== confirmation) {
        error.textContent = '2つの入力が一致しません。';
        return;
      }
      close(passphrase);
    });
    document.querySelector('#new-passphrase')?.focus();
  });
}

async function promptForPassphrase(title, message) {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="prompt-passphrase-title">
          <h2 id="prompt-passphrase-title">${escapeHtml(title)}</h2>
          <p>${escapeHtml(message)}</p>
          <form id="prompt-passphrase-form">
            <div class="form-field">
              <label for="prompt-passphrase">パスフレーズ</label>
              <input id="prompt-passphrase" name="passphrase" type="password" autocomplete="current-password" required>
            </div>
            <div class="modal-actions">
              <button class="button secondary" type="button" id="prompt-passphrase-cancel">キャンセル</button>
              <button class="button" type="submit">開く</button>
            </div>
          </form>
        </section>
      </div>`;
    const close = (value) => {
      dialogRoot.innerHTML = '';
      resolve(value);
    };
    document.querySelector('#prompt-passphrase-cancel')?.addEventListener('click', () => close(''));
    document.querySelector('#prompt-passphrase-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const passphrase = String(new FormData(event.currentTarget).get('passphrase') || '');
      close(passphrase);
    });
    document.querySelector('#prompt-passphrase')?.focus();
  });
}

async function confirmDialog(title, message, confirmLabel = '確認') {
  return new Promise((resolve) => {
    dialogRoot.innerHTML = `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
          <h2 id="confirm-dialog-title">${escapeHtml(title)}</h2>
          <p id="confirm-dialog-message">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="button secondary" type="button" id="confirm-cancel">キャンセル</button>
            <button class="button danger" type="button" id="confirm-accept">${escapeHtml(confirmLabel)}</button>
          </div>
        </section>
      </div>`;
    const close = (value) => {
      dialogRoot.innerHTML = '';
      resolve(value);
    };
    document.querySelector('#confirm-cancel')?.addEventListener('click', () => close(false));
    document.querySelector('#confirm-accept')?.addEventListener('click', () => close(true));
    document.querySelector('#confirm-cancel')?.focus();
  });
}

initialize();
