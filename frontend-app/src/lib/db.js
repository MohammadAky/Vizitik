// لایهٔ دسترسی به دیتابیس محلی (IndexedDB) برای حالت آفلاین
// این دیتابیس «آینهٔ کارِ آفلاین» است؛ دیتابیس اصلی MySQL روی سرور می‌ماند.

const DB_NAME = 'vizitik-pwa';
const DB_VERSION = 1;

const STORES = ['kv', 'customers', 'products', 'vanInventory', 'pendingOrders', 'ledger'];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'key' });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const os = t.objectStore(store);
        const out = fn(os);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

// برای جدول kv — key/value ساده (مثل تنظیمات، آخرین همگام‌سازی)
export const kv = {
  get(key) {
    return tx('kv', 'readonly', (os) => os.get(key)).then((r) => (r ? r.value : undefined));
  },
  set(key, value) {
    return tx('kv', 'readwrite', (os) => os.put({ key, value }));
  },
  remove(key) {
    return tx('kv', 'readwrite', (os) => os.delete(key));
  }
};

// برای جدول‌های کلکسیونی — ذخیرهٔ کل لیست زیر یک کلید ثابت
export const store = {
  save(listName, list) {
    return tx(listName, 'readwrite', (os) => os.put({ key: '__all__', items: list }));
  },
  load(listName) {
    return tx(listName, 'readonly', (os) => os.get('__all__')).then((r) =>
      r && Array.isArray(r.items) ? r.items : []
    );
  },
  clear(listName) {
    return tx(listName, 'readwrite', (os) => os.delete('__all__'));
  }
};

export async function clearAllLocalData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach((name) => t.objectStore(name).clear());
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}
