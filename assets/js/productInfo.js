// =======================================================
//  Lemon Banjo Product Info (Google Sheets Driven)
//  - Canonicalized group names (fixes invisible/Unicode/spacing mismatches)
//  - Honors is_default for provider + dependent groups
//  - Robust dependency handling & auto-heal on changes
//  - Exposes window.LemonBanjo.getConfig() for EmailJS
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';
const GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const MODEL = document.body.dataset.model || 'L3-00';
const fmtUSD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ---------- GLOBAL STATE ----------
const LemonState = {
  model: MODEL,
  product: null,
  optionsByCanon: null,
  groupNameMap: null,
  specs: null,
  selected: new Map(),
  total: 0
};

// ---------- HELPERS ----------
const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));
const cleanStr = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const lc = v => cleanStr(v).toLowerCase();
const canon = s => cleanStr(s).normalize('NFKC').replace(/[^0-9A-Za-z]+/g, ' ').trim().toLowerCase();

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

// ---------- LOAD DATA ----------
async function loadData(model) {
  const [prodT, optT, specT] = await Promise.all([
    gvizQuery('Products', `select A,B,C,D where A='${model}'`),
    gvizQuery('Options',  `select B,C,D,E,F,G,H,I,J where A='${model}' order by B asc, G asc`),
    gvizQuery('Specs',    `select B,C,D,E where A='${model}' order by B asc, E asc`)
  ]);

  const [model_id, title, series, base_price] = rows(prodT)[0] || [];
  const product = { model_id, title, series, base_price: +base_price || 0 };

  const optionsByCanon = {};
  const groupNameMap = {};
  rows(optT).forEach(([group, option_name, price_delta, price_type, is_default, sort, visible, dep_group, dep_value]) => {
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

  const specs = {};
  rows(specT).forEach(([section, label, value, sort]) => {
    const sec = cleanStr(section);
    const lab = cleanStr(label);
    const val = cleanStr(value);
    if (!sec || !lab || !val) return;
    if (!specs[sec]) specs[sec] = [];
    specs[sec].push({ label: lab, value: val, sort: +sort || 0 });
  });

  LemonState.product = product;
  LemonState.optionsByCanon = optionsByCanon;
  LemonState.groupNameMap = groupNameMap;
  LemonState.specs = specs;
  return { product, optionsByCanon, groupNameMap, specs };
}

// ---------- RENDER ----------
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
    const rowsClean = arr.map(r => ({ label: cleanStr(r.label), value: cleanStr(r.value) }))
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
(async function init() {
  try {
    const { product, optionsByCanon, groupNameMap, specs } = await loadData(MODEL);
    renderHeader(product);
    renderOptions(optionsByCanon, groupNameMap);
    renderSpecs(specs);
  } catch (err) {
    console.error(err);
    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = 'Price unavailable';
  }
})();

/* =======================================================
 * EmailJS Bridge
 * ======================================================= */
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
