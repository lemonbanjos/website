// =======================================================
// Lemon Banjo Product Info — JSON-first loader
// - Primary: /data/Products.json, /data/Options.json, /data/Specs.json
// - Optional fallback: Google Sheets GViz (kept for emergencies)
// - Same rendering + EmailJS bridge as before
// =======================================================

/* ==== CONFIG ==== */
const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU'; // used only for fallback
const MODEL = (document.body.dataset.model || 'L3-00').trim();
const USE_GOOGLE_FALLBACK = true; // set to false to hard-require local JSON

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

/* ==== JSON & GViz helpers ==== */
async function fetchJSON(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function fetchText(url, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

// Accepts: (1) GViz JSON, (2) GViz wrapped, (3) callback-wrapped, (4) array-of-objects
function toGvizTable(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();

    if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed);
      if (obj && obj.table) return obj.table;
    }
    if (trimmed.startsWith(")]}'")) {
      const obj = JSON.parse(trimmed.replace(/^\)\]\}'\s*/, ''));
      if (obj && obj.table) return obj.table;
    }
    const wrapStart = 'google.visualization.Query.setResponse(';
    const i = trimmed.indexOf(wrapStart);
    if (i !== -1) {
      const start = i + wrapStart.length;
      const end = trimmed.lastIndexOf(')');
      const obj = JSON.parse(trimmed.slice(start, end));
      if (obj && obj.table) return obj.table;
    }
    // fallback parse as JSON array
    input = JSON.parse(trimmed);
  }

  if (Array.isArray(input) && input.length) {
    const headers = Object.keys(input[0]);
    return {
      cols: headers.map(h => ({ id: h, label: h, type: 'string' })),
      rows: input.map(row => ({ c: headers.map(h => ({ v: row[h] })) }))
    };
  }
  throw new Error('Unrecognized data format for GViz table');
}

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

/* ==== PRIMARY: local JSON (/data/*.json) ==== */
async function jsonSheet(sheetName) {
  // Ex: /data/Products.json
  return fetchJSON(`./data/${encodeURIComponent(sheetName)}.json`);
}

/* ==== FALLBACK: Google Sheets GViz (optional) ==== */
async function gvizSheet(sheetName) {
  const qs = new URLSearchParams({ sheet: sheetName, tq: 'select *' }).toString();
  const gvizDirect = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${qs}&tqx=out:json`;
  const proxied = `https://corsproxy.io/?${encodeURIComponent(gvizDirect)}`;
  const txt = await fetchText(proxied);
  return toGvizTable(txt);
}

/* ==== Load & normalize three tables ==== */
async function loadData(model) {
  let prodT, optT, specT;

  try {
    // --- Try local JSON first (fast, cacheable) ---
    const [prodArr, optArr, specArr] = await Promise.all([
      jsonSheet('Products'), jsonSheet('Options'), jsonSheet('Specs')
    ]);
    prodT = toGvizTable(prodArr);
    optT  = toGvizTable(optArr);
    specT = toGvizTable(specArr);
  } catch (e) {
    if (!USE_GOOGLE_FALLBACK) throw e;
    // --- If JSON missing/broken, fall back to Google once ---
    [prodT, optT, specT] = await Promise.all([
      gvizSheet('Products'), gvizSheet('Options'), gvizSheet('Specs')
    ]);
  }

  // ---- Products: find row for MODEL
  const pIdx = headerIndex(prodT);
  const prodRow = rows(prodT).find(r => {
    const idByHeader = cellByHeader(r, pIdx, 'model_id');
    const idFallback = r[0];
    return cleanStr(idByHeader ?? idFallback) === model;
  }) || [];

  const product = {
    model_id: cleanStr(cellByHeader(prodRow, pIdx, 'model_id') ?? prodRow[0]),
    title:    cleanStr(cellByHeader(prodRow, pIdx, 'title')    ?? prodRow[1]),
    series:   cleanStr(cellByHeader(prodRow, pIdx, 'series')   ?? prodRow[2]),
    base_price: +(cellByHeader(prodRow, pIdx, 'base_price') ?? prodRow[3] ?? 0) || 0
  };

  // ---- Options: A model_id, B group, C option_name, D price_delta, E price_type, F is_default, G sort, H visible, I dep_group, J dep_value
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

  // ---- Specs: A model_id, B section, C label, D value, E sort
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

/* ==== PRICING / DEPENDENCIES ==== */
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

/* ==== RENDER ==== */
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

  const entries = Object.entries(optionsByCanon).map(([gCanon, list]) => [gCanon, [...list].sort((a,b)=>a.sort-b.sort)]);
  const isDependent = ([, list]) => list.some(o => o.dep_groupCanon);
  const providers  = entries.filter(e => !isDependent(e));
  const dependents = entries.filter(e =>  isDependent(e));

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
