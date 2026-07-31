import {
  ANSWER_OPTIONS,
  EMERGENCY_GUIDES,
  HAZARDS,
  HOME_SAFETY_GROUPS,
  INVENTORY_CATEGORIES,
  OFFICIAL_SOURCES,
  PREPAREDNESS_ARTICLES,
  RISK_QUESTIONS,
  RISK_SECTIONS,
  STOCKPILE_FIELDS
} from './data.js';
import { calculateRiskAssessment, emptyRiskAnswers, RISK_LEVELS } from './risk-engine.js';
import {
  analyzeInventory,
  calculateStockpile,
  createDefaultHousehold,
  createDefaultStockpile,
  householdPeople
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

let state = createDefaultState();
let protectedPassphrase = '';
let isLocked = false;
let lockedMetadata = null;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;
let editingInventoryId = null;
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
      highContrast: false,
      reducedMotion: false,
      easyMode: false
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
      contactRule: '',
      outOfAreaContact: '',
      pickupRule: '',
      supportPlan: '',
      petPlan: '',
      utilityRule: '',
      notes: '',
      updatedAt: null
    },
    audit: {
      createdAt: now,
      lastSavedAt: null,
      lastExportAt: null,
      lastImportAt: null
    }
  };
}

function mergeWithDefaults(saved) {
  const defaults = createDefaultState();
  if (!saved || typeof saved !== 'object') return defaults;
  return {
    ...defaults,
    ...saved,
    preferences: { ...defaults.preferences, ...(saved.preferences ?? {}) },
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
      inventory: Array.isArray(saved.stockpile?.inventory) ? saved.stockpile.inventory : []
    },
    homeSafety: {
      ...defaults.homeSafety,
      ...(saved.homeSafety ?? {}),
      items: { ...defaults.homeSafety.items, ...(saved.homeSafety?.items ?? {}) }
    },
    familyPlan: { ...defaults.familyPlan, ...(saved.familyPlan ?? {}) },
    audit: { ...defaults.audit, ...(saved.audit ?? {}) }
  };
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
    }
  } catch (error) {
    showToast(error.message || '保存データの読み込みに失敗しました。', 'error');
  }

  applyPreferences();
  render();
}

function bindGlobalEvents() {
  window.addEventListener('hashchange', render);
  window.addEventListener('online', async () => {
    offlineStatus.online = true;
    await refreshOfflineStatus();
    renderOfflineIndicatorOnly();
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
    showToast('ホーム画面への追加が完了しました。');
    renderOfflineIndicatorOnly();
  });

  document.querySelector('#font-decrease')?.addEventListener('click', () => changeFontScale(-1));
  document.querySelector('#font-increase')?.addEventListener('click', () => changeFontScale(1));

  document.addEventListener('click', handleGlobalClick);
}

async function handleGlobalClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'install-pwa') {
    event.preventDefault();
    await installPwa();
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

function changeFontScale(direction) {
  const scales = [100, 115, 130, 150, 175, 200];
  const currentIndex = Math.max(0, scales.indexOf(Number(state.preferences.fontScale)));
  const nextIndex = Math.min(scales.length - 1, Math.max(0, currentIndex + direction));
  state.preferences.fontScale = scales[nextIndex];
  applyPreferences();
  persistDebounced();
  showToast(`文字サイズを${scales[nextIndex]}%にしました。`);
}

function applyPreferences() {
  const body = document.body;
  for (const size of [100, 115, 130, 150, 175, 200]) body.classList.remove(`font-${size}`);
  body.classList.add(`font-${state.preferences.fontScale || 100}`);
  body.classList.toggle('high-contrast', Boolean(state.preferences.highContrast));
  body.classList.toggle('reduced-motion', Boolean(state.preferences.reducedMotion));
  body.classList.toggle('easy-mode', Boolean(state.preferences.easyMode));
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

  if (isLocked && route.first !== 'emergency') {
    main.innerHTML = renderUnlockPage();
    bindUnlockPage();
    focusPageHeading();
    return;
  }

  if (!state.onboardingComplete && !['emergency', 'help', 'about', 'sources'].includes(route.first)) {
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
      html = renderFamilyPlan();
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
        <h2 id="privacy-heading">入力内容は外部へ送信しません</h2>
        <div class="notice privacy">
          <p><strong>診断や備蓄チェックで入力した内容は、この端末のブラウザー内だけで処理します。</strong></p>
          <p>保存を選んだ場合も、回答内容をEpsilonLab、GitHub、その他の外部サーバーへ送信する処理はありません。広告、アクセス解析、外部JavaScriptも使用していません。</p>
        </div>
        <p>同じ端末・同じブラウザーを使う人は、保存内容を開ける場合があります。共有端末では「保存しない」または「パスフレーズで保護」を選んでください。ブラウザーのデータ消去や端末故障で失われることがあるため、必要に応じてバックアップを書き出せます。</p>
      </section>

      <form id="onboarding-form" class="section" novalidate>
        <fieldset class="card form-section">
          <legend>1. 保存方法を選ぶ</legend>
          <div class="grid two">
            ${storageOption('none', '保存しない', 'この画面を開いている間だけ使います。再読み込みや終了で回答は消えます。')}
            ${storageOption('result', '診断結果だけ保存', '回答そのものは残さず、優先度・理由・確認項目だけを保存します。途中の回答は再読み込みで消えます。')}
            ${storageOption('full', 'この端末に保存', '診断回答、備蓄、家の安全、家族計画をブラウザー内へ保存します。', true)}
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
<option value="85" ${Number(state.preferences.fontScale) === 85 ? "selected" : ""}>小さめ（85%）</option>
                ${[100,115,130,150,175,200].map((size) => `<option value="${size}"${size === 100 ? ' selected' : ''}>${size}%</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <span class="form-label">表示補助</span>
              <label><input type="checkbox" name="highContrast"> コントラストを強くする</label>
              <label><input type="checkbox" name="reducedMotion"> 動きを減らす</label>
              <label><input type="checkbox" name="easyMode"> やさしい表示を使う</label>
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
    if (['highContrast', 'reducedMotion', 'easyMode'].includes(event.target.name)) {
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
      easyMode: data.has('easyMode')
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
      ${pageHeader('保護された保存データ', 'パスフレーズで開く', '診断・備蓄・家族計画は暗号化され、この端末のブラウザー内に保存されています。')}
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

function renderDashboard() {
  const diagnosis = state.diagnosis.result;
  const stockpile = state.stockpile.result;
  const safety = homeSafetySummary();
  const familyDone = Object.entries(state.familyPlan)
    .filter(([key]) => !['updatedAt', 'notes'].includes(key))
    .some(([, value]) => String(value || '').trim());

  return `
    <div class="page-container">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-content">
          <p class="eyebrow">無料・広告なし・オフライン対応</p>
          <h1 id="page-title" tabindex="-1">守れるいのち</h1>
          <p class="subtitle">暮らしの防災アプリ</p>
          <p class="tagline">知る。備える。迷わず動く。</p>
          <p class="description">生活環境のリスクを多角的に確認し、家族に必要な備蓄と、災害時に取る行動を一つずつ整理します。</p>
          <div class="button-row">
            <a class="button primary-light" href="#/emergency">今、災害が起きている</a>
            <a class="button secondary-light" href="${diagnosis ? '#/diagnosis/results' : '#/diagnosis/area'}">${diagnosis ? '診断結果を見る' : '生活環境を診断する'}</a>
          </div>
        </div>
        <div class="hero-mark" aria-hidden="true">
          <img src="./assets/icons/icon-512.png" alt="">
        </div>
      </section>

      ${state.diagnosis.skipped && !diagnosis ? `
        <div class="notice warning section">
          <h2>リスク診断は後から行えます</h2>
          <p>まず災害時ガイドや備蓄だけを見ることもできます。落ち着いたときに3〜5分ほどで確認してください。</p>
          <a class="button small" href="#/diagnosis/area">診断を始める</a>
        </div>` : ''}

      <div class="grid dashboard-grid">
        <section class="card wide" aria-labelledby="diagnosis-card-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">生活環境</p>
              <h2 id="diagnosis-card-title">リスク診断</h2>
            </div>
            ${diagnosis ? `<span class="badge ${diagnosis.overallPriority >= 4 ? 'warning' : 'brand'}">優先度 ${diagnosis.overallPriority}/5</span>` : '<span class="badge">未診断</span>'}
          </div>
          ${diagnosis ? renderDashboardDiagnosis(diagnosis) : `
            <p>地形、住宅、家族、ライフライン、避難計画から、災害別に確認したい点を整理します。</p>
            <div class="button-row"><a class="button" href="#/diagnosis/area">診断を始める</a></div>`}
        </section>

        <section class="card" aria-labelledby="stock-card-title">
          <p class="eyebrow">生活継続</p>
          <h2 id="stock-card-title">備蓄チェック</h2>
          ${stockpile ? `
            <div class="kpi"><strong>${escapeHtml(stockpile.level.label)}</strong><small>重要項目の7日分達成度 ${stockpile.score}%</small></div>
            <p>${stockpile.deficits.length ? `3日分までに不足: ${escapeHtml(stockpile.deficits.slice(0,2).map((item) => item.label).join('、'))}` : '水・食料・トイレなどの最低3日分を確認済みです。'}</p>
            <a class="button small" href="#/stockpile/results">結果と不足を見る</a>` : `
            <p>家族構成に合わせ、3日分と7日分の水・食料・トイレなどを計算します。</p>
            <a class="button small" href="#/stockpile/household">備蓄を確認する</a>`}
        </section>

        <section class="card clickable">
          <a class="card-link" href="#/safety">
            <div class="card-icon" aria-hidden="true">家</div>
            <h2>家の安全</h2>
            <p>家具、寝室、窓、火災、停電、大雨の対策を部屋ごとに確認します。</p>
            <p class="link-label">${safety.complete}/${safety.total}項目を確認済み</p>
          </a>
        </section>

        <section class="card clickable">
          <a class="card-link" href="#/family">
            <div class="card-icon" aria-hidden="true">人</div>
            <h2>家族の防災計画</h2>
            <p>集合場所、連絡方法、迎え、支援、ペットの役割を記録します。</p>
            <p class="link-label">${familyDone ? '計画を確認・更新する' : '計画を作る'}</p>
          </a>
        </section>

        <section class="card clickable">
          <a class="card-link" href="#/inventory">
            <div class="card-icon" aria-hidden="true">庫</div>
            <h2>備蓄リスト</h2>
            <p>食品や用品の数量、保管場所、賞味期限を更新できます。</p>
            <p class="link-label">${state.stockpile.inventory.length}品を登録中</p>
          </a>
        </section>

        <section class="card clickable">
          <a class="card-link" href="#/learn">
            <div class="card-icon" aria-hidden="true">知</div>
            <h2>災害への備え</h2>
            <p>平常時の準備、避難、情報の確かめ方を短い項目で読めます。</p>
            <p class="link-label">防災ガイドを読む</p>
          </a>
        </section>

        <section class="card clickable">
          <a class="card-link" href="#/help">
            <div class="card-icon" aria-hidden="true">?</div>
            <h2>使い方とヘルプ</h2>
            <p>ホーム画面への追加、保存、バックアップ、オフライン利用を案内します。</p>
            <p class="link-label">ガイドを見る</p>
          </a>
        </section>

        <section class="card full" id="offline-card">
          ${renderOfflineCardContent()}
        </section>
      </div>

      <div class="notice privacy section">
        <h2>現在の保存方法: ${escapeHtml(storageModeLabel())}</h2>
        <p>診断回答や備蓄情報を外部へ送信する機能はありません。保存内容の確認、バックアップ、削除は「データと設定」から行えます。</p>
        <div class="button-row">
          <a class="button secondary small" href="#/settings">データと設定</a>
          <a class="button secondary small" href="#/print">防災計画を印刷</a>
        </div>
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

  return `
    <div class="page-container">
      ${pageHeader('備蓄チェック', '現在ある物を入力する', `${people}人分として、最低3日と安心7日の目安を比較します。`)}
      ${stockpileTabs('items')}
      <div class="notice privacy">
        <p>数量、備蓄状況、賞味期限は、選択した保存方法に応じてこの端末のブラウザー内だけで扱います。</p>
      </div>

      <form id="stockpile-form" class="section" novalidate>
        <div class="grid two">
          ${preview.items.map((item) => renderStockpileInput(item)).join('')}
        </div>

        <details class="section"${state.stockpile.advanced.enabled ? ' open' : ''}>
          <summary>アドバンスモード: 想定する停止日数を変更する</summary>
          <div class="card">
            <label class="storage-option">
              <input id="advanced-enabled" type="checkbox" name="advancedEnabled"${state.stockpile.advanced.enabled ? ' checked' : ''}>
              <span><strong>アドバンスモードを使う</strong><small>断水、停電、道路寸断などを自分の生活環境に合わせて設定します。</small></span>
            </label>
            <div class="form-grid section" id="advanced-fields">
              ${numberField('waterDays', '断水を想定する日数', state.stockpile.advanced.waterDays, '日', 1, 30)}
              ${numberField('foodDays', '食料を自力で確保する日数', state.stockpile.advanced.foodDays, '日', 1, 30)}
              ${numberField('powerDays', '停電を想定する日数', state.stockpile.advanced.powerDays, '日', 1, 30)}
              ${numberField('gasDays', '加熱手段が限られる日数', state.stockpile.advanced.gasDays, '日', 1, 30)}
              ${numberField('isolationDays', '物流・道路寸断を想定する日数', state.stockpile.advanced.isolationDays, '日', 1, 30)}
              ${numberField('elevatorDays', 'エレベーター停止を想定する日数', state.stockpile.advanced.elevatorDays, '日', 1, 30)}
            </div>
            <p class="hint">長い日数を設定するほど、保管量と重量が増えます。水は1Lで約1kgです。住居、階段移動、分散保管も考えて調整してください。</p>
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
          ${result.advanced.enabled ? `<div class="status-line"><span>アドバンス設定</span><span class="status-value ${result.advancedMet ? 'ok' : 'warn'}">${result.advancedMet ? '達成' : '不足あり'}</span></div>` : ''}
        </div>
      </section>

      <section class="card section">
        <h2>項目ごとの数量</h2>
        <div class="table-wrap">
          <table class="summary-table">
            <thead><tr><th>項目</th><th>現在</th><th>3日目安</th><th>7日目安</th><th>状態</th></tr></thead>
            <tbody>
              ${result.items.map((item) => `
                <tr>
                  <td><strong>${escapeHtml(item.label)}</strong><br><span class="small-text muted">${escapeHtml(item.description)}</span></td>
                  <td class="number">${formatNumber(item.current)} ${escapeHtml(item.unit)}</td>
                  <td class="number">${formatNumber(item.minimum)} ${escapeHtml(item.unit)}</td>
                  <td class="number">${formatNumber(item.comfort)} ${escapeHtml(item.unit)}</td>
                  <td>${stockStatusBadge(item)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>詳しいコメント</h2>
          <ul class="plain-list">${result.comments.map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}</ul>
          ${result.deficits.length ? `<h3>3日分までの不足</h3><ul class="plain-list">${result.deficits.map((item) => `<li>${escapeHtml(item.label)}: あと ${formatNumber(item.missingMinimum)} ${escapeHtml(item.unit)}</li>`).join('')}</ul>` : '<p class="badge success">重要項目は3日分を満たしています</p>'}
        </div>
        <div class="card">
          <h2>次に7日分へ近づける</h2>
          ${result.nextComfort.length ? `<ul class="plain-list">${result.nextComfort.map((item) => `<li>${escapeHtml(item.label)}: あと ${formatNumber(item.missingComfort)} ${escapeHtml(item.unit)}</li>`).join('')}</ul>` : '<p>重要項目は7日分の目安を満たしています。期限と使い方を確認してください。</p>'}
          <a class="button small" href="#/stockpile/items">数量を更新する</a>
        </div>
      </section>

      <section class="card section">
        <div class="section-heading">
          <div><p class="eyebrow">ローリングストック</p><h2>賞味期限と交換</h2></div>
          <span class="badge ${inventory.expired.length || inventory.within30.length ? 'warning' : 'success'}">登録 ${inventory.items.length}品</span>
        </div>
        <p>期限切れ ${inventory.expired.length}品 / 30日以内 ${inventory.within30.length}品 / 60日以内 ${inventory.within60.length}品</p>
        <a class="button secondary small" href="#/inventory">備蓄リストを更新する</a>
      </section>

      <div class="notice section">
        <h2>計算の前提</h2>
        <ul class="plain-list">${result.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
        <p><a href="#/sources">根拠と出典を見る</a></p>
      </div>

      <div class="button-row section">
        <a class="button" href="#/inventory">賞味期限を登録する</a>
        <a class="button secondary" href="#/print">結果を印刷する</a>
        <a class="button subtle" href="#/">ホームへ</a>
      </div>
    </div>`;
}

function stockStatusBadge(item) {
  const map = {
    comfort: ['success', '7日目安達成'],
    minimum: ['warning', '3日目安達成'],
    partial: ['warning', '3日分未満'],
    none: ['danger', '未登録']
  };
  const [tone, label] = map[item.status] || ['', '確認'];
  return `<span class="badge ${tone}">${label}</span>`;
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
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    for (const field of STOCKPILE_FIELDS) {
      state.stockpile.quantities[field.id] = toNonNegativeNumber(data.get(field.id), 0);
    }
    state.stockpile.advanced.enabled = data.has('advancedEnabled');
    for (const key of ['waterDays', 'foodDays', 'powerDays', 'gasDays', 'isolationDays', 'elevatorDays']) {
      state.stockpile.advanced[key] = Math.max(1, toNonNegativeInteger(data.get(key), state.stockpile.advanced[key]));
    }
    state.stockpile.result = calculateStockpile(state.household, state.stockpile);
    state.stockpile.lastCheckedAt = new Date().toISOString();
    await persistCurrentState();
    location.hash = '#/stockpile/results';
  });
}

function renderInventory() {
  const analysis = analyzeInventory(state.stockpile.inventory);
  const editing = editingInventoryId
    ? state.stockpile.inventory.find((item) => item.id === editingInventoryId)
    : null;
  const formItem = editing || {
    name: '',
    category: '食品',
    quantity: 1,
    unit: '個',
    expirationDate: '',
    storageLocation: '',
    opened: false,
    notes: ''
  };

  return `
    <div class="page-container">
      ${pageHeader('備蓄管理', '備蓄リストと賞味期限', '数量や保管場所を更新し、期限が近い物から普段の生活で使います。')}
      <div class="notice privacy">
        <p>品名、数量、賞味期限、保管場所は外部へ送信しません。共有端末では保存方法を確認してください。</p>
      </div>

      <section class="grid four section">
        ${inventoryKpi('登録', analysis.items.length, '品', '')}
        ${inventoryKpi('期限切れ', analysis.expired.length, '品', analysis.expired.length ? 'danger' : 'success')}
        ${inventoryKpi('30日以内', analysis.within30.length, '品', analysis.within30.length ? 'warning' : 'success')}
        ${inventoryKpi('60日以内', analysis.within60.length, '品', analysis.within60.length ? 'warning' : '')}
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
              <label for="inventory-location">保管場所</label>
              <input id="inventory-location" name="storageLocation" type="text" maxlength="80" value="${escapeHtml(formItem.storageLocation)}" placeholder="例: キッチン上段">
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
          ${item.storageLocation ? `<span class="badge brand">${escapeHtml(item.storageLocation)}</span>` : ''}
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

function renderFamilyPlan() {
  const plan = state.familyPlan;
  return `
    <div class="page-container">
      ${pageHeader('家族の防災計画', '連絡できないときも、同じ判断をする', '集合場所、迎え、支援、ペットなどを短い言葉で記録します。')}
      <div class="notice privacy">
        <p><strong>氏名、電話番号、病名などは必須ではありません。</strong>「母」「学校」「近隣の親族」のような関係や役割だけでも計画を作れます。内容は外部へ送信しません。</p>
      </div>

      <form id="family-plan-form" class="card section" novalidate>
        <div class="form-grid">
          ${textField('primaryMeetingPlace', '第一の集合場所', plan.primaryMeetingPlace, '例: 自宅近くの公園北側。洪水時は使用しない。')}
          ${textField('secondaryMeetingPlace', '第二の集合場所', plan.secondaryMeetingPlace, '例: 高台の指定緊急避難場所')}
          ${textField('evacuationPlace', '災害別の避難先', plan.evacuationPlace, '例: 地震は公園、洪水は小学校3階、津波は高台')}
          ${textField('outOfAreaContact', '遠方の連絡先・中継役', plan.outOfAreaContact, '例: 県外の親族へSMS。個人名を書かなくても構いません。')}
          ${textareaField('contactRule', '電話がつながらないときの連絡順', plan.contactRule, '例: SMS → 171 → 災害用伝言板。既読だけでも返す。')}
          ${textareaField('pickupRule', '学校・施設・職場からの迎え', plan.pickupRule, '例: 第一担当が行けない場合は第二担当。危険区域を横断しない。')}
          ${textareaField('supportPlan', '支援が必要な人への役割', plan.supportPlan, '例: 階段移動は二人で支援。早めに近隣へ連絡。')}
          ${textareaField('petPlan', 'ペットの避難と担当', plan.petPlan, '例: ケージは玄関。フードと薬は持出袋の横。')}
          ${textareaField('utilityRule', '電気・ガス・水の確認ルール', plan.utilityRule, '例: 安全にできる場合のみ、避難時にブレーカーを落とす。')}
          ${textareaField('notes', 'その他のメモ', plan.notes, '家族だけが分かる短いルールや、季節ごとの注意を書けます。')}
        </div>
        <div class="button-row">
          <button class="button" type="submit">家族計画を保存する</button>
          <a class="button secondary" href="#/print">印刷用ページを見る</a>
          <a class="button subtle" href="#/">ホームへ</a>
        </div>
      </form>

      <div class="notice warning section">
        <p>現在地の常時共有や、家族への自動通知は行いません。災害時は通信が使えない前提で、紙にも印刷し、171や携帯電話会社の災害用伝言板なども確認してください。</p>
      </div>
    </div>`;
}

function textField(id, label, value, placeholder = '') {
  return `
    <div class="form-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="text" maxlength="160" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
    </div>`;
}

function textareaField(id, label, value, placeholder = '') {
  return `
    <div class="form-field full">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <textarea id="${escapeHtml(id)}" name="${escapeHtml(id)}" maxlength="600" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </div>`;
}

function bindFamilyPlan() {
  const form = document.querySelector('#family-plan-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    for (const key of Object.keys(state.familyPlan)) {
      if (key === 'updatedAt') continue;
      state.familyPlan[key] = String(data.get(key) || '').trim();
    }
    state.familyPlan.updatedAt = new Date().toISOString();
    await persistCurrentState();
    showToast('家族の防災計画を保存しました。');
    renderPersistentStatus(currentRoute());
  });
}

function renderEmergencyOverview() {
  return `
    <div class="page-container">
      ${pageHeader('災害時モード', '今すぐ必要な行動を選ぶ', '初期設定や保存データを開かなくても利用できます。通信がなくても主要内容を表示します。')}

      <section class="card emergency-intro">
        <h2>命に危険が迫っている場合</h2>
        <p>まず目の前の危険から離れてください。火災・救急・救助は119、事件・事故は110へ通報します。電話が使えない場合は、周囲へ助けを求め、安全な場所へ移動してください。</p>
        <div class="phone-actions">
          <a class="phone-link" href="tel:119">119 火災・救急・救助</a>
          <a class="phone-link" href="tel:110">110 事件・事故</a>
          <a class="phone-link" href="tel:171">171 災害用伝言</a>
        </div>
      </section>

      <section class="section" aria-labelledby="emergency-types-title">
        <div class="section-heading"><div><p class="eyebrow">状況を選ぶ</p><h2 id="emergency-types-title">災害別の行動</h2></div><span class="badge ${navigator.onLine ? 'success' : 'warning'}">${navigator.onLine ? '通信あり' : 'オフライン'}</span></div>
        <div class="emergency-grid">
          ${EMERGENCY_GUIDES.map((guide) => `
            <article class="card emergency-card clickable">
              <a class="card-link" href="#/emergency/${escapeHtml(guide.id)}">
                <div class="emergency-symbol" aria-hidden="true">${escapeHtml(guide.symbol)}</div>
                <h2>${escapeHtml(guide.name)}</h2>
                <p>${escapeHtml(guide.summary)}</p>
                <p class="link-label">行動を確認する</p>
              </a>
            </article>`).join('')}
        </div>
      </section>

      <section class="notice warning section">
        <h2>このガイドの位置づけ</h2>
        <p>一般的な行動を短くまとめたものです。現在地の危険、建物、けが、自治体の避難情報、消防・警察の指示を優先してください。このアプリは現在の警報を自動配信しません。</p>
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
  return `
    <div class="page-container">
      ${pageHeader('災害時モード', guide.name, guide.summary)}
      <section class="card emergency-intro">
        <h2>最初に</h2>
        <p><strong>目の前の危険から離れ、自分の命を守ってください。</strong> 現在地の状況と公的機関の指示が、この一般ガイドより優先されます。</p>
        <div class="phone-actions">
          <a class="phone-link" href="tel:119">119 火災・救急・救助</a>
          <a class="phone-link" href="tel:110">110 事件・事故</a>
        </div>
      </section>

      <section class="card section">
        <p class="eyebrow">今すぐすること</p>
        <h2>安全を確保する</h2>
        <div class="emergency-steps">
          ${guide.immediate.map((item) => `<p class="emergency-step">${escapeHtml(item)}</p>`).join('')}
        </div>
      </section>

      <section class="notice danger section">
        <h2>避けること</h2>
        <ul class="plain-list">${guide.avoid.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>

      <section class="card section">
        <p class="eyebrow">安全を確保した後</p>
        <h2>次に確認する</h2>
        <ul class="plain-list">${guide.after.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
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
        <p>v0.1.0は、警報や近隣避難所を自動取得しません。災害時は自治体、気象庁、消防、警察、ライフライン事業者などの最新情報を確認してください。アプリの説明には内容確認日と出典を付けています。</p>
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
        <div class="card"><div class="card-icon" aria-hidden="true">3</div><h2>すぐ動けるようにする</h2><p>家の安全、家族計画、災害時ガイドを確認し、必要なら印刷します。</p><a class="button small" href="#/emergency">災害時へ</a></div>
      </section>

      <section class="card section" id="offline-help-card">
        ${renderOfflineCardContent(true)}
      </section>

      <section class="section" aria-labelledby="install-title">
        <div class="section-heading"><div><p class="eyebrow">スマートフォン・PC</p><h2 id="install-title">ホーム画面へ追加する</h2></div></div>
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
              <li>ブラウザーのメニューまたはアドレス欄のインストール表示を選びます。</li>
              <li>「アプリをインストール」「ホーム画面に追加」などを選びます。</li>
              <li>追加後、一度開いてオフライン準備を確認します。</li>
            </ol>
            ${deferredInstallPrompt ? '<button class="button small" type="button" data-action="install-pwa">この端末へインストール</button>' : '<p class="hint">インストールボタンが表示されない場合は、ブラウザーのメニューを確認してください。</p>'}
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
        <details><summary>データはGitHub Pagesへ保存されますか？</summary><p>保存されません。GitHub Pagesはアプリ本体を配信するだけです。入力内容は、選択した方法に応じて、この端末のブラウザー内だけで扱います。</p></details>
        <details><summary>オフラインで何が使えますか？</summary><p>一度正常に読み込み、オフライン準備が完了すれば、診断、備蓄、家の安全、家族計画、災害時ガイドを利用できます。現在の警報や外部サイトは通信が必要です。</p></details>
        <details><summary>端末を変えるにはどうしますか？</summary><p>「データと設定」からバックアップを書き出し、新しい端末で読み込みます。バックアップファイルには個人情報が含まれる場合があるため、安全に保管してください。</p></details>
        <details><summary>パスフレーズを忘れました</summary><p>アプリ開発者にも復元できません。保存データを削除してやり直す必要があります。重要な内容は暗号化バックアップや紙にも残してください。</p></details>
      </section>

      <section class="notice warning section">
        <h2>アプリの限界</h2>
        <ul class="plain-list">
          <li>現在の警報、避難指示、近隣避難所を自動配信しません。</li>
          <li>建物の安全性、医療上の必要量、個人の被害確率を判定しません。</li>
          <li>端末故障、ブラウザーデータ消去、パスフレーズ忘れによる消失を防げません。</li>
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
}

function renderSettings() {
  const diagnosisAnswers = Object.values(state.diagnosis.answers).filter(Boolean).length;
  const safety = homeSafetySummary();
  return `
    <div class="page-container">
      ${pageHeader('データと設定', '保存、表示、バックアップ', 'この端末にあるアプリデータを確認し、自分で管理できます。')}

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
        <h2 id="display-settings-title">表示設定</h2>
        <form id="preferences-form">
          <div class="form-grid">
            <div class="form-field">
              <label for="settings-font-scale">文字サイズ</label>
              <select id="settings-font-scale" name="fontScale">
<option value="85" ${Number(state.preferences.fontScale) === 85 ? "selected" : ""}>小さめ（85%）</option>
                ${[100,115,130,150,175,200].map((size) => `<option value="${size}"${Number(state.preferences.fontScale) === size ? ' selected' : ''}>${size}%</option>`).join('')}
              </select>
            </div>
            <div class="form-field">
              <span class="form-label">表示補助</span>
              <label><input type="checkbox" name="highContrast"${state.preferences.highContrast ? ' checked' : ''}> コントラストを強くする</label>
              <label><input type="checkbox" name="reducedMotion"${state.preferences.reducedMotion ? ' checked' : ''}> 動きを減らす</label>
              <label><input type="checkbox" name="easyMode"${state.preferences.easyMode ? ' checked' : ''}> やさしい表示（1列中心）</label>
            </div>
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
            ${storageOption('full', 'この端末に保存', '入力内容をブラウザー内へ保存します。', state.storageMode === 'full')}
            ${storageOption('protected', '暗号化して保存', '8文字以上のパスフレーズで保存内容を保護します。', state.storageMode === 'protected')}
          </div>
          <div class="button-row"><button class="button" type="submit">保存方法を変更</button></div>
        </form>
        <p class="hint">同じ端末・同じブラウザーを使う人は、暗号化していない保存内容を開ける場合があります。パスフレーズを忘れると、暗号化データは復元できません。</p>
      </section>

      <section class="grid two section">
        <div class="card">
          <h2>バックアップ</h2>
          <p>診断、備蓄、家の安全、家族計画をJSONファイルへ書き出します。端末変更やブラウザーデータ消去に備えられます。</p>
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
        <p>対応ブラウザーでは、保存領域を自動削除しにくくするよう要求できます。ブラウザーが必ず許可するとは限りません。</p>
        <button class="button secondary small" type="button" data-action="request-persistence">永続保存を要求する</button>
      </section>

      <section class="notice danger section">
        <h2>すべてのアプリデータを削除</h2>
        <p>診断、備蓄、賞味期限、家の安全、家族計画、設定をこの端末から削除します。元に戻せません。</p>
        <button class="button danger" type="button" data-action="delete-all-data">すべて削除する</button>
      </section>

      <div class="button-row section"><a class="button subtle" href="#/">ホームへ</a></div>
    </div>`;
}

function bindSettings() {
  const preferencesForm = document.querySelector('#preferences-form');
  preferencesForm?.addEventListener('change', (event) => {
    const data = new FormData(preferencesForm);
    state.preferences = {
      fontScale: Number(data.get('fontScale') || 100),
      highContrast: data.has('highContrast'),
      reducedMotion: data.has('reducedMotion'),
      easyMode: data.has('easyMode')
    };
    applyPreferences();
  });
  preferencesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await persistCurrentState();
    showToast('表示設定を保存しました。');
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
      target.textContent = 'このブラウザーでは使用容量を取得できません。';
      return;
    }
    const usageMb = estimate.usage / 1024 / 1024;
    const quotaMb = estimate.quota / 1024 / 1024;
    target.textContent = `ブラウザー内の使用量: 約${formatNumber(usageMb, 2)}MB / 利用可能な上限の目安: 約${formatNumber(quotaMb, 0)}MB`;
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
        <div class="section-heading"><div><p class="eyebrow">内容確認日 2026年7月31日</p><h2 id="sources-list-title">主な公的資料</h2></div></div>
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

      <p class="small-text muted">Version ${APP_VERSION} / 公開初版</p>
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
  if (route.first === 'family') bindFamilyPlan();
  if (route.first === 'settings') bindSettings();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    offlineStatus.controlled = Boolean(navigator.serviceWorker.controller);
    offlineStatus.updateAvailable = Boolean(serviceWorkerRegistration.waiting);

    serviceWorkerRegistration.addEventListener('updatefound', () => {
      const worker = serviceWorkerRegistration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          offlineStatus.updateAvailable = true;
          renderOfflineIndicatorOnly();
          showToast('新しいバージョンを利用できます。データと設定から適用できます。');
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
}

async function checkForUpdate() {
  if (!serviceWorkerRegistration) {
    showToast('この環境では更新確認を利用できません。', 'error');
    return;
  }
  try {
    await serviceWorkerRegistration.update();
    await refreshOfflineStatus();
    renderOfflineIndicatorOnly();
    showToast(offlineStatus.updateAvailable ? '新しいバージョンがあります。' : '現在のバージョンは最新です。');
  } catch {
    showToast('更新を確認できませんでした。通信状態を確認してください。', 'error');
  }
}

async function installPwa() {
  if (!deferredInstallPrompt) {
    showToast('ブラウザーのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。');
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
      showToast('このブラウザーは永続保存の要求に対応していません。');
    } else if (result.persisted) {
      showToast('ブラウザーが永続保存を許可しました。');
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
