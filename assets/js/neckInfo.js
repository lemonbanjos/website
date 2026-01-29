// =======================================================
//  Lemon Banjo Product Info (Google Sheets Driven)
// =======================================================

const SHEET_ID = '1JaKOJLDKDgEvIg54UKKg2J3fftwOsZlKBw1j5qjeheU';


// Sheet tab names (Google Sheets)
const SHEETS = {
  products: 'Necks',
  options:  'Neck_Options',
  specs:    'Neck_Specs'
};
// -------------------------------------------------------
// GViz fetch + caching (fast loads, still updates)
// - Uses localStorage TTL cache
// - Add ?fresh=1 to bypass cache immediately
// -------------------------------------------------------
const LEMON_TTL_MS = 300000; // ms
const LEMON_FRESH = new URLSearchParams(location.search).has('fresh');

const GVIZ_BASE =
  'https://corsproxy.io/?' +
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?';

const GVIZ = (sheet, tq) =>
  GVIZ_BASE + new URLSearchParams({ sheet, tq }).toString();

function gvizCacheKey(sheet, tq) {
  return `lb_gviz:${SHEET_ID}:${sheet}:${tq}`;
}

async function fetchGvizText(sheet, tq) {
  const key = gvizCacheKey(sheet, tq);

  if (!LEMON_FRESH) {
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const { t, txt } = JSON.parse(cached);
        if (txt && Date.now() - t < LEMON_TTL_MS) {
          return txt; // ✅ instant
        }
      } catch (_) {}
    }
  }

  const res = await fetch(GVIZ(sheet, tq));
  const txt = await res.text();

  // Save cache if response looks like GViz payload
  if (!LEMON_FRESH && txt && txt.includes('google.visualization.Query')) {
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), txt }));
    } catch (_) {}
  }

  return txt;
}


const rows = t => (t?.rows || []).map(r => (r.c || []).map(c => c?.v ?? null));

const cleanStr = v =>
  (v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim());

const fmtUSD = n =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Number(n) || 0);

// ---------- DISPLAY TITLE HELPERS (NECK PAGES) ----------
// Keep the sheet title clean, but on neck pages we always show "Neck"
// in the H1, specs headings, and inquiry email payload.

function normalizeNeckTitle(raw) {
  const t = cleanStr(raw);
  if (!t) return '';
  return t.toLowerCase().endsWith(' neck') ? t : `${t} Neck`;
}

function getDisplayTitle(product) {
  const base = product?.title || product?.model_id || '';
  return normalizeNeckTitle(base) || base;
}

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
  console.warn('No ?key= provided, defaulting to NECK-DEFAULT');
  return 'NECK-DEFAULT';
}

const MODEL = getModelKey();

async function gvizQuery(sheet, tq) {
  const txt = await fetchGvizText(sheet, tq);
  const json = JSON.parse(txt.substring(47).slice(0, -2));
  return json.table;
}


// ---------- GLOBAL STATE ----------

const LemonState = {
  model: MODEL,          // e.g. "LEGACY35-LB-3"
  product: null,         // { model_id, title, series, base_price, sale_price, sale_label, sale_active, image_count, video_url, visible }
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

  if (key.startsWith('NECK')) root = 'assets/product_images/necks';
  else if (key.startsWith('LEGACY35')) root = 'assets/product_images/35';
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
    // NOTE: I (video URL) and K (visible)
    gvizQuery(SHEETS.products, `select A,B,C,D,E,F,G,H,I,K,L where A='${key}'`),
    gvizQuery(SHEETS.options,  `select B,C,D,E,F,G,H,I,J where A='${key}'`),
    gvizQuery(SHEETS.specs,    `select B,C,D,E where A='${key}' order by B asc, E asc`)
  ]);

  // ---------- Product ----------
  const prodRow = rows(prodT)[0] || [];
  // [key, title, series, base, sale, saleLabel, saleActive, imageCount, videoUrl, visible]
  const [
    pKey,
    pTitle,
    pSeries,
    pBase,
    pSale,
    pSaleLabel,
    pSaleActive,
    pImageCount,
    pVideoUrl,
    pVisible,
    pDescription
  ] = prodRow;

  if (!pKey) {
    console.error('No product row found for key', key);
    throw new Error('Product not found');
  }

  // Interpret visibility flag
  // Default: if cell is empty, treat as visible
  const visible =
    pVisible == null ||
    pVisible === true ||
    (typeof pVisible === 'string' && pVisible.toLowerCase() === 'true') ||
    (typeof pVisible === 'number' && pVisible === 1);

  // If not visible, treat as not found / unavailable
  if (!visible) {
    console.warn('Product is marked not visible in sheet; blocking page load for', key);
    throw new Error('Product not visible');
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
  const video_url = cleanStr(pVideoUrl); // may be empty

  const product = {
    model_id: cleanStr(pKey),
    title: cleanStr(pTitle),
    series: cleanStr(pSeries),
    base_price,
    sale_price,
    sale_label: cleanStr(pSaleLabel),
    sale_active,
    image_count,
    video_url,
    visible,
    description: cleanStr(pDescription)
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
      visibleOpt,
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
      visibleOpt === true ||
      (typeof visibleOpt === 'string' && visibleOpt.toLowerCase() === 'true') ||
      (typeof visibleOpt === 'number' && visibleOpt === 1);

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

  const displayTitle = getDisplayTitle(product);

  if (seriesEl) {
    seriesEl.textContent = product.series || 'Lemon Banjos';
  }
  if (titleEl) {
    titleEl.textContent = displayTitle || product.model_id;
  }

  // Let the page-level observer build the final <title>, but set a sane fallback.
  if (displayTitle) document.title = displayTitle;
}

function renderDescription(product) {
  const section = document.getElementById('descriptionSection');
  const p = document.getElementById('productDescription');
  const h2 = section?.querySelector('h2');
  if (!section || !p) return;

const desc = cleanStr(product.description);

// ⭐ Only remove the word "series" for this heading
const series = cleanStr(product.series).replace(/series/i, '').trim();
const name = getDisplayTitle(product) || product.model_id || 'Description';
const fullName = series ? `${series} ${name}` : name;

if (desc) {
  p.textContent = desc;
  if (h2) h2.textContent = `${fullName} — Description`;
  section.style.display = '';
} else {
  section.style.display = 'none';
}
}


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
      setupNameBlockUI();              // *** NAME BLOCK: keep textbox in sync
    });

    block.appendChild(select);

    // *** NAME BLOCK: add custom-text input inside the Name Block option block
    if (displayName.toLowerCase() === 'name block') {
      const wrapper = document.createElement('div');
      wrapper.id = 'nameBlockWrapper';
      wrapper.style.display = 'none';
      wrapper.style.marginTop = '0.35rem';

      const lbl = document.createElement('p');
      lbl.className = 'small';
      lbl.textContent = 'Custom name block text';
      wrapper.appendChild(lbl);

      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'nameBlockCustomInput';
      input.maxLength = 20;
      input.placeholder = 'Enter custom name (max 20)';
      input.className = 'option-select';
      input.style.width = '100%';

      wrapper.appendChild(input);
      block.appendChild(wrapper);
    }
    // *** END NAME BLOCK UI ***

    container.appendChild(block);
  });

  // After initial render, apply visibility/dependency rules and recompute price
  updateOptionVisibility();
  recalcPrice();
  updateEmailConfig();
  setupNameBlockUI();          // *** NAME BLOCK: initial state
}

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

  setupNameBlockUI();      // *** NAME BLOCK: respond to visibility changes
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
  const specsHeader = document.querySelector('.specs-section h2');

 if (specsHeader && LemonState?.product) {
  // ⭐ Only remove the word "series" for this heading
  const series = cleanStr(LemonState.product.series).replace(/series/i, '').trim();
  const name = getDisplayTitle(LemonState.product) || LemonState.product.model_id || 'Specifications';
  const fullName = series ? `${series} ${name}` : name;

  specsHeader.textContent = `${fullName} — Specifications`;
}

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

// ---------- VIDEO RENDER (NEW) ----------

function normalizeVideoUrl(raw) {
  const url = cleanStr(raw);
  if (!url) return '';

  // If it already looks like an embed, just use it
  if (url.includes('/embed/')) return url;

  // YouTube watch URL -> embed
  if (url.includes('youtube.com/watch')) {
    try {
      const u = new URL(url);
      const v = u.searchParams.get('v');
      if (v) {
        return `https://www.youtube.com/embed/${v}`;
      }
    } catch (e) {
      // fall through
    }
  }

  // youtu.be short link -> embed
  if (url.includes('youtu.be/')) {
    try {
      const u = new URL(url);
      const id = u.pathname.replace('/', '');
      if (id) {
        return `https://www.youtube.com/embed/${id}`;
      }
    } catch (e) {
      // fall through
    }
  }

  // Otherwise, just return what we were given
  return url;
}

function renderVideo(product) {
  const section = document.getElementById('videoSection');
  const iframe = document.getElementById('productVideo');
  const fallback = document.getElementById('videoFallback');

  if (!section || !iframe) return;

  // 🔊 Update video title to "Hear the <model name>"
  const headerTitle = section.querySelector('.video-card-header h2');
  if (headerTitle) {
    const title = product.title || product.model_id || 'This Banjo';
    headerTitle.textContent = `Hear the ${title}`;
  }

  const raw = product.video_url || '';
  const embed = normalizeVideoUrl(raw);

  if (embed) {
    iframe.src = embed;
    section.style.display = '';
    if (fallback) fallback.style.display = 'none';
  } else {
    // No video URL: hide iframe and show "coming soon" text
    iframe.src = '';
    if (fallback) fallback.style.display = '';
    // If you want to hide the entire section instead, uncomment:
    // section.style.display = 'none';
  }
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
    img.dataset.lightboxLarge = lightboxSrc;
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
      mainImg.dataset.lightboxLarge = lightboxSrc;
    });

    img.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        img.click();
      }
    });

    thumbRail.appendChild(img);

    galleryImages.push(large);
    lightboxImages.push(lightboxSrc);
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

// ---------- NAME BLOCK CUSTOM UI (NEW) ----------

function setupNameBlockUI() {
  const wrapper = document.getElementById('nameBlockWrapper');
  const input = document.getElementById('nameBlockCustomInput');
  if (!wrapper || !input) return;

  const { optionsByCanon, selected } = LemonState;

  if (!optionsByCanon) {
    wrapper.style.display = 'none';
    input.disabled = true;
    input.value = '';
    return;
  }

  const groupCanon = canon('Name Block');
  const opts = optionsByCanon[groupCanon];

  if (!opts || !opts.length) {
    wrapper.style.display = 'none';
    input.disabled = true;
    input.value = '';
    return;
  }

  const chosen = selected && selected[groupCanon];
  const isCustom = chosen && chosen.toLowerCase().startsWith('custom');

  if (isCustom) {
    wrapper.style.display = '';
    input.disabled = false;
  } else {
    wrapper.style.display = 'none';
    input.disabled = true;
    input.value = '';
  }

  if (!input.dataset.lbBound) {
    const max = parseInt(input.getAttribute('maxlength') || '20', 10);
    input.addEventListener('input', () => {
      if (input.value.length > max) input.value = input.value.slice(0, max);
    });
    input.dataset.lbBound = '1';
  }
}

// ---------- EMAIL CONFIG ----------

function updateEmailConfig() {
  const p = LemonState.product;
  if (!p || typeof window.LemonBanjo === 'undefined') return;

  const displayTitle = getDisplayTitle(p);

  const priceEl = document.getElementById('productPrice');
  const priceText = priceEl ? priceEl.textContent : '';
  const basePrice = p.base_price;

  const selections = {};
  const { groupNameMap, selected } = LemonState;

  Object.entries(selected || {}).forEach(([canonKey, val]) => {
    if (!val) return;
    const displayGroup =
      (groupNameMap && groupNameMap[canonKey]) || canonKey;

    let displayVal = val;

    // *** NAME BLOCK: append custom text when Custom is chosen
    if (displayGroup && displayGroup.toLowerCase() === 'name block') {
      const input = document.getElementById('nameBlockCustomInput');
      const customText = cleanStr(input?.value || '');
      if (val.toLowerCase().startsWith('custom')) {
        displayVal = customText
          ? `${val} ("${customText}")`
          : `${val} (no text entered)`;
      }
    }
    // *** END NAME BLOCK ***

    selections[displayGroup] = displayVal;
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
    // Use a human-friendly model name everywhere (always includes "Neck")
    model: displayTitle || p.model_id || '',
    title: displayTitle || p.title || '',
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
    renderDescription(product);
    renderOptions(optionsByCanon, groupNameMap);
    renderSpecs(specs);
    setupGallery(product);
    renderVideo(product);        // NEW: hook up video
    updateOptionVisibility();
    recalcPrice(); // also calls updateEmailConfig
  } catch (err) {
    console.error('Error initializing product page', err);

    const titleEl = document.getElementById('productTitle');
    if (titleEl) titleEl.textContent = 'This banjo is unavailable';

    const priceEl = document.getElementById('productPrice');
    if (priceEl) priceEl.textContent = '';

    const opts = document.getElementById('productOptions');
    if (opts) opts.innerHTML = '<p>Sorry — this model is not currently available.</p>';

    const gallery = document.querySelector('.product-gallery');
    if (gallery) gallery.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', initProductPage);
