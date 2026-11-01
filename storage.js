// Saves lists to the person's Telegram account, so they follow them to a new
// device. Falls back to this device if Telegram's cloud storage is unavailable.

const LOCAL_KEY = 'lists';
const HIDDEN_KEY = 'hidden';
const META_KEY = 'meta';
const CHUNK_SIZE = 4000;  // Telegram allows 4096 characters per value...
const MAX_CHUNKS = 1000;  // ...and 1024 keys per person.
const BATCH_SIZE = 20;

function cloud() {
  const webApp = window.Telegram?.WebApp;
  return webApp?.initData && webApp.isVersionAtLeast('6.9') ? webApp.CloudStorage : null;
}

function call(storage, method, ...args) {
  return new Promise((resolve, reject) => {
    storage[method](...args, (error, result) => (error ? reject(new Error(error)) : resolve(result)));
  });
}

function saveLocal(text) {
  try {
    localStorage.setItem(LOCAL_KEY, text);
    return true;
  } catch {
    return false;
  }
}

function loadLocal() {
  try {
    return localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Nothing saved here, then.
  }
}

async function readMeta(storage) {
  const meta = await call(storage, 'getItem', META_KEY);
  return meta ? JSON.parse(meta) : null;
}

function chunkKeys({ generation, count }) {
  return Array.from({ length: count }, (_, i) => `g${generation}_${i}`);
}

async function removeChunks(storage, meta) {
  const keys = chunkKeys(meta);
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    await call(storage, 'removeItems', keys.slice(i, i + BATCH_SIZE));
  }
}

// New chunks go under a new generation, and `meta` switches over last, so an
// interrupted save leaves the previous lists intact.
async function saveCloud(storage, text) {
  const count = Math.ceil(text.length / CHUNK_SIZE);
  if (count > MAX_CHUNKS) throw new Error('Too large for cloud storage');
  const previous = await readMeta(storage);
  const meta = { generation: (previous?.generation ?? 0) + 1, count };
  const keys = chunkKeys(meta);
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    await Promise.all(keys.slice(i, i + BATCH_SIZE).map((key, offset) => {
      const start = (i + offset) * CHUNK_SIZE;
      return call(storage, 'setItem', key, text.slice(start, start + CHUNK_SIZE));
    }));
  }
  await call(storage, 'setItem', META_KEY, JSON.stringify(meta));
  if (previous) await removeChunks(storage, previous);
}

// Returns true if the lists will follow the person to other devices.
export async function saveLists(lists) {
  const text = JSON.stringify(lists);
  const storage = cloud();
  if (storage) {
    try {
      await saveCloud(storage, text);
      clearLocal();
      return true;
    } catch (e) {
      console.warn('Cloud save failed', e?.message);
    }
  }
  saveLocal(text);
  return false;
}

export async function loadLists() {
  const storage = cloud();
  if (storage) {
    try {
      const meta = await readMeta(storage);
      if (meta) {
        const keys = chunkKeys(meta);
        const parts = [];
        for (let i = 0; i < keys.length; i += BATCH_SIZE) {
          const batch = keys.slice(i, i + BATCH_SIZE);
          const values = await call(storage, 'getItems', batch);
          parts.push(...batch.map((key) => values[key]));
        }
        return JSON.parse(parts.join(''));
      }
    } catch (e) {
      console.warn('Cloud load failed', e?.message);
    }
  }
  const local = loadLocal();
  return local ? JSON.parse(local) : null;
}

function loadHiddenLocal() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

// Accounts the person hid stay separate from the lists, so they survive a new export.
export async function loadHidden() {
  const storage = cloud();
  if (storage) {
    try {
      const saved = await call(storage, 'getItem', HIDDEN_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Cloud load failed', e?.message);
    }
  }
  return loadHiddenLocal();
}

// Returns false if the names couldn't be saved anywhere that lasts.
export async function saveHidden(names) {
  const text = JSON.stringify(names);
  try {
    localStorage.setItem(HIDDEN_KEY, text);
  } catch {
    // Telegram's cloud below is the main copy anyway.
  }
  const storage = cloud();
  if (!storage) return true;
  if (text.length > CHUNK_SIZE) return false;
  try {
    await call(storage, 'setItem', HIDDEN_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export async function deleteLists() {
  clearLocal();
  try {
    localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Nothing saved here, then.
  }
  const storage = cloud();
  if (!storage) return;
  await call(storage, 'removeItem', HIDDEN_KEY);
  const meta = await readMeta(storage);
  if (meta) {
    await call(storage, 'removeItem', META_KEY);
    await removeChunks(storage, meta);
  }
}
