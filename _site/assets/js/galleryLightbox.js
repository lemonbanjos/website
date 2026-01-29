/* galleryLightbox.js (original behavior preserved)
   - Thumbnails change the main image (no lightbox on thumb click)
   - Clicking the MAIN image opens the lightbox
   - Zoom/Pan behavior intact
   - Safe with late token swaps: prefers resolved `src`, then `data-large`, then `data-src`.

   NEW: Lightbox image is upgraded to /lightbox/<file> (same filename)
*/

(function(){
  // ---------- Helpers ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Convert a thumbnail or full path into its lightbox version:
  // .../<model>/thumbnails/foo.webp  -> .../<model>/lightbox/foo.webp
  // .../<model>/foo.webp             -> .../<model>/lightbox/foo.webp
  function toLightboxURL(url){
    if (!url) return '';
    if (url.includes('/lightbox/')) return url;
    return url.replace(/(\/product_images\/[^/]+\/[^/]+)\/(?:thumbnails\/)?/,
    '$1/lightbox/');
  }

  // Common selectors
  const THUMB_SELECTOR = 'img[data-large], .thumb-rail img, .thumbs img, .gallery-thumbs img, .product-thumbs img, img.thumbnail';

  // Live-ish references
  let thumbnails = $$(THUMB_SELECTOR);
  let mainImage = $('#mainImage') || $('.main-image img') || $('[data-main-image]');

  // Use existing lightbox if present, else create a compatible one (IDs & classes used by your CSS)
  let lightbox   = $('#lightbox');
  let lightboxImg, closeBtn, prevBtn, nextBtn;

  function ensureLightbox(){
    lightbox = $('#lightbox');
    if(!lightbox){
      lightbox = document.createElement('div');
      lightbox.id = 'lightbox';
      lightbox.style.cssText = [
        'position:fixed','inset:0','display:none','align-items:center','justify-content:center',
        'background:rgba(0,0,0,.9)','zIndex:9999','padding:2rem'
      ].join(';');
      lightbox.innerHTML = `
        <button type="button" class="close"
          style="position:absolute;top:1rem;right:1rem;border:none;background:#fff;padding:.4rem .6rem;cursor:pointer;font-size:14px;">✕</button>
        <button type="button" class="prev"
          style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);border:none;background:#fff;padding:.4rem .6rem;cursor:pointer;font-size:14px;">‹</button>
        <img id="lightboxImg" alt="" style="max-width:100%;max-height:100%;display:block;user-select:none;cursor:grab;"/>
        <button type="button" class="next"
          style="position:absolute;right:1rem;top:50%;transform:translateY(-50%);border:none;background:#fff;padding:.4rem .6rem;cursor:pointer;font-size:14px;">›</button>
      `;
      document.body.appendChild(lightbox);
    }
    lightboxImg = $('#lightboxImg', lightbox) || (function(){
      const img = document.createElement('img');
      img.id = 'lightboxImg';
      img.alt = '';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      img.style.display = 'block';
      img.style.userSelect = 'none';
      img.style.cursor = 'grab';
      lightbox.appendChild(img);
      return img;
    })();
    closeBtn = $('.close', lightbox) || $('[data-lb-close]', lightbox);
    prevBtn  = $('.prev', lightbox)  || $('[data-lb-prev]', lightbox);
    nextBtn  = $('.next', lightbox)  || $('[data-lb-next]', lightbox);
  }
  ensureLightbox();

  // ---------- Image list with token-swap safety ----------
  let images = [];
  let currentIndex = 0;

  function normalizeURLFromThumb(imgEl) {
    const dl = imgEl.getAttribute('data-large');
    if (dl && dl.trim() && !dl.includes('{{MODELLOWER}}')) return dl.trim();
    const s  = imgEl.getAttribute('src');
    if (s && s.trim()) return s.trim();
    const ds = imgEl.getAttribute('data-src');
    return ds ? ds.trim() : '';
  }

  function refreshThumbnails(){
    thumbnails = $$(THUMB_SELECTOR);
    if(!mainImage){
      mainImage = $('#mainImage') || $('.main-image img') || $('[data-main-image]');
    }
  }

  function refreshImages(){
    refreshThumbnails();
    images = thumbnails.map(normalizeURLFromThumb).filter(Boolean);
  }

  refreshImages();
  document.addEventListener('DOMContentLoaded', refreshImages);

  const mo = new MutationObserver((mutations)=>{
    let changed=false;
    for(const m of mutations){
      if(
        (m.type==='attributes' && (m.attributeName==='src'||m.attributeName==='data-large'||m.attributeName==='data-src')) ||
        (m.type==='childList')
      ){ changed=true; break; }
    }
    if(changed) refreshImages();
  });
  mo.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['src','data-large','data-src']});

  // ---------- Main behavior ----------
  function setMain(idx){
    refreshImages();
    if(!images.length) return;
    currentIndex = Math.max(0, Math.min(idx, images.length-1));
    if(mainImage){
      mainImage.src = images[currentIndex]; // main viewer stays on normal image path
      const th = thumbnails[currentIndex];
      if(th && th.alt) mainImage.alt = th.alt;
    }
    thumbnails.forEach(t=>t.classList && t.classList.remove('active'));
    if(thumbnails[currentIndex] && thumbnails[currentIndex].classList){
      thumbnails[currentIndex].classList.add('active');
    }
  }

  function syncIndexFromMain(){
    refreshImages();
    if(!mainImage) return;
    const cur = mainImage.getAttribute('src') || '';
    const idx = images.findIndex(u => u === cur);
    if(idx >= 0) currentIndex = idx;
  }

  function openLightbox(){
    // Make sure we’re targeting the real #lightbox/#lightboxImg
    ensureLightbox();

    refreshImages();
    syncIndexFromMain();
    if(!images.length) return;

    lightbox.style.display = 'flex';
    document.body.classList.add('modal-open');
    lightboxImg.src = toLightboxURL(images[currentIndex]); // upgraded to /lightbox/
    const th = thumbnails[currentIndex];
    lightboxImg.alt = th && th.alt ? th.alt : '';
    resetTransform();
  }


  function closeLightbox(){
    lightbox.style.display = 'none';
    document.body.classList.remove('modal-open');
    resetTransform();
  }

  function showImage(i){
    refreshImages();
    if(!images.length) return;
    currentIndex = (i + images.length) % images.length;
    lightboxImg.src = toLightboxURL(images[currentIndex]); // upgraded to /lightbox/
    const th = thumbnails[currentIndex];
    lightboxImg.alt = th && th.alt ? th.alt : '';
    setMain(currentIndex);
    resetTransform();
  }

  // ---------- Wire events ----------
  // Thumbnails change main ONLY
  document.addEventListener('click', (e)=>{
    const t = e.target;
    if(!(t instanceof HTMLElement)) return;
    if (t.matches(THUMB_SELECTOR)){
      refreshImages();
      const idx = thumbnails.indexOf(t);
      if(idx >= 0){
        setMain(idx);
        e.preventDefault();
      }
      return;
    }
  }, true);

  // Main image: tap opens lightbox, swipe left/right changes image
  function wireMainImageInteractions(){
    if (!mainImage) {
      mainImage = $('#mainImage') || $('.main-image img') || $('[data-main-image]');
    }
    if (!mainImage) return;

    mainImage.style.cursor = 'zoom-in';

    let touchStartX = 0;
    let touchStartY = 0;
    const SWIPE_THRESHOLD = 40; // px

    mainImage.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

mainImage.addEventListener('touchend', (e) => {
  if (!e.changedTouches.length) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Refresh thumbnail list + image array
  refreshImages();
  if (!images.length) return;

  // Horizontal swipe?
  if (absDx > SWIPE_THRESHOLD && absDx > absDy) {
    if (dx < 0) {
      // swipe left → next
      setMain(currentIndex + 1);
    } else {
      // swipe right → previous
      setMain(currentIndex - 1);
    }
  } else {
    // Not a swipe → treat as tap, open lightbox
    e.preventDefault();      // ⬅ put this back
    openLightbox();
  }
}, { passive: false });



    // Mouse click (desktop) still opens the lightbox
    mainImage.addEventListener('click', (e) => {
      e.preventDefault();
      openLightbox();
    });
  }

  document.addEventListener('DOMContentLoaded', wireMainImageInteractions);


  // Lightbox controls
  ensureLightbox(); // make sure close/prev/next are pointing at real elements
  
  closeBtn && closeBtn.addEventListener('click', (e)=>{ e.preventDefault(); closeLightbox(); });
  nextBtn  && nextBtn.addEventListener('click', (e)=>{ e.preventDefault(); showImage(currentIndex+1); });
  prevBtn  && prevBtn.addEventListener('click', (e)=>{ e.preventDefault(); showImage(currentIndex-1); });
  window.addEventListener('keydown', (e)=>{
    if(lightbox.style.display !== 'flex') return;
    if(e.key==='Escape') closeLightbox();
    else if(e.key==='ArrowLeft')  showImage(currentIndex-1);
    else if(e.key==='ArrowRight') showImage(currentIndex+1);
  });

  // ---------- Zoom & Pan ----------
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;

  function applyTransform(){
    lightboxImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    lightboxImg.classList.toggle('is-zoomed', scale > 1.01);
    lightboxImg.style.transformOrigin = 'center center';
  }
  function resetTransform(){ scale=1; tx=0; ty=0; applyTransform(); }
  function clampPan(){
    const overlayW = lightbox.clientWidth, overlayH = lightbox.clientHeight;
    const rect = lightboxImg.getBoundingClientRect();
    const maxX = Math.max(0, (rect.width - overlayW) / 2);
    const maxY = Math.max(0, (rect.height - overlayH) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }

  // click-to-zoom toggle (without fighting drag)
  let zoomClickStartX = 0, zoomClickStartY = 0, clickMoved = false;
  lightboxImg.addEventListener('mousedown', (e)=>{
    zoomClickStartX = e.clientX; zoomClickStartY = e.clientY; clickMoved = false;
  });
  window.addEventListener('mousemove', (e)=>{
    if(Math.abs(e.clientX - zoomClickStartX) > 5 || Math.abs(e.clientY - zoomClickStartY) > 5) clickMoved = true;
  });
  lightboxImg.addEventListener('click', (e)=>{
    if(clickMoved) return;
    if(scale <= 1.01){ scale = 2.2; tx = 0; ty = 0; } else { scale = 1; tx = 0; ty = 0; }
    clampPan(); applyTransform();
  });

  // Wheel zoom (passive:false)
  lightboxImg.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const delta = -e.deltaY * 0.001; // sensitivity
    scale = Math.min(3, Math.max(1, scale + delta));
    if(scale <= 1.01){ tx = 0; ty = 0; }
    clampPan(); applyTransform();
  }, {passive:false});

  // Drag-to-pan (mouse) — only when zoomed
  lightboxImg.addEventListener('mousedown', (e)=>{
    if(scale <= 1.01) return;
    dragging = true; startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty; e.preventDefault();
  });
  window.addEventListener('mousemove', (e)=>{
    if(!dragging) return;
    tx = startTx + (e.clientX - startX); ty = startTy + (e.clientY - startY);
    clampPan(); applyTransform();
  });
  window.addEventListener('mouseup', ()=>{ dragging = false; });

  // Drag-to-pan (touch)
  lightboxImg.addEventListener('touchstart', (e)=>{
    if(scale <= 1.01) return;
    const t = e.touches[0]; dragging = true; startX = t.clientX; startY = t.clientY; startTx = tx; startTy = ty;
  }, {passive:true});
  lightboxImg.addEventListener('touchmove', (e)=>{
    if(!dragging) return;
    const t = e.touches[0]; tx = startTx + (t.clientX - startX); ty = startTy + (t.clientY - startY);
    clampPan(); applyTransform(); e.preventDefault();
  }, {passive:false});
  lightboxImg.addEventListener('touchend', ()=>{ dragging = false; }, {passive:true});

  // Close when clicking outside the image
  lightbox.addEventListener('click', (e)=>{ if(e.target === lightbox) closeLightbox(); });
})();
