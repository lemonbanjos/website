// LemonBanjos seriesCards.js (with sorting) - build 2026-01-29-1
// Sort defaults:
//  - Necks: Name A → Z
//  - Everything else: Price Low → High
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

// Use a proxy that works reliably on GitHub Pages.
// (corsproxy.io often returns 403 from GitHub Pages.)
function proxyUrl(rawUrl) {
  return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(rawUrl);
}

function gvizUrl(sheet, tq) {
  const raw =
    'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
    new URLSearchParams({ sheet, tq }).toString();
  return proxyUrl(raw);
}

const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));
const clean = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());
const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

async function gvizQuery(sheet, tq) {
  const res = await fetch(gvizUrl(sheet, tq));
  const txt = await res.text();

  // GViz responses look like: google.visualization.Query.setResponse({...});
  // Guard against proxy returning HTML/errors.
  if (!txt.includes('google.visualization.Query')) {
    throw new Error(`GViz response not detected for sheet="${sheet}". First 120 chars: ${txt.slice(0, 120)}`);
  }

  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

function buildImagePath(key, imageRoot) {
  const safeRoot = String(imageRoot || '').replace(/\/+$/, '');
  const parts = String(key || '').split('-');
  let slug;

  if (parts.length >= 3) slug = (parts[1] + '-' + parts[2]).toLowerCase();
  else if (parts.length === 2) slug = parts[1].toLowerCase();
  else slug = String(key || '').toLowerCase();

  return `${safeRoot}/${slug}/1.webp`;
}

function inferImageRoot(productsSheet, key) {
  const sheetLower = String(productsSheet || '').toLowerCase();
  const k = String(key || '');

  if (sheetLower.includes('neck')) return 'assets/product_images/necks';
  if (k.startsWith('LEGACY35')) return 'assets/product_images/35';
  if (k.startsWith('LEGACY54')) return 'assets/product_images/54';
  if (k.startsWith('MASTER')) return 'assets/product_images/master';
  if (k.startsWith('OLDTIME')) return 'assets/product_images/oldtime';
  return 'assets/product_images';
}

function allowedSortFields(productsSheet) {
  return String(productsSheet || '').toLowerCase().includes('neck')
    ? ['price', 'name']
    : ['price'];
}

function sortModels(models, field, dir) {
  const mul = dir === 'desc' ? -1 : 1;

  if (field === 'name') {
    models.sort((a, b) => {
      const at = (a.title || a.key || '').toString();
      const bt = (b.title || b.key || '').toString();
      return at.localeCompare(bt, undefined, { numeric: true, sensitivity: 'base' }) * mul;
    });
  } else {
    models.sort((a, b) => ((a.effectivePrice || 0) - (b.effectivePrice || 0)) * mul);
  }
}

// In-memory cache so multiple grids on the same page don't refetch
const _cache = new Map();

async function getProducts(productsSheet) {
  const sheet = clean(productsSheet) || 'Banjos';
  if (_cache.has(sheet)) return _cache.get(sheet);

  // A:key B:title C:series_label D:base E:sale F:sale_label G:sale_active K:visible
  const table = await gvizQuery(sheet, 'select A,B,C,D,E,F,G,K');

  const products = rows(table).map(r => {
    const [key, title, seriesLabel, basePrice, salePrice, saleLabel, saleActiveRaw, visibleRaw] = r;

    const regularBase = Number(basePrice || 0);
    const saleBase = Number(salePrice || 0);

    const saleActive =
      !!(
        saleActiveRaw === true ||
        (typeof saleActiveRaw === 'string' && saleActiveRaw.toLowerCase() === 'true') ||
        (typeof saleActiveRaw === 'number' && saleActiveRaw === 1)
      ) && saleBase > 0;

    const effectivePrice = saleActive ? saleBase : regularBase;

    const visible =
      visibleRaw == null ||
      visibleRaw === true ||
      (typeof visibleRaw === 'string' && visibleRaw.toLowerCase() === 'true') ||
      (typeof visibleRaw === 'number' && visibleRaw === 1);

    return {
      key: clean(key),
      title: clean(title),
      seriesLabel: clean(seriesLabel),
      regularBase,
      saleBase,
      saleActive,
      saleLabel: clean(saleLabel),
      effectivePrice,
      visible
    };
  }).filter(p => p.key && p.visible);

  _cache.set(sheet, products);
  return products;
}

function makeSortBar(grid, fields, initialField, initialDir, onChange) {
  const bar = document.createElement('div');
  bar.className = 'lb-sortbar';
  bar.style.display = 'flex';
  bar.style.gap = '10px';
  bar.style.alignItems = 'center';
  bar.style.justifyContent = 'flex-end';
  bar.style.margin = '14px 0 10px';
  bar.style.width = '100%';

  const label = document.createElement('span');
  label.textContent = 'Sort:';
  label.style.fontSize = '0.95rem';
  label.style.opacity = '0.85';

  const fieldSel = document.createElement('select');
  fieldSel.style.padding = '6px 8px';
  fieldSel.style.borderRadius = '8px';

  const dirSel = document.createElement('select');
  dirSel.style.padding = '6px 8px';
  dirSel.style.borderRadius = '8px';

  fields.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = (f === 'price') ? 'Price' : 'Name';
    fieldSel.appendChild(opt);
  });

  fieldSel.value = fields.includes(initialField) ? initialField : (fields[0] || 'price');

  function rebuildDir() {
    const f = fieldSel.value;
    dirSel.innerHTML = '';
    const opts = [
      { value: 'asc', label: (f === 'price') ? 'Low → High' : 'A → Z' },
      { value: 'desc', label: (f === 'price') ? 'High → Low' : 'Z → A' }
    ];
    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      dirSel.appendChild(opt);
    });
  }

  rebuildDir();
  dirSel.value = (initialDir === 'desc') ? 'desc' : 'asc';

  if (fields.length === 1) fieldSel.style.display = 'none';

  fieldSel.addEventListener('change', () => {
    rebuildDir();
    onChange(fieldSel.value, dirSel.value);
  });

  dirSel.addEventListener('change', () => {
    onChange(fieldSel.value, dirSel.value);
  });

  bar.appendChild(label);
  bar.appendChild(fieldSel);
  bar.appendChild(dirSel);

  grid.parentNode.insertBefore(bar, grid);
  return bar;
}

function clearCards(grid) {
  grid.querySelectorAll('.card-link-wrapper').forEach(n => n.remove());
}

function renderCards(grid, models, productsSheet, productPage, altNoun, imageRootAttr) {
  clearCards(grid);

  models.forEach(p => {
    const href = `${productPage}?key=${encodeURIComponent(p.key)}`;
    const imageRoot = imageRootAttr || inferImageRoot(productsSheet, p.key);
    const imgSrc = buildImagePath(p.key, imageRoot);

    const link = document.createElement('a');
    link.href = href;
    link.className = 'card-link-wrapper';

    const card = document.createElement('article');
    card.className = 'card';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = imgSrc;
    img.alt = `${p.seriesLabel || 'Lemon'} ${p.title || p.key} ${altNoun}`;
    img.className = 'card-img';

    const body = document.createElement('div');
    body.className = 'card-body';

    if (p.seriesLabel) {
      const seriesEl = document.createElement('div');
      seriesEl.className = 'card-series';
      seriesEl.textContent = p.seriesLabel;
      body.appendChild(seriesEl);
    }

    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    h3.textContent = p.title || p.key;

    const price = document.createElement('p');
    price.className = 'card-price';

    if (p.saleActive && p.saleBase > 0) {
      price.innerHTML = `
        <span class="card-price-original card-price-strike">Starting at ${fmtUSD(p.regularBase)}</span>
        <span class="card-price-sale">Now ${fmtUSD(p.saleBase)}</span>
      `;
    } else {
      price.textContent = p.regularBase ? `Starting at ${fmtUSD(p.regularBase)}` : '';
    }

    body.appendChild(h3);
    body.appendChild(price);
    card.appendChild(img);
    card.appendChild(body);
    link.appendChild(card);
    grid.appendChild(link);
  });
}

async function init() {
  const grids = [...document.querySelectorAll('.card-grid')];

  for (const grid of grids) {
    const productsSheet = clean(grid.dataset.productsSheet || '') || 'Banjos';
    const productPage = clean(grid.dataset.productPage || '') || 'banjo.html';
    const altNoun = clean(grid.dataset.altNoun || '') || 'banjo';
    const prefix = clean(grid.dataset.seriesPrefix || '').toUpperCase();
    const allMode =
      grid.dataset.allProducts === 'true' ||
      grid.dataset.allBanjos === 'true' ||
      grid.dataset.allNecks === 'true';
    const imageRootAttr = clean(grid.dataset.imageRoot || '');

    grid.querySelectorAll('.loading-message').forEach(m => m.remove());

    const all = await getProducts(productsSheet);

    let models = [];
    if (allMode) models = all.slice();
    else if (prefix) models = all.filter(p => p.key.toUpperCase().startsWith(prefix + '-'));
    else continue;

    const fields = allowedSortFields(productsSheet);

    let field = String(productsSheet || '').toLowerCase().includes('neck') ? 'name' : 'price';
    let dir = 'asc';
    if (!fields.includes(field)) field = fields[0] || 'price';

    const initialSorted = models.slice();
    sortModels(initialSorted, field, dir);
    renderCards(grid, initialSorted, productsSheet, productPage, altNoun, imageRootAttr);

    if (models.length >= 2) {
      makeSortBar(grid, fields, field, dir, (newField, newDir) => {
        field = newField || field;
        dir = newDir || dir;

        const copy = models.slice();
        sortModels(copy, field, dir);
        renderCards(grid, copy, productsSheet, productPage, altNoun, imageRootAttr);
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => console.error('seriesCards init failed', err));
});
