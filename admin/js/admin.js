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

  // Default settings
  let settings = {
    autoLimit: true,
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
        sessionStorage.setItem(TOKEN_KEY, token);
        showPanel();
        showToast('با موفقیت وارد شدید');
      })
      .catch(err => {
        errEl.textContent = 'ورود ناموفق: ' + err.message;
        errEl.hidden = false;
      });
  });

  $('logout').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    token = '';
    $('panel').hidden = true;
    $('gate').hidden = false;
    $('gate-token').value = '';
    $('gate-token').focus();
    showToast('از پنل خارج شدید', 'info');
  });

  // Auto-login
  const saved = sessionStorage.getItem(TOKEN_KEY);
  if (saved) {
    token = saved;
    api('/api/tables').then(showPanel).catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
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
        $('stat-revenue').textContent = '—'; // Will calculate if needed

        // Render table stats
        renderTableStats(stats.details);
      })
      .catch(err => {
        showToast('خطا در بارگذاری آمار: ' + err.message, 'error');
      });
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

      if (name === 'history') renderHistory();
      if (name === 'bookmarks') renderBookmarks();
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

  // Clear editor
  $('clear-editor').addEventListener('click', () => {
    $('sql-editor').value = '';
    $('sql-editor').focus();
  });

  // Run query
  function runQuery() {
    const sql = $('sql-editor').value.trim();
    const statusEl = $('sql-status');

    if (!sql) {
      showStatus('sql-status', 'کوئری خالی است', true);
      return;
    }

    // Check if write operation
    const isWrite = /^insert\s|^update\s|^delete\s/i.test(sql);
    if (isWrite && settings.confirmWrite) {
      if (!confirm('⚠️ آیا مطمئن هستید که می‌خواهید این عملیات نوشتن را اجرا کنید؟\n\nاین عملیات ممکن است داده‌ها را تغییر دهد.')) {
        return;
      }
    }

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
      if (data.type === 'SELECT' || data.type === 'SHOW' || data.type === 'DESCRIBE' || data.type === 'EXPLAIN') {
        // Read operation
        showStatus('sql-status', `${data.rowCount} ردیف · ${data.ms} میلی‌ثانیه`);
        renderResults(data);
      } else {
        // Write operation
        showStatus('sql-status', `✓ عملیات ${data.type} با موفقیت اجرا شد · ${data.affectedRows} ردیف تغییر کرد · ${data.ms} میلی‌ثانیه`);
        $('results-wrap').hidden = true;
        $('results-header').hidden = true;
        $('empty').hidden = false;
        showToast(`عملیات ${data.type} با موفقیت اجرا شد`);
      }

      // Add to history
      queryHistory.unshift({
        id: Date.now(),
        sql: data.sql,
        success: true,
        rowCount: data.rowCount || data.affectedRows || 0,
        ms: data.ms,
        type: data.type,
        timestamp: new Date().toISOString()
      });
    })
    .catch(err => {
      showStatus('sql-status', 'خطا: ' + err.message, true);
      $('results-wrap').hidden = true;
      $('results-header').hidden = true;
      $('empty').hidden = false;

      // Add failed query to history
      queryHistory.unshift({
        id: Date.now(),
        sql: sql,
        success: false,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    })
    .finally(() => {
      $('run').disabled = false;
    });
  }

  function renderResults(data) {
    const head = $('results-head');
    const body = $('results-body');

    if (!data.columns || data.columns.length === 0) {
      $('results-wrap').hidden = true;
      $('results-header').hidden = true;
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

    $('results-count').textContent = `${data.rowCount} ردیف`;
    $('results-time').textContent = `${data.ms} میلی‌ثانیه`;

    // Store current results for export
    window.currentResults = data;
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

  function renderHistory() {
    const container = $('history-list');

    if (queryHistory.length === 0) {
      container.innerHTML = '<p class="empty">هنوز کوئری‌ای اجرا نشده است.</p>';
      return;
    }

    container.innerHTML = queryHistory.map(h => `
      <div class="history-item ${h.success ? '' : 'failed'}">
        <div class="history-header">
          <span class="history-type ${h.type || ''}">${h.type || 'UNKNOWN'}</span>
          <span class="history-time">${formatDate(h.timestamp)}</span>
          ${h.success ? `<span class="history-rows">${h.rowCount} ردیف · ${h.ms}ms</span>` : `<span class="history-error">${esc(h.error)}</span>`}
        </div>
        <pre class="history-sql">${esc(h.sql)}</pre>
        <div class="history-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.loadHistoryQuery('${esc(h.sql.replace(/'/g, "\\'"))}')">بارگذاری</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.copyToClipboard('${esc(h.sql.replace(/'/g, "\\'"))}')">کپی</button>
        </div>
      </div>
    `).join('');
  }

  window.loadHistoryQuery = (sql) => {
    $('sql-editor').value = sql;
    document.querySelector('[data-sqltab="editor"]').click();
  };

  window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast('کپی شد');
    });
  };

  $('clear-history').addEventListener('click', () => {
    if (confirm('آیا مطمئن هستید که می‌خواهید تمام تاریخچه را پاک کنید؟')) {
      queryHistory = [];
      renderHistory();
      showToast('تاریخچه پاک شد');
    }
  });

  // ============================================================ Query Bookmarks

  function loadBookmarks() {
    // Bookmarks are stored in memory for now
    renderBookmarks();
    renderBookmarkList();
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
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.loadBookmarkQuery('${b.id}')">بارگذاری</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.copyToClipboard('${esc(b.sql.replace(/'/g, "\\'"))}')">کپی</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="window.deleteBookmark('${b.id}')">حذف</button>
        </div>
      </div>
    `).join('');
  }

  function renderBookmarkList() {
    const list = $('bookmark-list');
    list.innerHTML = '';

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
    const bookmark = queryBookmarks.find(b => b.id === parseInt(id));
    if (bookmark) {
      $('sql-editor').value = bookmark.sql;
      document.querySelector('[data-sqltab="editor"]').click();
    }
  };

  window.deleteBookmark = (id) => {
    if (confirm('آیا مطمئن هستید که می‌خواهید این کوئری ذخیره‌شده را حذف کنید؟')) {
      queryBookmarks = queryBookmarks.filter(b => b.id !== parseInt(id));
      renderBookmarks();
      renderBookmarkList();
      showToast('کوئری حذف شد');
    }
  };

  $('add-bookmark').addEventListener('click', () => {
    const sql = $('sql-editor').value.trim();
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

    queryBookmarks.push({
      id: Date.now(),
      name: name,
      description: desc,
      sql: sql,
      createdAt: new Date().toISOString()
    });

    $('bookmark-modal').hidden = true;
    renderBookmarks();
    renderBookmarkList();
    showToast('کوئری ذخیره شد');
  });

  // ============================================================ Export

  function exportResults(format) {
    if (!window.currentResults) {
      showToast('ابتدا یک کوئری اجرا کنید', 'error');
      return;
    }

    const data = window.currentResults;
    let content, mimeType, extension;

    if (format === 'json') {
      content = JSON.stringify(data.rows, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      // CSV
      const headers = data.columns.join(',');
      const rows = data.rows.map(row => {
        return data.columns.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return '';
          const str = String(v);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        }).join(',');
      });
      content = [headers, ...rows].join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-result-${Date.now()}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);

    showToast(`فایل ${extension.toUpperCase()} دانلود شد`);
  }

  $('export-csv').addEventListener('click', () => exportResults('csv'));
  $('export-json').addEventListener('click', () => exportResults('json'));

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
    });
  });

  // ============================================================ Products

  function loadProducts() {
    const body = $('products-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';

    api('/api/products')
      .then(data => {
        productsData = data.products;
        renderProducts();
        renderProductFilters();
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
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

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty">محصولی یافت نشد.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(p => {
      const price = p.baseUnitPrice === null ? '-' : formatNumber(p.baseUnitPrice);
      return `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${esc(p.brand || '-')}</td>
          <td>${esc(p.category || '-')}</td>
          <td dir="ltr">${price} تومان</td>
          <td dir="ltr">${p.unitsPerCartonDefault}</td>
          <td dir="ltr">${p.orderItemsCount}</td>
          <td dir="ltr">${p.userSettingsCount}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-edit="${esc(p.id)}">ویرایش</button>
            <button type="button" class="btn btn-danger btn-sm" data-del="${esc(p.id)}" data-name="${esc(p.name)}">حذف</button>
          </td>
        </tr>
      `;
    }).join('');

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
  }

  function renderProductFilters() {
    const brands = [...new Set(productsData.map(p => p.brand).filter(Boolean))];
    const categories = [...new Set(productsData.map(p => p.category).filter(Boolean))];

    const brandFilter = $('product-brand-filter');
    brandFilter.innerHTML = '<option value="">همه برندها</option>';
    brands.forEach(b => {
      brandFilter.innerHTML += `<option value="${esc(b)}">${esc(b)}</option>`;
    });

    const catFilter = $('product-category-filter');
    catFilter.innerHTML = '<option value="">همه دسته‌ها</option>';
    categories.forEach(c => {
      catFilter.innerHTML += `<option value="${esc(c)}">${esc(c)}</option>`;
    });
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

  function loadOrders() {
    const body = $('orders-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';

    // Load visitors for filter
    api('/api/users').then(data => {
      usersData = data.users;
      renderOrderVisitorFilter();
    }).catch(err => showToast(err.message, 'error'));

    const filters = {
      status: $('order-status-filter').value,
      visitorId: $('order-visitor-filter').value,
      dateFrom: $('order-date-from').value,
      dateTo: $('order-date-to').value
    };

    const params = new URLSearchParams();
    if (orderCustomerId) params.set('customerId', orderCustomerId);
    if (filters.status) params.set('status', filters.status);
    if (filters.visitorId) params.set('visitorId', filters.visitorId);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);

    api(`/api/orders?${params.toString()}`)
      .then(data => {
        ordersData = data.orders;
        renderOrders();
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
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
        <td><span class="status-badge status-${o.status.toLowerCase()}">${statusLabels[o.status] || o.status}</span></td>
        <td dir="ltr">${formatNumber(o.finalAmount)} تومان</td>
        <td dir="ltr">${o.itemsCount}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-view-order="${esc(o.id)}">مشاهده</button>
        </td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-view-order]').forEach(b => {
      b.addEventListener('click', () => viewOrderDetail(b.getAttribute('data-view-order')));
    });
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

  $('order-search').addEventListener('click', () => { orderCustomerId = ''; loadOrders(); });

  // ============================================================ Customers

  function loadCustomers() {
    const body = $('customers-body');
    body.innerHTML = '<tr><td colspan="8" class="loading">در حال دریافت...</td></tr>';

    const search = $('customer-search').value.trim();
    const params = search ? `?q=${encodeURIComponent(search)}` : '';

    api(`/api/customers${params}`)
      .then(data => {
        customersData = data.customers;
        renderCustomers();
      })
      .catch(err => {
        body.innerHTML = `<tr><td colspan="8" class="error">خطا: ${esc(err.message)}</td></tr>`;
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

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty">مشتری‌ای یافت نشد.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(c => {
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
  }

  $('customers-body').addEventListener('click', e => {
    const button = e.target.closest('[data-customer-orders]');
    if (!button) return;
    orderCustomerId = button.dataset.customerOrders;
    $('order-visitor-filter').value = '';
    $('order-status-filter').value = '';
    $('order-date-from').value = '';
    $('order-date-to').value = '';
    document.querySelector('[data-tab="orders"]').click();
    showToast('سفارشات این مشتری؛ برای حذف فیلتر دکمه جستجو را بزنید', 'info');
  });

  $('customer-search-btn').addEventListener('click', loadCustomers);
  $('customer-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadCustomers();
  });
  $('customer-debt-filter').addEventListener('change', renderCustomers);

  // ============================================================ Settings

  function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try { settings = Object.assign(settings, JSON.parse(saved)); }
      catch { localStorage.removeItem(SETTINGS_KEY); }
    }
    applySettings();
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applySettings() {
    $('setting-auto-limit').checked = settings.autoLimit;
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
  $('setting-auto-limit').addEventListener('change', (e) => {
    settings.autoLimit = e.target.checked;
    saveSettings();
  });

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
    settings.pageSize = parseInt(e.target.value) || 50;
    saveSettings();
  });

  $('setting-export-format').addEventListener('change', (e) => {
    settings.exportFormat = e.target.value;
    saveSettings();
  });

  $('setting-export-headers').addEventListener('change', (e) => {
    settings.exportHeaders = e.target.checked;
    saveSettings();
  });

  $('clear-all-history').addEventListener('click', () => {
    if (confirm('آیا مطمئن هستید که می‌خواهید تمام تاریخچه را پاک کنید؟')) {
      api('/api/query-history', { method: 'DELETE' })
        .then(() => { queryHistory = []; showToast('تاریخچه پاک شد'); })
        .catch(err => showToast(err.message, 'error'));
    }
  });

  $('clear-all-bookmarks').addEventListener('click', () => {
    if (confirm('آیا مطمئن هستید که می‌خواهید تمام کوئری‌های ذخیره‌شده را پاک کنید؟')) {
      api('/api/query-bookmarks')
        .then(data => Promise.all(data.bookmarks.map(b => api(`/api/query-bookmarks/${b.id}`, { method: 'DELETE' }))))
        .then(() => { queryBookmarks = []; renderBookmarkList(); showToast('کوئری‌های ذخیره‌شده پاک شدند'); })
        .catch(err => { loadBookmarks(); showToast(err.message, 'error'); });
    }
  });

})();
