// =======================================================
//  Lemon Banjo Product Info (Google Sheets Driven)
//  - Uses ?key=LEGACY35-LB-3 from URL
//  - Products sheet: A:key, B:title, C:series, D:base_price,
//                    E:sale_price, F:sale_label, G:sale_active, H:image_count
//  - Options sheet:  A:key, B:group, C:option_name, D:price_delta,
//                    E:price_type ("flat" or "percent"), F:is_default (TRUE/FALSE),
//                    G:sort, H:visible (TRUE/FALSE), I:dep_group, J:dep_value
//  - Specs sheet:    A:key, B:section, C:label, D:value, E:sort
//  - Builds options with dependencies + defaults
//  - Re-calculates regular + sale price on changes
//  - Builds image gallery from numbered images (1.webp, 2.webp, ...)
//  - Exposes window.LemonBanjo.getConfig() for EmailJS
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';

const GVIZ = (sheet, tq) =>
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?' +
  new URLSearchParams({ sheet, tq }).toString();

const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

const cleanStr = v =>
  (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());

const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// ---------- KEY / MODEL ----------

function getModelKey() {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl && keyFromUrl.trim()) {
    return keyFromUrl.trim();
  }
  const bodyKey = document.body?.dataset?.modelKey;
  if (bodyKey && bodyKey.trim()) {
    return bodyKey.trim();
  }
  console.warn('No ?key= provided, defaulting to LEGACY35-LB-00');
  return 'LEGACY35-LB-00';
}

const MODEL = getModelKey();

async function gvizQuery(sheet, tq) {
  const url = GVIZ(sheet, tq);
  const res = await fetch(url, { cache: 'no-store' });
  const txt = await res.text();
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}

// ---------- GLOBAL STATE ----------

const LemonState = {
  model: MODEL,          // e.g. "LEGACY35-LB-3"
  product: null,         // { model_id, title, series, base_price, sale_price, sale_label, sale_active, image_count }
  optionsByCanon: null,  // { groupCanon: [option, ...] }
  groupNameMap: null,    // { groupCanon: displayName }
  selected: {},          // { groupCanon: option_name }
  specs: null            // { section: [ {label,value,sort}, ... ] }
};

const canon = s => cleanStr(s).toLowerCase();

// ---------- IMAGE FOLDER HELPERS ----------

/**
 * Given a product key like "LEGACY35-LB-3", return the base folder
 * containing numbered webp images, e.g. "assets/product_images/35/lb-3".
 */
function getImageBaseFolder(modelKey) {
  const key = String(modelKey || '').toUpperCase();
  let root = 'assets/product_images';

  if (key.startsWith('LEGACY35')) root = 'assets/product_images/35';
  else if (key.startsWith('LEGACY54')) root = 'assets/product_images/54';
  else if (key.startsWith('MASTER')) root = 'assets/product_images/master';
  else if (key.startsWith('OLDTIME')) root = 'assets/product_images/oldtime';

  const parts = key.split('-'); // ["LEGACY35","LB","3"]
  let slug = '';

  if (parts.length >= 3) {
    slug = (parts[1] + '-' + parts[2]).toLowerCase();
  } else if (parts.length === 2) {
    slug = parts[1].toLowerCase();
  } else {
    slug = key.toLowerCase();
  }

  return root.replace(/\/+$/, '') + '/' + slug;
}

// ---------- LOAD DATA ----------

async function loadData(modelKey) {
  const key = modelKey || MODEL;

  const [prodT, optT, specT] = await Promise.all([
    gvizQuery('Products', `select A,B,C,D,E,F,G,H where A='${key}'`),
    gvizQuery('Options',  `select B,C,D,E,F,G,H,I,J where A='${key}'`),
    gvizQuery('Specs',    `select B,C,D,E where A='${key}' order by B asc, E asc`)
  ]);

  // ---------- Product ----------
  const prodRow = rows(prodT)[0] || [];
  const [pKey, pTitle, pSeries, pBase, pSale, pSaleLabel, pSaleActive, pImageCount] = prodRow;

  if (!pKey) {
    console.error('No product row found for key', key);
    throw new Error('Product not found');
  }

  const base_price = Number(pBase || 0);
  const sale_price = Number(pSale || 0);

  const sale_active =
    !!(
      pSaleActive === true ||
      (typeof pSaleActive === 'string' && pSaleActive.toLowerCase() === 'true') ||
      (typeof pSaleActive === 'number' && pSaleActive === 1)
    ) && sale_price > 0;

  const image_count = Number(pImageCount || 0) || 1;

  const product = {
    model_id: cleanStr(pKey),
    title: cleanStr(pTitle),
    series: cleanStr(pSeries),
    base_price,
    sale_price,
    sale_label: cleanStr(pSaleLabel),
    sale_active,
    image_count
  };

  // ---------- Options ----------
  const optionRows = rows(optT);
  const optionsByCanon = {};
  const groupNameMap = {};

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
      depValue
    ] = row;

    const groupOrig = cleanStr(groupName);
    if (!groupOrig) return;

    const groupCanon = canon(groupOrig);
    const optNameClean = cleanStr(optName);
    if (!optNameClean) return;

    const price_delta = Number(priceDelta || 0);
    const price_type = (cleanStr(priceType) || 'flat').toLowerCase() === 'percent'
      ? 'percent'
      : 'flat';

    const sortNum = Number(sort || 0);
    const visibleBool =
      visible === true ||
      (typeof visible === 'string' && visible.toLowerCase() === 'true') ||
      (typeof visible === 'number' && visible === 1);

    const depGroupCanon = canon(depGroup);
    const depValClean = cleanStr(depValue);

    const isDefBool =
      isDefault === true ||
      (typeof isDefault === 'string' && isDefault.toLowerCase() === 'true') ||
      (typeof isDefault === 'number' && isDefault === 1);

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
      is_default: isDefBool
    });
  });

  // ---------- Specs ----------
  const specRows = rows(specT);
  const specs = {};
  specRows.forEach(row => {
    const [section, label, value, sort] = row;
    const sec = cleanStr(section);
    const lab = cleanStr(label);
    const val = cleanStr(value);
    const srt = Number(sort || 0);
    if (!sec || !lab || !val) return;
    if (!specs[sec]) specs[sec] = [];
    specs[sec].push({ label: lab, value: val, sort: srt });
  });

  LemonState.product = product;
  LemonState.optionsByCanon = optionsByCanon;
  LemonState.groupNameMap = groupNameMap;
  LemonState.specs = specs;
  LemonState.selected = {};

  return { product, optionsByCanon, groupNameMap, specs };
}

// ---------- RENDER HEADER & DESCRIPTION ----------

function renderHeader(product) {
  const seriesEl = document.getElementById('seriesText');
  const titleEl = document.getElementById('productTitle');

  if (seriesEl) {
    seriesEl.textContent = product.series || 'Lemon Banjos';
  }
  if (titleEl) {
    titleEl.textContent = product.title || product.model_id;
  }

  if (product.title) {
    document.title = `${product.title} | Lemon Banjo`;
  }
}

// ---------- RENDER OPTIONS UI ----------

// ---------- RENDER OPTIONS UI (ALL AS DROPDOWNS) ----------

function renderOptions(optionsByCanon, groupNameMap) {
  const container = document.getElementById('productOptions');
  if (!container) return;

  container.innerHTML = '';
  LemonState.selected = LemonState.selected || {};

  const p = LemonState.product || {};
  const baseRegular = Number(p.base_price || 0);

  const entries = Object.entries(optionsByCanon); // keep sheet order

  entries.forEach(([groupCanon, options]) => {
    if (!options || !options.length) return;

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

    options.forEach((opt, idx) => {
      const optEl = document.createElement('option');
      optEl.value = opt.option_name;

      // ---- BUILD LABEL WITH PRICE DELTA ----
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
          const formatted = fmtUSD(abs); // e.g. $150.00
          const sign = delta > 0 ? '+' : '-';
          suffix = ` (${sign}${formatted.replace('$', '$')})`;
        } else {
          // Optional: mark included options
          // suffix = ' (Included)';
        }
      }

      optEl.textContent = opt.option_name + suffix;

      if (opt.is_default && !defaultName) {
        defaultName = opt.option_name;
      }

      select.appendChild(optEl);
    });

    // Fallback default: first option
    if (!defaultName && options.length) {
      defaultName = options[0].option_name;
    }

    // If we already had a selection saved (e.g. after redraw), use that
    const existing = LemonState.selected[groupCanon];
    const initialValue = existing || defaultName;

    if (initialValue) {
      LemonState.selected[groupCanon] = initialValue;
      select.value = initialValue;
    }

    select.addEventListener('change', () => {
      LemonState.selected[groupCanon] = select.value;
      recalcPrice();
      updateEmailConfig();
      updateOptionVisibility();
    });

    block.appendChild(select);
    container.appendChild(block);
  });

  // After initial render, apply visibility/dependency rules and recompute price
  updateOptionVisibility();
  recalcPrice();
  updateEmailConfig();
}



// ---------- OPTION VISIBILITY (DEPENDENCIES) ----------

// ---------- OPTION VISIBILITY (DEPENDENCIES) ----------

function updateOptionVisibility() {
  const state = LemonState;
  const { optionsByCanon, selected } = state;

  if (!optionsByCanon) return;

  let changedSelection = false;

  Object.entries(optionsByCanon).forEach(([groupCanon, opts]) => {
    const block = document.querySelector(`.option-block[data-group-canon="${groupCanon}"]`);
    if (!block) return;

    let anyVisible = false;

    const radios = block.querySelectorAll('input[type="radio"]');
    const select = block.querySelector('select');

    // First pass: apply visibility to each option
    opts.forEach((opt, idx) => {
      let show = opt.visible;

      if (show && opt.dep_groupCanon && opt.dep_value) {
        const depSel = selected[opt.dep_groupCanon];
        show = cleanStr(depSel).toLowerCase() === cleanStr(opt.dep_value).toLowerCase();
      }

      if (radios.length) {
        const radio = radios[idx];
        const label = block.querySelector(`label[for="${radio?.id}"]`);
        if (radio && label) {
          radio.parentElement.style.display = show ? '' : 'none';
          if (!show && radio.checked) {
            radio.checked = false;
            changedSelection = true;
          }
        }
      } else if (select) {
        const optEl = select.options[idx];
        if (optEl) {
          optEl.hidden = !show;
        }
      }

      if (show) anyVisible = true;
    });

    block.style.display = anyVisible ? '' : 'none';

    // Second pass: for <select>, if current selection is now hidden/invalid, pick a visible default
    if (select) {
      const currentVal = selected[groupCanon];
      const visibleIndices = [];
      for (let i = 0; i < select.options.length; i++) {
        if (!select.options[i].hidden) visibleIndices.push(i);
      }

      if (!visibleIndices.length) {
        // nothing visible, clear selection for this group
        if (selected[groupCanon]) {
          delete selected[groupCanon];
          changedSelection = true;
        }
        return;
      }

      const visibleOpts = visibleIndices.map(i => ({
        opt: opts[i],
        optEl: select.options[i]
      }));

      const stillVisible = visibleOpts.some(v => v.opt.option_name === currentVal);

      if (!stillVisible) {
        // Prefer a visible default if one exists
        let newChoice = visibleOpts.find(v => v.opt.is_default);
        if (!newChoice) newChoice = visibleOpts[0];

        if (newChoice) {
          select.value = newChoice.opt.option_name;
          selected[groupCanon] = newChoice.opt.option_name;
          changedSelection = true;
        }
      }
    }
  });

  // If any selection changed because of visibility/dependencies, recalc price once
  if (changedSelection) {
    recalcPrice();
    updateEmailConfig();
  }
}


// ---------- PRICE CALCULATION ----------

function recalcPrice() {
  const p = LemonState.product;
  if (!p) return;

  let baseRegular = Number(p.base_price || 0);
  let baseSale = p.sale_active ? Number(p.sale_price || 0) : 0;

  let totalRegular = baseRegular;
  let totalSale = baseSale;

  const { optionsByCanon, selected } = LemonState;

  if (optionsByCanon) {
    Object.entries(optionsByCanon).forEach(([groupCanon, opts]) => {
      const chosenName = selected[groupCanon];
      if (!chosenName) return;
      const opt = opts.find(o => o.option_name === chosenName);
      if (!opt) return;

      const delta = Number(opt.price_delta || 0);
      if (opt.price_type === 'percent') {
        totalRegular += baseRegular * (delta / 100);
        if (p.sale_active && totalSale > 0) {
          totalSale += baseSale * (delta / 100);
        }
      } else {
        totalRegular += delta;
        if (p.sale_active && totalSale > 0) {
          totalSale += delta;
        }
      }
    });
  }

  // Update DOM
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
	const basePriceEl = document.getElementById('productBasePrice');
if (basePriceEl) {
    basePriceEl.textContent = `Base price: ${fmtUSD(Number(p.base_price || 0))}`;
}
  }

  const priceBlock = document.querySelector('.product-price-block');
  if (priceBlock) {
    let badge = document.getElementById('saleBadge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'saleBadge';
      badge.className = 'sale-pill';
      priceBlock.appendChild(badge);
    }

    if (p.sale_active && p.sale_label) {
      badge.textContent = p.sale_label;
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  // Update config used by EmailJS
  updateEmailConfig();
}

// ---------- SPECS RENDER ----------

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
      </table>
    `;
    grid.appendChild(card);
  });
}

// ---------- GALLERY (numbered images + lightbox) ----------

function setupGallery(product) {
  const imageCount = Number(product.image_count || 0) || 1;
  const baseFolder = getImageBaseFolder(product.model_id);
  const thumbRail = document.getElementById('thumbRail') || document.querySelector('.thumb-rail');
  const mainImg = document.getElementById('mainImage');
  if (!thumbRail || !mainImg) return;

  thumbRail.innerHTML = '';

  const galleryImages = [];       // normal large images
  const lightboxImages = [];      // high-res lightbox images

  for (let i = 1; i <= imageCount; i++) {
    const large = `${baseFolder}/${i}.webp`;
    const thumb = `${baseFolder}/thumbnails/${i}.webp`;
    const lightboxSrc = `${baseFolder}/lightbox/${i}.webp`;

    const img = document.createElement('img');
    img.src = thumb;
    img.dataset.large = large;
    img.dataset.lightboxLarge = lightboxSrc;    // <-- NEW
    img.className = 'thumbnail';
    img.alt = `${product.title || 'Banjo'} view ${i}`;
    img.setAttribute('role', 'listitem');
    img.tabIndex = 0;

    if (i === 1) img.classList.add('active');

    img.addEventListener('click', () => {
      document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
      img.classList.add('active');
      mainImg.src = large;
      mainImg.dataset.large = large;
      mainImg.dataset.lightboxLarge = lightboxSrc;   // <-- NEW
    });

    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        img.click();
      }
    });

    thumbRail.appendChild(img);

    galleryImages.push(large);
    lightboxImages.push(lightboxSrc);   // <-- NEW ARRAY
  }

  // Set main image from #1
  mainImg.src = galleryImages[0];
  mainImg.dataset.large = galleryImages[0];
  mainImg.dataset.lightboxLarge = lightboxImages[0];
  mainImg.alt = `${product.title || 'Banjo'} – front`;
  mainImg.loading = 'lazy';

  // ----- Lightbox -----
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const closeBtn = lightbox?.querySelector('.close');
  const prevBtn = lightbox?.querySelector('.prev');
  const nextBtn = lightbox?.querySelector('.next');

  let currentIndex = 0;

  function openLightbox(src) {
    const idx = lightboxImages.indexOf(src);
    if (idx >= 0) currentIndex = idx;
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightbox.classList.add('open');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('open');
  }

  function showRelative(delta) {
    if (!lightboxImages.length || !lightboxImg) return;
    currentIndex = (currentIndex + delta + lightboxImages.length) % lightboxImages.length;
    lightboxImg.src = lightboxImages[currentIndex];
  }

  mainImg.addEventListener('click', () => {
    openLightbox(mainImg.dataset.lightboxLarge || mainImg.dataset.large);
  });

  closeBtn?.addEventListener('click', closeLightbox);
  prevBtn?.addEventListener('click', () => showRelative(-1));
  nextBtn?.addEventListener('click', () => showRelative(1));

  lightbox?.addEventListener('click', e => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', e => {
    if (!lightbox || !lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showRelative(-1);
    if (e.key === 'ArrowRight') showRelative(1);
  });
}


// ---------- EMAIL CONFIG ----------

function updateEmailConfig() {
  const p = LemonState.product;
  if (!p || typeof window.LemonBanjo === 'undefined') return;

  const priceEl = document.getElementById('productPrice');
  const priceText = priceEl ? priceEl.textContent : '';
  const basePrice = p.base_price;

  const selections = {};
  const { groupNameMap, selected } = LemonState;

  Object.entries(selected || {}).forEach(([canonKey, val]) => {
    if (!val) return;
    const displayGroup =
      (groupNameMap && groupNameMap[canonKey]) || canonKey;
    selections[displayGroup] = val;
  });

  const finalPriceNum = (() => {
    const match = priceText.match(/([\d,.]+)/g);
    if (!match) return basePrice;
    const last = match[match.length - 1].replace(/,/g, '');
    const n = parseFloat(last);
    return isNaN(n) ? basePrice : n;
  })();

  window.LemonBanjo.setConfig({
    id: p.model_id || MODEL,
    model: p.model_id || '',
    title: p.title || '',
    series: p.series || '',
    base_price: basePrice,
    final_price: finalPriceNum,
    selections
  });
}

// ---------- INIT ----------

async function initProductPage() {
  try {
    const { product, optionsByCanon, groupNameMap, specs } = await loadData(MODEL);
    renderHeader(product);
    renderOptions(optionsByCanon, groupNameMap);
    renderSpecs(specs);
    setupGallery(product);
    updateOptionVisibility();
    recalcPrice(); // also calls updateEmailConfig
  } catch (err) {
    console.error('Error initializing product page', err);
    const titleEl = document.getElementById('productTitle');
    if (titleEl) titleEl.textContent = 'Banjo Not Found';
    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', initProductPage);
