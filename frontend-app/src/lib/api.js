// کلاینت API — مستقیم به بک‌اند NestJS با JWT
// در دیپلوی واقعی، Nginx مسیر /api را به بک‌اند (پورت 3000) پروکسی می‌کند،
// بنابراین base خالی است (مسیر نسبی) تا بدون مشکل CORS و در هر هاست کار کند.

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const TOKEN_KEY = 'vizitik_token';
const USER_KEY = 'vizitik_user';

export const authStorage = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  setToken(t) {
    localStorage.setItem(TOKEN_KEY, t);
  },
  setUser(u) {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
};

export async function api(path, { method = 'GET', body, token = authStorage.token, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// درخواستی که اگر شبکه قطع بود بدون خطا مقدار null برمی‌گرداند
export async function apiSilent(path, opts) {
  try {
    return await api(path, opts);
  } catch {
    return null;
  }
}
