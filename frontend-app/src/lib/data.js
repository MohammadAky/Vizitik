import { useEffect, useState, useCallback } from 'react';
import { apiSilent } from './api.js';
import { store, kv } from './db.js';

// بارگذاری دادهٔ مرجع از API به IndexedDB (آینهٔ محلی برای آفلاین)
export async function pullMasterData() {
  const [customers, invResp] = await Promise.all([
    apiSilent('/customers'),
    apiSilent('/van-inventory')
  ]);
  const inventory = invResp && Array.isArray(invResp.items) ? invResp.items : [];
  if (customers) await store.save('customers', customers);
  if (invResp) await store.save('vanInventory', inventory);
  await kv.set('lastSync', new Date().toLocaleString('fa-IR')).catch(() => {});
  return { customers: customers || [], inventory };
}

export function useLocalData() {
  const [customers, setCustomers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lastSync, setLastSync] = useState('');
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(netOnline());

  const reload = useCallback(async (opts = {}) => {
    // اول از کش محلی (فوری)، بعد اگر آنلاین بود از سرور
    const [c, inv, ls] = await Promise.all([
      store.load('customers').catch(() => []),
      store.load('vanInventory').catch(() => []),
      kv.get('lastSync').catch(() => '')
    ]);
    setCustomers(c);
    setInventory(inv);
    setLastSync(ls || '');
    setLoading(false);
    if (opts.sync !== false && netOnline()) {
      const r = await pullMasterData().catch(() => null);
      if (r) {
        setCustomers(r.customers);
        setInventory(r.inventory);
      }
      const syncLs = await kv.get('lastSync').catch(() => '');
      if (syncLs) setLastSync(syncLs);
    }
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    reload();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [reload]);

  return { customers, inventory, lastSync, loading, online, reload, setCustomers, setInventory };
}

function netOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
