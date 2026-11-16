// Token Radar dashboard — renders window.RADAR, no network, no framework.
// The board is shown exactly in the rank order the data file carries; filtering
// only hides rows, it never re-sorts them.
(function () {
  'use strict';

  var DATA = window.RADAR || null;
  var boardBody = document.getElementById('board-body');
  var liveBody = document.getElementById('live-body');
  var detailBox = document.getElementById('detail');

  var state = {
    search: '',
    category: '',
    chain: '',
    minImpliedM: null,
    watchlistOnly: false,
    selected: null
  };

  /* ---------- formatting ---------- */

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function mult(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '×' + n.toFixed(2);
  }

  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function chainsText(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  function catLabel(c) {
    return c === null || c === undefined || c === '' ? 'Uncategorized' : c;
  }

  /* ---------- small DOM helpers (text only — data never goes through innerHTML) ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function cellNum(text, cls) {
    var td = el('td', 'num' + (cls ? ' ' + cls : ''));
    td.textContent = text;
    return td;
  }

  function factorRow(dl, label, value, isTotal) {
    var wrap = el('div');
    wrap.appendChild(el('dt', null, label));
    var dd = el('dd', isTotal ? 'total' : null, value);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }

  /* ---------- watchlist membership ---------- */

  // The board is watchlist rows (every one at or above the snapshot floor) plus
  // early rows below the floor, so TVL against the floor separates the two sets.
  // An explicit watchlist slug list wins when the data file carries one.
  function isWatchlist(row) {
    if (Array.isArray(DATA.watchlist) && DATA.watchlist.length > 0) {
      return DATA.watchlist.indexOf(row.slug) >= 0;
    }
    return typeof DATA.floor_usd === 'number' && row.tvl_usd >= DATA.floor_usd;
  }

  /* ---------- filtering ---------- */

  function visibleRows() {
    var q = state.search.trim().toLowerCase();
    var min = state.minImpliedM === null ? null : state.minImpliedM * 1e6;
    return DATA.rows.filter(function (r) {
      if (state.category && catLabel(r.category) !== state.category) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.watchlistOnly && !isWatchlist(r)) return false;
      if (min !== null && !(r.implied_value_usd >= min)) return false;
      if (q) {
        var hay = [r.name, r.slug, catLabel(r.category), (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ---------- board ---------- */

  function renderBoard() {
    var rows = visibleRows();
    boardBody.textContent = '';
    document.getElementById('board-empty').hidden = rows.length > 0;
    document.getElementById('result-count').textContent =
      rows.length + ' of ' + DATA.rows.length + ' rows';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      if (state.selected === r.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); }
      });
      tr.appendChild(cellNum(String(r.rank), 'rank'));
      var nameTd = el('td');
      nameTd.appendChild(el('span', 'cell-name', r.name));
      nameTd.appendChild(el('span', 'cell-slug', r.slug));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', 'cell-cat', catLabel(r.category)));
      tr.appendChild(el('td', 'cell-chains', chainsText(r.chains)));
      tr.appendChild(cellNum(money(r.tvl_usd)));
      var growth = cellNum(pct(r.change_7d));
      if (r.change_7d !== null && r.change_7d !== undefined) {
        growth.classList.add(r.change_7d >= 0 ? 'up' : 'down');
      }
      tr.appendChild(growth);
      tr.appendChild(cellNum(money(r.implied_value_usd), 'implied'));
      tr.appendChild(cellNum(ageText(r.age_days)));
      boardBody.appendChild(tr);
    });
  }

  /* ---------- live tokens ---------- */

  function renderLive() {
    liveBody.textContent = '';
    DATA.live.forEach(function (r) {
      var tr = document.createElement('tr');
      var nameTd = el('td');
      nameTd.appendChild(el('span', 'cell-name', r.name));
      nameTd.appendChild(el('span', 'cell-slug', r.slug));
      tr.appendChild(nameTd);
      tr.appendChild(el('td', 'cell-cat', catLabel(r.category)));
      tr.appendChild(el('td', 'cell-chains', chainsText(r.chains)));
      tr.appendChild(cellNum(money(r.tvl_usd)));
      var growth = cellNum(pct(r.change_7d));
      if (r.change_7d !== null && r.change_7d !== undefined) {
        growth.classList.add(r.change_7d >= 0 ? 'up' : 'down');
      }
      tr.appendChild(growth);
      tr.appendChild(cellNum(money(r.mcap_usd)));
      var ratio = '—';
      if (r.mcap_usd !== null && r.mcap_usd !== undefined && r.tvl_usd > 0) {
        ratio = (r.mcap_usd / r.tvl_usd).toFixed(2) + '×';
      }
      tr.appendChild(cellNum(ratio));
      liveBody.appendChild(tr);
    });
  }

  /* ---------- detail ---------- */

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) return DATA.rows[i];
    }
    return null;
  }

  function openDetail(slug) {
    var row = findRow(slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    document.getElementById('detail-kicker').textContent =
      'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatchlist(row) ? ' · watchlist' : ' · early row');
    document.getElementById('detail-title').textContent = row.name;
    document.getElementById('detail-sub').textContent =
      catLabel(row.category) + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'no chain listed') +
      ' · slug ' + row.slug;

    document.getElementById('detail-formula').textContent =
      'implied = TVL ' + money(row.tvl_usd) + ' × category ' + mult(row.category_multiple) +
      ' × growth ' + mult(row.growth_multiplier) + ' × maturity ' + mult(row.maturity_multiplier) +
      ' × chain ' + mult(row.chain_multiplier) + ' = ' + money(row.implied_value_usd);

    var factors = document.getElementById('detail-factors');
    factors.textContent = '';
    factorRow(factors, 'TVL', money(row.tvl_usd));
    factorRow(factors, 'Category multiple (' + catLabel(row.category) + ')', mult(row.category_multiple));
    factorRow(factors, 'Growth multiplier (7d ' + pct(row.change_7d) + ')', mult(row.growth_multiplier));
    factorRow(factors, 'Maturity multiplier (age ' + ageText(row.age_days) + ')', mult(row.maturity_multiplier));
    factorRow(factors, 'Chain multiplier (' + (row.chains ? row.chains.length : 0) + ' chain' + (row.chains && row.chains.length === 1 ? '' : 's') + ')', mult(row.chain_multiplier));
    factorRow(factors, 'Implied value', money(row.implied_value_usd), true);

    var check = document.getElementById('detail-check');
    check.textContent = '';
    var product = row.tvl_usd * row.category_multiple * row.growth_multiplier *
      row.maturity_multiplier * row.chain_multiplier;
    if (isFinite(product)) {
      var diff = Math.abs(product - row.implied_value_usd);
      var ok = diff <= Math.max(1, row.implied_value_usd * 0.001);
      var note = document.createElement('span');
      note.textContent = 'The factors multiply out to ' + money(Math.round(product)) +
        (ok ? ' — the same number the board carries.' : ' (rounded in the board to ' + money(row.implied_value_usd) + ').');
      if (ok) note.className = 'ok';
      check.appendChild(note);
    } else {
      check.textContent = 'One factor is missing, so the product cannot be recomputed for this row.';
    }

    var record = document.getElementById('detail-record');
    record.textContent = '';
    factorRow(record, 'Slug', row.slug);
    factorRow(record, 'Category', catLabel(row.category));
    factorRow(record, 'Chains', row.chains && row.chains.length ? row.chains.join(', ') : '—');
    factorRow(record, 'TVL', money(row.tvl_usd));
    factorRow(record, '7-day TVL change', pct(row.change_7d));
    factorRow(record, 'Market cap', money(row.mcap_usd));
    factorRow(record, 'First listed', row.listed_at || '—');
    factorRow(record, 'Age', row.age_days === null || row.age_days === undefined ? '—' : row.age_days + ' days');
    factorRow(record, 'Status', isWatchlist(row) ? 'Watchlist (TVL at or above the floor)' : 'Early row (below the floor)');

    var steps = document.getElementById('detail-steps');
    steps.textContent = '';
    var farm = Array.isArray(row.farm_steps) ? row.farm_steps : [];
    if (farm.length === 0) {
      steps.appendChild(el('li', null, 'No farm plan was supplied for this protocol.'));
    } else {
      farm.forEach(function (s) { steps.appendChild(el('li', null, s)); });
    }

    detailBox.hidden = false;
    detailBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderBoard();
  }

  function closeDetail() {
    state.selected = null;
    detailBox.hidden = true;
    writeHash();
    renderBoard();
  }

  /* ---------- hash (for screenshots and deep links) ---------- */

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('detail')) state.selected = params.get('detail');
    if (params.get('filter')) state.category = params.get('filter');
    if (params.get('live') !== null) state.scrollLive = true;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.category) params.set('filter', state.category);
    if (state.selected) params.set('detail', state.selected);
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  /* ---------- header / footer / filter controls ---------- */

  function fillStatic() {
    document.getElementById('stat-asof').textContent = DATA.as_of || '—';
    document.getElementById('stat-watchlist').textContent = String(DATA.watchlist_size);
    document.getElementById('stat-board').textContent = String(DATA.board_size);
    document.getElementById('stat-early').textContent = String(DATA.early_size);
    document.getElementById('stat-live').textContent = String(DATA.live_size);
    document.getElementById('intro-lede').innerHTML = '';
    var lede = document.getElementById('intro-lede');
    lede.appendChild(document.createTextNode('The watchlist is the floor: every protocol with at least '));
    lede.appendChild(el('strong', null, money(DATA.floor_usd)));
    lede.appendChild(document.createTextNode(' of TVL and no token on record. The early radar adds '));
    lede.appendChild(el('strong', null, String(DATA.early_size)));
    lede.appendChild(document.createTextNode(' pre-token protocols below that floor, and '));
    lede.appendChild(el('strong', null, String(DATA.live_size)));
    lede.appendChild(document.createTextNode(' live-token protocols are set aside with their market values. Implied value is a model, not a promise.'));
    document.getElementById('source-text').textContent = DATA.source || '—';
    document.getElementById('foot-meta').textContent =
      'Model ' + (DATA.model_version || '—') + ' · snapshot ' + (DATA.as_of || '—') +
      ' · floor ' + money(DATA.floor_usd) + ' · ' + DATA.board_size + ' rows ranked';
  }

  function fillDropdowns() {
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = catLabel(r.category);
      if (cats.indexOf(c) < 0) cats.push(c);
      (r.chains || []).forEach(function (ch) {
        if (chains.indexOf(ch) < 0) chains.push(ch);
      });
    });
    cats.sort();
    chains.sort();
    var catSel = document.getElementById('filter-category');
    cats.forEach(function (c) {
      var opt = el('option', null, c);
      opt.value = c;
      if (c === state.category) opt.selected = true;
      catSel.appendChild(opt);
    });
    var chainSel = document.getElementById('filter-chain');
    chains.forEach(function (ch) {
      var opt = el('option', null, ch);
      opt.value = ch;
      chainSel.appendChild(opt);
    });
  }

  function bindFilters() {
    var search = document.getElementById('filter-search');
    var catSel = document.getElementById('filter-category');
    var chainSel = document.getElementById('filter-chain');
    var minInput = document.getElementById('filter-min-implied');
    var watchBox = document.getElementById('filter-watchlist');

    search.addEventListener('input', function () { state.search = search.value; renderBoard(); });
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderBoard(); });
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; renderBoard(); });
    minInput.addEventListener('input', function () {
      var v = parseFloat(minInput.value);
      state.minImpliedM = isFinite(v) && v > 0 ? v : null;
      renderBoard();
    });
    watchBox.addEventListener('change', function () { state.watchlistOnly = watchBox.checked; renderBoard(); });
    document.getElementById('filter-clear').addEventListener('click', function () {
      state.search = ''; state.category = ''; state.chain = '';
      state.minImpliedM = null; state.watchlistOnly = false;
      search.value = ''; catSel.value = ''; chainSel.value = '';
      minInput.value = ''; watchBox.checked = false;
      writeHash(); renderBoard();
    });
    document.getElementById('detail-close').addEventListener('click', closeDetail);
  }

  /* ---------- boot ---------- */

  function boot() {
    if (!DATA || !Array.isArray(DATA.rows)) {
      document.getElementById('intro-lede').textContent =
        'No data file was found. This page reads window.RADAR from data.js loaded beside it.';
      document.getElementById('result-count').textContent = '0 rows';
      return;
    }
    readHash();
    fillStatic();
    fillDropdowns();
    bindFilters();
    renderBoard();
    renderLive();
    if (state.selected) openDetail(state.selected);
    if (state.scrollLive) {
      document.getElementById('live-section').scrollIntoView();
    }
  }

  boot();
})();
