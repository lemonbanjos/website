// =======================================================
//  Lemon Banjo Product Info (Google Sheets Driven)
//  - Same rendering as ORIGINAL file (no HTML/CSS changes needed)
//  - Unified data loader: AMPPS PHP → /data JSON → direct Google fallback
//  - Robust to gviz/JSON formats; filters rows by MODEL manually
//  - Exposes window.LemonBanjo.getConfig() for EmailJS
// =======================================================

/* ==== CONFIG ==== */
const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';
const MODEL = (document.body.dataset.model || 'L3-00').trim();

/* ==== UTIL ==== */
const fmtUSD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const cleanStr = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const lc = v => cleanStr(v).toLowerCase();
const canon = s => cleanStr(s).normalize('NFKC').replace(/[^0-9A-Za-z]+/g, ' ').trim().toLowerCase();
const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

/* ==== STATE ==== */
const LemonState = {
  model: MODEL,
  product: null,
  optionsByCanon: null,
  groupNameMap: null,
  specs: null,
  selected: new Map(),
  total: 0
};

/* ==== GVIZ TABLE HELPERS ==== */
function headerIndex(table) {
  const idx = {};
  (table.cols || []).forEach((col, i) => {
    const name = (col.label || col.id || '').toString().trim();
    idx[canon(name)] = i;
  });
  return idx;
}
function cellByHeader(row, idx, header) {
  const i = idx[canon(header)];
  return i == null ? null : (row[i] ?? null);
}

/* ==== DATA LOADER (AMPPS → static JSON → Google) ==== */
function candidateUrls(sheet, tq) {
  const qs = new URLSearchParams({ sheet, tq }).toString();
  const gvizDirect = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${qs}&tqx=out:json`;
  return [
    `./api/gviz.php?${qs}`,                                   // AMPPS PHP cache
    `./data/${encodeURIComponent(sheet)}.json`,               // GitHub Pages static JSON
    `https://corsproxy.io/?${encodeURIComponent(gvizDirect)}` // fallback
  ];
}
async function fetchText(url, ms = 6000) {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(id); }
}
function toGvizTable(txt) {
  const trimmed = txt.trim();
  // a) raw gviz JSON: {"version":...,"table":{...}}
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed);
    if (obj && obj.table) return obj.table;
  }
  // b) classic gviz prefix: )]}'
  if (trimmed.startsWith(")]}'")) {
    const obj = JSON.parse(trimmed.replace(/^\)\]\}'\s*/, ''));
    if (obj && obj.table) return obj.table;
  }
  // c) wrapped callback: google.visualization.Query.setResponse({...})
  const wrapStart = 'google.visualization.Query.setResponse(';
  const i = trimmed.indexOf(wrapStart);
  if (i !== -1) {
    const start = i + wrapStart.length;
    const end   = trimmed.lastIndexOf(')');
    const obj   = JSON.parse(trimmed.slice(start, end));
    if (obj && obj.table) return obj.table;
  }
  // d) static array-of-objects → synthesize table
  const arr = JSON.parse(trimmed);
  if (Array.isArray(arr) && arr.length) {
    const headers = Object.keys(arr[0]);
    return {
      cols: headers.map(h => ({ id: h, label: h, type: 'string' })),
      rows: arr.map(row => ({ c: headers.map(h => ({ v: row[h] })) }))
    };
  }
  throw new Error('Unrecognized data format for GViz table');
}
async function gvizQuery(sheet, tq) {
  const urls = candidateUrls(sheet, tq);
  let lastErr;
  for (const url of urls) {
    try {
      const txt = await fetchText(url, 7000);
      const table = toGvizTable(txt);
      return table;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All data sources failed');
}

/* ==== PRICING / DEPENDENCIES (unchanged behavior) ==== */
function dependencyOk(option, selectedMap) {
  if (!option.dep_groupCanon) return true;
  const selectedVal = lc(selectedMap.get(option.dep_groupCanon));
  if (!selectedVal) return false;
  return selectedVal === lc(option.dep_value);
}
function calcPrice(base, selected, optionsByCanon) {
  let total = base;
  for (const [canonGroup, optionName] of selected) {
    const list = optionsByCanon[canonGroup] || [];
    const item = list.find(o => o.option_name === optionName);
    if (!item) continue;
    if (item.price_type === 'add') total += item.price_delta;
    else if (item.price_type === 'pct') total += base * (item.price_delta / 100);
    else if (item.price_type === 'abs') total += item.price_delta;
  }
  return total;
}
function chooseDefault(validList, currentName) {
  if (!validList.length) return null;
  if (currentName && validList.some(o => o.option_name === currentName)) return currentName;
  const def = validList.find(o => o.is_default);
  return (def ? def.option_name : validList[0].option_name);
}

/* ==== LOAD DATA (keeps your original display logic) ==== */
async function loadData(model) {
  // We fetch ALL columns, then filter by model in JS so it works with static JSON too.
  const [prodT, optT, specT] = await Promise.all([
    gvizQuery('Products', `select *`),
    gvizQuery('Options',  `select *`),
    gvizQuery('Specs',    `select *`)
  ]);

  // ---- Products: locate row where first col (or header "model_id") matches MODEL
  const pIdx = headerIndex(prodT);
  const prodRow = rows(prodT).find(r => {
    const idByHeader = cellByHeader(r, pIdx, 'model_id');
    const idFallback = r[0];
    return cleanStr(idByHeader ?? idFallback) === model;
  }) || [];
  // Original assumed [A,B,C,D] = [model_id,title,series,base_price]
  // We still map by header when available for safety.
  const product = {
    model_id: cleanStr(cellByHeader(prodRow, pIdx, 'model_id') ?? prodRow[0]),
    title:    cleanStr(cellByHeader(prodRow, pIdx, 'title')    ?? prodRow[1]),
    series:   cleanStr(cellByHeader(prodRow, pIdx, 'series')   ?? prodRow[2]),
    base_price: +(cellByHeader(prodRow, pIdx, 'base_price') ?? prodRow[3] ?? 0) || 0
  };

  // ---- Options: keep your original shapes, but filter by A == model
  // Original column intent:
  // A model_id, B group, C option_name, D price_delta, E price_type, F is_default, G sort, H visible, I dep_group, J dep_value
  const oIdx = headerIndex(optT);
  const optionsByCanon = {};
  const groupNameMap = {};
  rows(optT).forEach(row => {
    const a_model = cleanStr(cellByHeader(row, oIdx, 'model_id') ?? row[0]);
    if (a_model !== model) return;

    const group       = cellByHeader(row, oIdx, 'group')        ?? row[1];
    const option_name = cellByHeader(row, oIdx, 'option_name')  ?? row[2];
    const price_delta = cellByHeader(row, oIdx, 'price_delta')  ?? row[3];
    const price_type  = cellByHeader(row, oIdx, 'price_type')   ?? row[4];
    const is_default  = cellByHeader(row, oIdx, 'is_default')   ?? row[5];
    const sort        = cellByHeader(row, oIdx, 'sort')         ?? row[6];
    const visible     = cellByHeader(row, oIdx, 'visible')      ?? row[7];
    const dep_group   = cellByHeader(row, oIdx, 'dep_group')    ?? row[8];
    const dep_value   = cellByHeader(row, oIdx, 'dep_value')    ?? row[9];

    const groupOrig = cleanStr(group);
    const groupCanon = canon(groupOrig);
    const dep_groupCanon = canon(dep_group || '');

    if (!optionsByCanon[groupCanon]) optionsByCanon[groupCanon] = [];
    if (!groupNameMap[groupCanon]) groupNameMap[groupCanon] = groupOrig;

    optionsByCanon[groupCanon].push({
      groupOrig,
      groupCanon,
      option_name: cleanStr(option_name),
      price_delta: +price_delta || 0,
      price_type: (price_type || 'add'),
      is_default: String(is_default).toLowerCase() === 'true',
      sort: +sort || 0,
      visible: String(visible).toLowerCase() !== 'false',
      dep_group: cleanStr(dep_group || ''),
      dep_groupCanon,
      dep_value: cleanStr(dep_value || '')
    });
  });

  // ---- Specs: keep your original card/table build, filter by A == model
  // Original column intent:
  // A model_id, B section, C label, D value, E sort
  const sIdx = headerIndex(specT);
  const specs = {};
  rows(specT).forEach(row => {
    const a_model = cleanStr(cellByHeader(row, sIdx, 'model_id') ?? row[0]);
    if (a_model !== model) return;

    const section = cleanStr(cellByHeader(row, sIdx, 'section') ?? row[1]);
    const label   = cleanStr(cellByHeader(row, sIdx, 'label')   ?? row[2]);
    const value   = cleanStr(cellByHeader(row, sIdx, 'value')   ?? row[3]);
    const sort    = +(cellByHeader(row, sIdx, 'sort') ?? row[4] ?? 0) || 0;

    if (!section || !label || !value) return;
    if (!specs[section]) specs[section] = [];
    specs[section].push({ label, value, sort });
  });

  LemonState.product = product;
  LemonState.optionsByCanon = optionsByCanon;
  LemonState.groupNameMap = groupNameMap;
  LemonState.specs = specs;

  return { product, optionsByCanon, groupNameMap, specs };
}

/* ==== RENDER (identical UI as your original) ==== */
function renderHeader(p) {
  const series = cleanStr(p.series);
  const model  = cleanStr(p.title || p.model_id || '');

  const seriesEl = document.getElementById('seriesText');
  if (seriesEl) seriesEl.textContent = series ? `Lemon Banjos — ${series}` : 'Lemon Banjos';

  const titleEl = document.getElementById('productTitle');
  if (titleEl) titleEl.textContent = model;

  const priceEl = document.getElementById('productPrice');
  if (priceEl) {
    priceEl.textContent = fmtUSD(p.base_price);
    priceEl.dataset.base = p.base_price;
  }

  document.title = series ? `Lemon “${series}” ${model}` : `Lemon ${model}`;
}

function renderOptions(optionsByCanon, groupNameMap) {
  const host = document.getElementById('productOptions');
  const selected = LemonState.selected = LemonState.selected || new Map();

  // Keep original provider/dependent behavior
  const entries = Object.entries(optionsByCanon).map(([gCanon, list]) => [gCanon, [...list].sort((a,b)=>a.sort-b.sort)]);
  const isDependent = ([, list]) => list.some(o => o.dep_groupCanon);
  const providers  = entries.filter(e => !isDependent(e));
  const dependents = entries.filter(e =>  isDependent(e));

  // Defaults for providers first
  for (const [gCanon, list] of providers) {
    const visible = list.filter(o => o.visible);
    if (!visible.length) { selected.delete(gCanon); continue; }
    const next = chooseDefault(visible, selected.get(gCanon));
    if (next) selected.set(gCanon, next);
  }

  function pruneInvalidDependents() {
    for (const [gCanon, list] of dependents) {
      const valid = list.filter(o => o.visible && dependencyOk(o, selected));
      if (!valid.length) selected.delete(gCanon);
    }
  }
  function normalizeDependents() {
    for (const [gCanon, list] of dependents) {
      const valid = list.filter(o => o.visible && dependencyOk(o, selected));
      const next = chooseDefault(valid, selected.get(gCanon));
      if (next) selected.set(gCanon, next);
      else selected.delete(gCanon);
    }
  }

  function draw() {
    pruneInvalidDependents();
    normalizeDependents();

    host.innerHTML = '';
    const ordered = [...providers, ...dependents];

    for (const [gCanon, list] of ordered) {
      const labelText = groupNameMap[gCanon] || gCanon;
      const valid = list.filter(o => o.visible && (!o.dep_groupCanon || dependencyOk(o, selected)));
      if (!valid.length) continue;

      const wrap = document.createElement('div');
      wrap.className = 'option-block';

      const label = document.createElement('p');
      label.textContent = labelText;
      wrap.appendChild(label);

      const sel = document.createElement('select');
      sel.name = labelText.replace(/\s+/g, '_');

      const current = selected.get(gCanon);
      valid.forEach(o => {
        const el = document.createElement('option');
        el.value = o.option_name;
        const bump = o.price_delta
          ? (o.price_type === 'pct' ? ` (+${o.price_delta}%)` : ` (+${fmtUSD(o.price_delta)})`)
          : '';
        el.textContent = o.option_name + bump;
        el.selected = (o.option_name === current);
        sel.appendChild(el);
      });

      sel.addEventListener('change', e => {
        selected.set(gCanon, e.target.value);
        const changingIsProvider = providers.some(([pCanon]) => pCanon === gCanon);
        if (changingIsProvider) pruneInvalidDependents();
        draw();
      });

      wrap.appendChild(sel);
      host.appendChild(wrap);
    }

    const baseNum = +(document.getElementById('productPrice')?.dataset.base || 0);
    const total = calcPrice(baseNum, selected, optionsByCanon);
    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = fmtUSD(total);
    LemonState.total = total;
  }

  draw();
}

function renderSpecs(specs) {
  const grid = document.getElementById('specsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.entries(specs).forEach(([section, arr]) => {
    arr.sort((a, b) => a.sort - b.sort);
    const rowsClean = arr
      .map(r => ({ label: cleanStr(r.label), value: cleanStr(r.value) }))
      .filter(r => r.label && r.value);
    if (!rowsClean.length) return;

    const card = document.createElement('article');
    card.className = 'spec-card';
    card.innerHTML = `
      <header><h3>${section}</h3></header>
      <table class="spec-table">
        ${rowsClean.map(r => `<tr><th>${r.label}</th><td>${r.value}</td></tr>`).join('')}
      </table>`;
    grid.appendChild(card);
  });
}

/* ==== INIT ==== */
(async function init() {
  try {
    const { product, optionsByCanon, groupNameMap, specs } = await loadData(MODEL);
    renderHeader(product);
    renderOptions(optionsByCanon, groupNameMap);
    renderSpecs(specs);
  } catch (err) {
    console.error('Failed to load config:', err);
    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = 'Price unavailable';
  }
})();

/* ==== EmailJS Bridge ==== */
window.LemonBanjo = window.LemonBanjo || {};
window.LemonBanjo.getConfig = function () {
  const p = LemonState.product || {};
  const base_price = Number(p.base_price || 0);
  const final_price = Number(LemonState.total || base_price);
  const series = p.series || (document.getElementById('seriesText')?.textContent || '').replace(/^Lemon Banjos —\s*/,'') || '';
  const model  = p.title || p.model_id || '';

  const selections = {};
  (LemonState.selected || new Map()).forEach((val, canonKey) => {
    const displayGroup = (LemonState.groupNameMap && LemonState.groupNameMap[canonKey]) || canonKey;
    selections[displayGroup] = val;
  });

  return {
    model: p.model_id || '',
    series,
    title: model,
    base_price,
    final_price,
    selections
  };
};
