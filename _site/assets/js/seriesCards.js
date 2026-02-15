// =======================================================
//  Series Cards Loader (Google Sheets Driven) + Sorting UI
//  ✅ NO CORS PROXY REQUIRED (uses GViz JSONP responseHandler)
//  - Builds cards for each .card-grid
//  - Reads from a "products" sheet (default: Banjos)
//
//  Expected columns on the products sheet:
//      A:key, B:title, C:Series Label,
//      D:base_price (regular), E:sale_price, F:sale_label, G:sale_active,
//      K:visible (TRUE/FALSE/1/0)
//  - Derives image path from data-image-root + key
//  - Shows sale pricing (struck-through regular + sale)
//
//  Sorting:
//    * Necks: default Name A→Z; can sort Name/Price asc/desc
//    * Others: default Price Low→High; can sort Price asc/desc
//
//  Tip: append ?fresh=1 to bust any intermediate caching: page.html?fresh=1
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const rowsSeries = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

const cleanStrSeries = v =>
  (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());

const fmtUSDSeries = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// ---------- GViz JSONP (no CORS needed) ----------
function gvizJsonpUrl(sheet, tq, cbName) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?`;
  const params = new URLSearchParams({
    sheet,
    tq,
    tqx: `out:json;responseHandler:${cbName}`
  });

  // Optional cache-bust only when you ask for it
  const fresh = new URLSearchParams(window.location.search).has('fresh');
  if (fresh) params.set('_cb', String(Date.now()));

  return base + params.toString();
}

function gvizQuerySeries(sheet, tq) {
  return new Promise((resolve, reject) => {
    const sheetName = cleanStrSeries(sheet);
    const query = cleanStrSeries(tq);

    // Unique callback per request
    const cbName = `__lb_gviz_cb_${Date.now()}_${Math.floor(Math.random()*1e9)}`;

    const script = document.createElement('script');
    script.async = true;
    script.src = gvizJsonpUrl(sheetName, query, cbName);

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('GViz JSONP timed out'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (resp) => {
      cleanup();
      // resp is the GViz response object
      if (!resp || !resp.table) {
        reject(new Error('GViz returned no table'));
        return;
      }
      resolve(resp.table);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Failed to load GViz script'));
    };

    document.head.appendChild(script);
  });
}

/**
 * Given a product key like "LEGACY35-LB-00" and an imageRoot like
 * "assets/product_images/35", return the path to the first numbered image:
 *
 *   "assets/product_images/35/lb-00/1.webp"
 */
function buildImagePath(key, imageRoot) {
  const safeRoot = imageRoot.replace(/\/+$/, ''); // trim trailing slashes
  const parts = String(key).split('-');           // ["LEGACY35","LB","00"]
  let slug;

  if (parts.length >= 3) slug = (parts[1] + '-' + parts[2]).toLowerCase();
  else if (parts.length === 2) slug = parts[1].toLowerCase();
  else slug = String(key).toLowerCase();

  return `${safeRoot}/${slug}/1.webp`;
}

// Cache products per sheet so we don't request the same sheet repeatedly per page load
const _productsCache = new Map();

async function getProductsFromSheet(productsSheet) {
  const sheetName = cleanStrSeries(productsSheet) || 'Banjos';
  if (_productsCache.has(sheetName)) return _productsCache.get(sheetName);

  const prodTable = await gvizQuerySeries(sheetName, 'select A,B,C,D,E,F,G,K');

  const products = rowsSeries(prodTable).map(row => {
    const [key, title, seriesLabel, basePrice, salePrice, saleLabel, saleActiveRaw, visibleRaw] = row;

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
  }).filter(p => p.key && p.visible);

  _productsCache.set(sheetName, products);
  return products;
}

function inferImageRoot({ productsSheet, key }) {
  const sheetLower = String(productsSheet || '').toLowerCase();
  const k = String(key || '');

  if (sheetLower.includes('neck')) return 'assets/product_images/necks';
  if (k.startsWith('LEGACY35')) return 'assets/product_images/35';
  if (k.startsWith('LEGACY41')) return 'assets/product_images/41';
  if (k.startsWith('LEGACY54')) return 'assets/product_images/54';
  if (k.startsWith('LEGACY27')) return 'assets/product_images/27';
  if (k.startsWith('MASTER')) return 'assets/product_images/master';
  if (k.startsWith('OLDTIME')) return 'assets/product_images/oldtime';
  return 'assets/product_images';
}

// ---------- Sorting helpers ----------
function isNecksSheet(productsSheet) {
  return String(productsSheet || '').toLowerCase().includes('neck');
}
function allowedSortFields(productsSheet) {
  return isNecksSheet(productsSheet) ? ['name', 'price'] : ['price'];
}
function defaultSort(productsSheet) {
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
  } else {
    models.sort((a, b) => ((a.effectivePrice || 0) - (b.effectivePrice || 0)) * mul);
  }
}

function buildSortBar(grid, productsSheet, sortState, onChange) {
  const fields = allowedSortFields(productsSheet);

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

  fieldSel.value = fields.includes(sortState.field) ? sortState.field : fields[0];

  function rebuildDirOptions() {
    dirSel.innerHTML = '';
    const f = fieldSel.value;
    const opts =
      (f === 'price')
        ? [{ value: 'asc', label: 'Low → High' }, { value: 'desc', label: 'High → Low' }]
        : [{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }];

    opts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      dirSel.appendChild(opt);
    });
  }

  rebuildDirOptions();
  dirSel.value = (sortState.dir === 'desc') ? 'desc' : 'asc';

  if (fields.length === 1) fieldSel.style.display = 'none';

  fieldSel.addEventListener('change', () => {
    sortState.field = fieldSel.value;
    rebuildDirOptions();
    // keep direction if possible
    dirSel.value = sortState.dir = (dirSel.value === 'desc') ? 'desc' : 'asc';
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
}

function clearCards(grid) {
  grid.querySelectorAll('.card-link-wrapper').forEach(n => n.remove());
}

async function initSeriesCards() {
  const grids = Array.from(document.querySelectorAll('.card-grid'));
  if (!grids.length) return;

  for (const grid of grids) {
    const productsSheet = cleanStrSeries(grid.dataset.productsSheet || '') || 'Banjos';
    const productPage = cleanStrSeries(grid.dataset.productPage || '') || 'banjo.html';
    const altNoun = cleanStrSeries(grid.dataset.altNoun || '') || 'banjo';
    const prefix = cleanStrSeries(grid.dataset.seriesPrefix || '').toUpperCase();
    const seriesLabelFilter = cleanStrSeries(grid.dataset.seriesLabel || '');

    const allMode =
      grid.dataset.allProducts === 'true' ||
      grid.dataset.allBanjos === 'true' ||
      grid.dataset.allNecks === 'true';

    const imageRootAttr = cleanStrSeries(grid.dataset.imageRoot || '');

    const allProducts = await getProductsFromSheet(productsSheet);

    let baseModels;
    if (allMode) baseModels = allProducts.slice();
    else if (prefix) baseModels = allProducts.filter(p => p.key.toUpperCase().startsWith(prefix + '-'));
    else continue;

    // Optional: restrict this grid to only one series label (exact match)
    if (seriesLabelFilter) {
      baseModels = baseModels.filter(p => cleanStrSeries(p.seriesLabel) === seriesLabelFilter);
    }

    grid.querySelectorAll('.loading-message').forEach(m => m.remove());

    // Optional: auto-hide empty sections/grids to avoid blank headings
    if (!baseModels.length) {
      // Hide the closest wrapper section (or an explicit wrapper marked for auto-hide)
      const wrap = grid.closest('[data-auto-hide="true"]') || grid.closest('section') || grid;
      if (wrap) wrap.style.display = 'none';

      // If there are nav buttons that point at this section, hide those too
      const sectionId = (wrap && wrap.id) ? wrap.id : '';
      if (sectionId) {
        document.querySelectorAll(`[data-jump-to="${sectionId}"]`).forEach(a => {
          a.style.display = 'none';
        });
      }
      continue;
    }

    const sortState = defaultSort(productsSheet);

    const render = () => {
      const models = baseModels.slice();
      sortModels(models, sortState.field, sortState.dir);

      clearCards(grid);

      for (const p of models) {
        const href = `${productPage}?key=${encodeURIComponent(p.key)}`;
        const aria = `View ${p.seriesLabel || ''} ${p.title || p.key}`;

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
          priceP.textContent = p.regularBase ? `Starting at ${fmtUSDSeries(p.regularBase)}` : '';
        }

        body.appendChild(h3);
        body.appendChild(priceP);

        article.appendChild(img);
        article.appendChild(body);
        link.appendChild(article);
        grid.appendChild(link);
      }
    };

    if (baseModels.length >= 2) buildSortBar(grid, productsSheet, sortState, render);
    render();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSeriesCards().catch(err => {
    console.error('Error initializing series cards', err);
  });
});
