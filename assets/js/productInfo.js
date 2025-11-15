// =======================================================
//  Lemon Banjo Product Info (Google Sheets Driven)
//  - Uses ?key=LEGACY35-LB-3 from URL
//  - Builds options with dependencies + defaults
//  - Re-calculates price on changes
//  - Exposes window.LemonBanjo.getConfig() for EmailJS
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

// ---------- KEY / MODEL ----------

function getModelKey() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('key');
  if (fromUrl && String(fromUrl).trim()) {
    return String(fromUrl).trim().toUpperCase();
  }

  const fromData = document.body?.dataset?.model;
  if (fromData && String(fromData).trim()) {
    return String(fromData).trim().toUpperCase();
  }

  console.warn('No ?key=… found; falling back to LEGACY35-LB-00');
  return 'LEGACY35-LB-00';
}

const MODEL = getModelKey();
const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// ---------- GLOBAL STATE ----------

const LemonState = {
  model: MODEL,          // e.g. "LEGACY35-LB-3"
  product: null,         // { model_id, title, series, base_price }
  optionsByCanon: null,  // { groupCanon: [option, ...] }
  groupNameMap: null,    // { groupCanon: "Display Name" }
  specs: null,           // { section: [{ label, value, sort }, ...] }
  selected: new Map(),   // Map<groupCanon, option_name>
  total: 0
};

// ---------- HELPERS ----------

const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));
const cleanStr = v =>
  (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const lc = v => cleanStr(v).toLowerCase();
const canon = s =>
  cleanStr(s)
    .normalize('NFKC')
    .replace(/[^0-9A-Za-z]+/g, ' ')
    .trim()
    .toLowerCase();

async function gvizQuery(sheet, tq) {
  const res = await fetch(GVIZ(sheet, tq), { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

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

    if (item.price_type === 'add') {
      total += item.price_delta;
    } else if (item.price_type === 'pct') {
      total += base * (item.price_delta / 100);
    } else if (item.price_type === 'abs') {
      total += item.price_delta;
    }
  }
  return total;
}

function chooseDefault(validList, currentName) {
  if (!validList.length) return null;
  if (currentName && validList.some(o => o.option_name === currentName)) {
    return currentName;
  }
  const def = validList.find(o => o.is_default);
  return def ? def.option_name : validList[0].option_name;
}

// ---------- LOAD DATA FROM SHEET ----------
//
// Products sheet:
//   A: key          (e.g. "LEGACY35-LB-3")
//   B: title        (e.g. "LB-3")
//   C: Series Label (e.g. "Legacy ’35 Series")
//   D: base_price
//
// Options sheet (your current layout):
//   A: model_id
//   B: group
//   C: option_name
//   D: price_delta
//   E: price_type
//   F: is_default
//   G: sort
//   H: visible
//   I: dep_group
//   J: dep_value
//
// Specs sheet:
//   A: model_id
//   B: section
//   C: label
//   D: value
//   E: sort
// ---------------------------------------------------

async function loadData(modelKey) {
  const key = modelKey || MODEL;

  const [prodT, optT, specT] = await Promise.all([
    gvizQuery('Products', `select A,B,C,D where A='${key}'`),
    gvizQuery('Options',  `select B,C,D,E,F,G,H,I,J where A='${key}' order by B asc, G asc`),
    gvizQuery('Specs',    `select B,C,D,E where A='${key}' order by B asc, E asc`)
  ]);

  // ---------- Product ----------
  const [pKey, pTitle, pSeries, pBase] = rows(prodT)[0] || [];
  if (!pKey) {
    console.error('No product row found for key', key);
    throw new Error('Product not found');
  }

  const product = {
    model_id: pKey,
    title: cleanStr(pTitle || pKey),
    series: cleanStr(pSeries),          // already "Legacy ’35 Series"
    base_price: Number(pBase || 0)
  };

  // ---------- Options ----------
  const optionsByCanon = {};
  const groupNameMap = {};

  rows(optT).forEach(row => {
    const [
      groupName,
      optName,
      priceDelta,
      priceType,
      isDefault,
      sort,
      visible,
      depGroup,
      depValue
    ] = row;

    const groupOrig = cleanStr(groupName);
    if (!groupOrig) return;

    const groupCanon = canon(groupOrig);
    const optNameClean = cleanStr(optName);
    if (!optNameClean) return;

    const price_type  = cleanStr(priceType).toLowerCase();  // "add","pct","abs"
    const price_delta = Number(priceDelta || 0);
    const isDefBool   = (String(isDefault).toLowerCase() === 'true' || isDefault === true);
    const sortNum     = Number(sort || 0);
    const visibleBool = (String(visible).toLowerCase() === 'true' || visible === true);
    const depGroupCanon = depGroup ? canon(depGroup) : null;
    const depValClean   = depValue ? cleanStr(depValue) : null;

    if (!optionsByCanon[groupCanon]) optionsByCanon[groupCanon] = [];
    if (!groupNameMap[groupCanon])   groupNameMap[groupCanon] = groupOrig;

    optionsByCanon[groupCanon].push({
      groupCanon,
      groupName: groupOrig,
      option_name: optNameClean,
      price_type,
      price_delta,
      visible: visibleBool,
      sort: sortNum,
      dep_groupCanon: depGroupCanon,
      dep_value: depValClean,
      is_default: isDefBool
    });
  });

  // ---------- Specs ----------
  const specs = {};
  rows(specT).forEach(row => {
    const [section, label, value, sort] = row;
    const sec = cleanStr(section);
    const lab = cleanStr(label);
    const val = cleanStr(value);
    const sortNum = Number(sort || 0);
    if (!sec || !lab || !val) return;

    if (!specs[sec]) specs[sec] = [];
    specs[sec].push({ label: lab, value: val, sort: sortNum });
  });

  // ---------- Save to state ----------
  LemonState.product       = product;
  LemonState.optionsByCanon = optionsByCanon;
  LemonState.groupNameMap   = groupNameMap;
  LemonState.specs          = specs;
  LemonState.selected       = LemonState.selected || new Map();
  LemonState.total          = product.base_price;

  // Push into LemonBanjo config for EmailJS
  if (window.LemonBanjo && typeof window.LemonBanjo.setConfig === 'function') {
    window.LemonBanjo.setConfig({
      id: product.model_id,
      series: product.series,
      model: product.title,
      base_price: product.base_price,
      final_price: product.base_price
    });
  }

  return { product, optionsByCanon, groupNameMap, specs };
}

// ---------- RENDER ----------

function renderHeader(p) {
  const series = cleanStr(p.series);
  const model  = cleanStr(p.title || p.model_id || '');

  const seriesEl = document.getElementById('seriesText');
  if (seriesEl) {
    seriesEl.textContent = series
      ? `Lemon Banjos — ${series}`
      : 'Lemon Banjos';
  }

  const titleEl = document.getElementById('productTitle');
  if (titleEl && model) {
    titleEl.textContent = model;
  }

  const priceEl = document.getElementById('productPrice');
  if (priceEl) {
    priceEl.textContent = fmtUSD(p.base_price);
    priceEl.dataset.base = p.base_price;
  }

  if (model) {
    document.title = series
      ? `Lemon “${series}” ${model}`
      : `Lemon ${model}`;
  }
}

function renderOptions(optionsByCanon, groupNameMap) {
  const host = document.getElementById('productOptions');
  if (!host) return;

  const selected = LemonState.selected = LemonState.selected || new Map();

  const entries = Object.entries(optionsByCanon).map(([gCanon, list]) => [
    gCanon,
    [...list].sort((a, b) => a.sort - b.sort)
  ]);

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
          ? (o.price_type === 'pct'
              ? ` (+${o.price_delta}%)`
              : ` (+${fmtUSD(o.price_delta)})`)
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

    if (window.LemonBanjo && typeof window.LemonBanjo.setConfig === 'function') {
      window.LemonBanjo.setConfig({ final_price: total });
    }
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

// ---------- INIT ----------

document.addEventListener('DOMContentLoaded', () => {
  loadData(MODEL)
    .then(({ product, optionsByCanon, groupNameMap, specs }) => {
      renderHeader(product);
      renderOptions(optionsByCanon, groupNameMap);
      renderSpecs(specs);
    })
    .catch(err => {
      console.error(err);
      const priceEl = document.getElementById('productPrice');
      if (priceEl) priceEl.textContent = 'Price unavailable';
    });
});

// ---------- EMAILJS BRIDGE ----------

window.LemonBanjo = window.LemonBanjo || {};
window.LemonBanjo.getConfig = function () {
  const p = LemonState.product || {};
  const base_price = Number(p.base_price || 0);
  const final_price = Number(LemonState.total || base_price);

  const seriesText = (document.getElementById('seriesText')?.textContent || '');
  const series = p.series || seriesText.replace(/^Lemon Banjos —\s*/, '') || '';

  const modelTitle = p.title || p.model_id || '';

  const selections = {};
  (LemonState.selected || new Map()).forEach((val, canonKey) => {
    const displayGroup =
      (LemonState.groupNameMap && LemonState.groupNameMap[canonKey]) || canonKey;
    selections[displayGroup] = val;
  });

  return {
    id: p.model_id || MODEL,
    model: p.model_id || '',
    title: modelTitle,
    series,
    base_price,
    final_price,
    selections
  };
};
