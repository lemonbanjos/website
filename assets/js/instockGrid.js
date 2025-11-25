// =======================================================
//  In-Stock Grid Loader (Google Sheets Driven)
//  - Uses InStock sheet; reads columns by header label:
//      item_id, brand, model, title,
//      price, sale_price, sale_label, sale_active,
//      status, condition, type, year,
//      image_folder, image_count, sort_order
//  - Builds cards inside #instock-grid
//  - Shows sale pricing with strike + red sale price
//  - Image logic:
//      1) Try <image_folder>/thumbnails/1.webp
//      2) Fallback to <image_folder>/1.webp
//      3) Fallback to <image_folder>/front.webp
// =======================================================

const IN_STOCK_SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const IN_STOCK_GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + IN_STOCK_SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const inStockRows = t => (t && t.rows ? t.rows : []).map(r => (r.c || []).map(c => (c && c.v != null ? c.v : null)));

const inStockClean = v =>
  v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim();

const inStockFmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

async function inStockQuery(sheet, tq) {
  const url = IN_STOCK_GVIZ(sheet, tq);
  const res = await fetch(url, { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

async function initInStockGrid() {
  const grid = document.getElementById('instock-grid');
  if (!grid) {
    console.warn('[InStock] No #instock-grid element found.');
    return;
  }

  const loadingEl = grid.querySelector('.loading-message');

  try {
    const table = await inStockQuery('InStock', 'select *');
    const raw = inStockRows(table);
    const cols = table.cols || [];

    // Build header -> index map from table.cols.labels
    const colIndex = {};
    cols.forEach((c, i) => {
      const name = inStockClean(c.label);
      if (!name) return;
      colIndex[name.toLowerCase()] = i;
    });

    const col = (row, name) => {
      const i = colIndex[name.toLowerCase()];
      return i == null ? null : row[i];
    };

    const allItems = raw
      .map(row => {
        const itemId      = col(row, 'item_id');
        if (!itemId) return null;

        const brand       = col(row, 'brand');
        const model       = col(row, 'model');
        const title       = col(row, 'title');
        const price       = col(row, 'price');
        const salePrice   = col(row, 'sale_price');
        const saleLabel   = col(row, 'sale_label');
        const saleActiveR = col(row, 'sale_active');
        const status      = col(row, 'status');
        const condition   = col(row, 'condition');
        const type        = col(row, 'type');
        const year        = col(row, 'year');
        const imageFolder = col(row, 'image_folder');
        const imageCount  = col(row, 'image_count');
        const sortOrder   = col(row, 'sort_order');

        const regularPrice = Number(price || 0);
        const salePriceNum = Number(salePrice || 0);

        const saleActive =
          !!(
            saleActiveR === true ||
            (typeof saleActiveR === 'string' && saleActiveR.toLowerCase() === 'true') ||
            (typeof saleActiveR === 'number' && saleActiveR === 1)
          ) && salePriceNum > 0;

        const effectivePrice = saleActive ? salePriceNum : regularPrice;

        return {
          itemId: inStockClean(itemId),
          brand: inStockClean(brand),
          model: inStockClean(model),
          title: inStockClean(title || itemId),
          regularPrice,
          salePrice: salePriceNum,
          saleActive,
          saleLabel: inStockClean(saleLabel),
          status: inStockClean(status),
          condition: inStockClean(condition),
          type: inStockClean(type),
          year: inStockClean(year),
          imageFolder: inStockClean(imageFolder),
          imageCount: Number(imageCount || 0) || 0,
          sortOrder: Number(sortOrder || 9999),
          effectivePrice
        };
      })
      .filter(Boolean);

    console.log('[InStock] Loaded items:', allItems);

    if (loadingEl) loadingEl.remove();
    grid.innerHTML = '';

    if (!allItems.length) {
      const msg = document.createElement('p');
      msg.className = 'text-center';
      msg.textContent = 'No instruments currently in stock.';
      grid.appendChild(msg);
      return;
    }

    // Sort: sort_order first, then effective price
    allItems.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.effectivePrice || 0) - (b.effectivePrice || 0);
    });

    allItems.forEach(p => {
      const href = `instock-item.html?id=${encodeURIComponent(p.itemId)}`;
      const aria = `View in-stock banjo ${p.title}`;

      const link = document.createElement('a');
      link.href = href;
      link.className = 'card-link-wrapper';
      link.setAttribute('aria-label', aria);

      const article = document.createElement('article');
      article.className = 'card instock-card';
      article.dataset.itemId = p.itemId;

      // ------------ Image ------------
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.className = 'card-img';

      if (p.imageFolder) {
        const base = p.imageFolder.replace(/\/+$/, '') + '/';
        // Try numbered thumbnail, then numbered main, then legacy front.webp
        img.src = base + 'thumbnails/1.webp';
        img.onerror = () => {
          img.onerror = () => {
            img.onerror = null;
            img.src = base + 'front.webp';
          };
          img.src = base + '1.webp';
        };
      } else {
        img.src = 'assets/product_images/placeholder.webp';
      }

      img.alt = `${p.brand || 'Banjo'} ${p.model || ''}`.trim() + ' – in stock';

      const body = document.createElement('div');
      body.className = 'card-body';

      // Meta line: Brand • Year • Condition • Status
      const meta = document.createElement('div');
      meta.className = 'card-series';
      const bits = [];
      if (p.brand) bits.push(p.brand);
      if (p.year) bits.push(p.year);
      if (p.condition) bits.push(p.condition);
      if (p.status) bits.push(p.status);
      meta.textContent = bits.join(' • ');
      body.appendChild(meta);

      // Title
      const h3 = document.createElement('h3');
      h3.className = 'card-title';
      h3.textContent = p.title;
      body.appendChild(h3);

      // Price
      const priceP = document.createElement('p');
      priceP.className = 'card-price';

      if (p.saleActive && p.salePrice > 0) {
        priceP.innerHTML = `
          <span class="card-price-original card-price-strike">
            ${inStockFmtUSD(p.regularPrice)}
          </span>
          <span class="card-price-sale">
            ${inStockFmtUSD(p.salePrice)}
          </span>
        `;
      } else {
        priceP.textContent = p.regularPrice
          ? inStockFmtUSD(p.regularPrice)
          : '';
      }

      body.appendChild(priceP);

      article.appendChild(img);
      article.appendChild(body);
      link.appendChild(article);
      grid.appendChild(link);
    });

  } catch (err) {
    console.error('[InStock] Failed to load grid', err);
    if (loadingEl) loadingEl.remove();
    grid.innerHTML = '<p class="text-center">Could not load in-stock instruments.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initInStockGrid().catch(err => console.error('[InStock] init error', err));
});
