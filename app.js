(() => {
  'use strict';

  const DATA = window.APP_DATA;
  if (!DATA || !Array.isArray(DATA.products) || !Array.isArray(DATA.posts)) return;

  const KEYS = Object.freeze({
    saved: 'store_saved', likes: 'store_likes', recent: 'store_recent', theme: 'store_theme', search: 'store_search_history', prefs: 'store_preferences'
  });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const app = $('#app');
  const toastRoot = $('#toast-root');
  const modalRoot = $('#modal-root');
  const store = {
    get(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
      catch { try { localStorage.removeItem(key); } catch {} return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
    update(key, fn, fallback) { const next = fn(this.get(key, fallback)); this.set(key, next); return next; }
  };

  const state = {
    saved: store.get(KEYS.saved, []),
    likes: store.get(KEYS.likes, []),
    recent: store.get(KEYS.recent, []),
    searches: store.get(KEYS.search, []),
    prefs: store.get(KEYS.prefs, {}),
    query: '',
    filters: {},
    sort: 'relevance',
    modal: null
  };
  state.saved = Array.isArray(state.saved) ? state.saved : [];
  state.likes = Array.isArray(state.likes) ? state.likes : [];
  state.recent = Array.isArray(state.recent) ? state.recent : [];
  state.searches = Array.isArray(state.searches) ? state.searches : [];

  const productsBySlug = new Map(DATA.products.map(p => [p.slug, p]));
  const postsBySlug = new Map(DATA.posts.map(p => [p.slug, p]));
  const productsById = new Map(DATA.products.map(p => [p.id, p]));
  const postsById = new Map(DATA.posts.map(p => [p.id, p]));
  const categoriesBySlug = new Map(DATA.categories.map(c => [c.slug, c]));

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  }
  function safeURL(value, fallback = '#') {
    try {
      const url = new URL(String(value || ''), location.origin);
      if (['http:', 'https:'].includes(url.protocol)) return url.href;
      if (url.origin === location.origin) return url.pathname + url.search + url.hash;
    } catch {}
    return fallback;
  }
  function formatCount(num) {
    const n = Number(num || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return String(n);
  }
  function formatPrice(p) { return Number(p) === 0 ? 'Free' : `$${Number(p).toFixed(2)}`; }
  function formatDate(date) { try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)); } catch { return String(date || ''); } }
  function routePath() { return location.pathname.replace(/\/+$/, '') || '/'; }
  function activeTheme() { return store.get(KEYS.theme, 'dark'); }
  function resolveTheme(theme) {
    if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return theme === 'light' ? 'light' : 'dark';
  }
  function setTheme(theme, rerender = true) {
    store.set(KEYS.theme, theme);
    document.documentElement.classList.toggle('light', resolveTheme(theme) === 'light');
    document.documentElement.dataset.theme = resolveTheme(theme);
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = resolveTheme(theme) === 'dark' ? '#0b1020' : '#f5f7fb';
    if (rerender) render();
  }
  function isSaved(id) { return state.saved.includes(id); }
  function isLiked(id) { return state.likes.includes(id); }
  function saveItem(id) {
    state.saved = isSaved(id) ? state.saved.filter(x => x !== id) : [id, ...state.saved].slice(0, 100);
    store.set(KEYS.saved, state.saved); toast(isSaved(id) ? 'Saved' : 'Removed from saved'); updateActionStates(id);
  }
  function likeItem(id) {
    state.likes = isLiked(id) ? state.likes.filter(x => x !== id) : [id, ...state.likes].slice(0, 200);
    store.set(KEYS.likes, state.likes); toast(isLiked(id) ? 'Like added' : 'Like removed'); updateActionStates(id, true);
  }
  function trackRecent(type, id) {
    const key = `${type}:${id}`;
    const next = [key, ...state.recent.filter(k => k !== key)].slice(0, 20);
    state.recent = next; store.set(KEYS.recent, next);
  }
  function recentObjects() {
    return state.recent.map(key => { const [type, id] = key.split(':'); return type === 'product' ? productsById.get(id) : postsById.get(id); }).filter(Boolean);
  }
  function toast(message, kind = 'default') {
    const el = document.createElement('div');
    el.className = `alert ${kind === 'error' ? 'alert-error' : kind === 'success' ? 'alert-success' : 'bg-base-300'} shadow-lg border border-base-content/10 py-3 px-4 max-w-sm text-sm pointer-events-auto`;
    el.setAttribute('role','status'); el.textContent = message; toastRoot.appendChild(el);
    setTimeout(() => { el.classList.add('opacity-0'); el.style.transition = 'opacity .2s ease'; setTimeout(() => el.remove(), 220); }, 2400);
  }
  function navigate(url) { history.pushState({}, '', url); window.scrollTo({ top: 0, behavior: 'instant' }); render(); }
  function internalLink(url) {
    return `<a href="${escapeHTML(url)}" data-nav class="focus-visible:outline-none">`;
  }

  function debounce(fn, wait = 180) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
  function adZone(label = 'Advertisement', compact = false) {
    return `<aside class="${compact ? 'py-2' : 'my-2'}" aria-label="${escapeHTML(label)}"><div class="rounded-2xl border border-dashed border-base-content/15 bg-base-200/30 ${compact ? 'p-3' : 'p-5'} text-center"><div class="text-[10px] uppercase tracking-[.2em] text-base-content/35">${escapeHTML(label)}</div><div class="text-xs text-base-content/45 mt-1">Reusable ad slot — replace with your network, native unit, or house promotion.</div></div></aside>`;
  }
  function searchSuggestions(q) {
    const query = q.trim().toLowerCase(); if (!query) return [];
    const productHits = DATA.products.map(p => ({ type: 'product', id: p.id, label: p.title, sub: p.category, score: scoreMatch(p, q) })).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,5);
    const postHits = DATA.posts.map(p => ({ type: 'post', id: p.id, label: p.title, sub: p.category, score: scoreMatch({ ...p, description: `${p.excerpt} ${(p.content||[]).map(b=>b.text||'').join(' ')}` }, q) })).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,3);
    return [...productHits, ...postHits].slice(0,7);
  }

  function badge(text, tone = 'default') {
    const cls = tone === 'accent' ? 'badge-primary' : tone === 'success' ? 'badge-success' : tone === 'warning' ? 'badge-warning' : tone === 'info' ? 'badge-info' : 'badge-ghost';
    return `<span class="badge ${cls} badge-sm">${escapeHTML(text)}</span>`;
  }
  function productCard(p, compact = false) {
    if (!p) return '';
    const badges = [p.verified && badge('Verified','success'), p.trending && badge('Trending','accent'), p.sponsored && badge('Sponsored','warning'), p.new && badge('New','info')].filter(Boolean).join(' ');
    return `<article class="card card-lift glass premium-border overflow-hidden ${compact ? 'min-w-[250px] w-[250px]' : 'h-full'}">
      ${compact ? '' : `<figure class="h-36 overflow-hidden bg-base-200"><img src="${escapeHTML(safeURL(p.image))}" alt="${escapeHTML(p.title)}" width="900" height="540" loading="lazy" decoding="async" class="h-full w-full object-cover" data-fallback-image></figure>`}
      <div class="card-body p-4 ${compact ? 'pt-4' : ''}">
        <div class="flex items-start gap-3">
          <div class="avatar placeholder shrink-0"><div class="size-11 rounded-xl bg-base-200 border border-base-content/10 grid place-items-center font-bold text-sm">${escapeHTML(p.icon)}</div></div>
          <div class="min-w-0 flex-1">${internalLink(`/product/${p.slug}`)}<h3 class="font-semibold leading-tight line-clamp-2">${escapeHTML(p.title)}</h3></a>
            <p class="text-xs text-base-content/60 mt-1">${escapeHTML(p.subtitle)}</p></div>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2">${badges}</div>
        <p class="text-sm text-base-content/70 ${compact ? 'line-clamp-2' : 'line-clamp-3'} mt-1">${escapeHTML(p.description)}</p>
        <div class="flex items-center justify-between gap-2 mt-auto pt-2">
          <div class="text-sm">★ <span class="font-semibold">${p.rating}</span> <span class="text-base-content/50">(${formatCount(p.reviews)})</span></div>
          <span class="font-semibold">${formatPrice(p.price)}</span>
        </div>
        <div class="card-actions justify-between items-center mt-1">
          ${internalLink(`/product/${p.slug}`)}<span class="text-xs font-semibold text-primary">View details →</span></a>
          <div class="join">
            <button class="btn btn-ghost btn-xs join-item" data-action="save" data-id="${escapeHTML(p.id)}" aria-label="${isSaved(p.id)?'Remove from saved':'Save'} ${escapeHTML(p.title)}">${isSaved(p.id)?'♥':'♡'}</button>
            <button class="btn btn-ghost btn-xs join-item" data-action="quick-view" data-id="${escapeHTML(p.id)}" aria-label="Quick view ${escapeHTML(p.title)}">⌁</button><button class="btn btn-ghost btn-xs join-item" data-action="share" data-type="product" data-id="${escapeHTML(p.id)}" aria-label="Share ${escapeHTML(p.title)}">↗</button>
          </div>
        </div>
      </div>
    </article>`;
  }
  function postCard(post, compact = false) {
    if (!post) return '';
    return `<article class="card card-lift glass premium-border overflow-hidden ${compact ? 'min-w-[290px] w-[290px]' : ''}">
      <figure class="h-40 overflow-hidden bg-base-200"><img src="${escapeHTML(safeURL(post.coverImage))}" alt="${escapeHTML(post.title)}" width="1400" height="800" loading="lazy" decoding="async" class="h-full w-full object-cover" data-fallback-image></figure>
      <div class="card-body p-4">
        <div class="flex items-center justify-between gap-2">${badge(DATA.categories.find(c=>c.slug===post.category)?.name || post.category)} <span class="text-xs text-base-content/50">${escapeHTML(post.readingTime || '5 min')}</span></div>
        ${internalLink(`/post/${post.slug}`)}<h3 class="font-semibold text-base line-clamp-2">${escapeHTML(post.title)}</h3></a>
        <p class="text-sm text-base-content/65 line-clamp-2">${escapeHTML(post.excerpt)}</p>
        <div class="flex items-center justify-between gap-3 pt-2 mt-auto">
          <div class="flex items-center gap-2 min-w-0"><div class="avatar placeholder"><div class="size-8 rounded-full bg-base-200 text-[10px]">${escapeHTML(post.authorAvatar)}</div></div><span class="text-xs truncate">${escapeHTML(post.author)}</span></div>
          <span class="text-xs text-base-content/50">${formatCount(post.views)} views</span>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-1">${(post.tags||[]).slice(0,3).map(t=>badge('#'+t)).join('')}</div>
        <div class="flex items-center justify-between pt-2">
          <span class="text-xs text-base-content/50">${formatDate(post.date)}</span>
          <div class="join">
            <button class="btn btn-ghost btn-xs join-item" data-action="like" data-id="${escapeHTML(post.id)}" aria-label="${isLiked(post.id)?'Unlike':'Like'} ${escapeHTML(post.title)}">${isLiked(post.id)?'♥':'♡'} ${formatCount((post.likes||0)+(isLiked(post.id)?1:0))}</button>
            <button class="btn btn-ghost btn-xs join-item" data-action="save" data-id="${escapeHTML(post.id)}" aria-label="${isSaved(post.id)?'Remove from saved':'Save'} ${escapeHTML(post.title)}">${isSaved(post.id)?'♥':'♡'}</button>
            <button class="btn btn-ghost btn-xs join-item" data-action="share" data-type="post" data-id="${escapeHTML(post.id)}" aria-label="Share ${escapeHTML(post.title)}">↗</button>
          </div>
        </div>
      </div>
    </article>`;
  }
  function section(title, subtitle, content, opts = {}) {
    return `<section class="space-y-4" ${opts.id ? `id="${escapeHTML(opts.id)}"` : ''}>
      <div class="flex items-end justify-between gap-4"><div><div class="text-xs uppercase tracking-[.18em] text-primary font-semibold">${escapeHTML(opts.kicker || 'Discover')}</div><h2 class="text-xl md:text-2xl font-bold tracking-tight mt-1">${escapeHTML(title)}</h2>${subtitle?`<p class="text-sm text-base-content/55 mt-1">${escapeHTML(subtitle)}</p>`:''}</div>${opts.action||''}</div>
      ${content}
    </section>`;
  }
  function rail(items, renderer, label) {
    if (!items.length) return `<div class="alert bg-base-200 text-sm">No ${escapeHTML(label || 'content')} available yet.</div>`;
    return `<div class="relative"><div class="rail no-scrollbar flex gap-4 overflow-x-auto pb-2 pr-4" data-rail>${items.map(renderer).join('')}</div><div class="hidden md:flex absolute right-1 -top-12 gap-2"><button class="btn btn-circle btn-sm btn-ghost border border-base-content/10" data-rail-dir="left" aria-label="Scroll left">←</button><button class="btn btn-circle btn-sm btn-ghost border border-base-content/10" data-rail-dir="right" aria-label="Scroll right">→</button></div></div>`;
  }

  function header() {
    const theme = activeTheme();
    const savedCount = state.saved.length;
    return `<header class="sticky top-0 z-40 border-b border-base-content/10 bg-base-100/82 backdrop-blur-xl">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <a href="/" data-nav class="flex items-center gap-2.5 shrink-0"><div class="size-9 rounded-xl bg-primary text-primary-content grid place-items-center font-black">N</div><span class="font-extrabold tracking-tight text-lg hidden sm:block">NexaMart</span></a>
        <nav class="hidden md:flex items-center gap-1 text-sm ml-2"><a href="/explore" data-nav class="btn btn-ghost btn-sm">Explore</a><button class="btn btn-ghost btn-sm" data-action="category-menu">Categories</button></nav>
        <div class="flex-1 max-w-2xl mx-auto relative"><form id="global-search" class="join w-full"><label for="global-search-input" class="sr-only">Search NexaMart</label><input id="global-search-input" autocomplete="off" value="${escapeHTML(state.query || '')}" class="input input-bordered join-item flex-1 bg-base-200/70" placeholder="Search apps, AI tools, software, finance, deals…"><button class="btn btn-primary join-item" aria-label="Search">Search</button></form><div id="search-suggest" class="hidden absolute left-0 right-0 top-[calc(100%+8px)] z-50 glass rounded-2xl p-2 shadow-2xl border border-base-content/10" role="listbox"></div></div>
        <div class="hidden sm:flex items-center gap-1"><a href="/saved" data-nav class="btn btn-ghost btn-sm" aria-label="Saved">Saved <span class="badge badge-sm">${savedCount}</span></a><button class="btn btn-ghost btn-sm" data-action="theme" aria-label="Change theme">${theme==='dark'?'☾':theme==='light'?'☀':'◐'}</button></div>
        <button class="btn btn-ghost btn-square md:hidden" data-action="mobile-menu" aria-label="Open menu">☰</button>
      </div>
      <div id="header-category-menu" class="hidden border-t border-base-content/10"><div class="max-w-7xl mx-auto p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">${DATA.categories.map(c=>`<a href="/category/${c.slug}" data-nav class="btn btn-ghost justify-start">${escapeHTML(c.icon)} ${escapeHTML(c.name)}</a>`).join('')}</div></div>
    </header>`;
  }
  function mobileNav() {
    return `<nav class="md:hidden fixed bottom-0 inset-x-0 z-50 bg-base-100/94 backdrop-blur-xl border-t border-base-content/10 safe-bottom"><div class="grid grid-cols-5 h-16">${[['/','⌂','Home'],['/explore','✦','Explore'],['/category/apps','▦','Categories'],['/saved','♡','Saved'],['#','⋯','More']].map(([href,icon,label],i)=>`<a href="${href}" ${href==='#'?'data-action="mobile-more"':''} data-nav class="flex flex-col items-center justify-center text-[11px] gap-1 ${i===0&&routePath()==='/'?'text-primary':''}"><span class="text-lg leading-none">${icon}</span><span>${label}</span></a>`).join('')}</div></nav>`;
  }
  function footer() {
    return `<footer class="border-t border-base-content/10 mt-16 pb-24 md:pb-8"><div class="max-w-7xl mx-auto px-4 sm:px-6 py-10"><div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8"><div class="col-span-2"><div class="flex items-center gap-2"><div class="size-9 rounded-xl bg-primary text-primary-content grid place-items-center font-black">N</div><span class="font-bold text-lg">NexaMart</span></div><p class="text-sm text-base-content/55 mt-3 max-w-sm">${escapeHTML(DATA.site.tagline)} Built static-first for fast discovery, useful content and transparent promotions.</p></div><div><h3 class="font-semibold text-sm">Discover</h3><div class="mt-3 space-y-2 text-sm text-base-content/60"><a href="/explore" data-nav class="block hover:text-primary">Explore</a><a href="/saved" data-nav class="block hover:text-primary">Saved</a><a href="/search?q=ai" data-nav class="block hover:text-primary">Search</a></div></div><div><h3 class="font-semibold text-sm">Categories</h3><div class="mt-3 space-y-2 text-sm text-base-content/60">${DATA.categories.slice(0,5).map(c=>`<a href="/category/${c.slug}" data-nav class="block hover:text-primary">${escapeHTML(c.name)}</a>`).join('')}</div></div><div><h3 class="font-semibold text-sm">Resources</h3><div class="mt-3 space-y-2 text-sm text-base-content/60"><a href="/post/best-free-video-editors-for-beginners" data-nav class="block hover:text-primary">Guides</a><a href="/category/tools" data-nav class="block hover:text-primary">Tools</a><a href="/category/templates" data-nav class="block hover:text-primary">Templates</a></div></div><div><h3 class="font-semibold text-sm">Company</h3><div class="mt-3 space-y-2 text-sm text-base-content/60"><a href="/explore" data-nav class="block hover:text-primary">About</a><a href="mailto:${escapeHTML(DATA.site.email)}" class="block hover:text-primary">Contact</a><a href="/" data-nav class="block hover:text-primary">Sitemap</a></div></div></div><div class="border-t border-base-content/10 mt-8 pt-5 flex flex-col sm:flex-row justify-between gap-3 text-xs text-base-content/45"><span>© ${new Date().getFullYear()} NexaMart Editorial.</span><span>Demo/local engagement data is not global analytics.</span></div></div></footer>`;
  }

  function layout(content) { app.innerHTML = `${header()}<main id="main-content" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">${content}</main>${footer()}${mobileNav()}`; bindGlobal(); }
  function bindGlobal() {
    $$('[data-nav]').forEach(a => a.addEventListener('click', e => {
      const href = a.getAttribute('href'); if (!href || href === '#') return;
      if (href.startsWith('/')) { e.preventDefault(); navigate(href); }
    }));
    const search = $('#global-search');
    const input = $('#global-search-input');
    search?.addEventListener('submit', e => { e.preventDefault(); const q = input?.value.trim() || ''; performSearch(q); });
    input?.addEventListener('focus', () => renderSearchSuggestions(input.value));
    input?.addEventListener('input', debounce(() => renderSearchSuggestions(input.value), 160));
    document.addEventListener('click', e => { if (!e.target.closest('#global-search') && !e.target.closest('#search-suggest')) $('#search-suggest')?.classList.add('hidden'); }, { once: true });

    $('[data-action="category-menu"]')?.addEventListener('click', () => $('#header-category-menu')?.classList.toggle('hidden'));
    $('[data-action="theme"]')?.addEventListener('click', openThemeModal);
    $('[data-action="mobile-menu"]')?.addEventListener('click', openMobileMenu);
    $('[data-action="mobile-more"]')?.addEventListener('click', e => { e.preventDefault(); openThemeModal(); });
    $$('[data-action="save"]').forEach(btn => btn.addEventListener('click', () => { saveItem(btn.dataset.id); render(); }));
    $$('[data-action="like"]').forEach(btn => btn.addEventListener('click', () => { likeItem(btn.dataset.id); render(); }));
    $$('[data-action="share"]').forEach(btn => btn.addEventListener('click', () => shareItem(btn.dataset.type, btn.dataset.id)));
    $$('[data-action="quick-view"]').forEach(btn => btn.addEventListener('click', () => openProductQuickView(btn.dataset.id)));
    $$('[data-rail-dir]').forEach(btn => btn.addEventListener('click', () => { const railEl = btn.closest('.relative')?.querySelector('[data-rail]'); if (railEl) railEl.scrollBy({ left: btn.dataset.railDir === 'right' ? railEl.clientWidth * .8 : -railEl.clientWidth * .8, behavior: 'smooth' }); }));
    $$('[data-image-preview]').forEach(img => img.addEventListener('click', () => openImagePreview(img.src, img.alt)));
    $$('img[data-fallback-image]').forEach(img => img.addEventListener('error', () => { img.onerror = null; img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><rect width="100%" height="100%" fill="#181f2e"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#8992a4" font-family="sans-serif" font-size="28">NexaMart</text></svg>`); }));
    document.addEventListener('keydown', keyGuard, { once: true });
  }
  function keyGuard(e) {
    if ((e.ctrlKey || e.metaKey) && ['u','s','p'].includes(e.key.toLowerCase()) && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); toast('This shortcut is disabled on the discovery UI.'); }
  }

  function openImagePreview(src, alt) {
    openModal(`<div class="p-3 sm:p-5"><div class="flex items-center justify-between gap-3 pb-3"><div class="font-semibold text-sm truncate">${escapeHTML(alt || 'Image preview')}</div><button class="btn btn-sm btn-ghost" data-modal-close aria-label="Close image preview">✕</button></div><img src="${escapeHTML(safeURL(src))}" alt="${escapeHTML(alt||'')}" class="max-h-[75vh] w-full object-contain rounded-2xl bg-base-200"></div>`);
  }
  function openProductQuickView(id) {
    const p = productsById.get(id); if (!p) return;
    openModal(`<div class="p-5"><div class="flex items-start justify-between gap-4"><div><div class="text-xs uppercase tracking-widest text-primary">Quick view</div><h2 class="text-xl font-bold mt-1">${escapeHTML(p.title)}</h2><p class="text-sm text-base-content/55 mt-1">${escapeHTML(p.subtitle)}</p></div><button class="btn btn-sm btn-ghost" data-modal-close aria-label="Close">✕</button></div><div class="flex gap-3 mt-5"><div class="size-14 rounded-2xl bg-base-200 grid place-items-center font-bold">${escapeHTML(p.icon)}</div><div class="text-sm text-base-content/65"><div>★ ${p.rating} · ${formatCount(p.views)} views</div><div class="mt-1">${formatPrice(p.price)}${p.discount?` · ${p.discount}% off`:''}</div></div></div><p class="text-sm leading-6 text-base-content/65 mt-5">${escapeHTML(p.description)}</p><div class="flex gap-2 mt-5"><a href="/product/${p.slug}" data-nav class="btn btn-primary flex-1">View full details</a><button class="btn btn-outline" data-action="save" data-id="${escapeHTML(p.id)}">${isSaved(p.id)?'Saved':'Save'}</button></div></div>`);
    $$('[data-nav]', modalRoot).forEach(a=>a.addEventListener('click',e=>{e.preventDefault();closeModal();navigate(a.getAttribute('href'));}));
    $('[data-action="save"]',modalRoot)?.addEventListener('click',()=>{saveItem(id);closeModal();render();});
  }
  function confirmAction(title, message, onConfirm) {
    openModal(`<div class="p-5"><div class="flex items-center justify-between"><h2 class="text-lg font-bold">${escapeHTML(title)}</h2><button class="btn btn-sm btn-ghost" data-modal-close>✕</button></div><p class="text-sm text-base-content/60 mt-2">${escapeHTML(message)}</p><div class="flex gap-2 justify-end mt-5"><button class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-error" id="confirm-action">Confirm</button></div></div>`); $('#confirm-action')?.addEventListener('click',()=>{closeModal();onConfirm();});
  }
  function openThemeModal() {
    openModal(`<div class="p-5"><div class="flex items-center justify-between"><h2 class="text-lg font-bold">Appearance</h2><button class="btn btn-sm btn-ghost" data-modal-close aria-label="Close">✕</button></div><p class="text-sm text-base-content/60 mt-1">Choose light, dark, or follow your system.</p><div class="grid grid-cols-3 gap-2 mt-5">${['dark','light','system'].map(t=>`<button class="btn ${activeTheme()===t?'btn-primary':'btn-outline'}" data-theme-choice="${t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></div>`);
    $$('[data-theme-choice]').forEach(b => b.addEventListener('click', () => { setTheme(b.dataset.themeChoice); closeModal(); }));
  }
  function openMobileMenu() {
    openModal(`<div class="p-5"><div class="flex items-center justify-between"><h2 class="text-lg font-bold">Browse</h2><button class="btn btn-sm btn-ghost" data-modal-close>✕</button></div><div class="grid grid-cols-2 gap-2 mt-4">${DATA.categories.map(c=>`<a href="/category/${c.slug}" data-nav class="btn btn-outline justify-start">${escapeHTML(c.icon)} ${escapeHTML(c.name)}</a>`).join('')}</div><a href="/explore" data-nav class="btn btn-primary w-full mt-4">Explore everything</a></div>`); bindGlobal(); }
  function openModal(content) { modalRoot.innerHTML = `<div class="w-full md:max-w-xl md:rounded-3xl bg-base-100 shadow-2xl border border-base-content/10 mobile-sheet">${content}</div>`; modalRoot.classList.remove('hidden'); modalRoot.classList.add('flex'); modalRoot.setAttribute('aria-hidden','false'); $('[data-modal-close]',modalRoot)?.addEventListener('click', closeModal); modalRoot.onclick = e => { if (e.target === modalRoot) closeModal(); }; document.addEventListener('keydown', escClose); }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() { modalRoot.classList.add('hidden'); modalRoot.classList.remove('flex'); modalRoot.setAttribute('aria-hidden','true'); modalRoot.innerHTML=''; document.removeEventListener('keydown', escClose); }

  async function shareItem(type, id) {
    const obj = type === 'product' ? productsById.get(id) : postsById.get(id); if (!obj) return;
    const url = new URL(`/${type === 'product' ? 'product' : 'post'}/${obj.slug}`, location.origin).href;
    const shareData = { title: obj.title, text: type === 'post' ? obj.excerpt : obj.description, url };
    try {
      if (navigator.share) { await navigator.share(shareData); toast('Shared', 'success'); return; }
      await navigator.clipboard.writeText(url); toast('Link copied');
    } catch {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { openShareFallback(url, obj.title); }
    }
  }
  function openShareFallback(url, title) {
    const e = encodeURIComponent(url); const t = encodeURIComponent(title);
    openModal(`<div class="p-5"><div class="flex items-center justify-between"><h2 class="text-lg font-bold">Share</h2><button class="btn btn-sm btn-ghost" data-modal-close>✕</button></div><div class="grid grid-cols-2 gap-2 mt-4"><a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${t}%20${e}">WhatsApp</a><a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="https://t.me/share/url?url=${e}&text=${t}">Telegram</a><a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${e}">Facebook</a><a class="btn btn-outline" target="_blank" rel="noopener noreferrer" href="https://x.com/intent/post?text=${t}&url=${e}">X</a></div></div>`);
  }
  function updateActionStates() {}

  function renderSearchSuggestions(q) {
    const box = $('#search-suggest'); if (!box) return;
    const hits = searchSuggestions(q);
    const popular = state.searches.length ? state.searches.slice(0,4) : ['AI tools','free video editor','website builder','investing'];
    if (!q.trim()) {
      box.innerHTML = `<div class="text-[10px] uppercase tracking-widest text-base-content/35 px-3 py-2">Recent / popular</div>${popular.map(x=>`<button class="btn btn-ghost btn-sm w-full justify-start" data-search-chip="${escapeHTML(x)}">⌕ ${escapeHTML(x)}</button>`).join('')}`;
    } else {
      box.innerHTML = hits.length ? hits.map(h=>`<button class="btn btn-ghost btn-sm w-full justify-between text-left" data-suggestion-type="${h.type}" data-suggestion-id="${h.id}"><span class="truncate">${escapeHTML(h.label)}</span><span class="text-xs text-base-content/35 ml-3">${escapeHTML(h.sub)}</span></button>`).join('') : `<div class="px-3 py-3 text-sm text-base-content/50">No instant matches. Press Enter to run the full search.</div>`;
    }
    box.classList.remove('hidden');
    $$('[data-search-chip]', box).forEach(b => b.addEventListener('click',()=>performSearch(b.dataset.searchChip)));
    $$('[data-suggestion-id]', box).forEach(b=>b.addEventListener('click',()=>{const obj=(b.dataset.suggestionType==='product'?productsById:postsById).get(b.dataset.suggestionId);if(obj){navigate(`/${b.dataset.suggestionType==='product'?'product':'post'}/${obj.slug}`);}}));
  }

  function performSearch(q) {
    state.query = q; state.filters = {}; state.sort = 'relevance';
    if (q) { state.searches = [q, ...state.searches.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); store.set(KEYS.search, state.searches); }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }
  function scoreMatch(item, query) {
    const q = query.toLowerCase().trim(); if (!q) return 0;
    const contentText = Array.isArray(item.content) ? item.content.map(b => b.text || '').join(' ') : '';
    const fields = [item.title, item.subtitle, item.description, item.excerpt, contentText, item.category, item.subcategory, ...(item.tags||[]), ...(item.features||[]), ...(item.platforms||[]), item.developer, item.publisher].filter(Boolean).join(' ').toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    let score = 0;
    if (String(item.title).toLowerCase() === q) score += 50;
    if (String(item.title).toLowerCase().includes(q)) score += 25;
    if (fields.includes(q)) score += 12;
    tokens.forEach(tok => { if (fields.includes(tok)) score += 6; });
    const titleTokens = String(item.title).toLowerCase().split(/\s+/);
    tokens.forEach(tok => titleTokens.forEach(tt => { if (levenshtein(tok, tt) <= 1) score += 3; }));
    return score;
  }
  function levenshtein(a,b) { if (a===b) return 0; if (!a) return b.length; if (!b) return a.length; const prev=Array(b.length+1).fill(0); for(let j=0;j<=b.length;j++)prev[j]=j; for(let i=1;i<=a.length;i++){let cur=[i]; for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); for(let j=0;j<=b.length;j++)prev[j]=cur[j];} return prev[b.length]; }
  function detectIntent(q) {
    const text = q.toLowerCase();
    let best = null, bestScore = 0;
    DATA.intentMap.forEach(rule => { const score = rule.terms.reduce((n, term) => n + (text.includes(term) ? term.split(' ').length * 5 : 0), 0); if (score > bestScore) { bestScore=score; best=rule; } });
    return best ? { ...best, score: bestScore } : { intent: 'General Discovery', categories: [], tags: [], related: [], score: 0 };
  }
  function filteredProducts(items, intent = null) {
    let out = items.slice(); const f = state.filters;
    if (state.query) out = out.map(p=>({...p,__score:scoreMatch(p,state.query)})).filter(p=>p.__score>0);
    if (intent?.categories?.length && state.query) out.sort((a,b)=>(b.__score||0)-(a.__score||0));
    if (f.category) out = out.filter(p=>p.category===f.category);
    if (f.subcategory) out = out.filter(p=>p.subcategory===f.subcategory);
    if (f.tag) out = out.filter(p=>(p.tags||[]).includes(f.tag));
    if (f.rating) out = out.filter(p=>p.rating >= Number(f.rating));
    if (f.price === 'free') out = out.filter(p=>Number(p.price)===0);
    if (f.price === 'paid') out = out.filter(p=>Number(p.price)>0);
    if (f.discount) out = out.filter(p=>Number(p.discount||0) > 0);
    if (f.verified) out = out.filter(p=>p.verified);
    if (f.featured) out = out.filter(p=>p.featured);
    if (f.sponsored) out = out.filter(p=>p.sponsored);
    if (f.new) out = out.filter(p=>p.new);
    if (f.platform) out = out.filter(p=>(p.platforms||[]).includes(f.platform));
    if (state.sort==='rating') out.sort((a,b)=>b.rating-a.rating);
    else if (state.sort==='popularity') out.sort((a,b)=>b.popularity-a.popularity);
    else if (state.sort==='newest') out.sort((a,b)=>new Date(b.dateAdded)-new Date(a.dateAdded));
    else if (state.sort==='priceLow') out.sort((a,b)=>a.price-b.price);
    else if (state.sort==='priceHigh') out.sort((a,b)=>b.price-a.price);
    else if (state.sort==='views') out.sort((a,b)=>b.views-a.views);
    else if (state.sort==='likes') out.sort((a,b)=>b.likes-a.likes);
    else if (state.query) out.sort((a,b)=>(b.__score||0)-(a.__score||0));
    return out;
  }
  function filteredPosts(items) {
    let out=items.slice(); if(state.query){out=out.map(p=>({...p,__score:scoreMatch(p,state.query)})).filter(p=>p.__score>0).sort((a,b)=>b.__score-a.__score);} if(state.filters.category) out=out.filter(p=>p.category===state.filters.category); if(state.filters.tag) out=out.filter(p=>(p.tags||[]).includes(state.filters.tag)); if(state.sort==='newest') out.sort((a,b)=>new Date(b.date)-new Date(a.date)); if(state.sort==='views') out.sort((a,b)=>b.views-a.views); if(state.sort==='likes') out.sort((a,b)=>b.likes-a.likes); return out;
  }

  function intentPanel(q) {
    const intent=detectIntent(q); const suggestions = [...new Set([...(intent.categories||[]), ...(intent.tags||[]), ...(intent.related||[])])].slice(0,8);
    return `<div class="glass rounded-2xl p-4 border border-primary/20 bg-primary/5"><div class="flex flex-wrap items-center gap-2"><span class="text-xs uppercase tracking-widest text-primary font-semibold">Smart match</span><span class="badge badge-primary badge-outline">${escapeHTML(intent.intent)}</span></div><div class="mt-2 text-sm text-base-content/65">Detected intent and mapped discovery paths from your search phrase.</div>${suggestions.length?`<div class="flex flex-wrap gap-2 mt-3">${suggestions.map(s=>`<button class="btn btn-xs btn-outline" data-search-chip="${escapeHTML(s)}">${escapeHTML(s)}</button>`).join('')}</div>`:''}</div>`;
  }
  function filtersUI() {
    const categories=DATA.categories; const platforms=[...new Set(DATA.products.flatMap(p=>p.platforms||[]))].slice(0,12);
    return `<details class="dropdown md:hidden"><summary class="btn btn-outline btn-sm">Filters</summary><div class="dropdown-content z-20 p-4 shadow-xl bg-base-100 border border-base-content/10 rounded-2xl w-[min(90vw,360px)] mt-2">${filterControls(categories,platforms)}</div></details><div class="hidden md:block glass rounded-2xl p-4 sticky top-24">${filterControls(categories,platforms)}</div>`;
  }
  function filterControls(categories,platforms){
    const subs=[...new Set(DATA.products.map(p=>p.subcategory).filter(Boolean))].sort();
    const tags=[...new Set(DATA.products.flatMap(p=>p.tags||[]).filter(Boolean))].sort();
    return `<div class="space-y-4"><div><div class="font-semibold text-sm mb-2">Category</div><select class="select select-bordered select-sm w-full" data-filter="category"><option value="">All categories</option>${categories.map(c=>`<option value="${c.slug}" ${state.filters.category===c.slug?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}</select></div><div><div class="font-semibold text-sm mb-2">Subcategory</div><select class="select select-bordered select-sm w-full" data-filter="subcategory"><option value="">All subcategories</option>${subs.map(v=>`<option value="${escapeHTML(v)}" ${state.filters.subcategory===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}</select></div><div><div class="font-semibold text-sm mb-2">Tag</div><select class="select select-bordered select-sm w-full" data-filter="tag"><option value="">Any tag</option>${tags.map(v=>`<option value="${escapeHTML(v)}" ${state.filters.tag===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}</select></div><div><div class="font-semibold text-sm mb-2">Rating</div><select class="select select-bordered select-sm w-full" data-filter="rating"><option value="">Any rating</option>${[4,4.5,4.7].map(v=>`<option value="${v}" ${String(state.filters.rating||'')===String(v)?'selected':''}>${v}+ stars</option>`).join('')}</select></div><div><div class="font-semibold text-sm mb-2">Pricing</div><select class="select select-bordered select-sm w-full" data-filter="price"><option value="">Any</option><option value="free" ${state.filters.price==='free'?'selected':''}>Free</option><option value="paid" ${state.filters.price==='paid'?'selected':''}>Paid</option></select></div><div><div class="font-semibold text-sm mb-2">Platform</div><select class="select select-bordered select-sm w-full" data-filter="platform"><option value="">Any</option>${platforms.map(v=>`<option value="${escapeHTML(v)}" ${state.filters.platform===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}</select></div><div class="grid grid-cols-2 gap-2 text-sm"><label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" data-filter="verified" ${state.filters.verified?'checked':''}> Verified</label><label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" data-filter="featured" ${state.filters.featured?'checked':''}> Featured</label><label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" data-filter="sponsored" ${state.filters.sponsored?'checked':''}> Sponsored</label><label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" data-filter="new" ${state.filters.new?'checked':''}> New</label><label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" data-filter="discount" ${state.filters.discount?'checked':''}> Deals</label></div><button class="btn btn-sm btn-ghost w-full" data-action="clear-filters">Clear filters</button></div>`;
  }
  function sortUI(){return `<select class="select select-bordered select-sm" data-sort aria-label="Sort results">${[['relevance','Relevance'],['rating','Rating'],['popularity','Popularity'],['newest','Newest'],['priceLow','Price low → high'],['priceHigh','Price high → low'],['views','Most viewed'],['likes','Most liked']].map(([v,t])=>`<option value="${v}" ${state.sort===v?'selected':''}>${t}</option>`).join('')}</select>`;}

  function renderHome() {
    state.query='';
    const trending=DATA.products.filter(p=>p.trending).slice(0,8), software=DATA.products.filter(p=>p.featured && p.category==='software').slice(0,8), ai=DATA.products.filter(p=>p.category==='ai-tools').slice(0,8), finance=DATA.products.filter(p=>p.category==='finance').slice(0,6), deals=DATA.products.filter(p=>p.discount>0).slice(0,6), latest=DATA.posts.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6), popular=DATA.posts.slice().sort((a,b)=>b.likes-a.likes).slice(0,6), recent=recentObjects().slice(0,8);
    layout(`<div class="space-y-9">
      <section class="hero-mesh hero-grid premium-border rounded-[2rem] glass overflow-hidden"><div class="p-6 sm:p-10 md:p-14 max-w-5xl"><div class="flex flex-wrap gap-2 mb-5">${badge('Fast discovery','accent')}${badge('Static-first')}${badge('PWA-ready')}</div><h1 class="text-4xl sm:text-5xl md:text-6xl font-black tracking-[-.04em] max-w-4xl">Find better digital products without the noise.</h1><p class="text-base sm:text-lg text-base-content/65 max-w-2xl mt-5">${escapeHTML(DATA.site.description)} Search by intent, compare options, save discoveries and explore useful posts—all in a fast app-like experience.</p><form id="hero-search" class="join w-full max-w-2xl mt-7"><label for="hero-search-input" class="sr-only">Search</label><input id="hero-search-input" class="input input-lg input-bordered join-item flex-1 bg-base-100/75" placeholder="Try “free video editor” or “best AI image tool”"><button class="btn btn-lg btn-primary join-item">Discover</button></form><div class="flex flex-wrap gap-2 mt-4"><span class="text-xs text-base-content/45 self-center">Popular:</span>${['AI tools','free video editor','website builder','investing','hosting'].map(q=>`<button class="btn btn-xs btn-ghost border border-base-content/10" data-search-chip="${q}">${q}</button>`).join('')}</div></div></section>
      ${adZone('Advertisement')}
      ${section('Browse by category','Start with a topic and let the content graph do the rest.',`<div class="flex gap-3 overflow-x-auto no-scrollbar pb-1">${DATA.categories.map(c=>`<a href="/category/${c.slug}" data-nav class="min-w-[145px] card card-lift bg-gradient-to-br ${c.color} border border-base-content/10"><div class="card-body p-4"><div class="text-2xl">${escapeHTML(c.icon)}</div><h3 class="font-semibold">${escapeHTML(c.name)}</h3><p class="text-xs text-base-content/50 line-clamp-2">${escapeHTML(c.description)}</p></div></a>`).join('')}</div>`)}
      ${section('Trending apps & tools','What is getting the most attention in the demo catalog.',rail(trending,p=>productCard(p,true),'trending products'),{kicker:'Live reel'})}
      ${section('Featured software','Polished tools for focused work, creativity and publishing.',rail(software,p=>productCard(p,true),'software'),{kicker:'Editor picks'})}
      ${section('AI discovery','Explore AI products by workflow instead of hype.',rail(ai,p=>productCard(p,true),'AI tools'),{kicker:'AI'})}
      ${section('Financial picks','Informational discovery only—verify current terms with official providers.',`<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${finance.map(p=>`<div class="glass rounded-2xl p-5 border border-emerald-500/15"><div class="flex justify-between gap-3">${badge(p.subcategory,'success')}${p.verified?badge('Verified','success'):''}</div><div class="flex items-center gap-3 mt-4"><div class="size-12 rounded-xl bg-base-200 grid place-items-center font-bold">${escapeHTML(p.icon)}</div><div class="min-w-0"><a href="/product/${p.slug}" data-nav class="font-semibold line-clamp-1">${escapeHTML(p.title)}</a><p class="text-xs text-base-content/50">${escapeHTML(p.subtitle)}</p></div></div><p class="text-sm text-base-content/65 mt-3 line-clamp-2">${escapeHTML(p.description)}</p><div class="text-xs text-warning mt-3">Financial information is not a guarantee of approval, rates, returns or coverage.</div><a href="/product/${p.slug}" data-nav class="btn btn-sm btn-outline w-full mt-4">Review details</a></div>`).join('')}</div>`,{kicker:'Compare carefully'})}
      ${section('Exclusive deals','Promotions are labeled; pricing and expiry should always be verified at checkout.',rail(deals,p=>`<div class="min-w-[280px] w-[280px] card glass border border-rose-500/20"><div class="card-body p-4"><div class="flex justify-between">${badge(`${p.discount}% off`,'warning')}<span class="text-xs text-base-content/45">Limited offer</span></div><h3 class="font-semibold mt-2">${escapeHTML(p.title)}</h3><p class="text-sm text-base-content/60 line-clamp-2">${escapeHTML(p.description)}</p><div class="flex items-end gap-2 mt-3"><span class="text-xl font-bold">${formatPrice(p.price)}</span><span class="text-xs line-through text-base-content/35">${formatPrice(p.oldPrice)}</span></div><a href="/product/${p.slug}" data-nav class="btn btn-sm btn-primary mt-2">Get deal</a><div class="text-[11px] text-base-content/40 mt-2">Check current terms before purchase.</div></div></div>`,'deals'),{kicker:'Offers'})}
      ${section('Latest posts','Discovery cards for guides, updates and practical ideas.',rail(latest,p=>postCard(p,true),'latest posts'),{kicker:'Post feed'})}
      ${section('Popular posts','The stories readers are engaging with most in the sample feed.',rail(popular,p=>postCard(p,true),'popular posts'),{kicker:'Community signal'})}
      ${section('Recommended for you','Personalized locally from recent items, shared tags, category affinity and popularity.',rail(recommendationProducts(recent.filter(x=>productsById.has(x)),6),p=>productCard(p,true),'recommendations'),{kicker:'Personalized'})}
      ${recent.length ? section('Recently viewed','Kept privately in your browser with a 20-item cap.',rail(recent,p=>productsById.has(p.id)?productCard(p,true):postCard(p,true),'recent items'),{kicker:'Your library'}) : ''}
      ${section('FAQ','Answers shown on the page are also used for FAQ structured data.',renderFAQ(DATA.faqs),{kicker:'Trust'})}
    </div>`);
    $('#hero-search')?.addEventListener('submit',e=>{e.preventDefault();performSearch($('#hero-search-input').value.trim());}); bindSearchChips();
  }
  function bindSearchChips(){ $$('[data-search-chip]').forEach(b=>b.addEventListener('click',()=>performSearch(b.dataset.searchChip))); }
  function renderFAQ(items){if(!items.length)return `<div class="alert bg-base-200">No FAQ entries available.</div>`; return `<div class="space-y-2 max-w-4xl">${items.map((f,i)=>`<details class="group rounded-2xl border border-base-content/10 bg-base-200/40 p-4" ${i===0?'open':''}><summary class="cursor-pointer font-medium list-none flex justify-between gap-4">${escapeHTML(f.q)}<span class="text-primary">+</span></summary><p class="text-sm text-base-content/60 mt-3 leading-7">${escapeHTML(f.a)}</p></details>`).join('')}</div>`;}

  function renderExplore(){
    const trending=DATA.products.slice().sort((a,b)=>b.popularity-a.popularity).slice(0,8), newest=DATA.products.slice().sort((a,b)=>new Date(b.dateAdded)-new Date(a.dateAdded)).slice(0,8), top=DATA.products.slice().sort((a,b)=>b.rating-a.rating).slice(0,8), deals=DATA.products.filter(p=>p.discount>0).slice(0,8), posts=DATA.posts.slice().sort((a,b)=>b.views-a.views).slice(0,6);
    layout(`<div class="space-y-9">${pageHero('Explore','A living dashboard of trending products, new arrivals, top-rated picks and useful posts.','Explore')}${section('Trending', 'Popularity is based on the sample discovery dataset.',rail(trending,p=>productCard(p,true),'trending'),{kicker:'Signal'})}${section('Newest','Freshly added items in the demo catalog.',rail(newest,p=>productCard(p,true),'newest'),{kicker:'Fresh'})}${section('Top rated','Highly rated items in the sample data.',rail(top,p=>productCard(p,true),'top-rated'),{kicker:'Ratings'})}${section('Deals','Promotional cards are visibly labeled and should be verified at the provider.',rail(deals,p=>productCard(p,true),'deals'),{kicker:'Value'})}${section('Featured posts','Longer-form content across the discovery graph.',`<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">${posts.map(p=>postCard(p)).join('')}</div>`,{kicker:'Stories'})}</div>`);
  }
  function pageHero(title, desc, label='Page'){return `<section class="glass hero-mesh rounded-3xl p-6 md:p-9 border border-base-content/10"><div class="text-xs uppercase tracking-[.18em] text-primary font-semibold">${escapeHTML(label)}</div><h1 class="text-3xl md:text-4xl font-black tracking-tight mt-2">${escapeHTML(title)}</h1><p class="text-base text-base-content/60 mt-2 max-w-2xl">${escapeHTML(desc)}</p></section>`;}

  function renderSearch(q){
    state.query=q; const intent=detectIntent(q); const products=filteredProducts(DATA.products,intent), posts=filteredPosts(DATA.posts);
    layout(`<div class="space-y-6"><div>${pageHero(q?`Search results for “${q}”`:'Search','Search across products, posts, categories, features, platforms and keywords.','Search')}${q?`<div class="mt-4">${intentPanel(q)}</div>`:''}</div><div class="flex flex-col md:grid md:grid-cols-[230px_1fr] gap-5"><aside>${filtersUI()}</aside><section class="space-y-5"><div class="flex flex-wrap items-center justify-between gap-3"><div class="text-sm text-base-content/60"><strong>${products.length + posts.length}</strong> matches · ${products.length} products · ${posts.length} posts</div><div>${sortUI()}</div></div>${products.length?`<div><div class="flex items-center justify-between mb-3"><h2 class="font-bold">Products & tools</h2></div><div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">${products.slice(0,30).map(p=>productCard(p)).join('')}</div></div>`:`<div class="alert bg-base-200">No matching products. Try broader keywords or clear filters.</div>`}${posts.length?`<div><div class="flex items-center justify-between mb-3"><h2 class="font-bold">Posts & guides</h2></div><div class="grid md:grid-cols-2 gap-4">${posts.slice(0,12).map(p=>postCard(p)).join('')}</div></div>`:''}${!products.length&&!posts.length?emptyState('No results','Try another phrase, remove filters, or choose a popular search.',q?`/search?q=`:'/') : ''}</section></section></div>`);
    bindSearchFilters(); bindSearchChips();
  }
  function bindSearchFilters(){ $$('[data-filter]').forEach(el=>el.addEventListener('change',()=>{state.filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value; renderSearch(state.query);})); $$('[data-sort]').forEach(el=>el.addEventListener('change',()=>{state.sort=el.value; renderSearch(state.query);})); $('[data-action="clear-filters"]')?.addEventListener('click',()=>{state.filters={};renderSearch(state.query);}); }
  function emptyState(title,desc,href='/'){return `<div class="glass rounded-3xl p-8 text-center border border-dashed border-base-content/20"><div class="text-3xl">⌁</div><h2 class="font-bold mt-3">${escapeHTML(title)}</h2><p class="text-sm text-base-content/55 mt-1">${escapeHTML(desc)}</p><a href="${escapeHTML(href)}" data-nav class="btn btn-primary btn-sm mt-5">Back to discovery</a></div>`;}

  function renderCategory(slug){
    const cat=categoriesBySlug.get(slug); if(!cat) return render404();
    const products=DATA.products.filter(p=>p.category===slug), posts=DATA.posts.filter(p=>p.category===slug || (slug==='software'&&p.category==='business'));
    layout(`<div class="space-y-8"><div class="glass rounded-3xl p-6 md:p-9 bg-gradient-to-br ${cat.color} border border-base-content/10"><div class="text-4xl">${escapeHTML(cat.icon)}</div><h1 class="text-3xl md:text-4xl font-black tracking-tight mt-3">${escapeHTML(cat.name)}</h1><p class="text-base text-base-content/60 max-w-2xl mt-2">${escapeHTML(cat.description)}</p><div class="flex flex-wrap gap-2 mt-4">${[...new Set(products.flatMap(p=>[p.subcategory,...(p.tags||[])].filter(Boolean)))].slice(0,12).map(x=>badge(x)).join('')}</div></div><div class="flex flex-wrap justify-between items-center gap-3"><div class="text-sm text-base-content/55">${products.length} products · ${posts.length} posts</div><a href="/search?q=${encodeURIComponent(cat.name)}" data-nav class="btn btn-sm btn-outline">Search this category</a></div>${products.length?section('Featured & trending','The category catalog, ranked for discovery.',`<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">${products.slice(0,12).map(p=>productCard(p)).join('')}</div>`,{kicker:'Products'}):emptyState('No products yet','This category has no sample products yet. Explore another category.')} ${posts.length?section('Posts & guides','Contextual content connected to this category.',`<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">${posts.map(p=>postCard(p)).join('')}</div>`,{kicker:'Stories'}):''}${section('Category FAQ','General information for this discovery category.',renderFAQ([{q:`What belongs in ${cat.name}?`,a:cat.description},{q:'How should I compare items here?',a:'Compare the visible features, fit, pricing and official terms; sponsored or affiliate placements are labeled.'}]),{kicker:'FAQ'})}</div>`);
  }

  function recommendationProducts(seed, limit=6){
    const seeds = Array.isArray(seed) ? seed : [seed]; const seen=new Set(seeds.filter(Boolean).map(p=>p.id)); const scored=DATA.products.filter(p=>!seen.has(p.id)).map(p=>{let score=p.popularity*.03+(p.trending?3:0); seeds.filter(Boolean).forEach(s=>{if(p.category===s.category)score+=5;if(p.subcategory===s.subcategory)score+=3;score+=(p.tags||[]).filter(t=>(s.tags||[]).includes(t)).length*1.4;}); if(state.recent.some(k=>k.endsWith(':'+p.id)))score+=2;return {p,score};}).sort((a,b)=>b.score-a.score);return scored.slice(0,limit).map(x=>x.p);}
  function recommendationPosts(seed, limit=4){const seeds=Array.isArray(seed)?seed:[seed];return DATA.posts.map(p=>({p,score:(p.trending?4:0)+p.views/10000+seeds.filter(s=>s && (p.category===s.category || (p.tags||[]).some(t=>(s.tags||[]).includes(t)))).length*5})).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.p);}

  function renderProduct(slug){
    const p=productsBySlug.get(slug); if(!p)return render404(); trackRecent('product',p.id); const related=p.relatedItems?.map(id=>productsById.get(id)).filter(Boolean)||recommendationProducts(p); const relPosts=DATA.posts.filter(x=>(x.relatedProducts||[]).includes(p.id)).slice(0,4);
    layout(`<div class="space-y-8"><div class="text-sm breadcrumbs"><ul><li><a href="/" data-nav>Home</a></li><li><a href="/category/${p.category}" data-nav>${escapeHTML(categoriesBySlug.get(p.category)?.name||p.category)}</a></li><li>${escapeHTML(p.title)}</li></ul></div><section class="glass rounded-3xl overflow-hidden border border-base-content/10"><div class="grid lg:grid-cols-[1.25fr_.75fr]"><div class="relative min-h-[280px] bg-base-200"><img src="${escapeHTML(safeURL(p.image))}" alt="${escapeHTML(p.title)}" width="1200" height="700" class="absolute inset-0 h-full w-full object-cover cursor-zoom-in" data-image-preview data-fallback-image></div><div class="p-6 md:p-8"><div class="flex flex-wrap gap-2">${p.verified?badge('Verified','success'):''}${p.featured?badge('Featured','accent'):''}${p.trending?badge('Trending','accent'):''}${p.sponsored?badge('Sponsored','warning'):''}${p.affiliateUrl?badge('Affiliate') : ''}</div><div class="flex gap-4 items-start mt-4"><div class="size-16 rounded-2xl bg-base-200 grid place-items-center font-black border border-base-content/10">${escapeHTML(p.icon)}</div><div class="min-w-0"><h1 class="text-3xl font-black tracking-tight">${escapeHTML(p.title)}</h1><p class="text-base-content/60 mt-1">${escapeHTML(p.subtitle)}</p></div></div><div class="flex flex-wrap gap-x-5 gap-y-2 mt-5 text-sm"><span>★ <b>${p.rating}</b> (${formatCount(p.reviews)})</span><span>${formatCount(p.views)} views</span><span>${formatCount(p.downloads)} downloads*</span></div><p class="text-sm text-base-content/65 mt-5 leading-7">${escapeHTML(p.description)}</p><div class="flex flex-col sm:flex-row gap-2 mt-6">${p.officialUrl?`<a class="btn btn-primary flex-1" target="_blank" rel="noopener noreferrer" href="${escapeHTML(safeURL(p.officialUrl))}">Official website</a>`:''}${p.affiliateUrl?`<a class="btn btn-outline flex-1" target="_blank" rel="sponsored noopener noreferrer" href="${escapeHTML(safeURL(p.affiliateUrl))}">View offer <span class="text-[10px]">Affiliate</span></a>`:''}<button class="btn btn-ghost" data-action="save" data-id="${escapeHTML(p.id)}">${isSaved(p.id)?'Saved':'Save'}</button><button class="btn btn-ghost" data-action="share" data-type="product" data-id="${escapeHTML(p.id)}">Share</button></div><p class="text-[11px] text-base-content/40 mt-3">*Sample/demo counters in this static build; not global analytics.</p></div></div></section>${adZone('Native promotion', true)}<div class="grid lg:grid-cols-[1fr_330px] gap-6"><article class="space-y-7"><section><h2 class="text-xl font-bold">Features</h2><div class="grid sm:grid-cols-2 gap-3 mt-3">${(p.features||[]).map(x=>`<div class="glass rounded-2xl p-4"><div class="font-medium">${escapeHTML(x)}</div></div>`).join('')}</div></section><section><h2 class="text-xl font-bold">Pros & considerations</h2><div class="grid md:grid-cols-2 gap-4 mt-3"><div class="glass rounded-2xl p-5"><h3 class="font-semibold text-emerald-400">Pros</h3><ul class="mt-3 space-y-2 text-sm text-base-content/65 list-disc pl-5">${(p.pros||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul></div><div class="glass rounded-2xl p-5"><h3 class="font-semibold text-amber-400">Considerations</h3><ul class="mt-3 space-y-2 text-sm text-base-content/65 list-disc pl-5">${(p.cons||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul></div></div></section><section><h2 class="text-xl font-bold">Platforms & pricing</h2><div class="glass rounded-2xl p-5 mt-3 flex flex-wrap gap-2">${(p.platforms||[]).map(x=>badge(x)).join('')}<span class="badge badge-primary">${formatPrice(p.price)}${p.discount?` · ${p.discount}% off`:''}</span></div></section>${p.category==='finance'?`<section class="alert alert-warning"><div><b>Financial information disclaimer</b><p class="text-sm mt-1">Information here is for discovery and education only. Eligibility, rates, approval, fees, coverage and returns depend on the official provider and current terms.</p></div></section>`:''}</article><aside class="space-y-4"><div class="glass rounded-2xl p-5"><div class="text-xs uppercase tracking-widest text-base-content/45">FAQ</div><div class="mt-3">${renderFAQ(p.faq||[])}</div></div><div class="glass rounded-2xl p-5"><div class="text-xs uppercase tracking-widest text-base-content/45">Trust & disclosure</div><p class="text-sm text-base-content/60 mt-2">Verified, sponsored and affiliate labels describe placement metadata in this sample. They are not endorsements.</p></div></aside></div>${related.length?section('Related products','Connected by category, tags and editorial relationships.',rail(related,p=>productCard(p,true),'related products'),{kicker:'You may also like'}):''}${relPosts.length?section('Related posts','Read more around this product.',`<div class="grid md:grid-cols-2 lg:grid-cols-4 gap-4">${relPosts.map(p=>postCard(p)).join('')}</div>`,{kicker:'Read next'}):''}</div>`);
  }

  function renderPost(slug){
    const post=postsBySlug.get(slug); if(!post)return render404(); trackRecent('post',post.id); const relatedProducts=(post.relatedProducts||[]).map(id=>productsById.get(id)).filter(Boolean), relatedPosts=(post.relatedPosts||[]).map(id=>postsById.get(id)).filter(Boolean); if(!relatedPosts.length)relatedPosts.push(...recommendationPosts(post,4).filter(p=>p.id!==post.id));
    layout(`<div class="space-y-7"><div class="breadcrumbs text-sm"><ul><li><a href="/" data-nav>Home</a></li><li><a href="/category/${post.category}" data-nav>${escapeHTML(categoriesBySlug.get(post.category)?.name||post.category)}</a></li><li>${escapeHTML(post.title)}</li></ul></div><article><header class="max-w-4xl"><div class="flex flex-wrap gap-2">${badge(post.category)}${post.featured?badge('Featured','accent'):''}${post.trending?badge('Trending','accent'):''}${post.sponsored?badge('Sponsored','warning'):''}${post.verified?badge('Verified','success'):''}</div><h1 class="text-4xl md:text-5xl font-black tracking-[-.035em] mt-4">${escapeHTML(post.title)}</h1><p class="text-lg text-base-content/60 mt-4 max-w-3xl">${escapeHTML(post.excerpt)}</p><div class="flex flex-wrap items-center gap-4 mt-5 text-sm text-base-content/55"><span>${escapeHTML(post.author)}</span><span>•</span><span>${formatDate(post.date)}</span>${post.updatedAt?`<span>Updated ${formatDate(post.updatedAt)}</span>`:''}<span>${escapeHTML(post.readingTime||'5 min')} read</span><span>${formatCount(post.views)} views</span></div><div class="flex flex-wrap gap-2 mt-5"><button class="btn btn-sm btn-outline" data-action="save" data-id="${escapeHTML(post.id)}">${isSaved(post.id)?'Saved':'Save'}</button><button class="btn btn-sm btn-outline" data-action="like" data-id="${escapeHTML(post.id)}">${isLiked(post.id)?'Liked':'Like'} · ${formatCount((post.likes||0)+(isLiked(post.id)?1:0))}</button><button class="btn btn-sm btn-outline" data-action="share" data-type="post" data-id="${escapeHTML(post.id)}">Share</button><button class="btn btn-sm btn-ghost" data-action="copy-link" data-type="post" data-id="${escapeHTML(post.id)}">Copy link</button></div></header><div class="mt-7 rounded-3xl overflow-hidden border border-base-content/10 bg-base-200"><img src="${escapeHTML(safeURL(post.coverImage))}" alt="${escapeHTML(post.title)}" width="1400" height="800" decoding="async" fetchpriority="high" class="w-full max-h-[520px] object-cover cursor-zoom-in" data-image-preview data-fallback-image></div>${adZone('Advertisement', true)}<div class="grid lg:grid-cols-[1fr_320px] gap-8 mt-8"><div class="prose-like max-w-none">${renderContentBlocks(post.content||[])}</div><aside class="space-y-4"><div class="glass rounded-2xl p-5"><div class="font-semibold">On this post</div><div class="text-sm text-base-content/55 mt-2">${post.tags?.map(t=>badge('#'+t)).join(' ')}</div></div>${post.sponsored?`<div class="glass rounded-2xl p-5 border-warning/20"><div class="font-semibold text-warning">Sponsored content</div><p class="text-sm text-base-content/55 mt-2">This post contains a paid placement and is labeled accordingly.</p></div>`:''}</aside></div></article>${relatedProducts.length?section('Related products','Tools and services referenced by the post.',rail(relatedProducts,p=>productCard(p,true),'related products'),{kicker:'Discover'}):''}${relatedPosts.length?section('More to read','Continue exploring the content graph.',`<div class="grid md:grid-cols-2 lg:grid-cols-4 gap-4">${relatedPosts.map(p=>postCard(p)).join('')}</div>`,{kicker:'Next'}):''}${post.faq?.length?section('Post FAQ','Visible FAQ entries are eligible for contextual structured data.',renderFAQ(post.faq),{kicker:'FAQ'}):''}<div class="flex justify-between gap-3"><a href="/explore" data-nav class="btn btn-outline">← Explore</a><a href="/category/${post.category}" data-nav class="btn btn-primary">More in ${escapeHTML(categoriesBySlug.get(post.category)?.name||post.category)} →</a></div></div>`);
    $('[data-action="copy-link"]')?.addEventListener('click', async b=>{const url=new URL(`/post/${post.slug}`,location.origin).href;try{await navigator.clipboard.writeText(url);toast('Link copied');}catch{toast('Copy unavailable','error');}});
  }
  function renderContentBlocks(blocks){ return blocks.map(block=>{switch(block.type){case'p':return `<p>${escapeHTML(block.text)}</p>`;case'heading':return `<h${Math.min(3,Math.max(2,block.level||2))} class="text-2xl font-bold mt-8 mb-3">${escapeHTML(block.text)}</h${Math.min(3,Math.max(2,block.level||2))}>`;case'list':return `<ul class="list-disc pl-6 text-base-content/70 space-y-2">${(block.items||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>`;case'numbered':return `<ol class="list-decimal pl-6 text-base-content/70 space-y-2">${(block.items||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ol>`;case'quote':return `<blockquote class="my-6 font-medium text-lg">${escapeHTML(block.text)}</blockquote>`;case'highlight':return `<div class="rounded-2xl bg-primary/10 border border-primary/20 p-5 my-6"><div class="text-xs uppercase tracking-widest text-primary font-semibold">${escapeHTML(block.title||'Highlight')}</div><div class="mt-1">${escapeHTML(block.text)}</div></div>`;case'warning':return `<div class="alert alert-warning my-6"><span>⚠</span><span>${escapeHTML(block.text)}</span></div>`;case'image':return `<figure class="my-7"><img src="${escapeHTML(safeURL(block.src))}" alt="${escapeHTML(block.alt||'') }" width="1400" height="800" loading="lazy" class="rounded-2xl w-full object-cover cursor-zoom-in" data-image-preview data-fallback-image><figcaption class="text-xs text-base-content/45 mt-2">${escapeHTML(block.alt||'')}</figcaption></figure>`;case'comparison':return `<div class="overflow-x-auto my-7"><table><thead><tr>${(block.columns||[]).map(c=>`<th>${escapeHTML(c)}</th>`).join('')}</tr></thead><tbody>${(block.rows||[]).map(row=>`<tr>${row.map(c=>`<td>${escapeHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;case'cta':{const p=productsById.get(block.productId);return `<div class="glass rounded-2xl p-5 my-7 border border-primary/20"><div class="text-xs uppercase tracking-widest text-primary font-semibold">Next step</div><h3 class="text-lg font-bold mt-1">${escapeHTML(block.title)}</h3><p class="text-sm text-base-content/60 mt-1">${escapeHTML(block.text)}</p>${p?`<a href="/product/${p.slug}" data-nav class="btn btn-primary btn-sm mt-3">Explore ${escapeHTML(p.title)}</a>`:''}</div>`;}case'product':{const p=productsById.get(block.productId);return p?productCard(p):'';}case'related':{const ps=(block.postIds||[]).map(id=>postsById.get(id)).filter(Boolean);return `<div class="grid sm:grid-cols-2 gap-4 my-7">${ps.map(p=>postCard(p,true)).join('')}</div>`;}default:return '';}}).join(''); }

  function renderSaved(){
    const saved=state.saved.map(id=>productsById.get(id)||postsById.get(id)).filter(Boolean); const products=saved.filter(x=>productsById.has(x.id)), posts=saved.filter(x=>postsById.has(x.id));
    layout(`<div class="space-y-8">${pageHero('Saved library','Your private browser-based collection of saved products, tools and posts.','Your space')}<div class="flex justify-end"><button class="btn btn-sm btn-outline" data-action="clear-saved" ${saved.length?'':'disabled'}>Clear all</button></div>${products.length?section('Saved products','Pinned locally in this browser.',`<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">${products.map(p=>productCard(p)).join('')}</div>`,{kicker:'Products'}):''}${posts.length?section('Saved posts','Pinned locally in this browser.',`<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">${posts.map(p=>postCard(p)).join('')}</div>`,{kicker:'Posts'}):''}${!saved.length?emptyState('Nothing saved yet','Use Save on a product or post to build your personal discovery shelf.','/explore'):''}</div>`); $('[data-action="clear-saved"]')?.addEventListener('click',()=>confirmAction('Clear saved library','This removes every locally saved item from this browser.',()=>{state.saved=[];store.set(KEYS.saved,[]);toast('Saved library cleared');render();})); }
  function render404(){layout(emptyState('Page not found','The route does not exist. Search the catalog or go back to explore.','/explore'));}

  function updateSEO(route, entity){
    let title=DATA.site.name, desc=DATA.site.description, image=''; let robots='index,follow,max-image-preview:large'; let type='WebSite';
    if(route.type==='product'){title=`${entity.title} — ${DATA.site.name}`;desc=entity.description;image=entity.image;type=entity.category==='finance'?'Product':'SoftwareApplication';}
    else if(route.type==='post'){title=`${entity.title} — ${DATA.site.name}`;desc=entity.excerpt;image=entity.coverImage;type='Article';}
    else if(route.type==='category'){title=`${entity.name} — ${DATA.site.name}`;desc=entity.description;type='CollectionPage';}
    else if(route.type==='search'){title=route.q?`Search: ${route.q} — ${DATA.site.name}`:`Search — ${DATA.site.name}`;desc='Search apps, software, AI tools, finance resources, deals and useful posts.';robots='noindex,follow';type='SearchResultsPage';}
    else if(route.type==='404'){title=`Page not found — ${DATA.site.name}`;desc='The page you requested could not be found.';robots='noindex,follow';}
    document.title=title; const setMeta=(sel,attr,val)=>{let el=$(sel);if(!el){el=document.createElement('meta');if(attr==='name')el.name=sel.match(/meta\[name="([^"]+)/)?.[1]||'';document.head.appendChild(el);}el.setAttribute(attr,val);}; const metaDesc=$('meta[name="description"]');if(metaDesc)metaDesc.content=desc; const robotsMeta=$('meta[name="robots"]');if(robotsMeta)robotsMeta.content=robots;
    const canonical=$('link[rel="canonical"]');if(canonical)canonical.href=new URL(location.pathname+location.search,location.origin).href;
    [['og:title',title],['og:description',desc],['og:url',location.href],['og:image',image||new URL('/icon-512.png',location.origin).href],['twitter:title',title],['twitter:description',desc],['twitter:image',image||new URL('/icon-512.png',location.origin).href]].forEach(([name,val])=>{let el=document.querySelector(`meta[property="${name}"]`)||document.querySelector(`meta[name="${name}"]`);if(!el){el=document.createElement('meta');(name.startsWith('og:')?el.setAttribute('property',name):el.setAttribute('name',name));document.head.appendChild(el);}el.setAttribute('content',val);});
    const schema=schemaFor(route,entity); const schemaEl=$('#schema-json'); if(schemaEl)schemaEl.textContent=JSON.stringify(schema);
  }
  function schemaFor(route,entity){
    const base={ '@context':'https://schema.org', name:DATA.site.name, url:DATA.site.url, description:DATA.site.description, publisher:{'@type':'Organization',name:DATA.site.organization} };
    if(route.type==='product'){return {...base,'@type':entity.category==='software'?'SoftwareApplication':'Product',name:entity.title,url:new URL(`/product/${entity.slug}`,location.origin).href,description:entity.description,category:entity.category,offers:entity.price>0?{'@type':'Offer',price:entity.price,priceCurrency:'USD',url:new URL(`/product/${entity.slug}`,location.origin).href}:undefined,aggregateRating:entity.reviews>0?{'@type':'AggregateRating',ratingValue:entity.rating,bestRating:5,ratingCount:entity.reviews}:undefined};}
    if(route.type==='post')return {...base,'@type':'Article',headline:entity.title,description:entity.excerpt,datePublished:entity.date,dateModified:entity.updatedAt||entity.date,author:{'@type':'Person',name:entity.author},image:[entity.coverImage],mainEntityOfPage:new URL(`/post/${entity.slug}`,location.origin).href};
    if(route.type==='category')return {...base,'@type':'CollectionPage',name:entity.name,description:entity.description};
    if(route.type==='search')return {...base,'@type':'WebSite',potentialAction:{'@type':'SearchAction',target:new URL('/search?q={search_term_string}',location.origin).href,'query-input':'required name=search_term_string'}};
    return {...base,'@type':'WebSite',potentialAction:{'@type':'SearchAction',target:new URL('/search?q={search_term_string}',location.origin).href,'query-input':'required name=search_term_string'}};
  }

  function resolveRoute(){
    const path=routePath(); if(path==='/')return {type:'home'}; if(path==='/explore')return {type:'explore'}; if(path==='/saved')return {type:'saved'}; if(path==='/search')return {type:'search',q:new URLSearchParams(location.search).get('q')||''}; let m=path.match(/^\/product\/([^/]+)$/);if(m)return{type:'product',slug:decodeURIComponent(m[1])};m=path.match(/^\/post\/([^/]+)$/);if(m)return{type:'post',slug:decodeURIComponent(m[1])};m=path.match(/^\/category\/([^/]+)$/);if(m)return{type:'category',slug:decodeURIComponent(m[1])};return{type:'404'};
  }
  function render(){
    closeModal(); const r=resolveRoute(); try{ switch(r.type){case'home':renderHome();updateSEO(r);break;case'explore':renderExplore();updateSEO(r);break;case'saved':renderSaved();updateSEO(r);break;case'search':renderSearch(r.q);updateSEO(r);break;case'product':const p=productsBySlug.get(r.slug);if(p){renderProduct(r.slug);updateSEO(r,p);}else render404();break;case'post':const post=postsBySlug.get(r.slug);if(post){renderPost(r.slug);updateSEO(r,post);}else render404();break;case'category':const c=categoriesBySlug.get(r.slug);if(c){renderCategory(r.slug);updateSEO(r,c);}else render404();break;default:render404();updateSEO(r);}}catch(err){console.error('NexaMart render error',err);render404();updateSEO({type:'404'});} }

  document.addEventListener('click', e => { const action=e.target.closest('[data-action]')?.dataset.action; if(action==='copy-link') return; });
  window.addEventListener('popstate',render);
  window.addEventListener('storage',()=>{state.saved=store.get(KEYS.saved,[]);state.likes=store.get(KEYS.likes,[]);state.recent=store.get(KEYS.recent,[]);render();});
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(activeTheme()==='system')setTheme('system');});
  document.addEventListener('contextmenu', e => { if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return; if(e.target.closest('img')) e.preventDefault(); });
  document.addEventListener('dragstart', e => { if(e.target?.tagName==='IMG') e.preventDefault(); });
  setTheme(activeTheme(), false);
  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{})); }
  render();
})();
