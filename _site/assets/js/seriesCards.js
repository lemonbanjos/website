// =======================================================
//  Series Cards Loader (Google Sheets Driven)
//  - Builds cards for each .card-grid
//  - Uses Products sheet:
//      A:key, B:title, C:Series Label,
//      D:base_price (regular), E:sale_price, F:sale_label, G:sale_active
//  - Derives image path from data-image-root + key
//  - Shows sale pricing (struck-through regular + red sale)
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
  const res = await fetch(GVIZ_SERIES(sheet, tq), { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

/**
 * Given a product key like "LEGACY35-LB-00" and an imageRoot like
 * "assets/product_images/35", return the path to the first numbered image
 * thumbnail:
 *
 *   "assets/product_images/35/lb-00/thumbnails/1.webp"
 *
 * Your folder structure per model should now look like:
 *   assets/product_images/35/lb-00/1.webp
 *   assets/product_images/35/lb-00/2.webp
 *   ...
 *   assets/product_images/35/lb-00/thumbnails/1.webp
 *   assets/product_images/35/lb-00/thumbnails/2.webp
 *   ...
 * (and optionally lightbox/1.webp, 2.webp, etc. for the product page)
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

  // Use the first numbered thumbnail for grid cards
  return `${safeRoot}/${slug}/1.webp`;
}


async function initSeriesCards() {
  const grids = Array.from(document.querySelectorAll('.card-grid'));
  if (!grids.length) return;

  // Pull all products once
  const prodTable = await gvizQuerySeries('Products', 'select A,B,C,D,E,F,G');
  const allProducts = rowsSeries(prodTable).map(row => {
    const [key, title, seriesLabel, basePrice, salePrice, saleLabel, saleActiveRaw] = row;

    const regularBase = Number(basePrice || 0);
    const saleBase    = Number(salePrice || 0);

    const saleActive =
      !!(
        saleActiveRaw === true ||
        (typeof saleActiveRaw === 'string' && saleActiveRaw.toLowerCase() === 'true') ||
        (typeof saleActiveRaw === 'number' && saleActiveRaw === 1)
      ) && saleBase > 0;

    const effectivePrice = saleActive ? saleBase : regularBase;

    return {
      key: cleanStrSeries(key),
      title: cleanStrSeries(title),
      seriesLabel: cleanStrSeries(seriesLabel),
      regularBase,
      saleBase,
      saleActive,
      saleLabel: cleanStrSeries(saleLabel),
      effectivePrice
    };
  }).filter(p => p.key);

  grids.forEach(grid => {
    const prefix   = cleanStrSeries(grid.dataset.seriesPrefix || "").toUpperCase();
    const allMode  = grid.dataset.allBanjos === "true";
    const imageRootAttr = cleanStrSeries(grid.dataset.imageRoot || "");

    let models;

    if (allMode) {
      models = allProducts.slice(); // copy all
    } else if (prefix) {
      models = allProducts.filter(p =>
        p.key.toUpperCase().startsWith(prefix + '-')
      );
    } else {
      return; // nothing to do
    }

    // Sort by *effective* price (sale if active, else regular)
    models.sort((a, b) => (a.effectivePrice || 0) - (b.effectivePrice || 0));

    // Remove loading message
    grid.querySelectorAll('.loading-message').forEach(m => m.remove());

    models.forEach(p => {
      const href = `banjo.html?key=${encodeURIComponent(p.key)}`;
      const aria = `View ${p.seriesLabel || ''} ${p.title || p.key}`;

      // Determine image root
      let imageRoot = imageRootAttr;
      if (!imageRoot) {
        // auto-root for All Banjos based on key prefix
        if (p.key.startsWith("LEGACY35"))      imageRoot = "assets/product_images/35";
        else if (p.key.startsWith("LEGACY54")) imageRoot = "assets/product_images/54";
        else if (p.key.startsWith("MASTER"))   imageRoot = "assets/product_images/master";
        else if (p.key.startsWith("OLDTIME"))  imageRoot = "assets/product_images/oldtime";
      }

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
      img.alt = `${p.seriesLabel || 'Lemon'} ${p.title || p.key} banjo`;
      img.className = 'card-img';

      const body = document.createElement('div');
      body.className = 'card-body';

      if (allMode && p.seriesLabel) {
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
    });
  });
}

// Kick it off on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initSeriesCards().catch(err => {
    console.error('Error initializing series cards', err);
  });
});
