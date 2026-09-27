/**
 * Vizitik Admin Panel - Advanced Client Logic
 * Features: SQL Editor, Dashboard, Products, Orders, Customers, Settings
 */
(function () {
  'use strict';

  // ============================================================ Constants
  const TOKEN_KEY = 'vizitik-admin-token';
  const SETTINGS_KEY = 'vizitik-admin-settings';
  const $ = (id) => document.getElementById(id);

  // sessionStorage/localStorage can throw (private mode, sandboxed preview
  // iframes). The panel has to keep working anyway.
  const store = {
    get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* ignore */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
    getSaved(key) { try { return localStorage.getItem(key); } catch { return null; } },
    setSaved(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    removeSaved(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
  };

  // ============================================================ State
  let token = '';
  let currentTab = 'dashboard';
  let editingProductId = null;
  let currentOrderId = null;
   let orderCustomerId = '';
  let queryHistory = [];
  let queryBookmarks = [];
  let tablesData = [];
  let productsData = [];
  let ordersData = [];
  let customersData = [];
  let usersData = [];
  let productsFiltered = [];
  let customersFiltered = [];
  let lastQuerySql = '';
  let lastQueryType = '';
  let ordersLimit = 0;
  let ordersExhausted = false;
  let listShown = { products: 0, customers: 0 };
  let userProductContext = null;

  // Default settings
  let settings = {
    confirmWrite: true,
    showSchema: true,
    darkMode: false,
    compactMode: false,
    pageSize: 50,
    exportFormat: 'csv',
    exportHeaders: true
  };

  // ============================================================ Utility Functions

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(n) {
    if (n === null || n === undefined) return '-';
    return Number(n).toLocaleString('fa-IR');
  }

  function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('fa-IR');
  }

  function showToast(message, type = 'success', duration = 3000) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span class="toast-message">${esc(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function showStatus(elementId, message, isError = false) {
    const el = $(elementId);
    if (!el) return;
    el.className = 'status' + (isError ? ' error' : '');
    el.textContent = message || '';
  }

  // ============================================================ API

  function api(path, opts = {}) {
    opts.headers = Object.assign({ 'X-Admin-Token': token }, opts.headers || {});
    if (opts.body && typeof opts.body === 'string') {
      opts.headers['Content-Type'] = 'application/json';
    }
    return fetch(path, opts).then(res => {
      return res.json().catch(() => ({})).then(data => {
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      });
    });
  }

  // ============================================================ Authentication

  function showPanel() {
    $('gate').hidden = true;
    $('panel').hidden = false;
    loadInitialData();
  }

  function loadInitialData() {
    loadTables();
    loadDashboard();
    loadBookmarks();
    loadSettings();
  }

  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('gate-token').value.trim();
    const errEl = $('gate-error');
    errEl.hidden = true;
    api('/api/tables')
      .then(() => {
        store.set(TOKEN_KEY, token);
        showPanel();
        showToast('با موفقیت وارد شدید');
      })
      .catch(err => {
        errEl.textContent = 'ورود ناموفق: ' + err.message;
        errEl.hidden = false;
      });
  });

  $('logout').addEventListener('click', () => {
    store.remove(TOKEN_KEY);
    token = '';
    $('panel').hidden = true;
    $('gate').hidden = false;
    $('gate-token').value = '';
    $('gate-token').focus();
    showToast('از پنل خارج شدید', 'info');
  });

  // Auto-login
  const saved = store.get(TOKEN_KEY);
  if (saved) {
    token = saved;
    api('/api/tables').then(showPanel).catch(() => {
      store.remove(TOKEN_KEY);
      $('gate-token').focus();
    });
  } else {
    $('gate-token').focus();
  }

  // ============================================================ Sidebar Toggle

  $('sidebar-toggle').addEventListener('click', () => {
    $('sidebar').classList.toggle('collapsed');
  });

  // ============================================================ Navigation

  const views = {
    dashboard: $('view-dashboard'),
    sql: $('view-sql'),
    products: $('view-products'),
    orders: $('view-orders'),
    customers: $('view-customers'),
    settings: $('view-settings')
  };

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute('data-tab');
      currentTab = name;
      Object.keys(views).forEach(k => views[k].hidden = k !== name);

      // Load data for the tab
      if (name === 'dashboard') loadDashboard();
      if (name === 'products') loadProducts();
      if (name === 'orders') loadOrders();
      if (name === 'customers') loadCustomers();
    });
  });

  // ============================================================ Tables Sidebar

  function loadTables() {
    const list = $('table-list');
    list.innerHTML = '<li class="loading">در حال دریافت...</li>';

    api('/api/tables')
      .then(data => {
        tablesData = data.tables;
        renderTablesList();
        renderTablePick();
        $('user-info').textContent = `${formatNumber(tablesData.length)} جدول متصل`;
      })
      .catch(err => {
        list.innerHTML = `<li class="error">خطا: ${esc(err.message)}</li>`;
      });
  }

  function renderTablesList() {
    const list = $('table-list');
    list.innerHTML = '';

    tablesData.forEach(t => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.name;
      b.title = `کلیک برای انتخاب ${t.name}`;
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = t.rows === null ? '—' : formatNumber(t.rows);
      b.appendChild(c);
      b.addEventListener('click', () => selectTable(t.name));
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function renderTablePick() {
    const pick = $('table-pick');
    pick.innerHTML = '<option value="">انتخاب جدول...</option>';
    tablesData.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} (${t.rows === null ? '-' : formatNumber(t.rows)})`;
      pick.appendChild(opt);
    });
  }

  function selectTable(tableName) {
    // Highlight in sidebar
    document.querySelectorAll('.table-list button').forEach(b => {
      b.classList.toggle('active', b.textContent.includes(tableName));
    });

    // Insert into editor
    const editor = $('sql-editor');
    editor.value = `SELECT * FROM \`${tableName}\` ORDER BY 1 DESC`;
    editor.focus();

    // Show schema info
    if (settings.showSchema) {
      loadTableSchema(tableName);
    }

    // Switch to SQL tab if not already there
    if (currentTab !== 'sql') {
      document.querySelector('[data-tab="sql"]').click();
    }
  }

  $('table-pick').addEventListener('change', function () {
    if (this.value) selectTable(this.value);
  });

  $('refresh-tables').addEventListener('click', loadTables);

  // ============================================================ Schema Info

  function loadTableSchema(tableName) {
    api(`/api/schema/${tableName}`)
      .then(data => {
        const container = $('schema-info');
        $('schema-table-name').textContent = tableName;

        const columnsHtml = data.schema.columns.map(c => `
          <div class="schema-column">
            <span class="column-name">${esc(c.name)}</span>
            <span class="column-type">${esc(c.type)}</span>
            ${c.nullable ? '<span class="column-nullable">NULL</span>' : ''}
            ${c.key ? `<span class="column-key">${c.key}</span>` : ''}
          </div>
        `).join('');

        $('schema-columns').innerHTML = columnsHtml;
        container.hidden = false;
      })
      .catch(err => {
        console.error('Failed to load schema:', err);
      });
  }

  $('close-schema').addEventListener('click', () => {
    $('schema-info').hidden = true;
  });

  // ============================================================ Dashboard

  function loadDashboard() {
    // Load stats from tables
    api('/api/stats')
      .then(data => {
        const stats = data.stats;
        const productTable = stats.details.find(t => t.name === 'products');
        const orderTable = stats.details.find(t => t.name === 'orders');
        const customerTable = stats.details.find(t => t.name === 'customers');

        $('stat-products').textContent = productTable ? formatNumber(productTable.rows) : '-';
        $('stat-orders').textContent = orderTable ? formatNumber(orderTable.rows) : '-';
        $('stat-customers').textContent = customerTable ? formatNumber(customerTable.rows) : '-';
        $('stat-revenue').textContent = '…';
        loadRevenueStat();

        // Render table stats
        renderTableStats(stats.details);
      })
      .catch(err => {
        showToast('خطا در بارگذاری آمار: ' + err.message, 'error');
      });
  }

  function loadRevenueStat() {
    const el = $('stat-revenue');
    el.title = 'جمع مبلغ نهایی سفارش‌های لغو‌نشده';
    api('/api/query', {
      method: 'POST',
      body: JSON.stringify({
        sql: "SELECT COALESCE(SUM(finalAmount), 0) AS revenue FROM orders WHERE status <> 'CANCELLED'",
        allowWrite: false,
        silent: true
      })
    })
      .then(data => {
        const row = (data.rows && data.rows[0]) || {};
        const revenue = Number(row.revenue);
        el.textContent = Number.isFinite(revenue) ? formatNumber(Math.round(revenue)) + ' تومان' : '-';
      })
      .catch(() => { el.textContent = '-'; });
  }

  function renderTableStats(details) {
    const container = $('table-stats');
    if (!details || details.length === 0) {
      container.innerHTML = '<p class="empty">آماری موجود نیست</p>';
      return;
    }

    const maxRows = Math.max(...details.map(d => d.rows || 0));

    container.innerHTML = details.map(d => {
      const percentage = maxRows > 0 ? ((d.rows || 0) / maxRows * 100) : 0;
      return `
        <div class="table-stat-item" data-table="${esc(d.name)}">
          <span class="table-stat-name">${esc(d.name)}</span>
          <div class="table-stat-bar">
            <div class="table-stat-fill" style="width: ${percentage}%"></div>
          </div>
          <span class="table-stat-count">${d.rows === null ? '-' : formatNumber(d.rows)}</span>
        </div>
      `;
    }).join('');

    // Click to select table
    container.querySelectorAll('.table-stat-item').forEach(item => {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        selectTable(item.getAttribute('data-table'));
      });
    });
  }

  // ============================================================ SQL Editor

  // SQL Sub-tabs
  document.querySelectorAll('.sql-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sql-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute('data-sqltab');

      document.querySelectorAll('.sql-subtab').forEach(sub => sub.hidden = true);
      $(`sqltab-${name}`).hidden = false;

      if (name === 'history') loadHistory();
      if (name === 'bookmarks') loadBookmarks();
    });
  });

  // Query Templates
  const queryTemplates = {
    'select-all': (table) => `SELECT * FROM \`${table || 'TableName'}\` ORDER BY 1 DESC`,
    'select-limit': (table) => `SELECT * FROM \`${table || 'TableName'}\` LIMIT 100`,
    'select-count': (table) => `SELECT COUNT(*) as total FROM \`${table || 'TableName'}\``,
    'select-unique': (table, column) => `SELECT DISTINCT \`${column || 'column'}\` FROM \`${table || 'TableName'}\``,
    'select-join': (table) => `SELECT t1.*, t2.* FROM \`${table || 'Table1'}\` t1 JOIN \`${table || 'Table2'}\` t2 ON t1.id = t2.table1Id`,
    'select-group': (table, column) => `SELECT \`${column || 'column'}\`, COUNT(*) as count FROM \`${table || 'TableName'}\` GROUP BY \`${column || 'column'}\` ORDER BY count DESC`,
    'select-date-range': (table) => `SELECT * FROM \`${table || 'TableName'}\` WHERE createdAt BETWEEN '2024-01-01' AND '2024-12-31' ORDER BY createdAt DESC`,
    'select-search': (table, column) => `SELECT * FROM \`${table || 'TableName'}\` WHERE \`${column || 'column'}\` LIKE '%search%'`,
    'insert-template': (table) => `INSERT INTO \`${table || 'TableName'}\` (column1, column2) VALUES ('value1', 'value2')`,
    'update-template': (table) => `UPDATE \`${table || 'TableName'}\` SET column1 = 'new_value' WHERE id = 1`,
    'delete-template': (table) => `DELETE FROM \`${table || 'TableName'}\` WHERE id = 1 LIMIT 1`
  };

  $('query-template').addEventListener('change', function () {
    const template = this.value;
    if (!template) return;

    const editor = $('sql-editor');
    const currentTable = $('table-pick').value || '';

    if (queryTemplates[template]) {
      editor.value = queryTemplates[template](currentTable);
      editor.focus();
    }

    this.value = '';
  });

  // Ready-made template cards: click loads the query into the editor
  document.querySelectorAll('.template-card').forEach(card => {
    const code = card.querySelector('code');
    const load = () => {
      const sql = code ? code.textContent.trim() : '';
      if (!sql) return;
      $('sql-editor').value = sql;
      document.querySelector('[data-sqltab="editor"]').click();
      $('sql-editor').focus();
      showToast('قالب در ویرایشگر بارگذاری شد؛ «اجرای کوئری» را بزنید');
    };
    card.addEventListener('click', load);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); }
    });
  });

  // Clear editor
  $('clear-editor').addEventListener('click', () => {
    $('sql-editor').value = '';
    $('sql-editor').focus();
  });

  // Run query
  function runQuery() {
    const rawSql = $('sql-editor').value.trim();

    if (!rawSql) {
      showStatus('sql-status', 'کوئری خالی است', true);
      return;
    }

    const isWrite = /^(insert|update|delete|replace|alter|drop|truncate|create)\b/i.test(rawSql);

    // Check if write operation
    if (isWrite && settings.confirmWrite) {
      if (!confirm('⚠️ آیا مطمئن هستید که می‌خواهید این عملیات نوشتن را اجرا کنید؟\n\nاین عملیات ممکن است داده‌ها را تغییر دهد.')) {
        return;
      }
    }

    // The server caps every SELECT at 500 rows (MAX_LIMIT); «خروجی کامل» runs the
    // same query through /api/export, which is allowed up to 20,000 rows.
    const sql = rawSql;

    showStatus('sql-status', 'در حال اجرا...');
    $('run').disabled = true;

    api('/api/query', {
      method: 'POST',
      body: JSON.stringify({
        sql: sql,
        allowWrite: $('allow-write').checked
      })
    })
    .then(data => {
      lastQuerySql = rawSql;
      lastQueryType = data.type;

      if (data.type === 'SELECT' || data.type === 'SHOW' || data.type === 'DESCRIBE' || data.type === 'EXPLAIN') {
        // Read operation
        const note = data.rowCount >= 500 ? ' · سقف پیش‌نمایش ۵۰۰ ردیف است؛ برای کل داده‌ها «خروجی کامل» را بزنید' : '';
        showStatus('sql-status', `${data.rowCount} ردیف · ${data.ms} میلی‌ثانیه${note}`);
        renderResults(data);
      } else {
        // Write operation
        showStatus('sql-status', `✓ عملیات ${data.type} با موفقیت اجرا شد · ${data.affectedRows} ردیف تغییر کرد · ${data.ms} میلی‌ثانیه`);
        clearResults();
        $('empty').hidden = false;
        showToast(`عملیات ${data.type} با موفقیت اجرا شد`);
      }

      loadHistory();
    })
    .catch(err => {
      showStatus('sql-status', 'خطا: ' + err.message, true);
      clearResults();
      $('empty').hidden = false;
      loadHistory();
    })
    .finally(() => {
      $('run').disabled = false;
    });
  }

  function renderResults(data) {
    const head = $('results-head');
    const body = $('results-body');

    if (!data.columns || data.columns.length === 0) {
      clearResults();
      $('empty').hidden = false;
      return;
    }

    head.innerHTML = '<tr>' + data.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
    body.innerHTML = data.rows.map(row => {
      return '<tr>' + data.columns.map(c => {
        const v = row[c];
        return v === null || v === undefined
          ? '<td class="null">NULL</td>'
          : `<td>${esc(v)}</td>`;
      }).join('') + '</tr>';
    }).join('');

    $('results-wrap').hidden = false;
    $('results-header').hidden = false;
    $('empty').hidden = true;
    setResultButtons(true);

    $('results-count').textContent = `${data.rowCount} ردیف`;
    $('results-time').textContent = `${data.ms} میلی‌ثانیه`;

    // Store current results for export
    window.currentResults = data;
  }

  function setResultButtons(enabled) {
    ['export-csv', 'export-json', 'export-full', 'copy-results'].forEach(id => { $(id).disabled = !enabled; });
  }

  function clearResults() {
    window.currentResults = null;
    lastQuerySql = '';
    lastQueryType = '';
    $('results-wrap').hidden = true;
    $('results-head').innerHTML = '';
    $('results-body').innerHTML = '';
    $('results-count').textContent = 'هنوز کوئری‌ای اجرا نشده است';
    $('results-time').textContent = '';
    setResultButtons(false);
  }

  $('run').addEventListener('click', runQuery);
  $('sql-editor').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  });

  // Bookmark current query
  $('bookmark-current').addEventListener('click', () => {
    const sql = $('sql-editor').value.trim();
    if (!sql) {
      showToast('کوئری خالی است', 'error');
      return;
    }
    openBookmarkModal(sql);
  });

  // ============================================================ Query History
  // The server keeps the last 100 executed queries (successes *and* failures),
  // so the list survives a page reload.

  function loadHistory() {
    return api('/api/query-history?limit=50')
      .then(data => {
        queryHistory = data.history || [];
        renderHistory();
      })
      .catch(err => {
        $('history-list').innerHTML = `<p class="empty">خطا در دریافت تاریخچه: ${esc(err.message)}</p>`;
      });
  }

  function renderHistory() {
    const container = $('history-list');

    if (queryHistory.length === 0) {
      container.innerHTML = '<p class="empty">هنوز کوئری‌ای اجرا نشده است.</p>';
      return;
    }

    container.innerHTML = queryHistory.map(h => {
      const type = h.type || (h.sql || '').trim().split(/\s+/)[0].toUpperCase() || 'QUERY';
      const details = h.success
        ? `<span class="history-rows">${formatNumber(h.rowCount)} ردیف · ${h.ms}ms</span>`
        : `<span class="history-error">${esc(h.error || 'اجرا نشد')}</span>`;
      return `
      <div class="history-item ${h.success ? '' : 'failed'}">
        <div class="history-header">
          <span class="history-type ${esc(type)}">${esc(type)}</span>
          <span class="history-time">${formatDate(h.timestamp)}</span>
          ${details}
        </div>
        <pre class="history-sql">${esc(h.sql)}</pre>
        <div class="history-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-load-sql="${esc(h.sql)}">بارگذاری</button>
          <button type="button" class="btn btn-ghost btn-sm" data-copy-sql="${esc(h.sql)}">کپی</button>
        </div>
      </div>
    `;
    }).join('');

    container.querySelectorAll('[data-load-sql]').forEach(b => {
      b.addEventListener('click', () => window.loadHistoryQuery(b.getAttribute('data-load-sql')));
    });
    container.querySelectorAll('[data-copy-sql]').forEach(b => {
      b.addEventListener('click', () => window.copyToClipboard(b.getAttribute('data-copy-sql')));
    });
  }

  window.loadHistoryQuery = (sql) => {
    $('sql-editor').value = sql;
    document.querySelector('[data-sqltab="editor"]').click();
  };

  window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('کپی شد');
    }).catch(() => showToast('مرورگر اجازه‌ی کپی نداد', 'error'));
  };

  $('clear-history').addEventListener('click', () => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید تمام تاریخچه را پاک کنید؟')) return;
    api('/api/query-history', { method: 'DELETE' })
      .then(() => { queryHistory = []; renderHistory(); showToast('تاریخچه پاک شد'); })
      .catch(err => showToast(err.message, 'error'));
  });

  // ============================================================ Query Bookmarks

  function loadBookmarks() {
    return api('/api/query-bookmarks')
      .then(data => {
        queryBookmarks = data.bookmarks || [];
        renderBookmarks();
        renderBookmarkList();
      })
      .catch(err => {
        $('bookmarks-list').innerHTML = `<p class="empty">خطا در دریافت کوئری‌های ذخیره‌شده: ${esc(err.message)}</p>`;
      });
  }

  function renderBookmarks() {
    const container = $('bookmarks-list');

    if (queryBookmarks.length === 0) {
      container.innerHTML = '<p class="empty">هنوز کوئری‌ای ذخیره نشده است.</p>';
      return;
    }

    container.innerHTML = queryBookmarks.map(b => `
      <div class="bookmark-item">
        <div class="bookmark-header">
          <span class="bookmark-name">${esc(b.name)}</span>
          <span class="bookmark-time">${formatDate(b.createdAt)}</span>
        </div>
        ${b.description ? `<p class="bookmark-desc">${esc(b.description)}</p>` : ''}
        <pre class="bookmark-sql">${esc(b.sql)}</pre>
        <div class="bookmark-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-load-bookmark="${esc(b.id)}">بارگذاری</button>
          <button type="button" class="btn btn-ghost btn-sm" data-copy-sql="${esc(b.sql)}">کپی</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-bookmark="${esc(b.id)}">حذف</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-load-bookmark]').forEach(b => {
      b.addEventListener('click', () => window.loadBookmarkQuery(b.getAttribute('data-load-bookmark')));
    });
    container.querySelectorAll('[data-copy-sql]').forEach(b => {
      b.addEventListener('click', () => window.copyToClipboard(b.getAttribute('data-copy-sql')));
    });
    container.querySelectorAll('[data-del-bookmark]').forEach(b => {
      b.addEventListener('click', () => window.deleteBookmark(b.getAttribute('data-del-bookmark')));
    });
  }

  function renderBookmarkList() {
    const list = $('bookmark-list');
    list.innerHTML = '';

    if (queryBookmarks.length === 0) {
      const li = document.createElement('li');
      li.className = 'bookmark-empty';
      li.textContent = 'کوئری ذخیره‌شده‌ای ندارید';
      list.appendChild(li);
      return;
    }

    queryBookmarks.forEach(b => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.name;
      btn.title = b.description || b.name;
      btn.addEventListener('click', () => {
        $('sql-editor').value = b.sql;
        document.querySelector('[data-tab="sql"]').click();
        document.querySelector('[data-sqltab="editor"]').click();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  window.loadBookmarkQuery = (id) => {
    const bookmark = queryBookmarks.find(b => String(b.id) === String(id));
    if (bookmark) {
      $('sql-editor').value = bookmark.sql;
      document.querySelector('[data-tab="sql"]').click();
      document.querySelector('[data-sqltab="editor"]').click();
      showToast('کوئری ذخیره‌شده بارگذاری شد');
    }
  };

  window.deleteBookmark = (id) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این کوئری ذخیره‌شده را حذف کنید؟')) return;
    api(`/api/query-bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => { showToast('کوئری حذف شد'); return loadBookmarks(); })
      .catch(err => showToast(err.message, 'error'));
  };

  $('add-bookmark').addEventListener('click', () => {
    const sql = $('sql-editor').value.trim();
    if (!sql) {
      showToast('کوئری خالی است', 'error');
      return;
    }
    openBookmarkModal(sql);
  });

  function openBookmarkModal(sql) {
    $('bookmark-modal').hidden = false;
    $('bookmark-sql').value = sql;
    $('bookmark-name').value = '';
    $('bookmark-desc').value = '';
    $('bookmark-name').focus();
  }

  $('close-bookmark-modal').addEventListener('click', () => {
    $('bookmark-modal').hidden = true;
  });

  $('cancel-bookmark').addEventListener('click', () => {
    $('bookmark-modal').hidden = true;
  });

  $('bookmark-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('bookmark-name').value.trim();
    const desc = $('bookmark-desc').value.trim();
    const sql = $('bookmark-sql').value.trim();

    if (!name || !sql) {
      showToast('نام و کوئری الزامی است', 'error');
      return;
    }

    api('/api/query-bookmarks', {
      method: 'POST',
      body: JSON.stringify({ name: name, description: desc, sql: sql })
    })
      .then(() => {
        $('bookmark-modal').hidden = true;
        showToast('کوئری ذخیره شد');
        return loadBookmarks();
      })
      .catch(err => showToast('ذخیره نشد: ' + err.message, 'error'));
  });

  // ============================================================ Export
  //
  // Every section exports what is currently on screen. `columns` is a list of
  // [key, label] pairs — key for JSON, label for the CSV header row.

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function downloadFile(content, mime, filename) {
    try {
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (err) {
      // Sandboxed/embedded previews block downloads
      showToast('دانلود در این محیط ممکن نشد: ' + err.message, 'error');
      return false;
    }
  }

  function fileStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportData(columns, rows, prefix, format) {
    if (!rows || rows.length === 0) {
      showToast('داده‌ای برای خروجی گرفتن وجود ندارد', 'error');
      return;
    }
    const fmt = String(format || settings.exportFormat || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const name = `${prefix}-${fileStamp()}.${fmt}`;

    let saved = false;
    if (fmt === 'json') {
      const out = rows.map(row => {
        const obj = {};
        columns.forEach(([key]) => { obj[key] = row[key] === undefined ? null : row[key]; });
        return obj;
      });
      saved = downloadFile(JSON.stringify(out, null, 2), 'application/json', name);
    } else {
      const lines = rows.map(row => columns.map(([key]) => csvCell(row[key])).join(','));
      if (settings.exportHeaders) lines.unshift(columns.map(([, label]) => csvCell(label)).join(','));
      // BOM so Excel opens the Persian text correctly
      saved = downloadFile('\uFEFF' + lines.join('\r\n'), 'text/csv', name);
    }

    if (saved) showToast(`${formatNumber(rows.length)} ردیف با فرمت ${fmt.toUpperCase()} ذخیره شد`);
  }

  function exportResults(format) {
    if (!window.currentResults) {
      showToast('ابتدا یک کوئری اجرا کنید', 'error');
      return;
    }
    const data = window.currentResults;
    exportData(data.columns.map(c => [c, c]), data.rows, 'query-result', format);
  }

  // Full export: re-runs the raw SQL on the server, so the automatic LIMIT 500
  // of the preview does not cut the file short.
  function exportFullResult() {
    if (!lastQuerySql || !/^(SELECT|SHOW|DESCRIBE|EXPLAIN)$/.test(lastQueryType)) {
      showToast('خروجی کامل فقط برای کوئری خواندن (SELECT) کار می‌کند', 'error');
      return;
    }
    const fmt = String(settings.exportFormat || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const btn = $('export-full');
    btn.disabled = true;
    showStatus('sql-status', 'در حال آماده‌سازی خروجی کامل...');
    api('/api/export', { method: 'POST', body: JSON.stringify({ sql: lastQuerySql, format: fmt }) })
      .then(data => {
        if (!data.data) {
          showToast('نتیجه‌ای برای خروجی وجود ندارد', 'error');
          return;
        }
        const content = fmt === 'csv' ? '\uFEFF' + data.data : data.data;
        downloadFile(content, fmt === 'csv' ? 'text/csv' : 'application/json', `query-full-${fileStamp()}.${fmt}`);
        showStatus('sql-status', `خروجی کامل آماده شد · ${formatNumber(data.rowCount)} ردیف`);
      })
      .catch(err => showStatus('sql-status', 'خطای خروجی کامل: ' + err.message, true))
      .finally(() => { btn.disabled = false; });
  }

  $('export-csv').addEventListener('click', () => exportResults('csv'));
  $('export-json').addEventListener('click', () => exportResults('json'));
  $('export-full').addEventListener('click', exportFullResult);

  $('copy-results').addEventListener('click', () => {
    if (!window.currentResults) {
      showToast('ابتدا یک کوئری اجرا کنید', 'error');
      return;
    }

    const text = window.currentResults.rows.map(row => {
      return window.currentResults.columns.map(c => row[c]).join('\t');
    }).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      showToast('نتایج کپی شد');
    }).catch(() => showToast('مرورگر اجازه‌ی کپی نداد', 'error'));
  });

  // Topbar export button: exports whatever section is open
  $('export-view').addEventListener('click', () => {
    if (currentTab === 'sql') {
      if (window.currentResults) exportResults(settings.exportFormat);
      else showToast('اول یک کوئری اجرا کنید تا خروجی داشته باشد', 'info');
    } else if (currentTab === 'products') {
      exportProducts();
    } else if (currentTab === 'orders') {
      exportOrders();
    } else if (currentTab === 'customers') {
      exportCustomers();
    } else if (currentTab === 'dashboard') {
      exportData([['name', 'جدول'], ['rows', 'تعداد ردیف']], tablesData, 'table-stats', settings.exportFormat);
    } else {
      showToast('این بخش داده‌ای برای خروجی ندارد', 'info');
    }
  });

  // ============================================================ Products

  function loadProducts() {
    const body = $('products-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';
    listShown.products = settings.pageSize;

    return api('/api/products')
      .then(data => {
        productsData = data.products;
        renderProductFilters();
        renderProducts(getActiveProductFilters());
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
        showStatus('products-status', 'خطا: ' + err.message, true);
      });
  }

  function renderProducts(filter = {}) {
    const body = $('products-body');
    let filtered = [...productsData];

    // Apply filters
    if (filter.search) {
      const q = filter.search.toLowerCase();
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
      );
    }
    if (filter.brand) {
      filtered = filtered.filter(p => p.brand === filter.brand);
    }
    if (filter.category) {
      filtered = filtered.filter(p => p.category === filter.category);
    }

    productsFiltered = filtered;

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty">محصولی یافت نشد.</td></tr>';
      showStatus('products-status', productsData.length
        ? `هیچ محصولی با این فیلتر پیدا نشد (از ${formatNumber(productsData.length)} محصول)`
        : 'هنوز محصولی ثبت نشده است');
      return;
    }

    const shown = Math.max(settings.pageSize, listShown.products || settings.pageSize);
    const visible = filtered.slice(0, shown);

    body.innerHTML = visible.map(p => {
      const price = p.baseUnitPrice === null ? '-' : formatNumber(p.baseUnitPrice);
      return `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${esc(p.brand || '-')}</td>
          <td>${esc(p.category || '-')}</td>
          <td dir="ltr">${price} تومان</td>
          <td dir="ltr">${p.unitsPerCartonDefault}</td>
          <td dir="ltr">${p.orderItemsCount}</td>
          <td dir="ltr"><button type="button" class="btn btn-ghost btn-sm" data-prices="${esc(p.id)}" title="قیمت اختصاصی این محصول برای ویزیتورها">${formatNumber(p.userSettingsCount)} ⚙️</button></td>
          <td class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">ویرایش</button>
            <button type="button" class="btn btn-danger btn-sm" data-del="${esc(p.id)}" data-name="${esc(p.name)}">حذف</button>
          </td>
        </tr>
      `;
    }).join('');

    if (filtered.length > visible.length) {
      const tr = document.createElement('tr');
      tr.className = 'list-more-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = `نمایش موردهای بیشتر (${formatNumber(visible.length)} از ${formatNumber(filtered.length)})`;
      btn.addEventListener('click', () => {
        listShown.products = visible.length + settings.pageSize;
        renderProducts(getActiveProductFilters());
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    }

    // Bind action buttons
    body.querySelectorAll('[data-edit]').forEach(b => {
      b.addEventListener('click', () => startEditProduct(b.getAttribute('data-edit')));
    });
    body.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-del');
        const name = b.getAttribute('data-name');
        if (confirm(`محصول «${name}» حذف شود؟`)) {
          deleteProduct(id);
        }
      });
    });
    body.querySelectorAll('[data-prices]').forEach(b => {
      b.addEventListener('click', () => openUserProductModal(b.getAttribute('data-prices')));
    });

    const total = productsData.length;
    const statusText = filtered.length === total
      ? `${formatNumber(total)} محصول` + (visible.length < total ? ` · نمایش ${formatNumber(visible.length)} مورد` : '')
      : `${formatNumber(filtered.length)} نتیجه از ${formatNumber(total)} محصول · نمایش ${formatNumber(visible.length)} مورد`;
    showStatus('products-status', statusText);
  }

  function renderProductFilters() {
    const brands = [...new Set(productsData.map(p => p.brand).filter(Boolean))];
    const categories = [...new Set(productsData.map(p => p.category).filter(Boolean))];
    const brandFilter = $('product-brand-filter');
    const catFilter = $('product-category-filter');
    const keepBrand = brandFilter.value;
    const keepCat = catFilter.value;

    brandFilter.innerHTML = '<option value="">همه برندها</option>' +
      brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    catFilter.innerHTML = '<option value="">همه دسته‌ها</option>' +
      categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    brandFilter.value = brands.includes(keepBrand) ? keepBrand : '';
    catFilter.value = categories.includes(keepCat) ? keepCat : '';
  }

  function getActiveProductFilters() {
    return {
      search: $('product-search').value.trim(),
      brand: $('product-brand-filter').value,
      category: $('product-category-filter').value
    };
  }

  $('product-search').addEventListener('input', () => renderProducts(getActiveProductFilters()));
  $('product-brand-filter').addEventListener('change', () => renderProducts(getActiveProductFilters()));
  $('product-category-filter').addEventListener('change', () => renderProducts(getActiveProductFilters()));

  // ---- Export / import ----

  function productColumns() {
    return [
      ['name', 'نام محصول'],
      ['brand', 'برند'],
      ['category', 'دسته'],
      ['unitsPerCartonDefault', 'تعداد در کارتن'],
      ['baseUnitPrice', 'قیمت واحد (تومان)'],
      ['orderItemsCount', 'تعداد سفارش'],
      ['userSettingsCount', 'قیمت اختصاصی (تعداد ویزیتور)']
    ];
  }

  function exportProducts() {
    exportData(productColumns(), productsFiltered, 'products', settings.exportFormat);
  }

  $('export-products').addEventListener('click', exportProducts);

  // Header keys accepted in an imported CSV/JSON file (English or Persian)
  const IMPORT_FIELDS = {
    'name': 'name', 'نام': 'name', 'نام محصول': 'name',
    'brand': 'brand', 'برند': 'brand',
    'category': 'category', 'دسته': 'category', 'دسته بندی': 'category', 'دسته‌بندی': 'category',
    'unitspercartondefault': 'unitsPerCartonDefault', 'unitspercarton': 'unitsPerCartonDefault',
    'تعداد در کارتن': 'unitsPerCartonDefault', 'تعداد کارتن': 'unitsPerCartonDefault',
    'baseunitprice': 'baseUnitPrice', 'قیمت واحد': 'baseUnitPrice', 'قیمت واحد تومان': 'baseUnitPrice',
    'cartonprice': 'cartonPrice', 'قیمت کارتن': 'cartonPrice', 'قیمت کارتن تومان': 'cartonPrice'
  };

  function normalizeHeader(h) {
    return String(h || '')
      .replace(/[()*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseCsv(text) {
    const clean = String(text).replace(/^\uFEFF/, '');
    const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? clean.length : clean.indexOf('\n'));
    const counts = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]);
    counts.sort((a, b) => b[1] - a[1]);
    const delimiter = counts[0][1] > 1 ? counts[0][0] : ',';

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }

    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function csvRowsToProducts(rows) {
    const header = rows[0].map(normalizeHeader);
    const items = [];
    const errors = [];

    for (let i = 1; i < rows.length; i++) {
      const raw = {};
      header.forEach((h, idx) => { raw[h] = String(rows[i][idx] === undefined ? '' : rows[i][idx]).trim(); });

      const item = {};
      Object.keys(raw).forEach(k => {
        const target = IMPORT_FIELDS[k];
        const value = raw[k];
        if (!target || value === '') return;
        if (target === 'name' || target === 'brand' || target === 'category') {
          item[target] = value;
        } else {
          const n = Number(value.replace(/[,\s]/g, ''));
          if (!Number.isFinite(n)) { errors.push(`ردیف ${i + 1}: «${value}» برای ${k} عدد نیست`); return; }
          item[target] = n;
        }
      });

      if (!item.name) { errors.push(`ردیف ${i + 1}: نام محصول خالی است`); continue; }
      if (!item.unitsPerCartonDefault) { errors.push(`ردیف ${i + 1}: تعداد در کارتن مشخص نیست`); continue; }
      if (item.baseUnitPrice === undefined && item.cartonPrice === undefined) {
        errors.push(`ردیف ${i + 1}: قیمت واحد یا قیمت کارتن لازم است`);
        continue;
      }
      items.push(item);
    }

    return { items, errors };
  }

  function importProducts(file) {
    const reader = new FileReader();

    reader.onload = () => {
      const text = String(reader.result || '');
      let items = [];
      let errors = [];

      try {
        if (/\.json$/i.test(file.name)) {
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.products) ? parsed.products : null);
          if (!list || list.length === 0) throw new Error('فایل JSON باید آرایه‌ای از محصولات باشد');
          list.forEach((row, idx) => {
            const item = {};
            ['name', 'brand', 'category'].forEach(f => { if (row[f]) item[f] = String(row[f]).trim(); });
            ['unitsPerCartonDefault', 'baseUnitPrice', 'cartonPrice'].forEach(f => {
              if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
                const n = Number(row[f]);
                if (Number.isFinite(n)) item[f] = n;
              }
            });
            if (!item.name || !item.unitsPerCartonDefault) { errors.push(`مورد ${idx + 1}: نام یا تعداد در کارتن ندارد`); return; }
            items.push(item);
          });
        } else {
          const rows = parseCsv(text);
          if (rows.length < 2) throw new Error('فایل باید یک ردیف سرستون و حداقل یک ردیف داده داشته باشد');
          const parsed = csvRowsToProducts(rows);
          items = parsed.items;
          errors = parsed.errors;
        }
      } catch (err) {
        showStatus('products-status', 'خطا در خواندن فایل: ' + err.message, true);
        return;
      }

      if (items.length === 0) {
        showStatus('products-status', 'هیچ ردیف معتبری در فایل نبود' + (errors.length ? ' — ' + errors.slice(0, 3).join(' / ') : ''), true);
        return;
      }
      if (!confirm(`${formatNumber(items.length)} محصول از فایل «${file.name}» اضافه شود؟${errors.length ? `\n(${formatNumber(errors.length)} ردیف نامعتبر رد می‌شود)` : ''}`)) {
        return;
      }

      showStatus('products-status', `در حال افزودن ${formatNumber(items.length)} محصول...`);
      let ok = 0;
      const failed = [];

      const next = (i) => {
        if (i >= items.length) {
          const msg = `${formatNumber(ok)} محصول از فایل اضافه شد` +
            (failed.length ? ` · ${formatNumber(failed.length)} ناموفق` : '') +
            (errors.length ? ` · ${formatNumber(errors.length)} ردیف نامعتبر` : '');
          const detail = msg + (failed.length ? ' — ' + failed.slice(0, 3).join(' / ') : '');
          showToast(msg, failed.length ? 'info' : 'success', 6000);
          // reload first, then keep the import summary visible in the status line
          loadProducts().then(() => showStatus('products-status', detail, failed.length > 0));
          return;
        }
        api('/api/products', { method: 'POST', body: JSON.stringify(items[i]) })
          .then(() => { ok++; })
          .catch(err => failed.push(`${items[i].name}: ${err.message}`))
          .then(() => next(i + 1));
      };
      next(0);
    };

    reader.onerror = () => showStatus('products-status', 'فایل خوانده نشد', true);
    reader.readAsText(file, 'utf-8');
  }

  $('import-products').addEventListener('click', () => {
    $('import-file').value = '';
    $('import-file').click();
  });

  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importProducts(file);
  });

  // ---- Per-visitor prices (user_products) ----

  function openUserProductModal(productId) {
    const product = productsData.find(p => p.id === productId);
    if (!product) { showToast('محصول یافت نشد', 'error'); return; }

    userProductContext = productId;
    $('user-product-title').textContent = `قیمت اختصاصی: ${product.name}`;
    $('user-product-modal').hidden = false;
    $('up-carton').value = '';
    $('up-unit').value = '';
    $('up-active').value = '1';

    const ensureUsers = usersData.length
      ? Promise.resolve()
      : api('/api/users').then(d => { usersData = d.users || []; }).catch(() => {});

    ensureUsers.then(() => {
      $('up-user').innerHTML = '<option value="">انتخاب ویزیتور...</option>' +
        usersData.map(u => `<option value="${esc(u.id)}">${esc((u.firstName + ' ' + u.lastName).trim())}${u.role === 'VISITOR' ? '' : ' — ' + esc(u.role)}</option>`).join('');
    });

    refreshUserProducts();
  }

  function refreshUserProducts() {
    const container = $('user-product-list');
    container.innerHTML = '<p class="loading">در حال دریافت...</p>';

    api(`/api/user-products?productId=${encodeURIComponent(userProductContext)}`)
      .then(data => {
        const rows = data.userProducts || [];
        $('user-product-hint').textContent = rows.length
          ? 'این ویزیتورها برای این محصول قیمت یا وضعیت اختصاصی دارند:'
          : 'هنوز برای این محصول قیمت اختصاصی ثبت نشده است؛ همه‌ی ویزیتورها قیمت پیش‌فرض را می‌بینند.';

        if (!rows.length) { container.innerHTML = ''; return; }

        container.innerHTML = rows.map(r => `
          <div class="user-product-item">
            <span class="up-name">${esc(r.userName || r.userId)}</span>
            <span class="up-price" dir="ltr">واحد: ${r.customUnitPrice === null ? 'پیش‌فرض' : formatNumber(r.customUnitPrice)}</span>
            <span class="up-price" dir="ltr">کارتن: ${r.customCartonPrice === null ? 'پیش‌فرض' : formatNumber(r.customCartonPrice)}</span>
            <span class="up-active ${r.isActiveForUser ? '' : 'off'}">${r.isActiveForUser ? 'فعال' : 'غیرفعال'}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-up-edit="${esc(r.userId)}">ویرایش</button>
            <button type="button" class="btn btn-danger btn-sm" data-up-del="${esc(r.userId)}">حذف</button>
          </div>
        `).join('');

        container.querySelectorAll('[data-up-edit]').forEach(b => {
          b.addEventListener('click', () => {
            const row = rows.find(r => r.userId === b.getAttribute('data-up-edit'));
            if (!row) return;
            $('up-user').value = row.userId;
            $('up-carton').value = row.customCartonPrice === null ? '' : row.customCartonPrice;
            $('up-unit').value = row.customUnitPrice === null ? '' : row.customUnitPrice;
            $('up-active').value = row.isActiveForUser ? '1' : '0';
          });
        });

        container.querySelectorAll('[data-up-del]').forEach(b => {
          b.addEventListener('click', () => {
            const userId = b.getAttribute('data-up-del');
            if (!confirm('این قیمت اختصاصی حذف شود؟')) return;
            api(`/api/user-products/${encodeURIComponent(userId)}/${encodeURIComponent(userProductContext)}`, { method: 'DELETE' })
              .then(() => { showToast('حذف شد'); refreshUserProducts(); loadProducts(); })
              .catch(err => showToast(err.message, 'error'));
          });
        });
      })
      .catch(err => { container.innerHTML = `<p class="error">خطا: ${esc(err.message)}</p>`; });
  }

  $('up-save').addEventListener('click', () => {
    const userId = $('up-user').value;
    if (!userId) { showToast('ویزیتور را انتخاب کنید', 'error'); return; }

    const carton = $('up-carton').value.trim();
    const unit = $('up-unit').value.trim();
    if (carton === '' && unit === '') {
      showToast('حداقل یکی از قیمت‌های کارتن یا واحد را وارد کنید', 'error');
      return;
    }

    const payload = {
      customCartonPrice: carton === '' ? null : Number(carton),
      customUnitPrice: unit === '' ? null : Number(unit),
      isActiveForUser: $('up-active').value === '1'
    };

    $('up-save').disabled = true;
    api(`/api/user-products/${encodeURIComponent(userId)}/${encodeURIComponent(userProductContext)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })
      .then(() => {
        showToast('قیمت اختصاصی ذخیره شد');
        $('up-carton').value = '';
        $('up-unit').value = '';
        refreshUserProducts();
        loadProducts();
      })
      .catch(err => showToast('ذخیره نشد: ' + err.message, 'error'))
      .finally(() => { $('up-save').disabled = false; });
  });

  $('close-user-product-modal').addEventListener('click', () => { $('user-product-modal').hidden = true; });
  $('up-close').addEventListener('click', () => { $('user-product-modal').hidden = true; });

  // Product Form
  $('add-product').addEventListener('click', () => {
    editingProductId = null;
    $('product-form-title').textContent = 'افزودن محصول جدید';
    resetProductForm();
    $('product-form').hidden = false;
    $('p-name').focus();
  });

  $('p-cancel').addEventListener('click', () => {
    $('product-form').hidden = true;
    editingProductId = null;
  });

  $('p-reset').addEventListener('click', resetProductForm);

  function resetProductForm() {
    ['p-name', 'p-brand', 'p-category', 'p-units', 'p-carton', 'p-unit'].forEach(id => {
      $(id).value = '';
    });
  }

  function startEditProduct(id) {
    const product = productsData.find(p => p.id === id);
    if (!product) {
      showToast('محصول یافت نشد', 'error');
      return;
    }

    editingProductId = id;
    $('product-form-title').textContent = 'ویرایش محصول';
    $('p-name').value = product.name || '';
    $('p-brand').value = product.brand || '';
    $('p-category').value = product.category || '';
    $('p-units').value = product.unitsPerCartonDefault;
    $('p-carton').value = '';
    $('p-unit').value = product.baseUnitPrice === null ? '' : Number(product.baseUnitPrice);
    $('product-form').hidden = false;
    $('p-name').focus();
  }

  $('product-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      name: $('p-name').value,
      brand: $('p-brand').value,
      category: $('p-category').value,
      unitsPerCartonDefault: $('p-units').value === '' ? undefined : Number($('p-units').value),
      cartonPrice: $('p-carton').value === '' ? undefined : Number($('p-carton').value),
      baseUnitPrice: $('p-unit').value === '' ? undefined : Number($('p-unit').value),
    };

    $('p-save').disabled = true;

    const req = editingProductId
      ? api(`/api/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(payload) })
      : api('/api/products', { method: 'POST', body: JSON.stringify(payload) });

    req.then(() => {
      showToast(editingProductId ? 'محصول به‌روزرسانی شد' : 'محصول ثبت شد');
      $('product-form').hidden = true;
      editingProductId = null;
      loadProducts();
    })
    .catch(err => {
      showToast('خطا: ' + err.message, 'error');
    })
    .finally(() => {
      $('p-save').disabled = false;
    });
  });

  function deleteProduct(id) {
    api(`/api/products/${id}`, { method: 'DELETE' })
      .then(() => {
        showToast('محصول حذف شد');
        loadProducts();
      })
      .catch(err => {
        showToast('حذف نشد: ' + err.message, 'error');
      });
  }

  // ============================================================ Orders

  function loadOrdersUsers() {
    if (usersData.length) { renderOrderVisitorFilter(); return; }
    api('/api/users')
      .then(data => { usersData = data.users || []; renderOrderVisitorFilter(); })
      .catch(() => { /* the visitor filter just stays empty */ });
  }

  function orderParams(limit) {
    const params = new URLSearchParams();
    if (orderCustomerId) params.set('customerId', orderCustomerId);
    const status = $('order-status-filter').value;
    const visitorId = $('order-visitor-filter').value;
    const dateFrom = $('order-date-from').value;
    const dateTo = $('order-date-to').value;
    if (status) params.set('status', status);
    if (visitorId) params.set('visitorId', visitorId);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    params.set('limit', String(limit));
    return params;
  }

  function loadOrders(resetLimit = true) {
    const body = $('orders-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';

    if (resetLimit || !ordersLimit) {
      ordersLimit = settings.pageSize;
      ordersExhausted = false;
    }

    loadOrdersUsers();
    showStatus('orders-status', 'در حال دریافت...');

    api(`/api/orders?${orderParams(ordersLimit).toString()}`)
      .then(data => {
        ordersData = data.orders || [];
        if (ordersData.length < ordersLimit) ordersExhausted = true;
        renderOrders();
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
        showStatus('orders-status', 'خطا: ' + err.message, true);
      });
  }

  function renderOrderVisitorFilter() {
    const select = $('order-visitor-filter');
    const selected = select.value;
    select.innerHTML = '<option value="">همه ویزیتورها</option>';
    usersData.filter(u => u.role === 'VISITOR').forEach(u => {
      select.innerHTML += `<option value="${esc(u.id)}">${esc(u.firstName + ' ' + u.lastName)}</option>`;
    });
    select.value = selected;
  }

  function renderOrders() {
    const body = $('orders-body');

    if (ordersData.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty">سفارشی یافت نشد.</td></tr>';
      showStatus('orders-status', 'سفارشی با این فیلتر پیدا نشد');
      return;
    }

    const statusLabels = {
      'DRAFT': 'پیش‌نویس',
      'CONFIRMED': 'تایید شده',
      'DELIVERED': 'تحویل شده',
      'CANCELLED': 'لغو شده'
    };

    body.innerHTML = ordersData.map(o => `
      <tr>
        <td dir="ltr">${esc(o.invoiceNumber || '-')}</td>
        <td>${esc(o.customerName)}</td>
        <td>${esc(o.visitorName)}</td>
        <td>${formatDate(o.orderDate)}</td>
        <td><span class="status-badge status-${esc(String(o.status).toLowerCase())}">${statusLabels[o.status] || esc(o.status)}</span></td>
        <td dir="ltr">${formatNumber(o.finalAmount)} تومان</td>
        <td dir="ltr">${o.itemsCount}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-view-order="${esc(o.id)}">مشاهده</button>
        </td>
      </tr>
    `).join('');

    if (!ordersExhausted) {
      const tr = document.createElement('tr');
      tr.className = 'list-more-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = `نمایش سفارش‌های بیشتر (${formatNumber(ordersData.length)} سفارش نمایش داده شده)`;
      btn.addEventListener('click', () => {
        ordersLimit += settings.pageSize;
        loadOrders(false);
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    }

    body.querySelectorAll('[data-view-order]').forEach(b => {
      b.addEventListener('click', () => viewOrderDetail(b.getAttribute('data-view-order')));
    });

    const shown = formatNumber(ordersData.length);
    showStatus('orders-status', `${shown} سفارش نمایش داده شد` + (ordersExhausted ? ' (همه)' : ' · برای دیدن بقیه «نمایش سفارش‌های بیشتر» را بزنید'));
  }

  function viewOrderDetail(orderId) {
    const order = ordersData.find(o => o.id === orderId);
    if (!order) {
      showToast('سفارش یافت نشد', 'error');
      return;
    }

    const content = $('order-detail-content');
    content.innerHTML = `
      <div class="order-detail-grid">
        <div class="order-detail-section">
          <h4>اطلاعات سفارش</h4>
          <p><strong>شماره فاکتور:</strong> ${esc(order.invoiceNumber || '-')}</p>
          <p><strong>تاریخ:</strong> ${formatDate(order.orderDate)}</p>
          <p><strong>وضعیت:</strong> ${order.status}</p>
        </div>
        <div class="order-detail-section">
          <h4>مشتری</h4>
          <p><strong>نام:</strong> ${esc(order.customerName)}</p>
          <p><strong>تلفن:</strong> ${esc(order.customerPhone || '-')}</p>
        </div>
        <div class="order-detail-section">
          <h4>ویزیتور</h4>
          <p><strong>نام:</strong> ${esc(order.visitorName)}</p>
        </div>
        <div class="order-detail-section">
          <h4>مالی</h4>
          <p><strong>جمع کل:</strong> ${formatNumber(order.subtotalAmount)} تومان</p>
          <p><strong>تخفیف:</strong> ${formatNumber(order.totalDiscountAmount)} تومان</p>
          <p><strong>نهایی:</strong> ${formatNumber(order.finalAmount)} تومان</p>
        </div>
      </div>
      <div class="order-detail-section">
        <h4>اقلام سفارش</h4>
        <table class="results" dir="rtl">
          <thead>
            <tr><th>محصول</th><th>کارتن</th><th>واحد</th><th>جمع</th></tr>
          </thead>
          <tbody>
            ${order.items.map(i => `
              <tr>
                <td>${esc(i.productName)}</td>
                <td dir="ltr">${i.cartonCount}</td>
                <td dir="ltr">${i.unitCount}</td>
                <td dir="ltr">${formatNumber(i.lineTotal)} تومان</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${order.payments.length > 0 ? `
        <div class="order-detail-section">
          <h4>پرداخت‌ها</h4>
          <table class="results" dir="rtl">
            <thead>
              <tr><th>روش</th><th>مبلغ</th><th>تاریخ</th></tr>
            </thead>
            <tbody>
              ${order.payments.map(p => `
                <tr>
                  <td>${esc(p.method)}</td>
                  <td dir="ltr">${formatNumber(p.amount)} تومان</td>
                  <td>${formatDate(p.paidAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;

    $('order-detail-modal').hidden = false;
  }

  $('close-order-modal').addEventListener('click', () => {
    $('order-detail-modal').hidden = true;
  });

  function orderColumns() {
    return [
      ['invoiceNumber', 'شماره فاکتور'],
      ['customerName', 'مشتری'],
      ['visitorName', 'ویزیتور'],
      ['orderDate', 'تاریخ'],
      ['status', 'وضعیت'],
      ['subtotalAmount', 'جمع کل (تومان)'],
      ['totalDiscountAmount', 'تخفیف (تومان)'],
      ['finalAmount', 'مبلغ نهایی (تومان)'],
      ['itemsCount', 'تعداد اقلام']
    ];
  }

  function exportOrders() {
    exportData(orderColumns(), ordersData, 'orders', settings.exportFormat);
  }

  $('export-orders').addEventListener('click', exportOrders);

  $('order-search').addEventListener('click', () => { orderCustomerId = ''; loadOrders(true); });

  // ============================================================ Customers

  function loadCustomers() {
    const body = $('customers-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';
    listShown.customers = settings.pageSize;

    const search = $('customer-search').value.trim();
    const params = search ? `?q=${encodeURIComponent(search)}` : '';

    api(`/api/customers${params}`)
      .then(data => {
        customersData = data.customers;
        renderCustomers();
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
        showStatus('customers-status', 'خطا: ' + err.message, true);
      });
  }

  function renderCustomers() {
    const body = $('customers-body');
    const debtFilter = $('customer-debt-filter').value;

    let filtered = [...customersData];
    if (debtFilter === 'debt') {
      filtered = filtered.filter(c => c.hasDebt);
    } else if (debtFilter === 'settled') {
      filtered = filtered.filter(c => !c.hasDebt);
    }

    customersFiltered = filtered;

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty">مشتری‌ای یافت نشد.</td></tr>';
      showStatus('customers-status', customersData.length
        ? `مشتری‌ای با این فیلتر پیدا نشد (از ${formatNumber(customersData.length)} مشتری)`
        : 'هنوز مشتری‌ای ثبت نشده است');
      return;
    }

    const shown = Math.max(settings.pageSize, listShown.customers || settings.pageSize);
    const visible = filtered.slice(0, shown);

    body.innerHTML = visible.map(c => {
      const last = c.lastOrderDate ? formatDate(c.lastOrderDate) : '-';
      const debt = c.hasDebt
        ? `<span class="debt-badge">${formatNumber(c.debt)} تومان</span>`
        : '<span class="settled-badge">تسویه</span>';
      return `
        <tr>
          <td>${esc(c.name)}</td>
          <td dir="ltr">${esc(c.phone || '-')}</td>
          <td>${esc(c.address || '-')}</td>
          <td>${esc(c.visitorName)}</td>
          <td>${debt}</td>
          <td dir="ltr">${c.ordersCount}</td>
          <td>${last}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-customer-orders="${esc(c.id)}">سفارشات</button>
          </td>
        </tr>
      `;
    }).join('');

    if (filtered.length > visible.length) {
      const tr = document.createElement('tr');
      tr.className = 'list-more-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = `نمایش مشتری‌های بیشتر (${formatNumber(visible.length)} از ${formatNumber(filtered.length)})`;
      btn.addEventListener('click', () => {
        listShown.customers = visible.length + settings.pageSize;
        renderCustomers();
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    }

    const total = customersData.length;
    const debtCount = filtered.filter(c => c.hasDebt).length;
    showStatus('customers-status',
      `${formatNumber(filtered.length)} مشتری` +
      (filtered.length === total ? '' : ` از ${formatNumber(total)}`) +
      ` · نمایش ${formatNumber(visible.length)} مورد` +
      (debtFilter === 'debt' ? '' : ` · ${formatNumber(debtCount)} بدهکار`));
  }

  function customerColumns() {
    return [
      ['name', 'نام'],
      ['phone', 'تلفن'],
      ['address', 'آدرس'],
      ['visitorName', 'ویزیتور'],
      ['debt', 'مانده حساب (تومان)'],
      ['hasDebt', 'بدهکار'],
      ['ordersCount', 'تعداد سفارش'],
      ['lastOrderDate', 'آخرین سفارش'],
      ['lastOrderAmount', 'مبلغ آخرین سفارش']
    ];
  }

  function exportCustomers() {
    exportData(customerColumns(), customersFiltered, 'customers', settings.exportFormat);
  }

  $('export-customers').addEventListener('click', exportCustomers);

  $('customers-body').addEventListener('click', e => {
    const button = e.target.closest('[data-customer-orders]');
    if (!button) return;
    orderCustomerId = button.dataset.customerOrders;
    $('order-visitor-filter').value = '';
    $('order-status-filter').value = '';
    $('order-date-from').value = '';
    $('order-date-to').value = '';
    document.querySelector('[data-tab="orders"]').click();
    loadOrders(true);
    showToast('سفارشات این مشتری؛ برای حذف فیلتر دکمه جستجو را بزنید', 'info');
  });

  $('customer-search-btn').addEventListener('click', loadCustomers);
  $('customer-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadCustomers();
  });
  $('customer-debt-filter').addEventListener('change', renderCustomers);


  // ============================================================ Settings

  function loadSettings() {
    const saved = store.getSaved(SETTINGS_KEY);
    if (saved) {
      try { settings = Object.assign(settings, JSON.parse(saved)); }
      catch { store.removeSaved(SETTINGS_KEY); }
    }
    applySettings();
  }

  function saveSettings() {
    store.setSaved(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applySettings() {
    $('setting-confirm-write').checked = settings.confirmWrite;
    $('setting-show-schema').checked = settings.showSchema;
    $('setting-dark-mode').checked = settings.darkMode;
    $('setting-compact-mode').checked = settings.compactMode;
    $('setting-page-size').value = settings.pageSize;
    $('setting-export-format').value = settings.exportFormat;
    $('setting-export-headers').checked = settings.exportHeaders;

    // Apply theme
    document.body.classList.toggle('dark-mode', settings.darkMode);
    document.body.classList.toggle('compact-mode', settings.compactMode);
  }

  // Settings event listeners
  $('setting-confirm-write').addEventListener('change', (e) => {
    settings.confirmWrite = e.target.checked;
    saveSettings();
  });

  $('setting-show-schema').addEventListener('change', (e) => {
    settings.showSchema = e.target.checked;
    saveSettings();
  });

  $('setting-dark-mode').addEventListener('change', (e) => {
    settings.darkMode = e.target.checked;
    saveSettings();
    applySettings();
  });

  $('setting-compact-mode').addEventListener('change', (e) => {
    settings.compactMode = e.target.checked;
    saveSettings();
    applySettings();
  });

  $('setting-page-size').addEventListener('change', (e) => {
    settings.pageSize = Math.min(500, Math.max(10, parseInt(e.target.value, 10) || 50));
    e.target.value = settings.pageSize;
    saveSettings();
    listShown = { products: settings.pageSize, customers: settings.pageSize };
    ordersLimit = settings.pageSize;
    ordersExhausted = false;
    if (currentTab === 'products') renderProducts(getActiveProductFilters());
    if (currentTab === 'orders') loadOrders(true);
    if (currentTab === 'customers') renderCustomers();
    showToast(`تعداد ردیف هر بارگذاری روی ${formatNumber(settings.pageSize)} تنظیم شد`);
  });

  $('setting-export-format').addEventListener('change', (e) => {
    settings.exportFormat = e.target.value === 'json' ? 'json' : 'csv';
    saveSettings();
    showToast(`فرمت پیش‌فرض خروجی: ${settings.exportFormat.toUpperCase()}`);
  });

  $('setting-export-headers').addEventListener('change', (e) => {
    settings.exportHeaders = e.target.checked;
    saveSettings();
  });

  $('clear-all-history').addEventListener('click', () => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید تمام تاریخچه را پاک کنید؟')) return;
    api('/api/query-history', { method: 'DELETE' })
      .then(() => { queryHistory = []; renderHistory(); showToast('تاریخچه پاک شد'); })
      .catch(err => showToast(err.message, 'error'));
  });

  $('clear-all-bookmarks').addEventListener('click', () => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید تمام کوئری‌های ذخیره‌شده را پاک کنید؟')) return;
    api('/api/query-bookmarks')
      .then(data => Promise.all((data.bookmarks || []).map(b => api(`/api/query-bookmarks/${encodeURIComponent(b.id)}`, { method: 'DELETE' }))))
      .then(() => { showToast('کوئری‌های ذخیره‌شده پاک شدند'); return loadBookmarks(); })
      .catch(err => showToast(err.message, 'error'));
  });


})();
