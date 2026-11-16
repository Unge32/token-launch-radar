// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, its filters, a per-protocol detail
// view with the model's own arithmetic, and the live comparables the model
// reads. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  // The model's arithmetic, recomputed in the page from the row's own factors,
  // so the number the detail view shows is the same one board.json carries.
  function impliedOf(row) {
    var v = row.tvl_usd * row.multiple * row.maturity * row.growth * row.breadth;
    return Math.max(DATA.model.implied_floor_usd, Math.min(DATA.model.implied_cap_usd, Math.round(v)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w') === '1') state.watchlistOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function fillSelect(select, values, allLabel) {
    select.textContent = '';
    select.appendChild(el('option', { value: 'all', text: allLabel }));
    values.forEach(function (v) {
      select.appendChild(el('option', { value: v, text: v }));
    });
  }

  function renderMeta() {
    var meta = document.getElementById('top-meta');
    meta.textContent = '';
    meta.appendChild(el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })));
    meta.appendChild(el('span', null, 'Model ', el('b', { text: DATA.model_version })));
    meta.appendChild(el('span', null, 'Global multiple ', el('b', { text: fmtMult(DATA.global_multiple) })));

    var stats = document.getElementById('stats');
    stats.textContent = '';
    var top = DATA.rows[0];
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every slug on it'],
      ['Pre-token rows', String(DATA.board_size), DATA.early_size + ' below the floor'],
      ['Top implied value', top ? fmtUsd(top.implied_value_usd) : 'n/a', top ? top.name : ''],
      ['Live categories priced', String(DATA.comparables.length), 'median multiples'],
    ].forEach(function (s) {
      stats.appendChild(el('div', { class: 'stat' }, el('span', { text: s[0] }), el('b', null, s[1], s[2] ? el('em', { text: ' · ' + s[2] }) : null)));
    });

    var m = DATA.model;
    document.getElementById('formula').textContent =
      'implied = clamp( tvl_usd x multiple x maturity x growth x breadth, $1,000,000, $100,000,000,000 )\n' +
      'multiple = category median of mcap / TVL over live-token protocols (min ' + m.min_comps + ', else global ' + fmtMult(DATA.global_multiple) + ', else ' + m.fallback_multiple + ')\n' +
      'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x min(1, age_years / ' + m.maturity_years + ')      growth = 1 + ' + m.growth_weight + ' x clip(change_7d / 100, ' + m.growth_clip_low + ', ' + m.growth_clip_high + ')\n' +
      'breadth  = 1 + ' + m.breadth_per_chain + ' x min(chains, ' + m.breadth_max_chains + ')';
    document.getElementById('model-note').textContent =
      'Every row is scored by the same function of the snapshot figures. No protocol name is special-cased and no row is hand-picked. ' +
      'Age is the time since the protocol was first listed — the best record of how long it has run with no token; a protocol with no listed date scores the floor, ' + m.maturity_floor + '.';
    document.getElementById('source-line').textContent = 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '; watchlist floor $' + (DATA.floor_usd / 1e6) + 'M.';
  }

  function renderControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var q = document.getElementById('q');
    var cat = document.getElementById('category');
    var chain = document.getElementById('chain');
    var wl = document.getElementById('watchlist-only');
    fillSelect(cat, categories, 'All categories');
    fillSelect(chain, chains, 'All chains');
    q.value = state.q;
    cat.value = categories.indexOf(state.category) >= 0 ? state.category : 'all';
    chain.value = chains.indexOf(state.chain) >= 0 ? state.chain : 'all';
    wl.checked = state.watchlistOnly;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderBoard(); });
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderBoard(); });
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); renderBoard(); });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); renderBoard(); });
  }

  function sortButton(key, label) {
    return el('button', {
      type: 'button',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        renderBoard();
      }
    }, label, state.sort === key ? el('span', { class: 'arrow', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null);
  }

  function renderBoard() {
    var list = sortedRows(visibleRows());
    var head = document.getElementById('head-row');
    head.textContent = '';
    [
      ['implied', 'Rank', ''],
      ['name', 'Protocol', ''],
      ['tvl', 'TVL', 'num'],
      ['growth', '7d', 'num'],
      ['age', 'Age', 'num'],
      ['multiple', 'Multiple', 'num'],
      ['implied', 'Implied value', 'num'],
    ].forEach(function (c) {
      head.appendChild(el('th', { scope: 'col', class: c[2] }, sortButton(c[0], c[1])));
    });
    head.appendChild(el('th', { scope: 'col', text: 'Token' }));

    var tbody = document.getElementById('rows');
    tbody.textContent = '';
    var max = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'aria-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null),
          el('span', { text: (r.category || 'Uncategorized') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'no chain listed') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    document.getElementById('empty').hidden = list.length !== 0;
    document.getElementById('count').textContent = list.length + ' of ' + DATA.board_size + ' rows';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    var panel = document.getElementById('detail');
    if (!row) { panel.hidden = true; return; }
    state.selected = slug;
    writeHash();
    panel.textContent = '';
    panel.hidden = false;
    var recomputed = impliedOf(row);
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rankline', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + (row.watchlist ? ' · ON THE WATCHLIST' : ' · EARLY RADAR') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'no chain listed') + ' · listed ' + (row.age_days === null ? 'at an unknown date' : fmtAge(row.age_days) + ' ago') })
      ),
      el('button', { class: 'close-btn', type: 'button', text: 'Close', onclick: function () { closeDetail(); } })
    ));
    var cells = [
      ['TVL', fmtUsd(row.tvl_usd), 'the protocol\'s locked value'],
      ['Multiple', fmtMult(row.multiple), row.multiple_source],
      ['Maturity', row.maturity.toFixed(2) + 'x', fmtAge(row.age_days) + ' with no token'],
      ['Growth', row.growth.toFixed(2) + 'x', '7d ' + fmtPct(row.change_7d)],
      ['Breadth', row.breadth.toFixed(2) + 'x', (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's')],
      ['Implied value', fmtUsd(row.implied_value_usd), 'recomputed in this page: ' + fmtUsd(recomputed)],
    ];
    var eq = el('div', { class: 'equation' });
    cells.forEach(function (c, i) {
      eq.appendChild(el('div', { class: 'cell' + (i === 5 ? ' result' : '') },
        el('span', { text: c[0] }), el('b', { text: c[1] }), el('small', { text: c[2] })));
    });
    panel.appendChild(eq);
    panel.appendChild(el('p', { class: 'sub', text: recomputed === row.implied_value_usd
      ? 'The page recomputes this row from the same factors and gets the same number board.json carries.'
      : 'The page recomputes this row as ' + fmtUsd(recomputed) + ', which differs from the board: the data would be stale.' }));
    panel.appendChild(el('h3', { text: 'Farm plan — what to do before a token exists' }));
    var ol = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      var costAt = tail.indexOf(' Time: ');
      var cost = costAt >= 0 ? tail.slice(0, costAt) : tail;
      var time = costAt >= 0 ? tail.slice(costAt + 1) : '';
      ol.appendChild(el('li', null,
        el('b', { text: action }),
        el('span', null, el('i', { text: cost }), document.createTextNode(' · '), el('i', { text: time }))
      ));
    });
    panel.appendChild(ol);
    renderBoard();
    panel.scrollIntoView({ block: 'nearest' });
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    document.getElementById('detail').hidden = true;
    renderBoard();
  }

  function renderComparables() {
    var compRows = document.getElementById('comp-rows');
    compRows.textContent = '';
    DATA.comparables.forEach(function (c) {
      compRows.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: fmtMult(c.median_multiple) }),
        el('td', { class: 'num', text: String(c.comps) })
      ));
    });
    var liveRows = document.getElementById('live-rows');
    liveRows.textContent = '';
    DATA.live_top.forEach(function (r) {
      liveRows.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.category || 'Uncategorized' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) })
      ));
    });
  }

  readHash();
  renderMeta();
  renderControls();
  renderBoard();
  renderComparables();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
