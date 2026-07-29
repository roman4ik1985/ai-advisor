(() => {
  const STORE_HOSTS = new Set(['ledprojector.com.ua', 'www.ledprojector.com.ua']);
  const PRODUCT_CARD_SELECTORS = [
    '[data-product-id]',
    '[data-product-sku]',
    '.product-layout',
    '.product-thumb',
    '.product-grid',
    '.product-list',
  ].join(',');
  const CONTROL_SELECTORS = 'button,input,select,textarea,[role="button"],.btn,.button,[onclick]';

  function safeStoreUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.port
        || !STORE_HOSTS.has(url.hostname.toLowerCase())
      ) return '';
      url.hostname = 'ledprojector.com.ua';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function canonicalStoreUrl(value) {
    const safeUrl = safeStoreUrl(value);
    if (!safeUrl) return '';
    const url = new URL(safeUrl);
    let pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/g, '');
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the encoded path when it contains an invalid escape sequence.
    }
    return `https://ledprojector.com.ua${pathname.toLowerCase() || '/'}`;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLocaleLowerCase('uk-UA')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function safeImageUrl(value) {
    return safeStoreUrl(value);
  }

  function normalizeAvailability(value) {
    const state = String(value?.state || value || '').toUpperCase();
    return ['IN_STOCK', 'OUT_OF_STOCK'].includes(state) ? state : 'UNKNOWN';
  }

  function normalizeProduct(rawProduct) {
    const raw = rawProduct && typeof rawProduct === 'object' ? rawProduct : {};
    const url = safeStoreUrl(raw.canonicalUrl || raw.url);
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!url || !name) return null;

    const aliases = [...new Set((Array.isArray(raw.aliases) ? raw.aliases : [])
      .map((alias) => String(alias || '').replace(/\s+/g, ' ').trim().slice(0, 240))
      .filter(Boolean))].slice(0, 12);
    const prices = [...new Set((Array.isArray(raw.prices) ? raw.prices : [])
      .map((price) => String(price || '').replace(/\s+/g, ' ').trim().slice(0, 80))
      .filter(Boolean))].slice(0, 2);
    const imageCandidates = [
      ...(Array.isArray(raw.images) ? raw.images : []),
      raw.image,
    ];
    const image = imageCandidates.map(safeImageUrl).find(Boolean) || '';

    return {
      id: String(raw.id || '').trim().slice(0, 120),
      sku: String(raw.sku || '').trim().slice(0, 120),
      name,
      aliases,
      url,
      canonicalUrl: canonicalStoreUrl(url),
      image,
      prices,
      availability: normalizeAvailability(raw.availability),
    };
  }

  function selectProducts(rawCatalog) {
    const selected = [];
    const seen = new Set();
    for (const rawProduct of Array.isArray(rawCatalog) ? rawCatalog : []) {
      const product = normalizeProduct(rawProduct);
      if (!product) continue;
      const key = product.canonicalUrl || (product.id ? `id:${normalizeText(product.id)}` : '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push(product);
      if (selected.length === 3) break;
    }
    return selected;
  }

  function candidateMatches(candidate, product, field) {
    const expected = field === 'urls'
      ? new Set([product.canonicalUrl].filter(Boolean))
      : field === 'ids'
        ? new Set([normalizeText(product.id)].filter(Boolean))
        : field === 'skus'
          ? new Set([normalizeText(product.sku)].filter(Boolean))
          : new Set([product.name, ...product.aliases].map(normalizeText).filter(Boolean));
    if (expected.size === 0) return false;

    const values = Array.isArray(candidate?.[field]) ? candidate[field] : [];
    return values.some((value) => {
      const normalized = field === 'urls' ? canonicalStoreUrl(value) : normalizeText(value);
      return normalized && expected.has(normalized);
    });
  }

  function matchProductCandidate(product, candidates, currentUrl = '') {
    const list = Array.isArray(candidates) ? candidates : [];
    for (const field of ['urls', 'ids', 'skus', 'names']) {
      const match = list.find((candidate) => candidateMatches(candidate, product, field));
      if (match) return match.element || match;
    }
    if (product.canonicalUrl && canonicalStoreUrl(currentUrl) === product.canonicalUrl) {
      return list.find((candidate) => candidate.detail)?.element || null;
    }
    return null;
  }

  function rectsIntersect(left, right) {
    return left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top;
  }

  function chooseGuidePosition(targetRect, viewport, obstacles = [], size = 96, gap = 12) {
    if (!targetRect || !viewport || viewport.width < 700) return null;
    const width = Number(viewport.width) || 0;
    const height = Number(viewport.height) || 0;
    const margin = 12;
    const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
    const centerY = targetRect.top + ((targetRect.bottom - targetRect.top - size) / 2);
    const centerX = targetRect.left + ((targetRect.right - targetRect.left - size) / 2);
    const candidates = [
      { left: targetRect.right + gap, top: centerY },
      { left: targetRect.left - size - gap, top: centerY },
      { left: centerX, top: targetRect.bottom + gap },
      { left: centerX, top: targetRect.top - size - gap },
    ];

    for (const candidate of candidates) {
      const left = clamp(candidate.left, margin, width - size - margin);
      const top = clamp(candidate.top, margin, height - size - margin);
      const rect = { left, top, right: left + size, bottom: top + size };
      if (rectsIntersect(rect, targetRect)) continue;
      if (obstacles.some((obstacle) => rectsIntersect(rect, obstacle))) continue;
      return { left, top };
    }
    return null;
  }

  function errorKind(error) {
    if (error?.name === 'AbortError') return 'timeout';
    if (error?.uiCode === 'RATE_LIMITED') return 'rateLimit';
    if (error?.uiCode === 'UNAVAILABLE') return 'unavailable';
    return 'error';
  }

  if (window.__ledProjectorAgentTestOnly) {
    window.__ledProjectorAgentTestHooks = Object.freeze({
      canonicalStoreUrl,
      chooseGuidePosition,
      errorKind,
      matchProductCandidate,
      normalizeProduct,
      normalizeText,
      selectProducts,
    });
    return;
  }

  if (window.__ledProjectorAgentLoaded) return;
  window.__ledProjectorAgentLoaded = true;

  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint || 'https://ai.ledprojector.com.ua/api/chat';
  const mascotUrl = script?.dataset.mascot || 'https://ai.ledprojector.com.ua/assets/mascot.png';
  const productTarget = script?.dataset.productTarget === '_blank' ? '_blank' : '_self';
  const panelId = 'lp-agent-panel';
  const language = document.documentElement.lang?.toLowerCase().startsWith('ru') ? 'ru' : 'uk';
  const copy = language === 'ru' ? {
    title: 'Помощник LedProjector',
    status: 'Подберу проектор под ваши задачи',
    bubble: 'Помочь выбрать проектор?',
    greeting: 'Здравствуйте! Расскажите, где и как планируете использовать проектор — помогу сузить выбор.',
    placeholder: 'Напишите ваш вопрос…',
    send: 'Отправить',
    close: 'Закрыть консультанта',
    open: 'Открыть AI-консультанта',
    suggestions: ['Подберите проектор', 'Сравнить модели', 'Доставка и оплата'],
    thinking: 'Думаю…',
    products: 'Подходящие товары',
    showProduct: 'Показать товар',
    openProduct: 'Открыть товар',
    productShown: 'Товар показан на странице.',
    inStock: 'В наличии',
    outOfStock: 'Нет в наличии',
    retry: 'Повторить',
    error: 'Не удалось получить ответ. Попробуйте ещё раз.',
    timeout: 'Ответ занимает слишком долго. Попробуйте ещё раз.',
    rateLimit: 'Слишком много запросов. Подождите немного и попробуйте снова.',
    unavailable: 'Консультант временно недоступен. Попробуйте ещё раз позже.',
  } : {
    title: 'Помічник LedProjector',
    status: 'Підберу проєктор під ваші задачі',
    bubble: 'Допомогти обрати проєктор?',
    greeting: 'Вітаю! Розкажіть, де і як плануєте використовувати проєктор — допоможу звузити вибір.',
    placeholder: 'Напишіть ваше питання…',
    send: 'Надіслати',
    close: 'Закрити консультанта',
    open: 'Відкрити AI-консультанта',
    suggestions: ['Підібрати проєктор', 'Порівняти моделі', 'Доставка й оплата'],
    thinking: 'Думаю…',
    products: 'Відповідні товари',
    showProduct: 'Показати товар',
    openProduct: 'Відкрити товар',
    productShown: 'Товар показано на сторінці.',
    inStock: 'У наявності',
    outOfStock: 'Немає в наявності',
    retry: 'Повторити',
    error: 'Не вдалося отримати відповідь. Спробуйте ще раз.',
    timeout: 'Відповідь надходить надто довго. Спробуйте ще раз.',
    rateLimit: 'Забагато запитів. Зачекайте трохи й спробуйте знову.',
    unavailable: 'Консультант тимчасово недоступний. Спробуйте пізніше.',
  };

  const root = document.createElement('aside');
  root.className = 'lp-agent-root';
  root.dataset.open = 'false';
  root.setAttribute('aria-label', copy.title);
  root.innerHTML = `
    <div class="lp-agent-bubble" aria-hidden="true">${escapeHtml(copy.bubble)}</div>
    <section class="lp-agent-panel" id="${panelId}" role="dialog" aria-modal="false" aria-labelledby="lp-agent-title">
      <header class="lp-agent-header">
        <img class="lp-agent-header-mark" src="${escapeAttribute(mascotUrl)}" alt="" />
        <div class="lp-agent-header-copy"><h2 class="lp-agent-title" id="lp-agent-title">${escapeHtml(copy.title)}</h2><p class="lp-agent-status">${escapeHtml(copy.status)}</p></div>
        <button class="lp-agent-icon-button" type="button" data-action="close" aria-label="${escapeAttribute(copy.close)}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="lp-agent-messages" aria-live="polite" aria-busy="false"></div>
      <form class="lp-agent-composer">
        <label class="lp-agent-sr-only" for="lp-agent-input">${escapeHtml(copy.placeholder)}</label>
        <input class="lp-agent-input" id="lp-agent-input" maxlength="1200" autocomplete="off" placeholder="${escapeAttribute(copy.placeholder)}" />
        <button class="lp-agent-send" type="submit" aria-label="${escapeAttribute(copy.send)}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 12h13" stroke="currentColor" stroke-width="2"/></svg>
        </button>
      </form>
    </section>
    <p class="lp-agent-sr-only lp-agent-guide-status" role="status" aria-live="polite"></p>
    <button class="lp-agent-mascot-button" type="button" data-action="open" aria-label="${escapeAttribute(copy.open)}" aria-controls="${panelId}" aria-expanded="false">
      <img class="lp-agent-mascot" src="${escapeAttribute(mascotUrl)}" alt="" />
    </button>`;

  document.body.append(root);
  const panel = root.querySelector('.lp-agent-panel');
  const messagesElement = root.querySelector('.lp-agent-messages');
  const input = root.querySelector('.lp-agent-input');
  const sendButton = root.querySelector('.lp-agent-send');
  const openButton = root.querySelector('[data-action="open"]');
  const guideStatus = root.querySelector('.lp-agent-guide-status');
  const conversation = [];
  const suggestionButtons = [];
  let busy = false;
  let guideTimer;
  let guideStartTimer;
  let suppressScrollResetUntil = 0;
  let guidedTarget = null;
  let guidedTargetTabindex = null;
  let lastFocusedElement = null;

  addMessage('assistant', copy.greeting);
  addSuggestions();

  openButton.addEventListener('click', () => setOpen(root.dataset.open !== 'true'));
  root.querySelector('[data-action="close"]').addEventListener('click', () => setOpen(false));
  root.querySelector('.lp-agent-composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    addMessage('user', text);
    conversation.push({ role: 'user', content: text });
    await requestAnswer(text);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.dataset.open === 'true') setOpen(false);
  });
  window.addEventListener('resize', resetGuide, { passive: true });
  window.addEventListener('scroll', () => {
    if (Date.now() >= suppressScrollResetUntil) resetGuide();
  }, { passive: true });

  function setOpen(open, options = {}) {
    if (open) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetGuide();
    }
    root.dataset.open = String(open);
    openButton.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-modal', 'false');
    if (open) {
      input.focus();
    } else if (options.restoreFocus !== false) {
      restoreFocus();
    }
  }

  async function requestAnswer(text) {
    if (busy) return;
    setBusy(true);
    const pending = addMessage('assistant', copy.thinking, { status: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation.slice(-8), page: collectPageContext() }),
        signal: controller.signal,
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw userInterfaceError('INVALID_RESPONSE');
      }
      if (!response.ok) {
        throw userInterfaceError(response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'UNAVAILABLE' : 'REQUEST_FAILED');
      }
      if (typeof payload?.answer !== 'string' || !payload.answer.trim()) throw userInterfaceError('INVALID_RESPONSE');
      pending.textContent = payload.answer.trim();
      pending.dataset.state = 'answer';
      conversation.push({ role: 'assistant', content: payload.answer.trim() });
      addProductCards(payload.catalog, pending);
    } catch (error) {
      const kind = errorKind(error);
      pending.textContent = copy[kind];
      pending.dataset.state = 'error';
      addRetry(text, pending);
    } finally {
      clearTimeout(timeout);
      setBusy(false);
      input.focus();
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }

  function addMessage(role, text, options = {}) {
    const element = document.createElement('p');
    element.className = 'lp-agent-message';
    element.dataset.role = role;
    if (options.status) {
      element.setAttribute('role', 'status');
      element.setAttribute('aria-atomic', 'true');
    }
    element.textContent = text;
    messagesElement.append(element);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    return element;
  }

  function addRetry(text, afterElement) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lp-agent-retry';
    button.textContent = copy.retry;
    button.addEventListener('click', async () => {
      button.remove();
      await requestAnswer(text);
    }, { once: true });
    afterElement.after(button);
  }

  function addProductCards(rawCatalog, afterElement) {
    const products = selectProducts(rawCatalog);
    if (products.length === 0) return;

    const section = document.createElement('section');
    section.className = 'lp-agent-products';
    section.setAttribute('aria-label', copy.products);
    const heading = document.createElement('h3');
    heading.className = 'lp-agent-products-title';
    heading.textContent = copy.products;
    const list = document.createElement('div');
    list.className = 'lp-agent-product-list';
    list.setAttribute('role', 'list');

    for (const product of products) {
      const card = document.createElement('article');
      card.className = 'lp-agent-product-card';
      card.setAttribute('role', 'listitem');

      if (product.image) {
        card.classList.add('lp-agent-product-card-has-image');
        const image = document.createElement('img');
        image.className = 'lp-agent-product-image';
        image.src = product.image;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        card.append(image);
      }

      const body = document.createElement('div');
      body.className = 'lp-agent-product-body';
      const title = document.createElement('h4');
      title.className = 'lp-agent-product-name';
      const titleLink = document.createElement('a');
      titleLink.href = product.url;
      titleLink.target = productTarget;
      if (productTarget === '_blank') titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = product.name;
      title.append(titleLink);
      body.append(title);

      if (product.prices.length > 0) {
        const price = document.createElement('p');
        price.className = 'lp-agent-product-price';
        price.textContent = product.prices[product.prices.length - 1];
        body.append(price);
      }
      if (product.availability !== 'UNKNOWN') {
        const availability = document.createElement('p');
        availability.className = 'lp-agent-product-availability';
        availability.dataset.state = product.availability;
        availability.textContent = product.availability === 'IN_STOCK' ? copy.inStock : copy.outOfStock;
        body.append(availability);
      }

      const action = document.createElement('a');
      action.className = 'lp-agent-product-action';
      action.href = product.url;
      action.target = productTarget;
      if (productTarget === '_blank') action.rel = 'noopener noreferrer';
      action.textContent = findProductTarget(product) ? copy.showProduct : copy.openProduct;
      action.addEventListener('click', (event) => {
        const target = findProductTarget(product);
        if (!target) return;
        event.preventDefault();
        showProduct(target);
      });
      body.append(action);
      card.append(body);
      list.append(card);
    }

    section.append(heading, list);
    afterElement.after(section);
  }

  function findProductTarget(product) {
    const candidates = collectDomCandidates();
    return matchProductCandidate(product, candidates, location.href);
  }

  function collectDomCandidates() {
    const candidates = [];
    for (const element of document.querySelectorAll(PRODUCT_CARD_SELECTORS)) {
      if (root.contains(element)) continue;
      const links = [
        ...(element.matches?.('a[href]') ? [element] : []),
        ...element.querySelectorAll('a[href]'),
      ];
      const names = [
        ...element.querySelectorAll('.product-name,h1,h2,h3,[itemprop="name"]'),
      ].map((node) => node.textContent || '');
      candidates.push({
        element,
        urls: links.map((link) => link.href || link.getAttribute('href')),
        ids: [
          element.dataset.productId,
          element.getAttribute('data-product-id'),
          element.getAttribute('data-product_id'),
        ],
        skus: [
          element.dataset.productSku,
          element.dataset.sku,
          ...[...element.querySelectorAll('.product-model,[itemprop="sku"]')].map((node) => node.textContent || ''),
        ],
        names,
      });
    }

    const detailTarget = document.querySelector('.product-info,#product-product main,main');
    if (detailTarget && !root.contains(detailTarget)) {
      candidates.push({
        element: detailTarget,
        detail: true,
        urls: [location.href],
        ids: [detailTarget.dataset?.productId],
        skus: [...detailTarget.querySelectorAll('.product-model,[itemprop="sku"]')].map((node) => node.textContent || ''),
        names: [...detailTarget.querySelectorAll('h1,[itemprop="name"]')].map((node) => node.textContent || ''),
      });
    }
    return candidates;
  }

  function showProduct(target) {
    resetGuide();
    setOpen(false, { restoreFocus: false });
    const rect = target.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!visible) {
      suppressScrollResetUntil = Date.now() + (reducedMotion ? 150 : 1200);
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
    guideStartTimer = setTimeout(
      () => guideToTarget(target),
      visible || reducedMotion ? 0 : 450,
    );
  }

  function guideToTarget(target) {
    resetGuide();
    guidedTarget = target;
    guidedTargetTabindex = target.getAttribute('tabindex');
    target.classList.add('lp-agent-product-highlight');
    if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    guideStatus.textContent = copy.productShown;

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && innerWidth >= 700) {
      const targetRect = target.getBoundingClientRect();
      const obstacles = [...document.querySelectorAll(CONTROL_SELECTORS)]
        .filter((element) => !root.contains(element) && !target.contains(element))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const position = chooseGuidePosition(targetRect, { width: innerWidth, height: innerHeight }, obstacles);
      if (position) {
        root.style.setProperty('--lp-agent-guide-left', `${Math.round(position.left)}px`);
        root.style.setProperty('--lp-agent-guide-top', `${Math.round(position.top)}px`);
        root.dataset.guiding = 'true';
      }
    }
    guideTimer = setTimeout(resetGuide, 8000);
  }

  function resetGuide() {
    clearTimeout(guideTimer);
    clearTimeout(guideStartTimer);
    root.dataset.guiding = 'false';
    root.style.removeProperty('--lp-agent-guide-left');
    root.style.removeProperty('--lp-agent-guide-top');
    if (guidedTarget) {
      guidedTarget.classList.remove('lp-agent-product-highlight');
      if (guidedTargetTabindex === null) guidedTarget.removeAttribute('tabindex');
      else guidedTarget.setAttribute('tabindex', guidedTargetTabindex);
    }
    guidedTarget = null;
    guidedTargetTabindex = null;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    sendButton.disabled = nextBusy;
    for (const button of suggestionButtons) button.disabled = nextBusy;
    panel.setAttribute('aria-busy', String(nextBusy));
    messagesElement.setAttribute('aria-busy', String(nextBusy));
  }

  function restoreFocus() {
    if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
      lastFocusedElement.focus();
      return;
    }
    openButton.focus();
  }

  function addSuggestions() {
    const group = document.createElement('div');
    group.className = 'lp-agent-suggestions';
    for (const suggestion of copy.suggestions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lp-agent-suggestion';
      button.textContent = suggestion;
      button.addEventListener('click', async () => {
        if (busy) return;
        addMessage('user', suggestion);
        conversation.push({ role: 'user', content: suggestion });
        await requestAnswer(suggestion);
      });
      suggestionButtons.push(button);
      group.append(button);
    }
    messagesElement.append(group);
  }

  function collectPageContext() {
    const selectors = ['h1', '.product-model', '.price', '.product-price', '.description', '#tab-description'];
    const visibleText = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)].slice(0, 3))
      .filter((element) => !root.contains(element))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 4000);
    return { title: document.title, url: location.href, language, visibleText };
  }

  function userInterfaceError(uiCode) {
    const error = new Error('Widget request failed.');
    error.uiCode = uiCode;
    return error;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
