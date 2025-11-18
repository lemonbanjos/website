// =======================================================
//  Series Cards Loader (Google Sheets Driven)
//  - Builds cards for each .card-grid[data-series-prefix]
//  - Uses Products sheet: A:key, B:title, C:Series Label, D:base_price
//  - Derives image path from data-image-root + key
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

const cleanStr = v => (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());

const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

async function gvizQuery(sheet, tq) {
  const res = await fetch(GVIZ(sheet, tq), { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

/**
 * Given a product key like "LEGACY35-LB-00" and an imageRoot like
 * "assets/product_images/35", return a full path:
 *   "assets/product_images/35/lb-00/front.webp"
 */
function buildImagePath(key, imageRoot) {
  const safeRoot = imageRoot.replace(/\/+$/, ''); // trim trailing slashes

  const parts = String(key).split('-'); // ["LEGACY35","LB","00"]
  let slug;

  if (parts.length >= 3) {
    slug = (parts[1] + '-' + parts[2]).toLowerCase();
  } else if (parts.length === 2) {
    slug = parts[1].toLowerCase();
  } else {
    slug = String(key).toLowerCase();
  }

  return `${safeRoot}/${slug}/front.webp`;
}

async function initSeriesCards() {
  const grids = Array.from(document.querySelectorAll('.card-grid'));
  if (!grids.length) return;

  // Pull all products once; we'll filter per grid
  const prodTable = await gvizQuery('Products', 'select A,B,C,D');
  const all = rows(prodTable).map(row => {
    const [key, title, seriesLabel, basePrice] = row;
    return {
      key: cleanStr(key),          // e.g. "LEGACY35-LB-00"
      title: cleanStr(title),      // e.g. "LB-00"
      seriesLabel: cleanStr(seriesLabel),
      basePrice: Number(basePrice || 0)
    };
  }).filter(p => p.key); // keep only valid rows

grids.forEach(grid => {
  const prefix = cleanStr(grid.dataset.seriesPrefix || "").toUpperCase();
  const allMode = grid.dataset.allBanjos === "true";
  const imageRoot = cleanStr(grid.dataset.imageRoot || "");

  let models;

  if (allMode) {
    // Load ALL models in the sheet
    models = all.slice(); // shallow copy
  } else if (prefix) {
    // Only models matching the prefix
    models = all.filter(p =>
      p.key.toUpperCase().startsWith(prefix + '-')
    );
  } else {
    return; // nothing to load for this grid
  }
  
  // If this is the All Banjos page, sort by price (lowest → highest)
if (allMode) {
  models.sort((a, b) => (a.basePrice || 0) - (b.basePrice || 0));
}


  // Clear loading state
  grid.querySelectorAll('.loading-message').forEach(m => m.remove());


  models.forEach(p => {
    const href = `banjo.html?key=${encodeURIComponent(p.key)}`;
    const aria = `View ${p.seriesLabel || ''} ${p.title || p.key}`;

    // If all-banjos mode, choose image-root by SERIES PREFIX
    let derivedRoot = imageRoot;
    if (allMode && !derivedRoot) {
      // Example roots based on your current convention
      if (p.key.startsWith("LEGACY35")) derivedRoot = "assets/product_images/35";
      else if (p.key.startsWith("LEGACY54")) derivedRoot = "assets/product_images/54";
      else if (p.key.startsWith("MASTER"))   derivedRoot = "assets/product_images/master";
      else if (p.key.startsWith("OLDTIME"))       derivedRoot = "assets/product_images/oldtime";
      // You can add more here if needed
    }

    const imgSrc = buildImagePath(p.key, derivedRoot);

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

    // OPTIONAL: show series name above model name ONLY on All Banjos page
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
    priceP.textContent = p.basePrice
      ? 'Starting at ' + fmtUSD(p.basePrice)
      : '';

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
