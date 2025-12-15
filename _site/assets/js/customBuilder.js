// =======================================================
//  Lemon Banjo - Custom Builder (Google Sheets Driven)
//  Based on your productInfo.js patterns
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ = (sheet, tq) =>
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({
    sheet,
    tq,
    tqx: 'out:json'
  }).toString();

async function gvizQuery(sheet, tq) {
  const url = GVIZ(sheet, tq);
  const res = await fetch(url, { cache: 'no-store' });
  const txt = await res.text();

  // Extract the JSON object from:
  // google.visualization.Query.setResponse({...});
  const jsonText = txt.substring(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  return JSON.parse(jsonText).table;
}

const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));
const cleanStr = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const canon = s => cleanStr(s).toLowerCase();

const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// ---------- KEY ----------
// Keeping this for future flexibility, but NOT used to query Products.
function getCustomKey() {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl && keyFromUrl.trim()) return keyFromUrl.trim().toUpperCase();

  const bodyKey = document.body?.dataset?.modelKey;
  if (bodyKey && bodyKey.trim()) return bodyKey.trim().toUpperCase();

  return 'CUSTOM'; // fallback
}

const CUSTOM_KEY = getCustomKey();

// ---------- STATE ----------
const BuilderState = {
  key: CUSTOM_KEY,
  product: null,         // { model_id, title, series, base_price, sale_price, sale_label, sale_active }
  optionsByCanon: null,  // { groupCanon: [ option... ] }
  groupNameMap: null,    // { groupCanon: displayName }
  selected: {}           // { groupCanon: option_name }
};

// ---------- LOAD DATA ----------
async function loadBuilderData(customKey) {
  const key = customKey || CUSTOM_KEY;

  // CustomBuilder mirrors Products sale behavior:
  // A=title, B=base_price, C=sale_price, D=sale_label, E=sale_active
  const [metaT, optT] = await Promise.all([
    gvizQuery('CustomBuilder', `select A,B,C,D,E`),
    gvizQuery('CustomBuilderOptions', `select A,B,C,D,E,F,G,H,I,J,K,L,M`)
  ]);

  // ---------- Meta (title/base/sale) ----------
  const metaRow = rows(metaT)[0] || [];
  const [
    mTitle,
    mBase,
    mSale,
    mSaleLabel,
    mSaleActive
  ] = metaRow;

  const base_price = Number(mBase || 0);
  const sale_price = Number(mSale || 0);

  const sale_active =
    !!(
      mSaleActive === true ||
      (typeof mSaleActive === 'string' && mSaleActive.toLowerCase() === 'true') ||
      (typeof mSaleActive === 'number' && mSaleActive === 1)
    ) && sale_price > 0;

  const product = {
    model_id: key, // you can keep CUSTOM_KEY here if you like
    title: cleanStr(mTitle) || 'Custom Banjo Builder',
    series: 'Custom Series',
    base_price,
    sale_price,
    sale_label: cleanStr(mSaleLabel),
    sale_active
  };

  // ---------- Options ----------
  const optionRows = rows(optT);

  const optionsByCanon = {};
  const groupNameMap = {};

  // Panels meta built from option rows
  const panelsByCanon = {};      // panelCanon -> { name, sort, open, groups: [] }
  const groupToPanelCanon = {};  // groupCanon -> panelCanon

  optionRows.forEach(row => {
    const [
      groupName,
      optName,
      priceDelta,
      priceType,
      isDefault,
      sort,
      visible,
      depGroup,
      depValue,
      panelName,
      panelSort,
      panelOpen,
      uiType // currently unused but reserved
    ] = row;

    const groupOrig = cleanStr(groupName);
    const optNameClean = cleanStr(optName);
    if (!groupOrig || !optNameClean) return;

    const groupCanon = canon(groupOrig);

    const price_delta = Number(priceDelta || 0);
    const pt = cleanStr(priceType).toLowerCase();
    const price_type = (pt === 'percent') ? 'percent' : 'flat';

    const sortNum = Number(sort || 0);
    const visibleBool =
      visible === true ||
      (typeof visible === 'string' && visible.toLowerCase() === 'true') ||
      (typeof visible === 'number' && visible === 1);

    const isDefBool =
      isDefault === true ||
      (typeof isDefault === 'string' && isDefault.toLowerCase() === 'true') ||
      (typeof isDefault === 'number' && isDefault === 1);

    const depGroupCanon = canon(depGroup);
    const depValClean = cleanStr(depValue);

    // Panel meta
    const panelNameClean = cleanStr(panelName) || 'General';
    const panelCanon = canon(panelNameClean);

    if (!panelsByCanon[panelCanon]) {
      panelsByCanon[panelCanon] = {
        panelCanon,
        panelName: panelNameClean,
        panelSort: Number(panelSort || 999),
        panelOpen:
          panelOpen === true ||
          (typeof panelOpen === 'string' && panelOpen.toLowerCase() === 'true') ||
          (typeof panelOpen === 'number' && panelOpen === 1),
        groups: []
      };
    }

    if (!groupToPanelCanon[groupCanon]) {
      groupToPanelCanon[groupCanon] = panelCanon;
      panelsByCanon[panelCanon].groups.push(groupCanon);
    }

    // store option
    if (!optionsByCanon[groupCanon]) optionsByCanon[groupCanon] = [];
    if (!groupNameMap[groupCanon]) groupNameMap[groupCanon] = groupOrig;

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
  is_default: isDefBool,
  ui_type: canon(uiType) // ← ADD THIS
});

  });

  // sort each group by sort (and stable fallback)
  Object.values(optionsByCanon).forEach(arr => {
    arr.sort((a, b) => (a.sort - b.sort) || a.option_name.localeCompare(b.option_name));
  });

  BuilderState.product = product;
  BuilderState.optionsByCanon = optionsByCanon;
  BuilderState.groupNameMap = groupNameMap;
  BuilderState.selected = {};
  BuilderState.panelsByCanon = panelsByCanon;
  BuilderState.groupToPanelCanon = groupToPanelCanon;

  return { product, optionsByCanon, groupNameMap, panelsByCanon, groupToPanelCanon };
}

// ---------- RENDER HEADER ----------
function renderHeader(product) {
	const pill = document.getElementById('salePill');
if (pill) {
  if (product.sale_active) {
    pill.style.display = 'inline-block';
    pill.textContent = product.sale_label || 'Sale';
  } else {
    pill.style.display = 'none';
    pill.textContent = '';
  }
}

  const seriesEl = document.getElementById('seriesText');
  const titleEl = document.getElementById('productTitle');

  if (seriesEl) seriesEl.textContent = product.series || 'Custom Series';
  if (titleEl) titleEl.textContent = product.title || 'Custom Banjo Builder';

  document.title = `${product.title || 'Custom Builder'} | Lemon Banjo`;
}

// ---------- build one option block ----------
function buildOptionBlock(groupCanon, opts, groupNameMap) {
  const displayName = groupNameMap[groupCanon] || groupCanon;

  const block = document.createElement('div');
  block.className = 'option-block';
  block.dataset.groupCanon = groupCanon;

  const labelP = document.createElement('p');
  labelP.textContent = displayName;
  block.appendChild(labelP);

  const select = document.createElement('select');
  select.className = 'option-select';
  select.dataset.groupCanon = groupCanon;

  let defaultName = null;

  opts.forEach(opt => {
    const optEl = document.createElement('option');
    optEl.value = opt.option_name;

    const delta = Number(opt.price_delta || 0);
    let suffix = '';

    if (opt.price_type === 'percent') {
      if (delta !== 0) {
        const sign = delta > 0 ? '+' : '';
        suffix = ` (${sign}${delta}%)`;
      }
    } else {
      if (delta !== 0) {
        const abs = Math.abs(delta);
        const sign = delta > 0 ? '+' : '-';
        suffix = ` (${sign}${fmtUSD(abs)})`;
      }
    }

    optEl.textContent = opt.option_name + suffix;

    if (opt.is_default && !defaultName) defaultName = opt.option_name;
    select.appendChild(optEl);
  });

  if (!defaultName && opts.length) defaultName = opts[0].option_name;
  BuilderState.selected[groupCanon] = defaultName;
  select.value = defaultName;

  select.addEventListener('change', () => {
    BuilderState.selected[groupCanon] = select.value;
    updateOptionVisibility();
    recalcPrice();
    updateEmailConfig();
  });

  block.appendChild(select);
  
  // ---------- TEXT INPUT (Name Block custom text) ----------
const textOpt = opts.find(o => o.ui_type === 'text');
if (textOpt) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'option-text-input';
  input.placeholder = 'Enter custom text…';
  input.style.display = 'none';

  // show ONLY when the matching option is selected
  const updateVisibility = () => {
    input.style.display = (select.value === textOpt.option_name) ? 'block' : 'none';
  };

  updateVisibility();

  select.addEventListener('change', updateVisibility);

  input.addEventListener('input', () => {
    BuilderState.selected[`${groupCanon}__text`] = input.value;
    updateEmailConfig();
  });

  block.appendChild(input);
}

  return block;
}

// ---------- Accordion behavior ----------
function setupDetailsAccordion(container) {
  const all = Array.from(container.querySelectorAll('details.custom-panel'));
  all.forEach(d => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      all.forEach(other => {
        if (other !== d) other.open = false;
      });
    });
  });
}

// ---------- RENDER OPTIONS (NOW IN <details> PANELS) ----------
function renderOptions(optionsByCanon, groupNameMap) {
  const container = document.getElementById('productOptions');
  if (!container) return;

  container.innerHTML = '';
  BuilderState.selected = BuilderState.selected || {};

  const panelsByCanon = BuilderState.panelsByCanon || {};
  const panelList = Object.values(panelsByCanon).sort((a, b) => a.panelSort - b.panelSort);

  // If no panels defined, fallback to old behavior (flat list)
  if (!panelList.length) {
    const entries = Object.entries(optionsByCanon);
    entries.forEach(([groupCanon, opts]) => {
      if (!opts?.length) return;
      container.appendChild(buildOptionBlock(groupCanon, opts, groupNameMap));
    });

    updateOptionVisibility();
    recalcPrice();
    updateEmailConfig();
    return;
  }

  // Render each panel as <details>
  panelList.forEach(panel => {
    const details = document.createElement('details');
    details.className = 'custom-panel';
    if (panel.panelOpen) details.open = true;

    const summary = document.createElement('summary');
    summary.textContent = panel.panelName;
    details.appendChild(summary);

    const inner = document.createElement('div');
    inner.className = 'custom-panel-inner';
    details.appendChild(inner);

    (panel.groups || []).forEach(groupCanon => {
      const opts = optionsByCanon[groupCanon];
      if (!opts?.length) return;
      inner.appendChild(buildOptionBlock(groupCanon, opts, groupNameMap));
    });

    container.appendChild(details);
  });

  setupDetailsAccordion(container);

  updateOptionVisibility();
  recalcPrice();
  updateEmailConfig();
}

// ---------- DEPENDENCY VISIBILITY ----------
function updateOptionVisibility() {
  const { optionsByCanon, selected } = BuilderState;
  if (!optionsByCanon) return;

  let changed = false;

  Object.entries(optionsByCanon).forEach(([groupCanon, opts]) => {
    const block = document.querySelector(`.option-block[data-group-canon="${groupCanon}"]`);
    const select = block?.querySelector('select');
    if (!block || !select) return;

    let anyVisible = false;

    opts.forEach((opt, idx) => {
      let show = opt.visible;

      if (show && opt.dep_groupCanon && opt.dep_value) {
        const depSel = selected[opt.dep_groupCanon];
        show = canon(depSel) === canon(opt.dep_value);
      }

      const optEl = select.options[idx];
      if (optEl) optEl.hidden = !show;

      if (show) anyVisible = true;
    });

    block.style.display = anyVisible ? '' : 'none';

    const currentVal = selected[groupCanon];
    const visibleOpts = opts
      .map((o, i) => ({ o, i }))
      .filter(x => !select.options[x.i].hidden);

    if (!visibleOpts.length) {
      if (selected[groupCanon]) {
        delete selected[groupCanon];
        changed = true;
      }
      return;
    }

    const stillVisible = visibleOpts.some(v => v.o.option_name === currentVal);
    if (!stillVisible) {
      const pick = visibleOpts.find(v => v.o.is_default) || visibleOpts[0];
      select.value = pick.o.option_name;
      selected[groupCanon] = pick.o.option_name;
      changed = true;
    }
  });

  if (changed) {
    recalcPrice();
    updateEmailConfig();
  }
}

// ---------- PRICE ----------
function recalcPrice() {
  const p = BuilderState.product;
  if (!p) return;

  const baseRegular = Number(p.base_price || 0);
  const baseSale = p.sale_active ? Number(p.sale_price || 0) : 0;

  let totalRegular = baseRegular;
  let totalSale = baseSale;

  const { optionsByCanon, selected } = BuilderState;

  Object.entries(optionsByCanon || {}).forEach(([groupCanon, opts]) => {
    const chosenName = selected[groupCanon];
    if (!chosenName) return;

    const opt = opts.find(o => o.option_name === chosenName);
    if (!opt) return;

    const delta = Number(opt.price_delta || 0);

    if (opt.price_type === 'percent') {
      totalRegular += baseRegular * (delta / 100);
      if (p.sale_active && totalSale > 0) totalSale += baseSale * (delta / 100);
    } else {
      totalRegular += delta;
      if (p.sale_active && totalSale > 0) totalSale += delta;
    }
  });

  const priceEl = document.getElementById('productPrice');
  if (priceEl) {
    if (p.sale_active && totalSale > 0) {
      priceEl.innerHTML = `
        <span class="price-original price-strike">${fmtUSD(totalRegular)}</span>
        <span class="price-sale">${fmtUSD(totalSale)}</span>
      `;
    } else {
      priceEl.textContent = fmtUSD(totalRegular);
    }
    priceEl.dataset.base = totalRegular.toString();
  }

  const basePriceEl = document.getElementById('productBasePrice');
  if (basePriceEl) {
    basePriceEl.textContent = `Base price: ${fmtUSD(baseRegular)}`;
  }
}

// ---------- EMAIL CONFIG ----------
function updateEmailConfig() {
  const p = BuilderState.product;
  if (!p || typeof window.LemonBanjo === 'undefined') return;

  const selections = {};
  const { groupNameMap, selected } = BuilderState;

Object.entries(selected || {}).forEach(([canonKey, val]) => {
  if (!val) return;

  if (canonKey.endsWith('__text')) {
    const baseKey = canonKey.replace('__text', '');
    const label = (groupNameMap && groupNameMap[baseKey]) || baseKey;
    selections[`${label} (Custom Text)`] = val;
    return;
  }

  const displayGroup = (groupNameMap && groupNameMap[canonKey]) || canonKey;
  selections[displayGroup] = val;
});


  const priceEl = document.getElementById('productPrice');
  const priceText = priceEl ? priceEl.textContent : '';
  const finalPriceNum = (() => {
    const match = priceText.match(/([\d,.]+)/g);
    if (!match) return Number(p.base_price || 0);
    const last = match[match.length - 1].replace(/,/g, '');
    const n = parseFloat(last);
    return isNaN(n) ? Number(p.base_price || 0) : n;
  })();

  window.LemonBanjo.setConfig({
    id: p.model_id || CUSTOM_KEY,
    model: p.model_id || CUSTOM_KEY,
    title: p.title || '',
    series: p.series || 'Custom Series',
    base_price: Number(p.base_price || 0),
    final_price: finalPriceNum,
    selections
  });
}

// ---------- INIT ----------
async function initCustomBuilder() {
  try {
    const { product, optionsByCanon, groupNameMap } = await loadBuilderData(CUSTOM_KEY);
    renderHeader(product);
    renderOptions(optionsByCanon, groupNameMap);
    recalcPrice();
    updateEmailConfig();
  } catch (err) {
    console.error('Error initializing custom builder', err);
    const titleEl = document.getElementById('productTitle');
    if (titleEl) titleEl.textContent = 'Custom Builder Not Available';
    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', initCustomBuilder);
