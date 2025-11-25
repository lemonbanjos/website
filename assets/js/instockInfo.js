// =======================================================
//  In-Stock Detail (Google Sheets Driven)
//  - Uses ?id=INSTOCK-0001 from URL
//  - Reads from InStock + InStockSpecs
//  - Uses column labels from table.cols as headers (normalized)
//  - Shows strike-through regular price + red sale price
//  - Adds red sale "pill" with sale_label
//  - Builds gallery from:
//        image_folder + numbered 1.webp…N.webp (using image_count)
//    and falls back to legacy front/back/headstock/etc if needed
//  - Exposes LemonBanjo.getConfig() for your email modal
// =======================================================

const IN_STOCK_SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ_STOCK = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + IN_STOCK_SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const sRows = t =>
  (t && t.rows ? t.rows : []).map(r =>
    (r.c || []).map(c => (c && c.v != null ? c.v : null))
  );

const sClean = v =>
  v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim();

const sFmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// Normalize header names so "Item ID", "item_id" etc. all map the same
function normalizeHeaderName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s_]+/g, ''); // "Item ID" -> "itemid", "image_folder" -> "imagefolder"
}

async function sQuery(sheet, tq) {
  const url = GVIZ_STOCK(sheet, tq);
  console.log('[InStockDetail] Fetching:', url);
  const res = await fetch(url, { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

function getInStockId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('id');
  if (fromUrl && String(fromUrl).trim()) {
    return String(fromUrl).trim();
  }
  const fromData = document.body?.dataset?.itemId;
  if (fromData && String(fromData).trim()) {
    return String(fromData).trim();
  }
  console.warn('[InStockDetail] No ?id=… found; falling back to INSTOCK-0001');
  return 'INSTOCK-0001';
}

const InStockState = {
  product: null,
  specs: {},
  totals: {
    regular: 0,
    sale: 0
  }
};

// ---------- LOAD DATA (using table.cols labels) ----------

async function loadInStockData(itemId) {
  // ----- InStock main row -----
  const itemTable = await sQuery('InStock', 'select *');
  const itemRows  = sRows(itemTable);
  const itemCols  = itemTable.cols || [];

  if (!itemRows.length) throw new Error('InStock sheet has no data rows');

  const colIndex = {};
  itemCols.forEach((c, i) => {
    const label = c && c.label ? c.label : '';
    const norm = normalizeHeaderName(label);
    if (!norm) return;
    colIndex[norm] = i;
  });

  const col = (row, headerName) => {
    const norm = normalizeHeaderName(headerName);
    const i = colIndex[norm];
    return i == null ? null : row[i];
  };

  let foundRow = null;
  for (const row of itemRows) {
    const idVal = sClean(col(row, 'item_id')); // or "Item ID"
    if (!idVal) continue;
    if (idVal === itemId) {
      foundRow = row;
      break;
    }
  }

  if (!foundRow) {
    console.error('[InStockDetail] No row found for item_id =', itemId);
    throw new Error('InStock row not found');
  }

  const brand        = col(foundRow, 'brand');
  const model        = col(foundRow, 'model');
  const title        = col(foundRow, 'title');
  const price        = col(foundRow, 'price');
  const salePrice    = col(foundRow, 'sale_price');
  const saleLabel    = col(foundRow, 'sale_label');
  const saleActiveR  = col(foundRow, 'sale_active');
  const status       = col(foundRow, 'status');
  const condition    = col(foundRow, 'condition');
  const type         = col(foundRow, 'type');
  const year         = col(foundRow, 'year');
  const imageFolder  = col(foundRow, 'image_folder');      // or "Image Folder"
  const imageCount   = col(foundRow, 'image_count');
  const sortOrder    = col(foundRow, 'sort_order');
  const shortDesc    = col(foundRow, 'short_description'); // optional

  const regularPrice = Number(price || 0);
  const salePriceNum = Number(salePrice || 0);

  const saleActive =
    !!(
      saleActiveR === true ||
      (typeof saleActiveR === 'string' && saleActiveR.toLowerCase() === 'true') ||
      (typeof saleActiveR === 'number' && saleActiveR === 1)
    ) && salePriceNum > 0;

  const product = {
    item_id: itemId,
    brand: sClean(brand),
    model: sClean(model),
    title: sClean(title || itemId),
    regularPrice,
    salePrice: salePriceNum,
    saleActive,
    saleLabel: sClean(saleLabel),
    status: sClean(status),
    condition: sClean(condition),
    type: sClean(type),
    year: sClean(year),
    imageFolder: sClean(imageFolder),
    sortOrder: Number(sortOrder || 0),
    shortDesc: sClean(shortDesc),
    imageCount: Number(imageCount || 0) || 0
  };

  // ----- InStockSpecs rows -----
  const specTable = await sQuery('InStockSpecs', 'select *');
  const specRows  = sRows(specTable);
  const specCols  = specTable.cols || [];

  const sIndex = {};
  specCols.forEach((c, i) => {
    const label = c && c.label ? c.label : '';
    const norm = normalizeHeaderName(label);
    if (!norm) return;
    sIndex[norm] = i;
  });

  const scol = (row, headerName) => {
    const norm = normalizeHeaderName(headerName);
    const i = sIndex[norm];
    return i == null ? null : row[i];
  };

  const specs = {};
  specRows.forEach(row => {
    const rowId  = sClean(scol(row, 'item_id'));
    if (rowId !== itemId) return;
    const section = sClean(scol(row, 'section'));
    const label   = sClean(scol(row, 'label'));
    const value   = sClean(scol(row, 'value'));
    const sort    = Number(scol(row, 'sort') || 0);
    if (!section || !label || !value) return;
    if (!specs[section]) specs[section] = [];
    specs[section].push({ label, value, sort });
  });

  InStockState.product = product;
  InStockState.specs   = specs;
  InStockState.totals.regular = regularPrice;
  InStockState.totals.sale    = saleActive ? salePriceNum : 0;

  return { product, specs };
}

// ---------- RENDER HEADER, DESCRIPTION, PRICE ----------

function renderInStockHeader(p) {
  const seriesEl = document.getElementById('seriesText');
  const titleEl  = document.getElementById('productTitle');

  if (seriesEl) {
    seriesEl.textContent = p.brand
      ? `In-Stock — ${p.brand}`
      : 'In-Stock Banjo';
  }

  if (titleEl) {
    titleEl.textContent = p.title || 'In-Stock Banjo';
  }

  const metaBits = [];
  if (p.year)      metaBits.push(p.year);
  if (p.type)      metaBits.push(p.type);
  if (p.condition) metaBits.push(p.condition);
  if (p.status)    metaBits.push(p.status);
  const metaText = metaBits.join(' • ');

  const descEl = document.getElementById('productDescription');
  if (descEl) {
    const parts = [];
    if (p.shortDesc) parts.push(p.shortDesc);
    if (metaText)    parts.push(metaText);
    descEl.textContent = parts.join(' — ');
  }

  if (p.title) {
    document.title = `${p.title} | In-Stock Banjo`;
  }
}

function renderInStockPrice(p) {
  const priceEl = document.getElementById('productPrice');
  if (!priceEl) return;

  if (p.saleActive && p.salePrice > 0) {
    priceEl.innerHTML = `
      <span class="price-original price-strike">${sFmtUSD(p.regularPrice)}</span>
      <span class="price-sale">${sFmtUSD(p.salePrice)}</span>
    `;
  } else {
    priceEl.textContent = sFmtUSD(p.regularPrice);
  }

  // Base price for emailJS
  priceEl.dataset.base = p.regularPrice.toString();

  // Sale pill
  const priceBlock = document.querySelector('.product-price-block');
  if (priceBlock) {
    let badge = document.getElementById('saleBadge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'saleBadge';
      badge.className = 'sale-pill';
      priceBlock.appendChild(badge);
    }

    if (p.saleActive && p.saleLabel) {
      badge.textContent = p.saleLabel;
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }
}

// ---------- RENDER SPECS ----------

function renderInStockSpecs(specs) {
  const grid = document.getElementById('specsGrid');
  if (!grid) return;

  grid.innerHTML = '';

  Object.entries(specs).forEach(([section, arr]) => {
    arr.sort((a, b) => a.sort - b.sort);
    const rowsClean = arr
      .map(r => ({ label: sClean(r.label), value: sClean(r.value) }))
      .filter(r => r.label && r.value);

    if (!rowsClean.length) return;

    const card = document.createElement('article');
    card.className = 'spec-card';
    card.innerHTML = `
      <header><h3>${section}</h3></header>
      <table class="spec-table">
        ${rowsClean.map(r => `<tr><th>${r.label}</th><td>${r.value}</td></tr>`).join('')}
      </table>
    `;
    grid.appendChild(card);
  });
}

// ---------- GALLERY (numbered images + fallback to legacy) ----------

function setupInStockGallery(p) {
  if (!p.imageFolder) {
    console.warn('[InStockDetail] No imageFolder for product', p);
    return;
  }

  const baseFolder = p.imageFolder.replace(/\/+$/, '');
  const thumbRail  = document.getElementById('thumbRail') || document.querySelector('.thumb-rail');
  const mainImg    = document.getElementById('mainImage');
  if (!thumbRail || !mainImg) return;

  thumbRail.innerHTML = '';

  const galleryImages  = []; // normal large images
  const lightboxImages = []; // high-res lightbox images (may 404 if not present)

  const count = Number(p.imageCount || 0);

  let currentIndex = 0;

  function pushImage(large, lightboxSrc) {
    galleryImages.push(large);
    lightboxImages.push(lightboxSrc || large);
  }

  function addThumb(large, thumb, lightboxSrc, altText, index) {
    const img = document.createElement('img');
    img.src = thumb;
    img.dataset.large = large;
    img.dataset.lightboxLarge = lightboxSrc || large;
    img.dataset.index = String(index);
    img.className = 'thumbnail';
    img.alt = altText;
    img.setAttribute('role', 'listitem');
    img.tabIndex = 0;

    if (index === 0) img.classList.add('active');

    img.addEventListener('click', () => {
      currentIndex = index;
      document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
      img.classList.add('active');
      mainImg.src = large;
      mainImg.dataset.large = large;
      mainImg.dataset.lightboxLarge = lightboxSrc || large;
      mainImg.dataset.index = String(index);
    });

    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        img.click();
      }
    });

    thumbRail.appendChild(img);
  }

  if (count > 0) {
    // New numbered scheme: 1.webp…N.webp
    for (let i = 1; i <= count; i++) {
      const large       = `${baseFolder}/${i}.webp`;
      const thumb       = `${baseFolder}/thumbnails/${i}.webp`;
      const lightboxSrc = `${baseFolder}/lightbox/${i}.webp`;

      pushImage(large, lightboxSrc);
      addThumb(large, thumb, lightboxSrc, `${p.title || 'Banjo'} view ${i}`, i - 1);
    }
  } else {
    // Legacy scheme fallback (front/back/headstock/block/side)
    const legacyFiles = [
      { slug: 'front.webp',          alt: 'Front view' },
      { slug: 'back.webp',           alt: 'Back view' },
      { slug: 'headstockFront.webp', alt: 'Headstock detail' },
      { slug: 'block.webp',          alt: 'Block rim detail' },
      { slug: 'side.webp',           alt: 'Side view' }
    ];

    legacyFiles.forEach((file, idx) => {
      const large       = `${baseFolder}/${file.slug}`;
      const thumb       = `${baseFolder}/thumbnails/${file.slug}`;
      const lightboxSrc = `${baseFolder}/lightbox/${file.slug}`;

      pushImage(large, lightboxSrc);
      addThumb(large, thumb, lightboxSrc, `${p.title || 'Banjo'} — ${file.alt}`, idx);
    });
  }

  if (!galleryImages.length) {
    console.warn('[InStockDetail] No gallery images for', p);
    return;
  }

  // Set main image from first entry
  currentIndex = 0;
  mainImg.src = galleryImages[0];
  mainImg.dataset.large = galleryImages[0];
  mainImg.dataset.lightboxLarge = lightboxImages[0];
  mainImg.dataset.index = '0';
  mainImg.alt = `${p.title || 'Banjo'} – front`;
  mainImg.loading = 'lazy';

  // ----- Lightbox wiring (index-based) -----
  const lightbox    = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const closeBtn    = lightbox?.querySelector('.close');
  const prevBtn     = lightbox?.querySelector('.prev');
  const nextBtn     = lightbox?.querySelector('.next');

  function openLightboxFromIndex(index) {
    if (!lightbox || !lightboxImg) return;
    if (!lightboxImages.length) return;

    currentIndex = ((index % lightboxImages.length) + lightboxImages.length) % lightboxImages.length;
    const src = lightboxImages[currentIndex] || galleryImages[currentIndex];
    lightboxImg.src = src;
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
  }

  function showRelative(delta) {
    if (!lightboxImages.length || !lightboxImg) return;
    const nextIndex = currentIndex + delta;
    openLightboxFromIndex(nextIndex);
  }

  mainImg.addEventListener('click', () => {
    const idxAttr = mainImg.dataset.index;
    const idx = idxAttr != null ? parseInt(idxAttr, 10) : currentIndex;
    openLightboxFromIndex(Number.isNaN(idx) ? 0 : idx);
  });

  closeBtn?.addEventListener('click', closeLightbox);
  prevBtn?.addEventListener('click', () => showRelative(-1));
  nextBtn?.addEventListener('click', () => showRelative(1));

  lightbox?.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', e => {
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   showRelative(-1);
    if (e.key === 'ArrowRight')  showRelative(1);
  });
}

// ---------- EMAIL CONFIG ----------

window.LemonBanjo = window.LemonBanjo || {
  _cfg: {},
  setConfig(cfg) {
    this._cfg = { ...this._cfg, ...cfg };
  },
  getConfig() {
    return this._cfg;
  }
};

function initInStockEmailConfig(p) {
  const regular = Number(p.regularPrice || 0);
  const sale    = p.saleActive ? Number(p.salePrice || 0) : 0;
  const final   = (p.saleActive && sale > 0) ? sale : regular;

  window.LemonBanjo.setConfig({
    id: p.item_id,
    model: p.model,
    title: p.title,
    series: p.brand ? `In-Stock — ${p.brand}` : 'In-Stock',
    base_price: regular,
    final_price: final,
    selections: {} // no options for in-stock instruments
  });
}

// ---------- INIT ----------

document.addEventListener('DOMContentLoaded', () => {
  const id = getInStockId();

  loadInStockData(id)
    .then(({ product, specs }) => {
      console.log('[InStockDetail] Loaded item', product);
      renderInStockHeader(product);
      renderInStockPrice(product);
      renderInStockSpecs(specs);
      setupInStockGallery(product);
      initInStockEmailConfig(product);
    })
    .catch(err => {
      console.error('[InStockDetail] Error loading in-stock item', err);
      const titleEl = document.getElementById('productTitle');
      if (titleEl) titleEl.textContent = 'In-Stock Banjo Not Found';
      const priceEl = document.getElementById('productPrice');
      if (priceEl) priceEl.textContent = '';
    });
});
