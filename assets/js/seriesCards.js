// =======================================================
//  Series Cards Loader (Google Sheets Driven) + Sorting UI
//  - Builds cards for each .card-grid
//  - Reads from a "products" sheet (default: Banjos)
//
//  Expected columns on the products sheet:
//      A:key, B:title, C:Series Label,
//      D:base_price (regular), E:sale_price, F:sale_label, G:sale_active,
//      K:visible (TRUE/FALSE/1/0)
//
//  - Derives image path from data-image-root + key
//  - Shows sale pricing (struck-through regular + sale)
//  - Adds per-page sorting:
//      * Necks: default Name A→Z, can sort by Name or Price (asc/desc)
//      * Others: default Price Low→High, can sort by Price (asc/desc)
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ_SERIES = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const rowsSeries = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

const cleanStrSeries = v =>
  (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());

const fmtUSDSeries = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

async function gvizQuerySeries(sheet, tq) {
  // Keep your original behavior
  const res = await fetch(GVIZ_SERIES(sheet, tq), { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

/**
 * Given a product key like "LEGACY35-LB-00" and an imageRoot like
 * "assets/product_images/35", return the path to the first numbered image:
 *
 *   "assets/product_images/35/lb-00/1.webp"
 *
 * Adjust slugging here if your folder naming changes.
 */
function buildImagePath(key, imageRoot) {
  const safeRoot = imageRoot.replace(/\/+$/, ''); // trim trailing slashes
  const parts = String(key).split('-');           // ["LEGACY35","LB","00"]
  let slug;

  if (parts.length >= 3) {
    slug = (parts[1] + '-' + parts[2]).toLowerCase();
  } else if (parts.length === 2) {
    slug = parts[1].toLowerCase();
  } else {
    slug = String(key).toLowerCase();
  }

  // Use the first numbered image for grid cards
  return `${safeRoot}/${slug}/1.webp`;
}

// Cache products per sheet so we don't fetch the same sheet multiple times
const _productsCache = new Map();

/**
 * Load products from a given sheet name (e.g., "Banjos" or "Necks")
 */
async function getProductsFromSheet(productsSheet) {
  const sheetName = cleanStrSeries(productsSheet) || 'Banjos';
  if (_productsCache.has(sheetName)) return _productsCache.get(sheetName);

  // NOTE: visible is in column K, so we select it explicitly
  const prodTable = await gvizQuerySeries(sheetName, 'select A,B,C,D,E,F,G,K');

  const products = rowsSeries(prodTable).map(row => {
    const [
      key,
      title,
      seriesLabel,
      basePrice,
      salePrice,
      saleLabel,
      saleActiveRaw,
      visibleRaw
    ] = row;

    const regularBase = Number(basePrice || 0);
    const saleBase    = Number(salePrice || 0);

    const saleActive =
      !!(
        saleActiveRaw === true ||
        (typeof saleActiveRaw === 'string' && saleActiveRaw.toLowerCase() === 'true') ||
        (typeof saleActiveRaw === 'number' && saleActiveRaw === 1)
      ) && saleBase > 0;

    const effectivePrice = saleActive ? saleBase : regularBase;

    // Treat null/blank as "visible"
    const visible =
      visibleRaw == null ||           // default: show if cell is empty
      visibleRaw === true ||
      (typeof visibleRaw === 'string' && visibleRaw.toLowerCase() === 'true') ||
      (typeof visibleRaw === 'number' && visibleRaw === 1);

    return {
      key: cleanStrSeries(key),
      title: cleanStrSeries(title),
      seriesLabel: cleanStrSeries(seriesLabel),
      regularBase,
      saleBase,
      saleActive,
      saleLabel: cleanStrSeries(saleLabel),
      effectivePrice,
      visible
    };
  }).filter(p => p.key && p.visible); // only show visible models

  _productsCache.set(sheetName, products);
  return products;
}

/**
 * Try to pick a reasonable default image root when none is provided.
 * You can override per-grid by setting data-image-root on the .card-grid element.
 */
function inferImageRoot({ productsSheet, key }) {
  const sheetLower = String(productsSheet || '').toLowerCase();
  const k = String(key || '');

  // If you're on the Necks sheet, default to a necks folder.
  if (sheetLower.includes('neck')) return 'assets/product_images/necks';

  // Otherwise, keep your existing banjo heuristics by key prefix.
  if (k.startsWith('LEGACY35')) return 'assets/product_images/35';
  if (k.startsWith('LEGACY54')) return 'assets/product_images/54';
  if (k.startsWith('MASTER'))   return 'assets/product_images/master';
  if (k.startsWith('OLDTIME'))  return 'assets/product_images/oldtime';

  // Fallback
  return 'assets/product_images';
}

// ---------- Sorting helpers ----------

function isNecksSheet(productsSheet) {
  return String(productsSheet || '').toLowerCase().includes('neck');
}

function allowedSortFields(productsSheet) {
  // Necks: name + price. Others: price only.
  return isNecksSheet(productsSheet) ? ['name', 'price'] : ['price'];
}

function defaultSort(productsSheet) {
  // Necks default: Name A→Z. Others: Price Low→High.
  return isNecksSheet(productsSheet)
    ? { field: 'name', dir: 'asc' }
    : { field: 'price', dir: 'asc' };
}

function sortModels(models, field, dir) {
  const mul = (dir === 'desc') ? -1 : 1;

  if (field === 'name') {
    models.sort((a, b) => {
      const at = (a.title || a.key || '').toString();
      const bt = (b.title || b.key || '').toString();
      return at.localeCompare(bt, undefined, { numeric: true, sensitivity: 'base' }) * mul;
    });
    return;
  }

  // price
  models.sort((a, b) => ((a.effectivePrice || 0) - (b.effectivePrice || 0)) * mul);
}

function buildSortBar(grid, productsSheet, sortState, onChange) {
  const fields = allowedSortFields(productsSheet);

  const bar = document.createElement('div');
  bar.className = 'lb-sortbar';
  // Inline styling so you don’t need CSS changes
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

  // Field options
  fields.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = (f === 'price') ? 'Price' : 'Name';
    fieldSel.appendChild(opt);
  });

  // Set default field
  fieldSel.value = fields.includes(sortState.field) ? sortState.field : fields[0];

  function rebuildDirOptions() {
    dirSel.innerHTML = '';
    const f = fieldSel.value;

    const opts =
      (f === 'price')
        ? [
            { value: 'asc',  label: 'Low → High' },
            { value: 'desc', label: 'High → Low' }
          ]
        : [
            { value: 'asc',  label: 'A → Z' },
            { value: 'desc', label: 'Z → A' }
          ];

    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      dirSel.appendChild(opt);
    });
  }

  rebuildDirOptions();

  // Set default direction (must be after rebuildDirOptions)
  dirSel.value = (sortState.dir === 'desc') ? 'desc' : 'asc';

  // If only price is allowed, hide the field selector
  if (fields.length === 1) fieldSel.style.display = 'none';

  fieldSel.addEventListener('change', () => {
    sortState.field = fieldSel.value;
    rebuildDirOptions();
    // keep direction if possible, else default to asc
    sortState.dir = (sortState.dir === 'desc') ? 'desc' : 'asc';
    dirSel.value = sortState.dir;
    onChange();
  });

  dirSel.addEventListener('change', () => {
    sortState.dir = dirSel.value;
    onChange();
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

// ---------- Main ----------

async function initSeriesCards() {
  const grids = Array.from(document.querySelectorAll('.card-grid'));
  if (!grids.length) return;

  // Process each grid independently (so different grids can point at different sheets)
  for (const grid of grids) {
    // Default to Banjos to match your renamed sheet
    const productsSheet = cleanStrSeries(grid.dataset.productsSheet || '') || 'Banjos';
    const productPage   = cleanStrSeries(grid.dataset.productPage || '') || 'banjo.html';
    const altNoun       = cleanStrSeries(grid.dataset.altNoun || '') || 'banjo';

    const prefix = cleanStrSeries(grid.dataset.seriesPrefix || '').toUpperCase();

    // Support a few flags (backwards compatible)
    const allMode =
      grid.dataset.allProducts === 'true' ||
      grid.dataset.allBanjos === 'true' ||
      grid.dataset.allNecks === 'true';

    const imageRootAttr = cleanStrSeries(grid.dataset.imageRoot || '');

    // Pull products from the sheet this grid points to
    const allProducts = await getProductsFromSheet(productsSheet);

    let baseModels;
    if (allMode) {
      baseModels = allProducts.slice(); // copy all
    } else if (prefix) {
      baseModels = allProducts.filter(p => p.key.toUpperCase().startsWith(prefix + '-'));
    } else {
      continue; // nothing to do
    }

    // Remove loading message
    grid.querySelectorAll('.loading-message').forEach(m => m.remove());

    // Sort state + UI
    const sortState = defaultSort(productsSheet);

    const render = () => {
      // use the same underlying set, always re-copy so we don't mutate the base list
      const models = baseModels.slice();
      sortModels(models, sortState.field, sortState.dir);

      clearCards(grid);

      for (const p of models) {
        const href = `${productPage}?key=${encodeURIComponent(p.key)}`;
        const aria = `View ${p.seriesLabel || ''} ${p.title || p.key}`;

        // Determine image root
        const imageRoot = imageRootAttr || inferImageRoot({ productsSheet, key: p.key });
        const imgSrc = buildImagePath(p.key, imageRoot);

        const link = document.createElement('a');
        link.href = href;
        link.className = 'card-link-wrapper';
        link.setAttribute('aria-label', aria);

        const article = document.createElement('article');
        article.className = 'card';
        article.dataset.modelKey = p.key;

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

        const priceP = document.createElement('p');
        priceP.className = 'card-price';

        if (p.saleActive && p.saleBase > 0) {
          priceP.innerHTML = `
            <span class="card-price-original card-price-strike">
              Starting at ${fmtUSDSeries(p.regularBase)}
            </span>
            <span class="card-price-sale">
              Now ${fmtUSDSeries(p.saleBase)}
            </span>
          `;
        } else {
          priceP.textContent = p.regularBase
            ? `Starting at ${fmtUSDSeries(p.regularBase)}`
            : '';
        }

        body.appendChild(h3);
        body.appendChild(priceP);

        article.appendChild(img);
        article.appendChild(body);
        link.appendChild(article);
        grid.appendChild(link);
      }
    };

    // Add sort UI (only if at least 2 items)
    if (baseModels.length >= 2) {
      buildSortBar(grid, productsSheet, sortState, render);
    }

    // Initial render
    render();
  }
}

// Kick it off on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initSeriesCards().catch(err => {
    console.error('Error initializing series cards', err);
  });
});
