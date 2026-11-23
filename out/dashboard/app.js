// Shadow Copy Radar — dashboard logic. Static page, no network, no fetch.
//
// The page recomputes every row's copy score and implied value from the
// row's own signals and the model constants in data.js, and regenerates
// every row's copy plan from the row's own record — the same rules as
// lib/model.ts, so the number on screen is the model's number.

(function () {
  var DATA = window.RADAR;
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:24px">No radar data found: data.js did not load.</p>';
    return;
  }
  var M = DATA.model;

  /** The page checks its own arithmetic: every row's score and implied value
   *  recompute from the row's signals within tolerance. The board displays
   *  the stored board.json values (the gate's source of truth); the check
   *  below proves the page's model agrees with them. */
  var recomputeBad = DATA.rows.filter(function (r) {
    return Math.abs(impliedOf(r) - r.implied_value_usd) > Math.max(1, r.implied_value_usd * 0.001) ||
      Math.abs(scoreOf(r) - r.copy_score) > 0.0015;
  }).length;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function fmtFlow(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v + '%</span>';
  }

  /** The copy score, recomputed from the row's own signals. */
  function scoreOf(r) {
    return M.weight_inflow * r.inflow + M.weight_scale * r.scale +
      M.weight_breadth * r.breadth + M.weight_persistence * r.persistence +
      M.weight_category_heat * r.category_heat;
  }

  /** The implied value, recomputed from TVL and the copy score. */
  function impliedOf(r) {
    return Math.max(1, Math.round(r.tvl_usd * M.base_multiple * (M.copy_floor + M.copy_range * scoreOf(r))));
  }

  function tierOf(score) {
    if (score >= 0.5) return 'A';
    if (score >= 0.38) return 'B';
    return 'C';
  }

  function mirrorUsdFor(tier) {
    if (tier === 'A') return 250;
    if (tier === 'B') return 150;
    return 75;
  }

  function maxMirrorsFor(tier) {
    if (tier === 'A') return 6;
    if (tier === 'B') return 4;
    return 2;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function chainOf(r) {
    return r.chains && r.chains.length > 0 ? r.chains[0] : 'its main chain';
  }

  function mirrorActionFor(r, capital, chain) {
    var c = (r.category || '').toLowerCase();
    var name = r.name;
    var tail = 'the same action the wallets you are copying took.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Mirror the cohort on ' + name + ': supply $' + capital + ' of USDC to its lending pool on ' + chain + ' and keep the position open, ' + tail;
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Mirror the cohort on ' + name + ': provide $' + capital + ' of liquidity to its main pool on ' + chain + ' and keep the position open, ' + tail;
    if (c.indexOf('bridge') >= 0) return 'Mirror the cohort on ' + name + ': bridge $' + capital + ' of USDC to ' + chain + ' through it and use the bridged funds in its app, ' + tail;
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Mirror the cohort on ' + name + ': stake $' + capital + ' of the chain\'s staking asset through it and keep the receipt, ' + tail;
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Mirror the cohort on ' + name + ': deposit $' + capital + ' of USDC as margin and open one small hedge, ' + tail;
    if (c.indexOf('prediction') >= 0) return 'Mirror the cohort on ' + name + ': fund $' + capital + ' and place one market position, ' + tail;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Mirror the cohort on ' + name + ': deposit $' + capital + ' into one of its vaults on ' + chain + ' and keep the shares, ' + tail;
    if (c.indexOf('stable') >= 0) return 'Mirror the cohort on ' + name + ': mint or deposit $' + capital + ' of the stable asset through it on ' + chain + ', ' + tail;
    if (c.indexOf('rwa') >= 0) return 'Mirror the cohort on ' + name + ': mint $' + capital + ' of its yield asset on ' + chain + ' and hold it, ' + tail;
    if (c.indexOf('insurance') >= 0) return 'Mirror the cohort on ' + name + ': buy $' + capital + ' of cover from it on ' + chain + ' and keep the policy, ' + tail;
    return 'Mirror the cohort on ' + name + ': deposit $' + capital + ' of USDC into it on ' + chain + ' and keep the position open, ' + tail;
  }

  function flowTriggerFor(r, capital) {
    var flow = r.change_7d;
    var half = Math.round(capital / 2);
    if (flow === null || flow === undefined) return 'The snapshot records no 7-day flow for ' + r.name + ', so mirror a half-size $' + half + ' first and add the rest only after a week of positive flow.';
    if (flow > 0) return r.name + ' gained ' + flow + '% of TVL in 7 days: add to the mirror only while the weekly flow stays positive, and pause new deposits the week it turns negative.';
    if (flow < 0) return r.name + ' lost ' + Math.abs(flow) + '% of TVL in 7 days: mirror a half-size $' + half + ' now and wait for two positive weeks before adding more.';
    return r.name + ' is flat over 7 days: mirror a half-size $' + half + ' and add the rest only once the flow turns positive.';
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** One step as one string: action, cost, time — the same shape as the board's farm steps. */
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }

  /** A row's copy plan, regenerated here from the row's own record. */
  function copyPlan(r) {
    var tier = tierOf(r.copy_score);
    var capital = mirrorUsdFor(tier);
    var hold = holdDaysFor(r.age_days);
    var maxPos = maxMirrorsFor(tier);
    var tvlHalf = Math.round(r.tvl_usd / 2);
    return [
      { text: 'Open a fresh copy wallet that holds only the funds you plan to mirror with, and keep its seed phrase offline. Never reuse a wallet that holds other positions.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mirrorActionFor(r, capital, chainOf(r)), cost: '$' + capital + ' of capital and about $' + (capital >= 250 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: flowTriggerFor(r, capital), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Copy score ' + r.copy_score.toFixed(2) + ' puts ' + r.name + ' in tier ' + tier + ': mirror $' + capital + ' per position and run at most ' + maxPos + ' mirrors at this tier at once, so one bad copy cannot sink the book.', cost: '$' + capital + ' of capital per mirror', time: '5 minutes to size' },
      { text: 'Hold the mirror for at least ' + hold + ' days so the activity is counted in more than one snapshot, and unwind if the 7-day flow stays negative for two weeks running or TVL falls below $' + fmtInt(tvlHalf) + '.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Write the wallet, the dates and every transaction in a copy log, and claim only from the link the protocol\'s own points page publishes. Never pay anyone to claim for you.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  function barClass(v) {
    if (v >= 0.7) return '';
    if (v >= 0.5) return 'mid';
    return 'low';
  }

  function scoreCell(r) {
    var s = r.copy_score;
    return '<span class="bar ' + barClass(s) + '"><i style="width:' + Math.round(s * 100) + '%"></i></span><span class="score-num">' + s.toFixed(2) + '</span>';
  }

  function filteredRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('category').value;
    var chain = $('chain').value;
    var minScore = parseFloat($('minScore').value);
    var wlOnly = $('watchlistOnly').checked;
    var rows = DATA.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (!r.chains || r.chains.indexOf(chain) < 0)) return false;
      if (r.copy_score < minScore) return false;
      if (wlOnly && !DATA.watchlist_slugs[r.slug]) return false;
      return true;
    });
    var sort = $('sort').value;
    if (sort === 'score') rows = rows.slice().sort(function (a, b) { return b.copy_score - a.copy_score; });
    else if (sort === 'tvl') rows = rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'flow') rows = rows.slice().sort(function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    $('board-count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols shown · ranked by implied value unless sorted otherwise · snapshot ' + DATA.as_of +
      ' · page check: ' + (recomputeBad === 0 ? 'all rows recompute within tolerance' : recomputeBad + ' rows differ on recompute');
    var html = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc((r.chains || []).slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtFlow(r.change_7d) + '</td>' +
        '<td>' + scoreCell(r) + '</td>' +
        '<td><span class="tier tier-' + r.tier + '">' + r.tier + '</span></td>' +
        '<td class="num">' + fmtUsd(r.implied_value_usd) + '</td></tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="9">No protocols match these filters.</td></tr>';
    $('rows').querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
  }

  var SIGNALS = [
    ['inflow', 'Inflow — 7-day TVL flow', 'Wallets arriving or leaving. Positive flow is the crowd walking in.'],
    ['scale', 'Scale — log TVL', 'Enough depth to enter and exit a mirror without moving the pool.'],
    ['breadth', 'Breadth — chain count', 'More chains, more distinct wallet cohorts touching the protocol.'],
    ['persistence', 'Persistence — age', 'A protocol that survived is likelier to launch than a new one.'],
    ['category_heat', 'Category heat', 'The median 7-day flow of the category\'s pre-token peers.'],
  ];

  function renderDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) {
      $('detail').innerHTML = '<p>Unknown protocol: ' + esc(slug) + '</p>';
      return;
    }
    var sigHtml = SIGNALS.map(function (sg) {
      var key = sg[0], label = sg[1], note = sg[2];
      var v = r[key];
      return '<div class="sig"><div class="lab"><span>' + label + '</span><b>' + v.toFixed(2) + '</b></div>' +
        '<span class="bar ' + barClass(v) + '"><i style="width:' + Math.round(v * 100) + '%"></i></span><p>' + note + '</p></div>';
    }).join('');
    var planHtml = copyPlan(r).map(function (s) {
      var idx = s.lastIndexOf(' Cost: ');
      var body = idx >= 0 ? s.slice(0, idx) : s;
      var cost = idx >= 0 ? s.slice(idx + 1) : '';
      return '<li>' + esc(body) + '<br><span class="cost">' + esc(cost) + '</span></li>';
    }).join('');
    $('detail').innerHTML =
      '<div class="detail-card"><h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="tier tier-' + r.tier + '">' + r.tier + '</span></h2>' +
      '<div class="kv"><span>Copy score <b>' + r.copy_score.toFixed(2) + '</b></span>' +
      '<span>Implied value <b>' + fmtUsd(r.implied_value_usd) + '</b></span>' +
      '<span>TVL <b>' + fmtUsd(r.tvl_usd) + '</b></span>' +
      '<span>7d flow <b>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') + '</b></span>' +
      '<span>Age <b>' + (r.age_days === null ? 'unknown' : r.age_days + ' days') + '</b></span>' +
      '<span>Chains <b>' + esc((r.chains || []).join(', ') || '—') + '</b></span>' +
      '<span>Category <b>' + esc(r.category || '—') + '</b></span>' +
      '<span>Mirror size <b>$' + mirrorUsdFor(r.tier) + '</b></span></div>' +
      '<div class="detail-grid">' + sigHtml + '</div>' +
      '<h2>Copy plan</h2><ol class="plan">' + planHtml + '</ol></div>';
  }

  function renderLive() {
    $('live-rows').innerHTML = DATA.live.map(function (p) {
      return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td>' + esc((p.chains || []).slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd === null ? '—' : fmtUsd(p.mcap_usd)) + '</td>' +
        '<td class="num">' + fmtFlow(p.change_7d) + '</td></tr>';
    }).join('');
  }

  function show(view) {
    $('board-view').hidden = view !== 'board';
    $('detail-view').hidden = view !== 'detail';
    $('live-view').hidden = view !== 'live';
    $('controls').style.display = view === 'board' ? '' : 'none';
    $('tab-board').classList.toggle('active', view !== 'live');
    $('tab-live').classList.toggle('active', view === 'live');
  }

  function route() {
    var h = location.hash || '#/';
    if (h.indexOf('#/p/') === 0) {
      show('detail');
      renderDetail(decodeURIComponent(h.slice(4)));
      $('tab-note').textContent = 'Detail view';
    } else if (h.indexOf('#/f') === 0) {
      var q = {};
      h.slice(3).split('&').forEach(function (kv) {
        var parts = kv.split('=');
        if (parts[0]) q[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
      });
      if (q.minScore) $('minScore').value = q.minScore;
      if (q.category) $('category').value = q.category;
      if (q.chain) $('chain').value = q.chain;
      if (q.watchlist) $('watchlistOnly').checked = q.watchlist === '1';
      if (q.q) $('q').value = q.q;
      show('board');
      renderBoard();
      $('tab-note').textContent = 'Filtered view';
    } else if (h === '#/live') {
      show('live');
      renderLive();
      $('tab-note').textContent = '';
    } else {
      show('board');
      renderBoard();
      $('tab-note').textContent = '';
    }
  }

  // Header meta and filter options.
  $('meta').innerHTML = 'Snapshot <b>' + esc(DATA.as_of) + '</b><br>' +
    '<b>' + DATA.board_size + '</b> rows · <b>' + DATA.watchlist_size + '</b> watchlist · <b>' + DATA.early_size + '</b> early<br>' +
    'model <b>' + esc(DATA.model_version) + '</b>';
  $('source').textContent = DATA.source;
  var cats = [], chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; $('category').appendChild(o);
  });
  chains.sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; $('chain').appendChild(o);
  });

  ['q', 'category', 'chain', 'minScore', 'watchlistOnly', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', function () { if (location.hash.indexOf('#/p/') !== 0) renderBoard(); });
    $(id).addEventListener('change', function () { if (location.hash.indexOf('#/p/') !== 0) renderBoard(); });
  });
  $('tab-board').addEventListener('click', function () { location.hash = '#/'; });
  $('tab-live').addEventListener('click', function () { location.hash = '#/live'; });
  $('back').addEventListener('click', function () { location.hash = '#/'; });
  window.addEventListener('hashchange', route);
  route();
})();
