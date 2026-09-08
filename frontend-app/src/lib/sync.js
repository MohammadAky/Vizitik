import { store } from './db.js';
import { api, authStorage } from './api.js';

// صفِ آفلاین: اقلامِ { id, type:'ORDER'|'VAN_BULK', payload, createdAt }
// نوع ORDER  ->  POST /api/orders
// نوع VAN_BULK -> PUT /api/van-inventory/bulk
const QUEUE_STORE = 'pendingOrders';
const listeners = new Set();

export function subscribeSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(status) {
  listeners.forEach((fn) => {
    try {
      fn(status);
    } catch (e) {
      /* noop */
    }
  });
}

export function networkState() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export async function getPending() {
  return store.load(QUEUE_STORE).catch(() => []);
}

async function savePending(list) {
  await store.save(QUEUE_STORE, list);
  emit({ type: 'queue', count: list.length });
}

export async function enqueue(type, payload) {
  const list = await getPending();
  list.push({ id: (type === 'ORDER' ? 'ord_' : 'van_') + Date.now() + '_' + Math.random().toString(36).substring(2, 7), type, payload, createdAt: Date.now() });
  await savePending(list);
  return list.length;
}

export async function removeFromQueue(id) {
  const list = await getPending();
  await savePending(list.filter((q) => q.id !== id));
}

async function runOp(q) {
  if (q.type === 'ORDER') {
    await api('/orders', { method: 'POST', body: q.payload, timeout: 20000 });
  } else if (q.type === 'VAN_BULK') {
    await api('/van-inventory/bulk', { method: 'PUT', body: q.payload, timeout: 20000 });
  } else {
    throw new Error('op type unknown');
  }
}

export async function flushPendingQueue({ onEach } = {}) {
  if (!authStorage.token) return { sent: 0, failed: 0 };
  if (!networkState()) return { sent: 0, failed: 0 };
  emit({ type: 'syncing', syncing: true });
  let list = await getPending();
  let sent = 0;
  let failed = 0;
  // تک‌تک تلاش می‌کنیم؛ در صورت موفقیت حذف، در صورت خطای دائمی نگه می‌داریم
  for (const q of [...list]) {
    try {
      await runOp(q);
      await removeFromQueue(q.id);
      sent += 1;
      if (onEach) onEach(q, null);
    } catch (err) {
      failed += 1;
      if (onEach) onEach(q, err);
      // خطای 4xx یعنی دادهٔ ارسالی مشکل دارد — برای جلوگیری از گیرکردن دائمی، خارجش می‌کنیم
      // (در عمل تراکنش و localUuid جلوی تکرار را می‌گیرد)
      if (err && err.status && err.status >= 400 && err.status < 500) {
        await removeFromQueue(q.id);
      }
    }
  }
  emit({ type: 'syncing', syncing: false });
  return { sent, failed };
}
