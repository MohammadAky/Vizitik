/* vizitik admin panel - client logic */
(function () {
  'use strict';

  var TOKEN_KEY = 'vizitik-admin-token';
  var $ = function (id) { return document.getElementById(id); };

  var gate = $('gate'), panel = $('panel'), token = '';

  // ------------------------------------------------------------- api

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'X-Admin-Token': token }, opts.headers || {});
    if (opts.body) opts.headers['Content-Type'] = 'application/json';
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  // ------------------------------------------------------------- gate

  function showPanel() {
    gate.hidden = true;
    panel.hidden = false;
    loadTables();
  }

  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('gate-token').value.trim();
    var errEl = $('gate-error');
    errEl.hidden = true;
    api('/api/tables')
      .then(function () {
        sessionStorage.setItem(TOKEN_KEY, token);
        showPanel();
      })
      .catch(function (err) {
        errEl.textContent = 'ورود ناموفق: ' + err.message;
        errEl.hidden = false;
      });
  });

  $('logout').addEventListener('click', function () {
    sessionStorage.removeItem(TOKEN_KEY);
    token = '';
    panel.hidden = true;
    gate.hidden = false;
    $('gate-token').value = '';
    $('gate-token').focus();
  });

  var saved = sessionStorage.getItem(TOKEN_KEY);
  if (saved) {
    token = saved;
    api('/api/tables').then(showPanel).catch(function () {
      sessionStorage.removeItem(TOKEN_KEY);
      $('gate-token').focus();
    });
  } else {
    $('gate-token').focus();
  }

  // ------------------------------------------------------------- tables

  function loadTables() {
    var list = $('table-list');
    list.innerHTML = '<li class="err">در حال دریافت…</li>';
    api('/api/tables').then(function (data) {
      list.innerHTML = '';
      var pick = $('table-pick');
      pick.innerHTML = '<option value="">جدول…</option>';
      data.tables.forEach(function (t) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = t.name;
        b.title = 'کوئری روی ' + t.name;
        var c = document.createElement('span');
        c.className = 'count';
        c.textContent = t.rows === null ? '—' : String(t.rows);
        b.appendChild(c);
        b.addEventListener('click', function () {
          list.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          $('sql').value = 'SELECT * FROM `' + t.name + '` ORDER BY 1 DESC';
          runQuery();
        });
        li.appendChild(b);
        list.appendChild(li);
        var opt = document.createElement('option');
        opt.value = t.name;
        opt.textContent = t.name;
        pick.appendChild(opt);
      });
    }).catch(function (err) {
      list.innerHTML = '<li class="err">خطا: ' + err.message + '</li>';
    });
  }

  $('refresh-tables').addEventListener('click', loadTables);
  $('table-pick').addEventListener('change', function () {
    if (this.value) $('sql').value = 'SELECT * FROM `' + this.value + '` ORDER BY 1 DESC';
  });

  // ------------------------------------------------------------- query

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function runQuery() {
    var sql = $('sql').value.trim();
    var status = $('status');
    if (!sql) { status.textContent = 'کوئری خالی است.'; status.className = 'status error'; return; }
    status.className = 'status';
    status.textContent = 'در حال اجرا…';
    $('run').disabled = true;
    api('/api/query', { method: 'POST', body: JSON.stringify({ sql: sql }) })
      .then(function (data) {
        status.className = 'status';
        status.textContent = data.rowCount + ' ردیف · ' + data.ms + ' میلی‌ثانیه · ' + data.sql;
        var head = $('results-head'), body = $('results-body');
        head.innerHTML = '<tr>' + data.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>';
        body.innerHTML = data.rows.map(function (row) {
          return '<tr>' + data.columns.map(function (c) {
            var v = row[c];
            return v === null || v === undefined
              ? '<td class="null">NULL</td>'
              : '<td>' + esc(v) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        $('results-wrap').hidden = data.rowCount === 0;
        $('empty').hidden = data.rowCount !== 0;
        if (data.rowCount === 0) status.textContent = 'هیچ ردیفی برگردانده نشد · ' + data.ms + ' میلی‌ثانیه';
      })
      .catch(function (err) {
        status.className = 'status error';
        status.textContent = 'خطا: ' + err.message;
        $('results-wrap').hidden = true;
        $('empty').hidden = false;
      })
      .then(function () { $('run').disabled = false; });
  }

  $('run').addEventListener('click', runQuery);
  $('sql').addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
  });

  // ------------------------------------------------------------- tabs

  var views = { sql: $('view-sql'), products: $('view-products'), pricing: $('view-pricing'), customers: $('view-customers') };
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var name = tab.getAttribute('data-tab');
      Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
      if (name === 'products') loadProducts();
      if (name === 'pricing') loadPricingTab();
      if (name === 'customers') loadCustomers();
    });
  });

  // ------------------------------------------------------------- products

  var editingId = null;

  function pStatus(msg, isError) {
    var s = $('p-status');
    s.className = 'status' + (isError ? ' error' : '');
    s.textContent = msg || '';
  }

  function loadProducts() {
    var body = $('products-body');
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">در حال دریافت…</td></tr>';
    api('/api/products').then(function (data) {
      if (!data.products.length) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">هنوز محصولی ثبت نشده است.</td></tr>';
        return;
      }
      body.innerHTML = data.products.map(function (p) {
        var price = p.baseUnitPrice === null || p.baseUnitPrice === undefined ? '—' : Number(p.baseUnitPrice).toLocaleString('fa-IR');
        return '<tr>' +
          '<td>' + esc(p.name) + '</td>' +
          '<td>' + esc(p.brand || '—') + '</td>' +
          '<td>' + esc(p.category || '—') + '</td>' +
          '<td>' + price + '</td>' +
          '<td>' + p.unitsPerCartonDefault + '</td>' +
          '<td>' + p.orderItemsCount + '</td>' +
          '<td>' + p.userSettingsCount + '</td>' +
          '<td class="row-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">ویرایش</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-del="' + esc(p.id) + '" data-name="' + esc(p.name) + '">حذف</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      body.querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () { startEdit(b.getAttribute('data-edit')); });
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          if (!confirm('محصول «' + b.getAttribute('data-name') + '» حذف شود؟')) return;
          api('/api/products/' + id, { method: 'DELETE' })
            .then(function () { pStatus('محصول حذف شد.'); loadProducts(); })
            .catch(function (err) { pStatus('حذف نشد: ' + err.message, true); });
        });
      });
    }).catch(function (err) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--danger)">خطا: ' + esc(err.message) + '</td></tr>';
    });
  }

  function findProduct(id) {
    return api('/api/products').then(function (d) {
      return d.products.find(function (p) { return p.id === id; });
    });
  }

  function startEdit(id) {
    findProduct(id).then(function (p) {
      if (!p) { pStatus('محصول یافت نشد.', true); return; }
      editingId = id;
      $('p-name').value = p.name || '';
      $('p-brand').value = p.brand || '';
      $('p-category').value = p.category || '';
      $('p-units').value = p.unitsPerCartonDefault;
      $('p-carton').value = '';
      $('p-unit').value = p.baseUnitPrice === null ? '' : Number(p.baseUnitPrice);
      $('product-form').hidden = false;
      $('p-name').focus();
      pStatus('در حال ویرایش: ' + p.name + ' — برای قیمت واحد جدید، قیمت کارتن را هم می‌توانید خالی بگذارید.');
    }).catch(function (err) { pStatus('خطا: ' + err.message, true); });
  }

  function resetForm() {
    editingId = null;
    $('product-form').hidden = true;
    ['p-name', 'p-brand', 'p-category', 'p-units', 'p-carton', 'p-unit'].forEach(function (id) { $(id).value = ''; });
  }

  $('add-product').addEventListener('click', function () {
    resetForm();
    $('product-form').hidden = false;
    $('p-name').focus();
  });

  $('p-cancel').addEventListener('click', resetForm);

  $('product-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = {
      name: $('p-name').value,
      brand: $('p-brand').value,
      category: $('p-category').value,
      unitsPerCartonDefault: $('p-units').value === '' ? undefined : Number($('p-units').value),
      cartonPrice: $('p-carton').value === '' ? undefined : Number($('p-carton').value),
      baseUnitPrice: $('p-unit').value === '' ? undefined : Number($('p-unit').value),
    };
    var req = editingId
      ? api('/api/products/' + editingId, { method: 'PUT', body: JSON.stringify(payload) })
      : api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    $('p-save').disabled = true;
    req.then(function () {
      pStatus(editingId ? 'محصول به‌روزرسانی شد.' : 'محصول ثبت شد و از همین لحظه برای همه‌ی ویزیتورها قابل مشاهده است.');
      resetForm();
      loadProducts();
    }).catch(function (err) {
      pStatus('خطا: ' + err.message, true);
    }).then(function () { $('p-save').disabled = false; });
  });

  // ------------------------------------------------------------- pricing

  var pricingProductId = '';

  function priceStatus(msg, isError) {
    var s = $('pricing-status');
    s.className = 'status' + (isError ? ' error' : '');
    s.textContent = msg || '';
  }

  function loadPricingTab() {
    var pick = $('pricing-product');
    Promise.all([api('/api/products'), api('/api/users')]).then(function (all) {
      var products = all[0].products;
      window.__pricingUsers = all[1].users;
      var prev = pricingProductId;
      pick.innerHTML = products.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.brand ? ' — ' + esc(p.brand) : '') + '</option>';
      }).join('');
      pricingProductId = products.some(function (p) { return p.id === prev; }) ? prev : (products[0] ? products[0].id : '');
      pick.value = pricingProductId;
      if (!pricingProductId) {
        $('pricing-body').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">اول از تب محصولات یک محصول اضافه کنید.</td></tr>';
        return;
      }
      pick.onchange = function () { pricingProductId = this.value; renderPricing(); };
      renderPricing();
    }).catch(function (err) {
      $('pricing-body').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger)">خطا: ' + esc(err.message) + '</td></tr>';
    });
  }

  function renderPricing() {
    var users = window.__pricingUsers || [];
    var body = $('pricing-body');
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">در حال دریافت…</td></tr>';
    Promise.all([
      api('/api/user-products?productId=' + encodeURIComponent(pricingProductId)),
      api('/api/products'),
    ]).then(function (all) {
      var overrides = {};
      all[0].userProducts.forEach(function (r) { overrides[r.userId] = r; });
      var product = all[1].products.find(function (p) { return p.id === pricingProductId; }) || {};
      body.innerHTML = users.filter(function (u) { return u.role === 'VISITOR'; }).map(function (u) {
        var o = overrides[u.id] || {};
        return '<tr data-user="' + esc(u.id) + '">' +
          '<td>' + esc(u.firstName + ' ' + u.lastName) + '<span class="cell-sub">' + esc(u.phone) + '</span></td>' +
          '<td><input class="cell-input" data-f="customUnitPrice" dir="ltr" type="number" min="0" step="any" placeholder="' + (product.baseUnitPrice == null ? '—' : product.baseUnitPrice) + '" value="' + (o.customUnitPrice == null ? '' : o.customUnitPrice) + '" /></td>' +
          '<td><input class="cell-input" data-f="customCartonPrice" dir="ltr" type="number" min="0" step="any" placeholder="—" value="' + (o.customCartonPrice == null ? '' : o.customCartonPrice) + '" /></td>' +
          '<td><input class="cell-input" data-f="customUnitsPerCarton" dir="ltr" type="number" min="1" step="1" placeholder="' + (product.unitsPerCartonDefault || '—') + '" value="' + (o.customUnitsPerCarton == null ? '' : o.customUnitsPerCarton) + '" /></td>' +
          '<td><input class="cell-check" data-f="isActiveForUser" type="checkbox"' + (o.isActiveForUser === false ? '' : ' checked') + ' aria-label="فعال برای این ویزیتور" /></td>' +
          '<td class="row-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" data-save="' + esc(u.id) + '">ذخیره</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-reset="' + esc(u.id) + '">حذف قید</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      body.querySelectorAll('[data-save]').forEach(function (b) {
        b.addEventListener('click', function () { saveOverride(b.getAttribute('data-save')); });
      });
      body.querySelectorAll('[data-reset]').forEach(function (b) {
        b.addEventListener('click', function () {
          var uid = b.getAttribute('data-reset');
          if (!confirm('قید اختصاصی این ویزیتور برای این محصول حذف شود؟ (برمی‌گردد به قیمت کاتالوگ)')) return;
          api('/api/user-products/' + uid + '/' + pricingProductId, { method: 'DELETE' })
            .then(function () { priceStatus('قید حذف شد؛ قیمت کاتالوگ اعمال می‌شود.'); renderPricing(); })
            .catch(function (err) { priceStatus('خطا: ' + err.message, true); });
        });
      });
    }).catch(function (err) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger)">خطا: ' + esc(err.message) + '</td></tr>';
    });
  }

  function saveOverride(userId) {
    var tr = $('pricing-body').querySelector('tr[data-user="' + userId + '"]');
    if (!tr) return;
    var payload = { isActiveForUser: tr.querySelector('[data-f="isActiveForUser"]').checked };
    ['customUnitPrice', 'customCartonPrice', 'customUnitsPerCarton'].forEach(function (f) {
      var input = tr.querySelector('[data-f="' + f + '"]');
      payload[f] = input.value === '' ? null : Number(input.value);
    });
    api('/api/user-products/' + userId + '/' + pricingProductId, { method: 'PUT', body: JSON.stringify(payload) })
      .then(function () { priceStatus('قیمت اختصاصی ذخیره شد.'); renderPricing(); })
      .catch(function (err) { priceStatus('خطا: ' + err.message, true); });
  }

  // ------------------------------------------------------------- customers

  function loadCustomers(q) {
    var body = $('customers-body');
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">در حال دریافت…</td></tr>';
    api('/api/customers' + (q ? '?q=' + encodeURIComponent(q) : ''))
      .then(function (data) {
        if (!data.customers.length) {
          body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">مشتری‌ای پیدا نشد.</td></tr>';
          return;
        }
        body.innerHTML = data.customers.map(function (c) {
          var last = c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('fa-IR') : '—';
          var debt = c.hasDebt
            ? '<span class="debt-badge">' + Number(c.debt).toLocaleString('fa-IR') + ' تومان</span>'
            : '<span class="settled-badge">تسویه</span>';
          return '<tr>' +
            '<td>' + esc(c.name) + '</td>' +
            '<td dir="ltr">' + esc(c.phone || '—') + '</td>' +
            '<td>' + esc(c.visitorName) + '</td>' +
            '<td>' + debt + '</td>' +
            '<td>' + c.ordersCount + '</td>' +
            '<td>' + last + '</td>' +
          '</tr>';
        }).join('');
      })
      .catch(function (err) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger)">خطا: ' + esc(err.message) + '</td></tr>';
      });
  }

  $('customer-search').addEventListener('click', function () {
    loadCustomers($('customer-q').value.trim());
  });
  $('customer-q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); loadCustomers(this.value.trim()); }
  });
})();
