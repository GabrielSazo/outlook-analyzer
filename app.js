/* outlook-analyzer / app.js — UI sin dependencias. Todo local. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    fileName: '', emails: [], result: null, authors: [],
    support: [], scoped: [], filtered: [], page: 0, perPage: 100,
    months: [], respFilter: [], topic: '', gran: 'week', chartBuckets: [], chartBound: false
  };

  function monthLabel(key) {
    var p = String(key).split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleString('es', { month: 'short', year: 'numeric' });
  }

  function fmtDate(d) {
    if (!d) return '—';
    d = d instanceof Date ? d : new Date(d);
    return d.toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDur(min) {
    if (min == null) return '—';
    if (min < 1) return '< 1 min';
    if (min < 60) return (Math.round(min * 10) / 10) + ' min';
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h < 48) return h + ' h ' + m + ' min';
    return Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- carga ----------
  var drop = $('dropZone'), input = $('fileInput');
  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  ['dragover', 'dragenter'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.borderColor = '#22c55e'; });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.style.borderColor = ''; });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer.files.length) loadFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });
  input.addEventListener('change', function () {
    if (input.files.length) loadFiles(Array.prototype.slice.call(input.files));
    input.value = '';
  });
  $('btnReset').addEventListener('click', function () {
    $('dashboard').hidden = true; drop.style.display = ''; $('btnReset').hidden = true;
    state.emails = []; state.result = null;
  });

  function loadFiles(files) {
    files = files.filter(function (f) { return /\.eml$/i.test(f.name) || f.type === 'message/rfc822'; });
    if (!files.length) { alert('Elige archivos .eml.'); return; }
    $('loadProgress').hidden = false;
    var reads = files.map(function (f) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve({ name: f.name, text: r.result }); };
        r.onerror = reject;
        r.readAsText(f, 'utf-8');
      });
    });
    Promise.all(reads).then(function (docs) {
      try {
        state.emails = [];
        var bad = 0;
        docs.forEach(function (d) {
          try {
            var m = MailParser.parseEML(d.text, d.name);
            if (!m.date) { bad++; return; }
            state.emails.push(m);
          } catch (e) { bad++; }
        });
        if (!state.emails.length) throw new Error('No se reconoció ningún correo válido.');
        afterLoad(docs.length + ' archivos' + (bad ? ' (' + bad + ' omitidos)' : ''));
      } catch (err) {
        $('loadProgress').hidden = true;
        alert('Error: ' + err.message);
      }
    }, function () {
      $('loadProgress').hidden = true;
      alert('No se pudieron leer los archivos.');
    });
  }

  function afterLoad(title) {
    state.emails.sort(function (a, b) { return a.date - b.date; });
    state.months = []; state.respFilter = []; state.topic = '';
    var sugg = MailParser.suggestSupport(state.emails, 8).map(function (s) { return s.name; });
    state.support = sugg;
    var seen = {};
    state.authors = [];
    state.emails.forEach(function (e) {
      var k = (e.from.email || e.from.name || '').toLowerCase();
      if (k && !seen[k]) { seen[k] = 1; state.authors.push(e.from.name); }
    });
    state.authors.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    $('loadProgress').hidden = true;
    drop.style.display = 'none';
    $('dashboard').hidden = false;
    $('btnReset').hidden = false;
    $('fileName').textContent = title;
    $('fileMeta').textContent = state.emails.length.toLocaleString('es-GT') + ' correos · ' +
      fmtDate(state.emails[0].date) + ' → ' + fmtDate(state.emails[state.emails.length - 1].date);
    buildRoster();
    recompute();
  }

  // ---------- ejemplo ----------
  $('btnDemo').addEventListener('click', function () {
    var demo = [
      ['demo1.eml', 'From: Juan Pérez <juan@cliente.com>\nTo: soporte@empresa.com\nSubject: Activación MTA no sincroniza\nDate: Mon, 05 Oct 2026 09:02:00 -0600\nMessage-ID: <d1@x>\nContent-Type: text/plain; charset=utf-8\n\nBuen día, el MTA 15159299 no sincroniza.'],
      ['demo2.eml', 'From: Soporte <soporte@empresa.com>\nTo: juan@cliente.com\nSubject: Re: Activación MTA no sincroniza\nDate: Mon, 05 Oct 2026 09:20:00 -0600\nMessage-ID: <d2@x>\nIn-Reply-To: <d1@x>\nContent-Type: text/plain; charset=utf-8\n\nListo Juan, ya quedó.'],
      ['demo3.eml', 'From: María López <maria@cliente.com>\nTo: soporte@empresa.com\nSubject: Código BBI da inválido\nDate: Tue, 06 Oct 2026 08:00:00 -0600\nMessage-ID: <d3@x>\nContent-Type: text/plain; charset=utf-8\n\nEl código BBI 15165263 da inválido.'],
      ['demo4.eml', 'From: Soporte <soporte@empresa.com>\nTo: maria@cliente.com\nSubject: Re: Código BBI da inválido\nDate: Tue, 06 Oct 2026 08:06:00 -0600\nMessage-ID: <d4@x>\nIn-Reply-To: <d3@x>\nContent-Type: text/plain; charset=utf-8\n\nListo, actualizado: 54758114.'],
      ['demo5.eml', 'From: Pedro Gómez <pedro@cliente.com>\nTo: soporte@empresa.com\nSubject: Cambio de equipo Kaon\nDate: Wed, 07 Oct 2026 10:00:00 -0600\nMessage-ID: <d5@x>\nContent-Type: text/plain; charset=utf-8\n\nSolicito cambio de equipo Kaon serie 8971.']
    ];
    state.emails = demo.map(function (d) { return MailParser.parseEML(d[1], d[0]); });
    state.fileName = 'ejemplo';
    afterLoad('ejemplo (datos de prueba)');
    state.support = ['Soporte'];
    buildRoster();
    recompute();
  });

  // ---------- roster ----------
  function buildRoster() {
    var box = $('rosterList'); box.innerHTML = '';
    state.authors.forEach(function (a) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = a;
      cb.checked = state.support.indexOf(a) !== -1;
      cb.addEventListener('change', function () {
        if (cb.checked) state.support.push(a);
        else state.support = state.support.filter(function (x) { return x !== a; });
        $('rosterCount').textContent = state.support.length;
        recompute();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(a));
      box.appendChild(lab);
    });
    $('rosterCount').textContent = state.support.length;
  }
  $('btnRoster').addEventListener('click', function () {
    var p = $('rosterPanel'); p.hidden = !p.hidden;
  });

  // ---------- cómputo ----------
  $('optWindow').addEventListener('change', recompute);
  $('optSupportOnly').addEventListener('change', recompute);
  $('optGran').addEventListener('change', function () { state.gran = this.value; renderChart(); });

  // ---------- desplegables múltiples (mes / respondedor) ----------
  function togglePanel(btn, panel) {
    var open = panel.hidden;
    document.querySelectorAll('.dd-panel').forEach(function (p) { p.hidden = true; });
    panel.hidden = !open;
  }
  $('btnMonth').addEventListener('click', function (e) { e.stopPropagation(); togglePanel(this, $('monthPanel')); });
  $('btnResp').addEventListener('click', function (e) { e.stopPropagation(); togglePanel(this, $('respPanel')); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.dd')) {
      document.querySelectorAll('.dd-panel').forEach(function (p) { p.hidden = true; });
    }
  });

  function addMultiRow(box, value, label, checked, all, onChange) {
    var lab = document.createElement('label');
    if (all) lab.className = 'all';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = value; cb.checked = checked;
    cb.addEventListener('change', function () { onChange(cb.checked); });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(label));
    box.appendChild(lab);
  }

  function monthKeys() {
    var seen = {}, keys = [];
    state.result.conversations.forEach(function (c) {
      var k = MailParser.monthKey(c.requestedAt);
      if (!seen[k]) { seen[k] = 1; keys.push(k); }
    });
    return keys.sort();
  }

  function syncMonthPanel() {
    var box = $('monthPanel'); box.innerHTML = '';
    var keys = monthKeys();
    state.months = state.months.filter(function (k) { return keys.indexOf(k) !== -1; });
    addMultiRow(box, '', 'Todos', state.months.length === 0, true, function () {
      state.months = [];
      syncMonthPanel(); updateMultiLabels(); renderAll();
    });
    keys.forEach(function (k) {
      addMultiRow(box, k, monthLabel(k), state.months.indexOf(k) !== -1, false, function (on) {
        if (on) { if (state.months.indexOf(k) === -1) state.months.push(k); }
        else state.months = state.months.filter(function (x) { return x !== k; });
        syncMonthPanel(); updateMultiLabels(); renderAll();
      });
    });
  }

  function syncRespPanel() {
    var box = $('respPanel'); box.innerHTML = '';
    state.respFilter = state.respFilter.filter(function (n) { return state.support.indexOf(n) !== -1; });
    var names = state.support.slice().sort(function (a, b) { return a.localeCompare(b, 'es'); });
    addMultiRow(box, '', 'Todos', state.respFilter.length === 0, true, function () {
      state.respFilter = [];
      syncRespPanel(); updateMultiLabels(); renderAll();
    });
    names.forEach(function (n) {
      addMultiRow(box, n, n, state.respFilter.indexOf(n) !== -1, false, function (on) {
        if (on) { if (state.respFilter.indexOf(n) === -1) state.respFilter.push(n); }
        else state.respFilter = state.respFilter.filter(function (x) { return x !== n; });
        syncRespPanel(); updateMultiLabels(); renderAll();
      });
    });
  }

  function updateMultiLabels() {
    $('btnMonth').textContent = state.months.length === 0 ? 'Mes: Todos'
      : state.months.length === 1 ? 'Mes: ' + monthLabel(state.months[0])
      : 'Mes: ' + state.months.length + ' sel.';
    $('btnResp').textContent = state.respFilter.length === 0 ? 'Responde: Todos'
      : state.respFilter.length === 1 ? 'Responde: ' + state.respFilter[0]
      : 'Responde: ' + state.respFilter.length + ' sel.';
  }

  function monthScope() {
    if (!state.months.length) return '';
    if (state.months.length === 1) return ' · ' + monthLabel(state.months[0]);
    return ' · ' + state.months.length + ' meses';
  }

  function respScope() {
    if (!state.respFilter.length) return '';
    if (state.respFilter.length === 1) return ' · responde ' + state.respFilter[0];
    return ' · responden ' + state.respFilter.length;
  }

  function recompute() {
    if (!state.emails.length) return;
    var r = MailParser.analyzeEmails(state.emails, {
      windowHours: parseInt($('optWindow').value, 10),
      supportOnly: $('optSupportOnly').checked,
      supportSet: state.support
    });
    state.result = r;
    syncMonthPanel();
    syncRespPanel();
    updateMultiLabels();
    buildTopicOptions();
    renderAll();
  }

  function buildTopicOptions() {
    var rows = MailParser.topics(state.result.conversations, 30).map(function (t) { return t.word; });
    var sel = $('fTopic'), cur = sel.value;
    sel.innerHTML = '<option value="">Todo tema</option>' + rows.map(function (w) {
      return '<option value="' + esc(w) + '"' + (w === cur ? ' selected' : '') + '>' + esc(w) + '</option>';
    }).join('');
    if (cur && rows.indexOf(cur) === -1) { sel.value = ''; state.topic = ''; }
  }

  function renderAll() {
    if (!state.result) return;
    state.topic = $('fTopic').value;
    var pool = state.result.conversations;
    if (state.respFilter.length) {
      pool = pool.filter(function (c) { return state.respFilter.indexOf(c.responder) !== -1; });
    }
    if (state.topic) {
      pool = pool.filter(function (c) { return MailParser.topicMatch(c.subject, state.topic); });
    }
    state.scoped = state.months.length
      ? pool.filter(function (c) { return state.months.indexOf(MailParser.monthKey(c.requestedAt)) !== -1; })
      : pool;
    var scope = monthScope() + respScope() + (state.topic ? ' · tema ' + state.topic : '');
    var s = MailParser.summarize(state.scoped);
    s.windowHours = parseInt($('optWindow').value, 10);
    renderKpis(s, scope);
    renderTops(MailParser.statsBy(state.scoped, 10));
    state.page = 0;
    applyFilters();
    renderChart();
    renderDist();
    renderTopics();
  }

  function renderTopics() {
    var rows = MailParser.topics(state.scoped, 15);
    var tb = $('topBody');
    tb.innerHTML = rows.map(function (r) {
      return '<tr data-w="' + esc(r.word) + '" class="' + (state.topic === r.word ? 'active' : '') + '">' +
        '<td>' + esc(r.word) + '</td><td>' + r.count.toLocaleString('es-GT') + '</td>' +
        '<td>' + r.pct + '%</td><td>' + esc(fmtDur(r.avg)) + '</td><td>' + r.pending.toLocaleString('es-GT') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">Sin datos</td></tr>';
    tb.querySelectorAll('tr[data-w]').forEach(function (tr) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () {
        var w = tr.dataset.w;
        $('fTopic').value = ($('fTopic').value === w) ? '' : w;
        renderAll();
      });
    });
  }

  function renderKpis(s, suffix) {
    var el = $('kpis');
    el.innerHTML =
      kpi(s.total.toLocaleString('es-GT'), 'conversaciones' + suffix, '', 'Hilos distintos en el período') +
      kpi(s.responded.toLocaleString('es-GT') + ' (' + s.responseRate + '%)', 'respondidas', 'good', 'Conversaciones con al menos una respuesta dentro de la ventana') +
      kpi(s.pending.toLocaleString('es-GT'), 'pendientes', s.pending ? 'bad' : '', 'Sin respuesta dentro de la ventana: requieren seguimiento') +
      kpi(s.reopened.toLocaleString('es-GT'), 'reabiertas', '', 'Volvieron a moverse después de respondidas') +
      kpi(fmtDur(s.medianMinutes), 'mediana 1ª respuesta', '', 'El 50% se respondió en este tiempo o menos') +
      kpi(fmtDur(s.p90Minutes), 'p90 1ª respuesta', 'warn', 'El 90% se respondió en este tiempo o menos') +
      kpi(fmtDur(s.avgMinutes), 'promedio 1ª respuesta', '', 'Media aritmética');
    function kpi(v, l, cls, tip) {
      return '<div class="kpi ' + (cls || '') + '" title="' + esc(tip) + '"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>';
    }
  }

  function renderTops(sb) {
    $('topReq').innerHTML = sb.requesters.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + r.count + '</td>' +
        '<td>' + esc(fmtDur(r.avg)) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="muted">Sin datos</td></tr>';
    $('topResp').innerHTML = sb.responders.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + r.count + '</td>' +
        '<td>' + esc(fmtDur(r.avg)) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="muted">Sin datos</td></tr>';
  }

  function renderChart() {
    var res = state.result;
    if (!res) return;
    var cv = $('chart'), ctx = cv.getContext('2d');
    var W = cv.width = Math.max(300, cv.parentElement.clientWidth), H = cv.height = 190;
    var padB = 24, padT = 20;
    ctx.clearRect(0, 0, W, H);
    var mails = state.emails.filter(function (m) { return m.date; });
    if (!mails.length) return;
    var buckets = state.gran === 'month'
      ? monthBuckets(mails, res.conversations)
      : weekBuckets(mails, res.conversations);
    state.chartBuckets = buckets;
    var max = 1;
    buckets.forEach(function (b) { max = Math.max(max, b.msgs); });
    ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.fillStyle = '#2563eb'; ctx.fillRect(4, 4, 10, 10);
    ctx.fillStyle = '#93a1b3'; ctx.fillText('correos', 18, 13);
    ctx.fillStyle = '#22c55e'; ctx.fillRect(100, 4, 10, 10);
    ctx.fillStyle = '#93a1b3'; ctx.fillText('conversaciones nuevas', 114, 13);
    var bw = W / buckets.length;
    buckets.forEach(function (b, i) {
      var dim = state.months.length && !b.months.some(function (k) { return state.months.indexOf(k) !== -1; });
      ctx.globalAlpha = dim ? 0.25 : 1;
      var h = (b.msgs / max) * (H - padB - padT);
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(i * bw + 1, H - padB - h, Math.max(1, bw - 2), h);
      var th = (b.ticks / max) * (H - padB - padT);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(i * bw + 1, H - padB - Math.max(2, th), Math.max(1, bw - 2), Math.max(2, th));
      ctx.globalAlpha = 1;
      if (b.showLabel && bw > 22) {
        ctx.fillStyle = '#93a1b3'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(b.label, i * bw + bw / 2, H - 8);
        ctx.textAlign = 'left';
      }
    });
    bindChartTip();
  }

  function weekBuckets(mails, convs) {
    var t0 = mails[0].date.getTime(), t1 = mails[mails.length - 1].date.getTime();
    var n = Math.min(52, Math.max(4, Math.round((t1 - t0) / (7 * 864e5)) || 4));
    var span = Math.max(1, t1 - t0);
    var out = [];
    for (var i = 0; i < n; i++) out.push({ msgs: 0, ticks: 0, months: {}, start: t0 + (span * i) / n });
    function idx(t) { return Math.min(n - 1, Math.floor(((t - t0) / span) * n)); }
    mails.forEach(function (m) {
      var b = out[idx(m.date.getTime())];
      b.msgs++;
      b.months[MailParser.monthKey(m.date)] = 1;
    });
    convs.forEach(function (c) { out[idx(new Date(c.requestedAt).getTime())].ticks++; });
    var prevMk = null;
    return out.map(function (b, i) {
      var d = new Date(b.start);
      var mk = MailParser.monthKey(d);
      var show = i === 0 || mk !== prevMk;
      prevMk = mk;
      var lab = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
      return { label: lab, full: 'Semana del ' + d.toLocaleString('es', { day: 'numeric', month: 'short' }),
        msgs: b.msgs, ticks: b.ticks, months: Object.keys(b.months), showLabel: show };
    });
  }

  function monthBuckets(mails, convs) {
    var d0 = mails[0].date, d1 = mails[mails.length - 1].date;
    var keys = [], cur = new Date(d0.getFullYear(), d0.getMonth(), 1);
    var end = new Date(d1.getFullYear(), d1.getMonth(), 1);
    while (cur <= end) {
      keys.push(MailParser.monthKey(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    var map = {};
    keys.forEach(function (k) { map[k] = { msgs: 0, ticks: 0 }; });
    mails.forEach(function (m) { map[MailParser.monthKey(m.date)].msgs++; });
    convs.forEach(function (c) { map[MailParser.monthKey(c.requestedAt)].ticks++; });
    return keys.map(function (k) {
      return { label: monthLabel(k), full: monthLabel(k), msgs: map[k].msgs,
        ticks: map[k].ticks, months: [k], showLabel: true };
    });
  }

  function bindChartTip() {
    if (state.chartBound) return;
    state.chartBound = true;
    var cv = $('chart'), tip = $('chartTip');
    cv.addEventListener('mousemove', function (e) {
      var n = state.chartBuckets.length;
      if (!n) return;
      var r = cv.getBoundingClientRect();
      var i = Math.floor(((e.clientX - r.left) / r.width) * n);
      i = Math.max(0, Math.min(n - 1, i));
      var b = state.chartBuckets[i];
      tip.innerHTML = '<b>' + esc(b.full) + '</b><br>' +
        'Correos: <b>' + b.msgs.toLocaleString('es-GT') + '</b><br>' +
        'Conversaciones nuevas: <b>' + b.ticks.toLocaleString('es-GT') + '</b>';
      var wr = cv.parentElement.getBoundingClientRect();
      var lx = e.clientX - wr.left + 14, ly = e.clientY - wr.top + 14;
      if (lx + 190 > wr.width) lx -= 200;
      tip.style.left = lx + 'px';
      tip.style.top = ly + 'px';
      tip.hidden = false;
    });
    cv.addEventListener('mouseleave', function () { tip.hidden = true; });
  }

  function renderDist() {
    var s = MailParser.summarize(state.scoped);
    var tot = s.responded || 1;
    var box = $('distRanges');
    box.innerHTML = ['0-1h', '1-8h', '8-24h', '+24h'].map(function (r) {
      var c = s.ranges[r];
      var pct = Math.round((c / tot) * 100);
      return '<div class="seg' + ($('fRange').value === r ? ' active' : '') + '" data-r="' + r + '">' +
        '<b>' + c.toLocaleString('es-GT') + '</b><span>' + MailParser.RANGE_LABELS[r] + ' · ' + pct + '%</span></div>';
    }).join('');
    box.querySelectorAll('.seg').forEach(function (el) {
      el.addEventListener('click', function () {
        var r = el.dataset.r;
        $('fRange').value = ($('fRange').value === r) ? '' : r;
        state.page = 0;
        applyFilters();
        renderDist();
      });
    });
  }

  // ---------- tabla ----------
  ['fSearch', 'fStatus', 'fRange', 'fTopic', 'fConf'].forEach(function (id) {
    var el = $(id);
    el.addEventListener('input', function () { state.page = 0; applyFilters(); });
    el.addEventListener('change', function () {
      if (id === 'fTopic') renderAll();
      else { state.page = 0; applyFilters(); }
    });
  });
  $('pgPrev').addEventListener('click', function () { if (state.page > 0) { state.page--; renderTable(); } });
  $('pgNext').addEventListener('click', function () {
    if ((state.page + 1) * state.perPage < state.filtered.length) { state.page++; renderTable(); }
  });

  function applyFilters() {
    var q = $('fSearch').value.trim().toLowerCase();
    var st = $('fStatus').value, cf = $('fConf').value, rg = $('fRange').value;
    var base = state.scoped;
    state.filtered = base.filter(function (c) {
      if (st === 'reabierto' ? !c.reopened : (st && c.status !== st)) return false;
      if (rg && MailParser.rangeOf(c.minutesToResponse) !== rg) return false;
      if (cf && c.confidence !== cf && c.status !== 'pendiente') return false;
      if (q && (c.subject + ' ' + c.requester + ' ' + (c.responder || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var curRg = $('fRange').value;
    document.querySelectorAll('#distRanges .seg').forEach(function (el) {
      el.classList.toggle('active', el.dataset.r === curRg);
    });
    renderTable();
  }

  function renderTable() {
    var tb = $('tblBody');
    var start = state.page * state.perPage;
    var rows = state.filtered.slice(start, start + state.perPage);
    $('tblCount').textContent = '· ' + state.filtered.length.toLocaleString('es-GT') + ' de ' +
      state.scoped.length.toLocaleString('es-GT');
    $('pgInfo').textContent = state.filtered.length
      ? ('Página ' + (state.page + 1) + ' de ' + Math.ceil(state.filtered.length / state.perPage))
      : 'Sin resultados';
    $('pgPrev').disabled = state.page === 0;
    $('pgNext').disabled = (state.page + 1) * state.perPage >= state.filtered.length;
    tb.innerHTML = rows.map(function (c, i) {
      var idx = state.result.conversations.indexOf(c);
      return '<tr><td><strong>' + esc(c.subject.length > 60 ? c.subject.slice(0, 60) + '…' : c.subject) + '</strong></td>' +
        '<td>' + esc(c.requester) + '</td>' +
        '<td>' + esc(fmtDate(c.requestedAt)) + '</td><td>' + esc(c.responder || '—') + '</td>' +
        '<td>' + esc(fmtDur(c.minutesToResponse)) + '</td>' +
        '<td><span class="pill ' + (c.status === 'respondido' ? 'ok' : 'pend') + '">' + c.status + '</span>' +
        (c.reopened ? '<span class="pill warn" title="Volvió a moverse después de respondida">reabierta</span>' : '') + '</td>' +
        '<td class="conf">' + esc(c.confidence || '—') + '</td>' +
        '<td><button class="btn ghost" data-i="' + idx + '">Ver</button></td></tr>';
    }).join('');
    tb.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { showDetail(state.result.conversations[+b.dataset.i]); });
    });
  }

  // ---------- detalle ----------
  function showDetail(c) {
    $('dTitle').textContent = c.subject.slice(0, 80) + ' · ' + c.status;
    $('dBody').innerHTML =
      '<p><strong>Solicita:</strong> ' + esc(c.requester) + ' &lt;' + esc(c.requesterEmail || '') + '&gt; · ' + esc(fmtDate(c.requestedAt)) + '</p>' +
      '<p><strong>Solicitud:</strong></p><div class="tl-item"><div class="txt">' + esc(c.requestText) + '</div></div>' +
      (c.responder
        ? '<p><strong>Primera respuesta:</strong> ' + esc(c.responder) + ' · ' + esc(fmtDate(c.respondedAt)) +
          ' · <strong>' + esc(fmtDur(c.minutesToResponse)) + '</strong> después (confianza ' + esc(c.confidence) + ')</p>' +
          '<div class="tl-item"><div class="txt">' + esc(c.responseText || '') + '</div></div>'
        : '<p><strong>Sin respuesta</strong> dentro de la ventana de ' + esc($('optWindow').value) + ' h.</p>') +
      (c.reopened
        ? '<p><strong>↩ Reabierta:</strong> ' + esc(c.reopenedBy) + ' · ' + esc(fmtDate(c.reopenedAt)) +
          (c.reopenCount > 1 ? ' · ' + c.reopenCount + ' mensajes posteriores' : '') + '</p>' +
          '<div class="tl-item"><div class="txt">' + esc(c.reopenedText || '') + '</div></div>'
        : '') +
      '<h3>Hilo (' + c.thread.length + ' correos)</h3><div class="tl">' +
      c.thread.map(function (m) {
        return '<div class="tl-item"><div class="who">' + esc(m.from) + '</div><div class="when">' +
          esc(fmtDate(m.date)) + '</div><div class="txt">' + esc(m.body.slice(0, 600)) + '</div></div>';
      }).join('') + '</div>';
    $('drawer').hidden = false;
  }
  $('drawerClose').addEventListener('click', function () { $('drawer').hidden = true; });
  $('drawer').addEventListener('click', function (e) { if (e.target === $('drawer')) $('drawer').hidden = true; });

  // ---------- export ----------
  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvCell(v) {
    v = v == null ? '' : String(v);
    return '"' + v.replace(/"/g, '""') + '"';
  }
  $('btnCsv').addEventListener('click', function () {
    if (!state.result) return;
    var head = 'asunto,solicitante,email_solicitante,fecha_solicitud,respondedor,fecha_respuesta,minutos_respuesta,estado,confianza,mensajes\n';
    var body = state.filtered.map(function (c) {
      return [c.subject, c.requester, c.requesterEmail || '', fmtDate(c.requestedAt), c.responder || '', c.respondedAt ? fmtDate(c.respondedAt) : '',
        c.minutesToResponse == null ? '' : c.minutesToResponse, c.status, c.confidence || '', c.messageCount]
        .map(csvCell).join(',');
    }).join('\n');
    var tag = (state.months.length === 1 ? '-' + state.months[0] : (state.months.length ? '-m' + state.months.length : '')) +
      (state.respFilter.length ? '-r' + state.respFilter.length : '');
    download('conversaciones-correo' + tag + '.csv', '﻿' + head + body, 'text/csv;charset=utf-8');
  });
  $('btnJson').addEventListener('click', function () {
    if (!state.result) return;
    var tag = (state.months.length === 1 ? '-' + state.months[0] : (state.months.length ? '-m' + state.months.length : '')) +
      (state.respFilter.length ? '-r' + state.respFilter.length : '');
    download('conversaciones-correo' + tag + '.json', JSON.stringify({ archivo: state.fileName, meses: state.months.length ? state.months.join(',') : 'todos', responde: state.respFilter.length ? state.respFilter.join(', ') : 'todos', stats: MailParser.summarize(state.filtered), conversations: state.filtered }, null, 1), 'application/json');
  });
})();
