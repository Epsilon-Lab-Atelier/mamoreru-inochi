import { APP_VERSION, SCHEMA_VERSION, deepClone } from './utils.js';
import { decryptJson, encryptJson, isEncryptedPayload } from './crypto.js';

const DB_NAME = 'mamoreru_inochi_v1';
const STORE_NAME = 'records';
const DB_VERSION = 1;
const META_KEY = 'metadata';
const DATA_KEY = 'app-data';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('このブラウザでは端末保存を利用できません。'));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error || new Error('端末保存を開けませんでした。')));
  });
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.addEventListener('complete', () => resolve(result));
      transaction.addEventListener('error', () => reject(transaction.error || new Error('端末保存の処理に失敗しました。')));
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('端末保存の処理が中断されました。')));
    });
  } finally {
    database.close();
  }
}

async function getRecord(key) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.addEventListener('success', () => resolve(request.result ?? null));
      request.addEventListener('error', () => reject(request.error || new Error('保存データを読み込めませんでした。')));
    });
  } finally {
    database.close();
  }
}

async function putRecord(key, value) {
  return withStore('readwrite', (store) => store.put(value, key));
}

async function deleteRecord(key) {
  return withStore('readwrite', (store) => store.delete(key));
}

export async function getStorageMetadata() {
  try {
    return await getRecord(META_KEY);
  } catch {
    return null;
  }
}

export async function loadSavedState() {
  const metadata = await getStorageMetadata();
  if (!metadata?.mode || metadata.mode === 'none') {
    return { metadata, state: null, locked: false };
  }
  const record = await getRecord(DATA_KEY);
  if (!record) return { metadata, state: null, locked: false };
  if (metadata.mode === 'protected') {
    return { metadata, state: null, locked: true, encrypted: record };
  }
  return { metadata, state: deepClone(record), locked: false };
}

function resultOnlyState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    onboardingComplete: true,
    storageMode: 'result',
    preferences: deepClone(state.preferences),
    diagnosis: {
      answers: {},
      result: deepClone(state.diagnosis?.result ?? null),
      completedAt: state.diagnosis?.completedAt ?? null,
      skipped: Boolean(state.diagnosis?.skipped)
    },
    household: null,
    stockpile: null,
    homeSafety: null,
    familyPlan: null,
    audit: {
      lastSavedAt: new Date().toISOString()
    }
  };
}

export async function saveState(state, passphrase = '') {
  const mode = state.storageMode || 'none';
  if (mode === 'none') {
    await clearSavedData();
    return;
  }

  const metadata = {
    mode,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
    preferences: deepClone(state.preferences)
  };

  let payload;
  if (mode === 'result') {
    payload = resultOnlyState(state);
  } else if (mode === 'protected') {
    payload = await encryptJson(state, passphrase);
  } else {
    payload = deepClone(state);
  }

  await putRecord(META_KEY, metadata);
  await putRecord(DATA_KEY, payload);
}

export async function unlockSavedState(passphrase) {
  const metadata = await getStorageMetadata();
  if (metadata?.mode !== 'protected') {
    throw new Error('保護された保存データは見つかりませんでした。');
  }
  const payload = await getRecord(DATA_KEY);
  if (!isEncryptedPayload(payload)) {
    throw new Error('保護された保存データの形式を確認できませんでした。');
  }
  return decryptJson(payload, passphrase);
}

export async function changeStorageMode(state, newMode, passphrase = '') {
  const nextState = { ...deepClone(state), storageMode: newMode };
  if (newMode === 'none') {
    await clearSavedData();
    return nextState;
  }
  await saveState(nextState, passphrase);
  return nextState;
}

export async function clearSavedData() {
  try {
    await deleteRecord(DATA_KEY);
    await deleteRecord(META_KEY);
  } catch (error) {
    if (!globalThis.indexedDB) return;
    throw error;
  }
}

export async function exportBackup(state, passphrase = '') {
  const exportedAt = new Date().toISOString();
  if (state.storageMode === 'protected') {
    const encrypted = await encryptJson(state, passphrase);
    return {
      format: 'mamoreru-inochi-backup-v1',
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      protected: true,
      payload: encrypted
    };
  }
  return {
    format: 'mamoreru-inochi-backup-v1',
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    protected: false,
    payload: deepClone(state)
  };
}

export async function importBackup(bundle, passphrase = '') {
  if (bundle?.format !== 'mamoreru-inochi-backup-v1') {
    throw new Error('「守れるいのち」のバックアップ形式ではありません。');
  }
  if (Number(bundle.schemaVersion) > SCHEMA_VERSION) {
    throw new Error('このバックアップは、より新しいアプリで作成されています。先にアプリを更新してください。');
  }
  const restored = bundle.protected
    ? await decryptJson(bundle.payload, passphrase)
    : deepClone(bundle.payload);
  if (!restored || typeof restored !== 'object') {
    throw new Error('バックアップの内容を確認できませんでした。');
  }
  return restored;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const alreadyPersisted = await navigator.storage.persisted();
  if (alreadyPersisted) return { supported: true, persisted: true };
  const persisted = await navigator.storage.persist();
  return { supported: true, persisted };
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0
  };
}
