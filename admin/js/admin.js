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
})();
