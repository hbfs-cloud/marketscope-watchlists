const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const STORAGE = { tags: 'marketscope:tags', alerts: 'marketscope:alerts', firebase: 'marketscope:firebase', tagFilters: 'marketscope:tag-filters', sort: 'marketscope:sort' };
const storedTagState = storedTagFilter();
const state = {
  lists: [], assets: [], filtered: [], tags: read(STORAGE.tags, {}), alerts: read(STORAGE.alerts, []),
  selectedTags: new Set(storedTagState.tags), taggedOnly: storedTagState.taggedOnly, sort: storedSort(),
  selected: null, stream: null, firebase: null, firebaseApi: null, remoteTimer: null, analysisLoading: false
};
const SORT_LABELS = { change:'variation', price:'prix', ticker:'ticker', name:'nom', lists:'nombre de listes', market:'marché', setup:'tendance', relvol:'volume relatif', rsi:'RSI', ma200:'écart MA200' };

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function storedTagFilter() {
  const value = read(STORAGE.tagFilters, []);
  if (Array.isArray(value)) return { tags:value, taggedOnly:false };
  return value && typeof value === 'object' ? { tags:Array.isArray(value.tags) ? value.tags : [], taggedOnly:Boolean(value.taggedOnly) } : { tags:[], taggedOnly:false };
}
function storedSort() {
  const value = read(STORAGE.sort, {});
  return value && typeof value === 'object' ? { key:value.key || 'change', dir:value.dir === 'asc' ? 'asc' : 'desc' } : { key:'change', dir:'desc' };
}
function marketFor(id, ticker, name) {
  const text = `${id} ${ticker} ${name}`.toUpperCase();
  if (text.includes('CRYPTO') || /\b(BTC|ETH|SOL|XRP)\b/.test(text)) return 'CRYPTO';
  if (/_JP_|_HK_|_AU_|_SG_|6857/.test(text)) return 'APAC';
  if (/_US_/.test(text)) return 'US';
  if (/#|XAU|XAG|GOLD|SILVER|BRENT|CRUDE|OIL|EURUSD|USA500|SPX/.test(text)) return 'MACRO';
  return 'EU';
}
function numberFrom(text) {
  if (typeof text === 'number') return text;
  const cleaned = String(text).replace(/\s/g, '').replace(',', '.').replace(/[−–]/g, '-').replace(/[^0-9.+-]/g, '');
  return Number.parseFloat(cleaned) || 0;
}
function yahooSymbol(asset) {
  const id = asset.id.toUpperCase();
  const text = `${asset.ticker} ${asset.name}`.toUpperCase();
  const map = { BTC:'BTC-USD', ETH:'ETH-USD', SOL:'SOL-USD', XRP:'XRP-USD', XAU:'GC=F', GOLD:'GC=F', XAG:'SI=F', SILVER:'SI=F', BRENT:'BZ=F', CRUDE:'CL=F', OIL:'CL=F', EURUSD:'EURUSD=X', USA500:'^GSPC', SPX:'^GSPC' };
  for (const [key, value] of Object.entries(map)) if (text.includes(key) || id.includes(key)) return value;
  if (asset.market === 'US') return asset.ticker.replace(/\./g, '-');
  if (/_JP_/.test(id) || /^\d{4}$/.test(asset.ticker)) return `${asset.ticker}.T`;
  if (/_FR_|P_EQ$/.test(id)) return `${asset.ticker}.PA`;
  if (/_DE_|D_EQ$/.test(id)) return `${asset.ticker}.DE`;
  if (/_GB_|L_EQ$/.test(id)) return `${asset.ticker}.L`;
  if (/_NL_/.test(id)) return `${asset.ticker}.AS`;
  if (/_IT_/.test(id)) return `${asset.ticker}.MI`;
  return asset.ticker;
}
function tradingViewCandidates(asset) {
  const id = asset.id.toUpperCase(), ticker = asset.ticker.toUpperCase().replace('/', '');
  if (/_US_/.test(id) || asset.market === 'US') return [`NASDAQ:${ticker}`,`NYSE:${ticker}`,`AMEX:${ticker}`];
  if (/P_EQ$/.test(id) || /_FR_/.test(id)) return [`EURONEXT:${ticker}`];
  if (/D_EQ$/.test(id)) return [`XETR:${ticker}`,`FWB:${ticker}`];
  if (/L_EQ$/.test(id)) return [`LSE:${ticker}`,`LSE:${ticker}.`];
  if (/M_EQ$/.test(id)) return [`MIL:${ticker}`];
  if (/A_EQ$/.test(id)) return [`EURONEXT:${ticker}`];
  if (/S_EQ$/.test(id)) return [`SIX:${ticker}`];
  if (/_CA_/.test(id)) return [`TSX:${ticker}`];
  if (/_JP_/.test(id) || asset.market === 'APAC') return [`TSE:${ticker}`];
  if (asset.market === 'CRYPTO') { const base = ticker.replace(/EUR|USD|USDT/g,''); return [`BINANCE:${base}USDT`,`COINBASE:${base}USD`]; }
  if (/XAU|GOLD/.test(id)) return ['COMEX:GC1!','TVC:GOLD'];
  if (/XAG|SILVER/.test(id)) return ['COMEX:SI1!','TVC:SILVER'];
  if (/CRUDE|OIL|#QM/.test(id)) return ['NYMEX:CL1!','NYMEX:QM1!'];
  if (/EURUSD/.test(id)) return ['FX:EURUSD','OANDA:EURUSD'];
  if (/USA500|#ES/.test(id)) return ['SP:SPX','CME_MINI:ES1!'];
  if (/VIX/.test(id)) return ['CBOE:VIX'];
  return [];
}
function setupFor(asset) {
  const t = asset.tech; if (!t) return '';
  const above = t.close > t.ma20 && t.ma20 > t.ma50 && t.ma50 > t.ma200;
  if (t.close >= t.high3m * .985 && t.relVolume >= 1.2 && t.rsi >= 50) return 'breakout';
  if (t.close > t.ma200 && (Math.abs(t.close - t.ma20) / t.ma20 < .03 || Math.abs(t.close - t.ma50) / t.ma50 < .03) && t.rsi >= 38 && t.rsi <= 62) return 'pullback';
  if (above && t.macd > t.macdSignal && t.rsi >= 55 && t.recommend > .2) return 'momentum';
  return t.close > t.ma200 ? 'haussier' : t.close < t.ma200 ? 'baissier' : 'neutre';
}
function matchesSignal(asset, signal) {
  const t = asset.tech; if (!signal) return true; if (!t) return false;
  if (signal === 'analyzed') return true;
  if (signal === 'above200') return t.close > t.ma200;
  if (signal === 'relvol') return t.relVolume > 1.5;
  if (signal === 'oversold') return t.rsi < 30;
  return setupFor(asset) === signal;
}
async function loadTechnicals() {
  if (state.analysisLoading) return; state.analysisLoading = true;
  const button = $('#analyzeBtn'); button.disabled = true; button.textContent = '⌁ Analyse en cours…'; $('#analysisState').textContent = 'mise à jour…';
  try {
    const candidateMap = new Map(), tickers = [];
    for (const asset of state.assets) for (const candidate of tradingViewCandidates(asset)) if (!candidateMap.has(candidate)) { candidateMap.set(candidate, asset); tickers.push(candidate); }
    const columns = ['name','close','change','volume','relative_volume_10d_calc','RSI','MACD.macd','MACD.signal','SMA20','SMA50','SMA100','SMA200','Recommend.All','ATR','High.1M','High.3M','High.6M','VWAP','Perf.W','Perf.1M'];
    const response = await fetch('https://scanner.tradingview.com/global/scan', { method:'POST', body:JSON.stringify({symbols:{tickers,query:{types:[]}},columns,range:[0,tickers.length]}) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    for (const row of payload.data || []) {
      const asset = candidateMap.get(row.s); if (!asset) continue; const d = row.d;
      asset.tvSymbol = row.s; asset.tech = { close:d[1], change:d[2], volume:d[3], relVolume:d[4], rsi:d[5], macd:d[6], macdSignal:d[7], ma20:d[8], ma50:d[9], ma100:d[10], ma200:d[11], recommend:d[12], atr:d[13], high1m:d[14], high3m:d[15], high6m:d[16], vwap:d[17], perfWeek:d[18], perfMonth:d[19], obvDelta:(d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0) * (d[3] || 0) };
    }
    const count = state.assets.filter(a => a.tech).length; $('#analysisState').textContent = `${count}/${state.assets.length} couverts`; toast(`${count} instruments analysés en données réelles`);
  } catch (error) { $('#analysisState').textContent = 'source indisponible'; toast(`Analyse technique indisponible : ${error.message}`); }
  finally { state.analysisLoading = false; button.disabled = false; button.textContent = '⌁ Actualiser l’analyse'; applyFilters(); if (state.selected) renderDetail(state.selected); }
}
function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function seededSeries(key, length = 24) {
  let seed = hash(key), value = 50, out = [];
  for (let i = 0; i < length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; value = Math.max(5, value + ((seed / 4294967296) - .48) * 7); out.push(value); }
  return out;
}
function pathFor(values, width, height, pad = 3) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * (width - pad * 2) / Math.max(1, values.length - 1)).toFixed(1)},${(height - pad - (v - min) * (height - pad * 2) / span).toFixed(1)}`).join(' ');
}
function spark(asset) {
  const values = seededSeries(asset.id, 18), negative = asset.change < 0;
  return `<svg class="spark ${negative ? 'negative' : ''}" viewBox="0 0 92 28" aria-hidden="true"><path d="${pathFor(values, 92, 28)}"/></svg>`;
}
function saveLocal() {
  localStorage.setItem(STORAGE.tags, JSON.stringify(state.tags));
  localStorage.setItem(STORAGE.alerts, JSON.stringify(state.alerts));
  updateCounts();
  scheduleRemoteSave();
}
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}
function activeAlerts() {
  const now = Date.now();
  const current = state.alerts.filter(a => a.expiresAt > now);
  if (current.length !== state.alerts.length) { state.alerts = current; saveLocal(); }
  return current;
}
function updateCounts() {
  $('#visibleCount').textContent = state.filtered.length;
  $('#resultCount').textContent = `${state.filtered.length} instrument${state.filtered.length > 1 ? 's' : ''}`;
  $('#positiveCount').textContent = state.filtered.filter(a => (a.liveChange ?? a.tech?.change ?? a.change) > 0).length;
  $('#analyzedCount').textContent = state.assets.filter(a => a.tech).length;
  $('#alertCount').textContent = activeAlerts().length;
}
function renderFilters() {
  const options = state.lists.map(list => `<option value="${esc(list.name)}">${esc(list.name)} (${list.indexes.length})</option>`).join('');
  $('#listFilter').insertAdjacentHTML('beforeend', options);
}
function personalTags() {
  const counts = new Map();
  Object.values(state.tags).flat().forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
  return [...counts.entries()].sort((a,b) => a[0].localeCompare(b[0], 'fr'));
}
function saveUiState() {
  localStorage.setItem(STORAGE.tagFilters, JSON.stringify({ tags:[...state.selectedTags], taggedOnly:state.taggedOnly }));
  localStorage.setItem(STORAGE.sort, JSON.stringify(state.sort));
}
function renderTagFilter() {
  const tags = personalTags(), available = new Set(tags.map(([tag]) => tag));
  state.selectedTags.forEach(tag => { if (!available.has(tag)) state.selectedTags.delete(tag); });
  $('#tagsOnly').checked = state.taggedOnly;
  $('#tagChoices').innerHTML = tags.length ? tags.map(([tag,count]) => `<label class="tag-choice"><input type="checkbox" data-filter-tag="${esc(tag)}" ${state.selectedTags.has(tag) ? 'checked' : ''}><span><b>#${esc(tag)}</b><small>${count} instrument${count > 1 ? 's' : ''}</small></span></label>`).join('') : '<p class="tag-empty">Aucun tag pour le moment.<br>Ajoutez-en depuis la fiche d’un instrument.</p>';
  const filterCount = state.selectedTags.size + (state.taggedOnly ? 1 : 0), badge = $('#tagFilterCount');
  badge.textContent = filterCount; badge.hidden = filterCount === 0;
  const active = $('#activeTagFilters'), chips = [];
  if (state.taggedOnly) chips.push('<button type="button" data-remove-tagged>Avec tags <span>×</span></button>');
  state.selectedTags.forEach(tag => chips.push(`<button type="button" data-remove-tag="${esc(tag)}">#${esc(tag)} <span>×</span></button>`));
  if (chips.length) chips.push('<button type="button" class="clear-active" data-clear-tags>Effacer les filtres tags</button>');
  active.innerHTML = chips.join(''); active.hidden = chips.length === 0;
  saveUiState();
}
function sortValue(asset, key) {
  if (key === 'ticker') return asset.ticker;
  if (key === 'name') return asset.name;
  if (key === 'lists') return asset.lists.length;
  if (key === 'market') return asset.market;
  if (key === 'setup') return setupFor(asset) || '';
  if (key === 'price') return asset.livePrice ?? asset.tech?.close ?? asset.priceNumber;
  if (key === 'relvol') return asset.tech?.relVolume;
  if (key === 'rsi') return asset.tech?.rsi;
  if (key === 'ma200') return asset.tech?.ma200 ? (asset.tech.close - asset.tech.ma200) / asset.tech.ma200 : null;
  return asset.liveChange ?? asset.tech?.change ?? asset.change;
}
function compareAssets(a, b) {
  const av = sortValue(a, state.sort.key), bv = sortValue(b, state.sort.key), missingA = av == null || (typeof av === 'number' && !Number.isFinite(av)), missingB = bv == null || (typeof bv === 'number' && !Number.isFinite(bv));
  if (missingA !== missingB) return missingA ? 1 : -1;
  const base = typeof av === 'string' ? av.localeCompare(bv, 'fr', { sensitivity:'base' }) : (av - bv);
  return (state.sort.dir === 'asc' ? base : -base) || a.ticker.localeCompare(b.ticker, 'fr');
}
function updateSortUi() {
  const key = SORT_LABELS[state.sort.key] ? state.sort.key : 'change', dir = state.sort.dir === 'asc' ? 'asc' : 'desc';
  state.sort = { key, dir };
  document.querySelectorAll('[data-sort-column]').forEach(th => {
    const active = th.dataset.sortColumn === key; th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const arrow = $('span', th); if (arrow) arrow.textContent = active ? (dir === 'asc' ? '↑' : '↓') : '↕';
  });
  $('#sortKey').value = key; $('#sortDirection').textContent = dir === 'asc' ? '↑' : '↓';
  $('#sortDirection').setAttribute('aria-label', `Tri ${dir === 'asc' ? 'croissant' : 'décroissant'} — inverser`);
  $('#sortStatus').textContent = `Triés par ${SORT_LABELS[key]}, ${dir === 'asc' ? 'croissant' : 'décroissant'}`;
  saveUiState();
}
function setSort(key, direction) {
  const defaultDirection = ['ticker','name','market','setup'].includes(key) ? 'asc' : 'desc';
  state.sort = { key, dir: direction || (state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : defaultDirection) };
  applyFilters();
}
function applyFilters() {
  const q = $('#search').value.trim().toLowerCase(), list = $('#listFilter').value, market = $('#marketFilter').value, signal = $('#signalFilter').value;
  state.filtered = state.assets.filter(asset => {
    const tags = state.tags[asset.id] || [];
    const haystack = `${asset.ticker} ${asset.name} ${asset.lists.join(' ')} ${tags.join(' ')}`.toLowerCase();
    const selectedTagMatch = !state.selectedTags.size || tags.some(tag => state.selectedTags.has(tag));
    return (!q || haystack.includes(q)) && (!list || asset.lists.includes(list)) && (!market || asset.market === market) && matchesSignal(asset, signal) && (!state.taggedOnly || tags.length) && selectedTagMatch;
  });
  state.filtered.sort(compareAssets);
  renderRows(); updateCounts(); updateSortUi();
}
function renderRows() {
  const alerts = activeAlerts();
  $('#rows').innerHTML = state.filtered.map(asset => {
    const tags = state.tags[asset.id] || [], price = asset.livePrice ?? asset.tech?.close ?? asset.priceNumber, change = asset.liveChange ?? asset.tech?.change ?? asset.change, setup = setupFor(asset);
    const pills = [...asset.lists.slice(0, 2).map(x => `<span class="pill">${esc(x)}</span>`), ...tags.slice(0, 2).map(x => `<span class="pill tag">#${esc(x)}</span>`)];
    if (asset.lists.length > 2) pills.push(`<span class="pill">+${asset.lists.length - 2}</span>`);
    return `<tr data-id="${esc(asset.id)}" tabindex="0"><td><div class="asset"><span class="logo-wrap"><span class="avatar">${esc(asset.ticker.slice(0,3))}</span><img class="asset-logo" src="https://img.anylogo.dev/ticker/${encodeURIComponent(yahooSymbol(asset))}?size=64&variant=icon" alt="" loading="lazy"></span><span><b>${esc(asset.ticker)}</b><small>${esc(asset.name)}</small></span></div></td><td><div class="pills">${pills.join('')}</div></td><td><span class="market">${asset.market}</span></td><td><div class="signal-stack">${spark({...asset,change})}<span class="signal-badge ${esc(setup)}">${esc(setup || 'analyse…')}</span></div></td><td class="num">${Number.isFinite(price) ? price.toLocaleString('fr-FR',{maximumFractionDigits:4}) : esc(asset.price)}</td><td class="num change ${change < 0 ? 'negative' : ''}">${change > 0 ? '+' : ''}${change.toLocaleString('fr-FR',{maximumFractionDigits:2})} %</td><td><button class="bell ${alerts.some(a => a.instrumentId === asset.id) ? 'active' : ''}" aria-label="Alertes ${esc(asset.ticker)}">♢</button></td></tr>`;
  }).join('');
  document.querySelectorAll('.asset-logo').forEach(image => image.addEventListener('error', () => image.remove(), { once:true }));
  $('#empty').hidden = state.filtered.length > 0;
}
function chartSvg(values) {
  const d = pathFor(values, 500, 190, 12), area = `${d} L488,190 L12,190 Z`;
  return `<svg class="detail-chart" viewBox="0 0 500 190" preserveAspectRatio="none" role="img" aria-label="Historique de prix"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#77f2c1" stop-opacity=".25"/><stop offset="1" stop-color="#77f2c1" stop-opacity="0"/></linearGradient></defs><path class="area" d="${area}"/><path class="line" d="${d}"/></svg>`;
}
function formatMetric(value, digits = 2) { return Number.isFinite(value) ? value.toLocaleString('fr-FR',{maximumFractionDigits:digits}) : '—'; }
function formatCompact(value) { return Number.isFinite(value) ? new Intl.NumberFormat('fr-FR',{notation:'compact',maximumFractionDigits:1,signDisplay:'exceptZero'}).format(value) : '—'; }
function setupText(setup) {
  return setup === 'breakout' ? 'Proche du plus haut 3 mois, avec volume confirmé.' : setup === 'pullback' ? 'Tendance au-dessus de la MA200, retour contrôlé vers MA20/50.' : setup === 'momentum' ? 'MA20 > MA50 > MA200, MACD positif et RSI porteur.' : setup === 'haussier' ? 'Prix au-dessus de la MA200, sans déclencheur fort.' : setup === 'baissier' ? 'Prix sous la MA200 : tendance longue fragile.' : 'Pas de setup directionnel confirmé.';
}
function renderDetail(asset, chart = null) {
  const tags = state.tags[asset.id] || [], alerts = activeAlerts().filter(a => a.instrumentId === asset.id), t = asset.tech || {};
  const values = chart?.closes?.filter(Number.isFinite) || seededSeries(asset.id, 60), price = asset.livePrice ?? t.close ?? asset.priceNumber, change = asset.liveChange ?? t.change ?? asset.change, symbol = yahooSymbol(asset), setup = setupFor(asset) || 'en attente';
  const chartBlock = asset.market === 'US' ? `<figure class="finviz-figure"><img id="finvizChart" class="finviz-chart" src="https://finviz.com/chart.ashx?t=${encodeURIComponent(asset.ticker)}&ty=c&ta=1&p=d&s=l" alt="Graphique technique Finviz de ${esc(asset.ticker)}"><figcaption><span>Finviz · journalier · SMA20/50/200</span><span>${esc(asset.ticker)}</span></figcaption></figure>` : `${chartSvg(values)}<div class="chart-caption"><span>${chart ? 'Yahoo Finance · 1 an' : 'Historique Yahoo en chargement…'}</span><span>${esc(symbol)}</span></div>`;
  const metric = (label, value, digits = 2, suffix = '') => `<div class="metric"><small>${label}</small><b>${formatMetric(value,digits)}${Number.isFinite(value) ? suffix : ''}</b></div>`;
  $('#detailContent').innerHTML = `<p class="eyebrow">${asset.market} · ${esc(asset.lists.join(' · '))}</p><h1>${esc(asset.ticker)}</h1><div class="secondary">${esc(asset.name)}</div><div class="quote">${Number.isFinite(price) ? price.toLocaleString('fr-FR',{maximumFractionDigits:4}) : esc(asset.price)}</div><div class="change ${change < 0 ? 'negative' : ''}">${change > 0 ? '+' : ''}${formatMetric(change,2)} %</div>${chartBlock}<div class="setup-card"><strong class="signal-badge ${esc(setup)}">${esc(setup)}</strong><span>${esc(setupText(setup))}</span></div><div class="metrics extended">${metric('MA 20',t.ma20)}${metric('MA 50',t.ma50)}${metric('MA 100',t.ma100)}${metric('MA 200',t.ma200)}${metric('RSI 14',t.rsi,1)}${metric('MACD',t.macd,3)}${metric('Signal MACD',t.macdSignal,3)}${metric('Vol. relatif',t.relVolume,2,'×')}${metric('VWAP',t.vwap)}${metric('ATR 14',t.atr)}${metric('Perf. semaine',t.perfWeek,2,'%')}<div class="metric"><small>OBV Δ jour</small><b>${formatCompact(t.obvDelta)}</b></div></div><p class="analysis-source">TradingView Scanner · données quotidiennes. OBV Δ jour = contribution signée du volume, pas l’OBV cumulatif.</p><div class="section"><b>Tags personnels</b><div class="tag-input"><input id="newTag" maxlength="24" placeholder="ex. breakout, énergie"><button id="addTag" class="primary">Ajouter</button></div><div class="tag-list">${tags.map(tag => `<button data-tag="${esc(tag)}" title="Retirer">#${esc(tag)} ×</button>`).join('')}</div></div><div class="section"><b>Alerte de prix avec durée de vie</b><div class="alert-grid"><select id="alertCondition"><option value="above">Au-dessus de</option><option value="below">En dessous de</option></select><input id="alertTarget" type="number" step="any" value="${Number.isFinite(price) ? price : ''}" aria-label="Prix cible"><select id="alertTtl"><option value="24">24 heures</option><option value="168">7 jours</option><option value="720">30 jours</option></select><button id="addAlert" class="primary">Créer l’alerte</button></div>${alerts.map(a => `<div class="alert-item"><span>${a.condition === 'above' ? '≥' : '≤'} ${a.target} · expire ${new Date(a.expiresAt).toLocaleDateString('fr-FR')}</span><button data-alert="${esc(a.id)}" aria-label="Supprimer">×</button></div>`).join('')}<p class="secondary">Les alertes fonctionnent tant que cette page reste ouverte.</p></div><div class="links"><a href="https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}" target="_blank" rel="noopener">Yahoo Finance ↗</a>${asset.market === 'US' ? `<a href="https://finviz.com/quote.ashx?t=${encodeURIComponent(asset.ticker)}" target="_blank" rel="noopener">Finviz ↗</a>` : ''}</div>`;
  const finviz = $('#finvizChart');
  if (finviz) finviz.addEventListener('error', () => { const figure = finviz.closest('figure'); figure.innerHTML = `${chartSvg(values)}<figcaption><span>Finviz indisponible · aperçu local</span><span>${esc(asset.ticker)}</span></figcaption>`; }, { once:true });
  bindDetailActions(asset);
}
function bindDetailActions(asset) {
  $('#addTag').onclick = () => { const input = $('#newTag'), tag = input.value.trim().replace(/^#/,'').toLowerCase(); if (!tag) return; state.tags[asset.id] = [...new Set([...(state.tags[asset.id] || []), tag])]; input.value=''; saveLocal(); renderTagFilter(); applyFilters(); renderDetail(asset); };
  $('#newTag').onkeydown = e => { if (e.key === 'Enter') $('#addTag').click(); };
  document.querySelectorAll('[data-tag]').forEach(button => button.onclick = () => { state.tags[asset.id] = (state.tags[asset.id] || []).filter(t => t !== button.dataset.tag); saveLocal(); renderTagFilter(); applyFilters(); renderDetail(asset); });
  $('#addAlert').onclick = async () => {
    const target = Number($('#alertTarget').value), ttl = Number($('#alertTtl').value); if (!Number.isFinite(target)) return toast('Prix cible invalide');
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    state.alerts.push({ id: crypto.randomUUID(), instrumentId: asset.id, condition: $('#alertCondition').value, target, createdAt: Date.now(), expiresAt: Date.now() + ttl * 3600000, triggered: false });
    saveLocal(); applyFilters(); renderDetail(asset); toast('Alerte enregistrée');
  };
  document.querySelectorAll('[data-alert]').forEach(button => button.onclick = () => { state.alerts = state.alerts.filter(a => a.id !== button.dataset.alert); saveLocal(); applyFilters(); renderDetail(asset); });
}
async function loadChart(asset) {
  const symbol = yahooSymbol(asset);
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`);
    if (!response.ok) throw new Error('chart');
    const result = (await response.json()).chart.result?.[0], quote = result?.indicators?.quote?.[0];
    if (!quote?.close) throw new Error('chart');
    renderDetail(asset, { closes: quote.close, volumes: quote.volume || [], highs: quote.high || [], lows: quote.low || [] });
  } catch { /* the offline chart is already visible */ }
}
function openDetail(id) {
  const asset = state.assets.find(a => a.id === id); if (!asset) return;
  state.selected = asset; renderDetail(asset); if (asset.market !== 'US') loadChart(asset);
  $('#detail').classList.add('open'); $('#detail').setAttribute('aria-hidden','false'); $('#scrim').hidden = false;
}
function closeDetail() { $('#detail').classList.remove('open'); $('#detail').setAttribute('aria-hidden','true'); $('#scrim').hidden = true; state.selected = null; }
function evaluateAlerts(asset) {
  const price = asset.livePrice ?? asset.priceNumber;
  for (const alert of activeAlerts().filter(a => a.instrumentId === asset.id && !a.triggered)) {
    if ((alert.condition === 'above' && price >= alert.target) || (alert.condition === 'below' && price <= alert.target)) {
      alert.triggered = true; const message = `${asset.ticker} ${alert.condition === 'above' ? 'a franchi' : 'est passé sous'} ${alert.target}`;
      toast(message); if ('Notification' in window && Notification.permission === 'granted') new Notification('MarketScope', { body: message });
    }
  }
  saveLocal();
}
function decodeYahoo(data) {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)); let i = 0, result = {};
  const varint = () => { let value = 0, shift = 0, b; do { b = bytes[i++]; value += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return value; };
  while (i < bytes.length) {
    const key = varint(), field = key >> 3, wire = key & 7;
    if (wire === 2) { const length = varint(), chunk = bytes.slice(i, i + length); i += length; if (field === 1) result.id = new TextDecoder().decode(chunk); }
    else if (wire === 5) { const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4); const value = view.getFloat32(0, true); i += 4; if (field === 2) result.price = value; else if (field === 8) result.changePercent = value; }
    else if (wire === 0) { const value = varint(); if (field === 3) result.time = value; }
    else if (wire === 1) i += 8; else break;
  }
  return result;
}
function disconnectStream() {
  if (state.stream) state.stream.close(); state.stream = null; $('#marketState').classList.remove('live'); $('#connectionState').textContent = 'Hors ligne'; $('#streamBtn').classList.remove('active');
}
function toggleStream() {
  if (state.stream) return disconnectStream();
  try {
    const socket = new WebSocket('wss://streamer.finance.yahoo.com/?version=2'); state.stream = socket; $('#connectionState').textContent = 'Connexion…';
    socket.onopen = () => { const symbols = [...new Set(state.assets.filter(a => ['US','CRYPTO','MACRO'].includes(a.market)).map(yahooSymbol))].slice(0, 100); socket.send(JSON.stringify({ subscribe: symbols })); $('#marketState').classList.add('live'); $('#connectionState').textContent = 'Yahoo live'; $('#streamBtn').classList.add('active'); toast(`${symbols.length} symboles abonnés`); };
    socket.onmessage = event => { try { const quote = decodeYahoo(event.data); const asset = state.assets.find(a => yahooSymbol(a) === quote.id); if (!asset) return; if (Number.isFinite(quote.price)) asset.livePrice = quote.price; if (Number.isFinite(quote.changePercent)) asset.liveChange = quote.changePercent; evaluateAlerts(asset); applyFilters(); if (state.selected?.id === asset.id) renderDetail(asset); } catch {} };
    socket.onerror = () => toast('Flux Yahoo indisponible — données figées conservées');
    socket.onclose = () => disconnectStream();
  } catch { toast('WebSocket indisponible dans ce navigateur'); }
}
async function sharePage() {
  const payload = { title: 'MarketScope', text: 'Mon cockpit de surveillance marchés', url: location.href };
  try { if (navigator.share) await navigator.share(payload); else { await navigator.clipboard.writeText(location.href); toast('Lien copié — prêt pour Telegram'); } } catch (error) { if (error.name !== 'AbortError') toast('Impossible de partager ce lien'); }
}
async function connectGoogle(event) {
  event.preventDefault(); const status = $('#syncStatus');
  try {
    const config = JSON.parse($('#firebaseConfig').value); if (!config.apiKey || !config.projectId) throw new Error('Configuration incomplète');
    status.textContent = 'Connexion à Google…';
    const appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const dbMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
    const app = appMod.initializeApp(config), auth = authMod.getAuth(app), provider = new authMod.GoogleAuthProvider();
    const credential = await authMod.signInWithPopup(auth, provider), db = dbMod.getFirestore(app);
    const ref = dbMod.doc(db, 'users', credential.user.uid, 'marketscope', 'state'); const snapshot = await dbMod.getDoc(ref);
    state.firebase = { uid: credential.user.uid, ref }; state.firebaseApi = dbMod; localStorage.setItem(STORAGE.firebase, JSON.stringify(config));
    if (snapshot.exists()) { const remote = snapshot.data(); state.tags = remote.tags || state.tags; state.alerts = remote.alerts || state.alerts; saveLocal(); renderTagFilter(); applyFilters(); }
    else await dbMod.setDoc(ref, { tags: state.tags, alerts: state.alerts, updatedAt: Date.now() });
    status.textContent = `Synchronisé avec ${credential.user.email}`; $('#syncDialog').close(); $('#syncBtn').textContent = '✓ Google connecté'; toast('Synchronisation Google active');
  } catch (error) { status.textContent = `Échec : ${error.message}`; }
}
function scheduleRemoteSave() {
  if (!state.firebase || !state.firebaseApi) return; clearTimeout(state.remoteTimer);
  state.remoteTimer = setTimeout(() => state.firebaseApi.setDoc(state.firebase.ref, { tags: state.tags, alerts: state.alerts, updatedAt: Date.now() }).catch(() => toast('Synchronisation Google interrompue')), 600);
}
function registerWebMcp() {
  if (!document.modelContext?.registerTool) return;
  document.modelContext.registerTool({ name:'filter_watchlist', description:'Filtre le cockpit par texte, liste ou marché.', inputSchema:{type:'object',properties:{query:{type:'string'},list:{type:'string'},market:{type:'string'}}}, annotations:{readOnlyHint:true}, execute: async input => { if (input.query != null) $('#search').value=input.query; if (input.list != null) $('#listFilter').value=input.list; if (input.market != null) $('#marketFilter').value=input.market; applyFilters(); return {content:[{type:'text',text:`${state.filtered.length} instruments visibles`}]} } });
  document.modelContext.registerTool({ name:'open_instrument', description:'Ouvre la fiche détaillée d’un ticker.', inputSchema:{type:'object',required:['ticker'],properties:{ticker:{type:'string'}}}, annotations:{readOnlyHint:true}, execute: async ({ticker}) => { const asset=state.assets.find(a=>a.ticker.toLowerCase()===ticker.toLowerCase()); if(!asset) throw new Error('Ticker introuvable'); openDetail(asset.id); return {content:[{type:'text',text:`Fiche ${asset.ticker} ouverte`}]} } });
}
async function init() {
  try {
    const response = await fetch('./data/watchlists.json'); if (!response.ok) throw new Error('Données indisponibles');
    const [rawLists, rawAssets] = await response.json();
    state.lists = rawLists.map(([name,indexes]) => ({name,indexes}));
    const memberships = Array.from({length:rawAssets.length},()=>[]); state.lists.forEach(list => list.indexes.forEach(index => memberships[index]?.push(list.name)));
    state.assets = rawAssets.map(([id,ticker,name,price,change], index) => ({ id,ticker,name,price,priceNumber:numberFrom(price),change:numberFrom(change),market:marketFor(id,ticker,name),lists:memberships[index] }));
    $('#assetCount').textContent = state.assets.length; renderFilters(); renderTagFilter(); applyFilters(); registerWebMcp(); loadTechnicals();
    const config = localStorage.getItem(STORAGE.firebase); if (config) $('#firebaseConfig').value = config;
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) { $('#rows').innerHTML = `<tr><td colspan="7">${esc(error.message)}</td></tr>`; }
}
['search','listFilter','marketFilter','signalFilter'].forEach(id => $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', applyFilters));
document.querySelectorAll('[data-sort]').forEach(button => button.onclick = () => setSort(button.dataset.sort));
$('#sortKey').onchange = event => setSort(event.target.value, ['ticker','name','market','setup'].includes(event.target.value) ? 'asc' : 'desc');
$('#sortDirection').onclick = () => setSort(state.sort.key, state.sort.dir === 'asc' ? 'desc' : 'asc');
$('#tagsOnly').onchange = event => { state.taggedOnly = event.target.checked; renderTagFilter(); applyFilters(); };
$('#tagChoices').onchange = event => { const checkbox = event.target.closest('[data-filter-tag]'); if (!checkbox) return; checkbox.checked ? state.selectedTags.add(checkbox.dataset.filterTag) : state.selectedTags.delete(checkbox.dataset.filterTag); renderTagFilter(); applyFilters(); };
$('#clearTagFilters').onclick = () => { state.selectedTags.clear(); state.taggedOnly = false; renderTagFilter(); applyFilters(); };
$('#activeTagFilters').onclick = event => { const tag = event.target.closest('[data-remove-tag]'), tagged = event.target.closest('[data-remove-tagged]'), clear = event.target.closest('[data-clear-tags]'); if (tag) state.selectedTags.delete(tag.dataset.removeTag); if (tagged) state.taggedOnly = false; if (clear) { state.selectedTags.clear(); state.taggedOnly = false; } if (tag || tagged || clear) { renderTagFilter(); applyFilters(); } };
document.addEventListener('click', event => { const filter = $('#tagFilter'); if (filter.open && !filter.contains(event.target)) filter.removeAttribute('open'); });
$('#analyzeBtn').onclick = loadTechnicals;
$('#rows').addEventListener('click', event => { const row = event.target.closest('tr'); if (row) openDetail(row.dataset.id); });
$('#rows').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr')) openDetail(event.target.dataset.id); });
$('#closeDetail').onclick = closeDetail; $('#scrim').onclick = closeDetail; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
$('#streamBtn').onclick = toggleStream; $('#shareBtn').onclick = sharePage; $('#syncBtn').onclick = () => $('#syncDialog').showModal(); $('#connectGoogle').onclick = connectGoogle;
setInterval(() => { activeAlerts(); updateCounts(); }, 60000);
init();
