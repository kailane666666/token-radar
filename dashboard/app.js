// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan, the live-token view, and the model's calibration table. No network: every
// byte it shows is in data.js. The farm plan and the implied value are recomputed here from the same
// snapshot figures the model scores, so the page's code and the board's data are visibly the same
// arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null, cmpA: null, cmpB: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
    return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  }

  // The model in one function: the page recomputes a row from the snapshot figures and the calibration
  // the model wrote, and checks the number board.json carries, so the page's code and the board's data
  // are visibly the same arithmetic.
  function categoryMultipleOf(row) {
    var key = row.category || 'Other';
    var found = null;
    DATA.calibration.categories.forEach(function (c) { if (c.category === key) found = c; });
    if (found) return { multiple: found.multiple, liveCount: found.live_count };
    return { multiple: DATA.calibration.global_median, liveCount: 0 };
  }
  function impliedOf(row, model) {
    var cat = categoryMultipleOf(row);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * (Math.max(age, 0) / (Math.max(age, 0) + model.maturity_half_life_days));
    var chainMult = 1 + model.chain_bonus_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_bonus_max_chains);
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * cat.multiple * growthMult * maturity * chainMult)),
      categoryMultiple: cat.multiple, categoryLiveCount: cat.liveCount,
      growthPct: growth, growthMult: growthMult, maturityMult: maturity, chainMult: chainMult, age: age
    };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum') return { perTx: 'about $8 of gas', setup: 'about $15 of gas' };
    if (c === 'solana') return { perTx: 'under $0.10 of gas', setup: 'under $1 of gas' };
    if (c === 'bitcoin') return { perTx: 'about $2 of network fees', setup: 'about $5 of network fees' };
    if (['base', 'arbitrum', 'optimism', 'polygon', 'linea', 'zksync era', 'blast', 'scroll', 'mode', 'mantle', 'zora', 'fraxtal', 'ink', 'abstract', 'soneium', 'unichain', 'world chain'].indexOf(c) >= 0) return { perTx: 'about $0.50 of gas', setup: 'about $2 of gas' };
    return { perTx: 'about $2 of gas', setup: 'about $5 of gas' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 25e6) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it and keep both positions open.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s basis strategy on " + chain + ' and hold the position through one funding cycle.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in your wallet.';
    if (c.indexOf('restak') >= 0 || c.indexOf('liquid staking') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in its app at least once.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perps') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position on a market that settles after 30 days.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + "'s chain and use two of its apps at least once each.";
    if (c.indexOf('payment') >= 0) return 'Send $' + capital + ' through ' + name + ' in two or more transfers a month apart.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of LP tokens into ' + name + "'s farm on " + chain + ' and keep them staked.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it.';
    if (c.indexOf('privacy') >= 0) return 'Move $' + capital + ' through ' + name + "'s private transfer on " + chain + ' and keep the receipt.';
    if (c.indexOf('options') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s options vault on " + chain + ' and hold through one epoch.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Watch the collateral ratio: a sharp price drop can liquidate the borrow, so keep the loan well under half the deposit.';
    if (c.indexOf('dex') >= 0) return 'Expect impermanent loss if the pool price moves far: the LP share can be worth less than holding the two assets.';
    if (c.indexOf('yield') >= 0) return 'The vault rate moves with the market, and a vault contract is a smart-contract risk: never deposit more than you can lose.';
    if (c.indexOf('basis') >= 0) return 'A basis trade loses when funding rates flip: check the funding rate weekly and exit if it stays negative.';
    if (c.indexOf('rwa') >= 0) return 'Real-world assets carry issuer and regulatory risk on top of smart-contract risk: read what backs the token before minting.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Staked assets can be slashed and may take days to unstake: keep an exit window in mind before you lock up.';
    if (c.indexOf('bridge') >= 0) return 'Bridges have been the largest exploit target in DeFi: bridge only what you need, and move funds out again after using them.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perps') >= 0) return 'Leveraged positions liquidate fast: keep leverage low and set the position size so a 20% move cannot wipe it.';
    if (c.indexOf('prediction') >= 0) return 'A prediction position pays nothing if the market resolves against you: size it as a lottery ticket, not an investment.';
    if (c.indexOf('insurance') >= 0) return 'Cover pays only on the terms the policy states: read the exclusions before you buy, or a claim may be refused.';
    if (c.indexOf('stable') >= 0) return 'A stable asset can depeg: watch its price against $1 and exit if it trades below $0.98 for more than a day.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'A curator vault is only as good as its manager: check what the vault holds and who can change its strategy.';
    return 'Every position is a smart-contract risk: read the protocol docs, never deposit more than you can lose, and keep an exit plan.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function weeklyFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Top up the supply or repay a little of the borrow on ' + name + ' once a week, so the position shows fresh activity.';
    if (c.indexOf('dex') >= 0) return 'Swap a small amount through ' + name + "'s pool once a week, or add a little more liquidity to the position.";
    if (c.indexOf('yield') >= 0) return 'Check the vault rate on ' + name + ' once a week and add to the vault when the rate is near its recent high.';
    if (c.indexOf('basis') >= 0) return "Check " + name + "'s funding rate once a week and keep the position open while funding stays positive.";
    if (c.indexOf('rwa') >= 0) return "Check what backs " + name + "'s asset once a week and add a little more when a new issuance is announced.";
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Check the staking yield on ' + name + ' once a week and restake any rewards the protocol pays out.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount through ' + name + ' once a week and use the funds in its app, so the wallet stays active on both sides.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perps') >= 0) return 'Adjust the hedged position on ' + name + ' once a week so it stays delta-neutral as prices move.';
    if (c.indexOf('prediction') >= 0) return 'Place one small position a week on ' + name + ', on markets that settle on different dates.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Check what " + name + "'s vault holds once a week and move to a better vault if the strategy changes.";
    if (c.indexOf('chain') >= 0) return 'Use one app on ' + name + "'s chain each week: a swap, a mint or a vote, so the wallet has a steady history.";
    if (c.indexOf('payment') >= 0) return 'Send one payment through ' + name + ' each week, varying the amount and the recipient.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to create, and never share the seed phrase', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.setup, time: '15 minutes to set up' },
      { text: weeklyFor(p, chain), cost: gas.perTx + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page once a month, and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes a month' },
      { text: riskFor(p), cost: 'no cost to check, and it can save the position', time: '10 minutes a week' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'TOKEN RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' }))
      )
    );
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('h1', { text: 'Every pre-token protocol, ranked by what its token could be worth' }),
      el('p', null,
        'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
        ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) + ' pre-token protocols' }),
        ' below that floor. Implied value is calibrated from the live-token market in the same snapshot, not a flat multiple — and it is a model, not a promise.'
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist protocol ranked' })),
        el('div', { class: 'stat' }, el('span', { text: 'Rows on the board' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'stat hot' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('small', { text: 'sum of all rows, model ' + DATA.model_version })),
        el('div', { class: 'stat' }, el('span', { text: 'Top of the board' }), el('b', { text: top ? top.name : 'n/a' }), el('small', { text: top ? fmtUsd(top.implied_value_usd) + ' implied' : '' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    function scopeBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.scope === value ? 'true' : 'false', text: label, onclick: function () { state.scope = value; writeHash(); render(); } });
    }
    function tabBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === value ? 'true' : 'false', text: label, onclick: function () { state.tab = value; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'tabs' }, scopeBtn('all', 'All'), scopeBtn('watchlist', 'Watchlist'), scopeBtn('early', 'Early'))),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('market', 'Market'), tabBtn('compare', 'Compare'), tabBtn('model', 'Model'))),
      el('span', { class: 'count', text: state.tab === 'board' ? rows().length + ' of ' + DATA.board_size + ' rows' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'market' ? marketRows().length + ' categories on the board' : state.tab === 'compare' ? 'two protocols, side by side' : DATA.calibration.categories.length + ' categories calibrated' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // The week's fastest growers on the board: the five pre-token rows with the largest
  // seven-day TVL change, each opening its detail drawer. A mover is a signal, not a rank.
  function moversStrip() {
    var movers = DATA.rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; })
      .sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    if (movers.length === 0) return null;
    return el('section', { class: 'panel movers' },
      el('h2', { text: 'Top movers — fastest TVL growth this week' }),
      el('div', { class: 'mover-list' }, movers.map(function (r) {
        return el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'mover-name', text: r.name }),
          el('span', { class: 'mover-growth pos', text: fmtPct(r.change_7d) }),
          el('span', { class: 'mover-value sub', text: 'implied ' + fmtUsd(r.implied_value_usd) + ' · rank ' + r.rank })
        );
      }))
    );
  }

  // One category's standing on the board: how many rows, how much TVL and implied value it holds,
  // the multiple the model gives it, and its strongest protocol. Computed from the board's rows.
  function marketRows() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var key = r.category || 'Other';
      if (!byCat[key]) byCat[key] = { category: key, count: 0, tvl: 0, implied: 0, top: null };
      var c = byCat[key];
      c.count++;
      c.tvl += r.tvl_usd;
      c.implied += r.implied_value_usd;
      if (!c.top || r.implied_value_usd > c.top.implied_value_usd) c.top = r;
    });
    return Object.keys(byCat).map(function (k) { return byCat[k]; })
      .sort(function (a, b) { return b.implied - a.implied; });
  }

  function marketPanel() {
    var rows = marketRows();
    var top = rows[0];
    var tbody = el('tbody');
    rows.forEach(function (c) {
      var cal = null;
      DATA.calibration.categories.forEach(function (x) { if (x.category === c.category) cal = x; });
      tbody.appendChild(el('tr', { tabindex: '0', onclick: function () { state.category = c.category; state.tab = 'board'; writeHash(); render(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.category = c.category; state.tab = 'board'; writeHash(); render(); } } },
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.count) }),
        el('td', { class: 'num', text: fmtUsd(c.tvl) }),
        el('td', { class: 'num', text: fmtUsd(c.implied) }),
        el('td', { class: 'num', text: cal ? fmtMult(cal.multiple) + 'x' : fmtMult(DATA.calibration.global_median) + 'x' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: c.top.name }), el('span', { class: 'sub', text: 'rank ' + c.top.rank + ' · ' + fmtUsd(c.top.implied_value_usd) + ' implied' })))
      ));
    });
    return el('section', { class: 'panel market' },
      el('h2', { text: 'Where the implied value sits' }),
      el('p', { class: 'note', text: top
        ? top.category + ' holds the most implied value on the board (' + fmtUsd(top.implied) + ' across ' + top.count + ' protocols, led by ' + top.top.name + '), because its protocols carry the most TVL at a multiple the live market supports. Each category multiple comes from its own live-token protocols; a category with few of them leans on the global median. Select a row to see its protocols on the board.'
        : 'No categories on the board.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Rows' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Implied value' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Strongest protocol' }))),
          tbody
        )
      )
    );
  }

  // Two protocols, side by side: every model input and the implied value, so a reader can see
  // exactly why one outranks the other. The defaults are the top two rows of the board.
  function comparePanel() {
    if (!state.cmpA) state.cmpA = DATA.rows[0] ? DATA.rows[0].slug : null;
    if (!state.cmpB) state.cmpB = DATA.rows[1] ? DATA.rows[1].slug : null;
    var a = DATA.rows.filter(function (r) { return r.slug === state.cmpA; })[0] || DATA.rows[0];
    var b = DATA.rows.filter(function (r) { return r.slug === state.cmpB; })[0] || DATA.rows[1];
    function picker(value, onchange) {
      var sel = el('select', { 'aria-label': 'Pick a protocol to compare' },
        DATA.rows.map(function (r) { return el('option', { value: r.slug, text: '#' + r.rank + ' ' + r.name, selected: r.slug === value ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { onchange(sel.value); render(); });
      return sel;
    }
    function rowFor(label, va, vb, better) {
      return el('tr', null,
        el('td', null, el('span', { class: 'sub', text: label })),
        el('td', { class: 'num' + (better === 'a' ? ' win' : ''), text: va }),
        el('td', { class: 'num' + (better === 'b' ? ' win' : ''), text: vb })
      );
    }
    var va = impliedOf(a, DATA.model), vb = impliedOf(b, DATA.model);
    var ratio = (b.implied_value_usd > 0 && a.implied_value_usd > 0)
      ? (a.implied_value_usd >= b.implied_value_usd ? (a.implied_value_usd / b.implied_value_usd).toFixed(1) + 'x' : (b.implied_value_usd / a.implied_value_usd).toFixed(1) + 'x')
      : 'n/a';
    var leader = a.implied_value_usd >= b.implied_value_usd ? a : b;
    var trailer = leader === a ? b : a;
    var why = leader.tvl_usd >= trailer.tvl_usd * 1.5
      ? 'mostly because it carries more TVL'
      : (leader.category_multiple || 0) > (trailer.category_multiple || 0) * 1.2
        ? 'mostly because its category earns a higher multiple from the live market'
        : 'from the combination of its TVL, growth, age and chains — no single input dominates';
    return el('section', { class: 'panel compare' },
      el('h2', { text: 'Compare two protocols' }),
      el('div', { class: 'compare-pickers' },
        el('div', { class: 'field' }, el('label', { text: 'First protocol' }), picker(a.slug, function (v) { state.cmpA = v; })),
        el('button', { class: 'button', type: 'button', text: 'Swap', onclick: function () { var t = state.cmpA; state.cmpA = state.cmpB; state.cmpB = t; render(); } }),
        el('div', { class: 'field' }, el('label', { text: 'Second protocol' }), picker(b.slug, function (v) { state.cmpB = v; }))
      ),
      el('p', { class: 'note', text: leader.name + ' is valued ' + ratio + ' higher than ' + trailer.name + ', ' + why + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Figure' }), el('th', { scope: 'col', text: a.name }), el('th', { scope: 'col', text: b.name }))),
          el('tbody', null,
            rowFor('Rank', '#' + a.rank, '#' + b.rank, a.rank < b.rank ? 'a' : 'b'),
            rowFor('Category', a.category || 'Other', b.category || 'Other', null),
            rowFor('TVL', fmtUsd(a.tvl_usd), fmtUsd(b.tvl_usd), a.tvl_usd > b.tvl_usd ? 'a' : 'b'),
            rowFor('Seven-day growth', fmtPct(a.change_7d), fmtPct(b.change_7d), (a.change_7d || 0) > (b.change_7d || 0) ? 'a' : 'b'),
            rowFor('Age with no token', fmtAge(a.age_days), fmtAge(b.age_days), (a.age_days || 0) > (b.age_days || 0) ? 'a' : 'b'),
            rowFor('Chains', String((a.chains || []).length), String((b.chains || []).length), (a.chains || []).length > (b.chains || []).length ? 'a' : 'b'),
            rowFor('Category multiple', fmtMult(va.categoryMultiple) + 'x (' + va.categoryLiveCount + ' live)', fmtMult(vb.categoryMultiple) + 'x (' + vb.categoryLiveCount + ' live)', va.categoryMultiple > vb.categoryMultiple ? 'a' : 'b'),
            rowFor('Growth multiplier', 'x' + fmtMult(va.growthMult), 'x' + fmtMult(vb.growthMult), va.growthMult > vb.growthMult ? 'a' : 'b'),
            rowFor('Maturity multiplier', 'x' + fmtMult(va.maturityMult), 'x' + fmtMult(vb.maturityMult), va.maturityMult > vb.maturityMult ? 'a' : 'b'),
            rowFor('Chain multiplier', 'x' + fmtMult(va.chainMult), 'x' + fmtMult(vb.chainMult), va.chainMult > vb.chainMult ? 'a' : 'b'),
            rowFor('Implied value', fmtUsd(a.implied_value_usd), fmtUsd(b.implied_value_usd), a.implied_value_usd > b.implied_value_usd ? 'a' : 'b')
          )
        )
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category, chain or scope to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' + (r.rank <= 3 ? ' rank-top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge' + (r.on_watchlist ? ' watch' : ''), text: r.on_watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Scope' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : fmtMult(r.mcap_tvl_ratio) + 'x' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what calibrates the model.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var sorted = cal.categories.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    var tbody = el('tbody');
    sorted.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: c.live_median === null ? 'n/a' : fmtMult(c.live_median) + 'x' }),
        el('td', { class: 'num', text: fmtMult(c.multiple) + 'x' })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'note', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The base multiple is calibrated from the live-token market in the same snapshot, category by category.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ', el('b', { text: 'category_multiple' }), ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x age / (age + ' + m.maturity_half_life_days + ')) x (1 + ' + m.chain_bonus_per_chain + ' x min(chains - 1, ' + m.chain_bonus_max_chains + ')) )'
      ),
      el('p', { class: 'note', text: 'Category multiple: the median market-cap-to-TVL ratio of the live-token protocols in the category, shrunk toward the global median of ' + fmtMult(cal.global_median) + 'x (' + cal.global_count + ' live protocols) with prior strength ' + m.prior_strength + ', then clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. The shrinkage is done in log space — ratios spread multiplicatively, so the geometric combination is the right centre — and a category with few live protocols leans on the global median; a category with none uses it outright.' }),
      el('p', { class: 'note', text: 'Maturity saturates: a protocol reaches half its maturity bonus at one year old, because surviving the first year is the strong filter and age past three years adds little. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth rewards reach: a protocol live on many chains has more surface for a launch.' }),
      el('div', { class: 'calib' },
        el('h3', { text: 'Backtest: how well the model predicts the live market it was calibrated on' }),
        el('p', { class: 'note', text: 'Each live-token protocol was scored by this same function with its own record left out of the calibration (leave-one-out), and the prediction compared with its actual market cap. On ' + DATA.validation.n + ' live-token protocols the typical prediction is within a factor of ' + DATA.validation.median_factor.toFixed(1) + 'x of the real market cap; ' + Math.round(DATA.validation.within_2x * 100) + '% land within 2x and ' + Math.round(DATA.validation.within_3x * 100) + '% within 3x. Market caps vary about 30x around their median, so no model with ten fields predicts one precisely — the ranking is the claim, and the backtest states how far to trust it.' })
      ),
      el('div', { class: 'calib' },
        el('h3', { text: 'Calibration: the multiple each category gets, from the live market' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live protocols' }), el('th', { scope: 'col', text: 'Live median mcap/TVL' }), el('th', { scope: 'col', text: 'Multiple used' }))),
            tbody
          )
        )
      ),
      el('p', { class: 'note', text: 'Above-floor protocols the watchlist leaves out are not ranked: the house rule left them out because they are wrapped, staked or bridged products of a token that already trades, or a parent protocol\u2019s product, so they are not standalone launches.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var v = impliedOf(row, DATA.model);
    var match = v.implied === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'badge' + (row.on_watchlist ? ' watch' : ''), text: (row.on_watchlist ? 'Watchlist' : 'Early') + ' · Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'detail-actions' },
      el('button', { class: 'button primary', type: 'button', text: 'Compare with the top protocol', onclick: function () { state.cmpA = row.slug; state.cmpB = DATA.rows[0] && DATA.rows[0].slug !== row.slug ? DATA.rows[0].slug : (DATA.rows[1] ? DATA.rows[1].slug : null); state.tab = 'compare'; dialog.close(); writeHash(); render(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ', ' + v.categoryLiveCount + ' live)' }), el('b', { class: 'num', text: fmtMult(v.categoryMultiple) + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + ' → x' + fmtMult(v.growthMult) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + ' → x' + fmtMult(v.maturityMult) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + fmtMult(v.chainMult) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(v.implied) + (match ? ', the same number board.json carries.' : ' — the board and the page disagree, so the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    if (state.tab === 'board') { var mv = moversStrip(); if (mv) shell.appendChild(mv); shell.appendChild(boardTable()); }
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'market') shell.appendChild(marketPanel());
    else if (state.tab === 'compare') shell.appendChild(comparePanel());
    else shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      el('span', { text: 'Implied value is this entry\u2019s own model, never a price or a prediction of a launch. A protocol on this board records no token; it may still have one its DefiLlama record does not carry.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; state.tab = 'board'; state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
