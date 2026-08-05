void (async () => {
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
  const ANALYTICS_ENVIRONMENTS = new Set(['production', 'staging']);
  const ANALYTICS_SCHEMA_PATTERN = /^[A-Za-z0-9._-]{1,32}$/u;
  const ANALYTICS_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

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

  function createAnalyticsUuid(cryptoObject = window.crypto) {
    try {
      if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
      if (typeof cryptoObject?.getRandomValues !== 'function') return '';
      const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    } catch {
      return '';
    }
  }

  function classifyPageType(locationLike = window.location) {
    try {
      const url = new URL(String(locationLike?.href || ''), 'https://ledprojector.com.ua/');
      const path = url.pathname.toLowerCase();
      const route = String(url.searchParams.get('route') || '').toLowerCase();
      if (path === '/' && !route) return 'home';
      if (path.includes('checkout') || route.includes('checkout/checkout') || route.includes('checkout/simplecheckout')) return 'checkout';
      if (path.includes('cart') || route.includes('checkout/cart')) return 'cart';
      if (path.includes('search') || route.includes('product/search')) return 'search';
      if (path.includes('product') || route.includes('product/product')) return 'product';
      if (path.includes('category') || route.includes('product/category')) return 'category';
      return 'other';
    } catch {
      return 'other';
    }
  }

  function questionLengthBucket(value) {
    const length = typeof value === 'number'
      ? Math.max(0, Math.round(value))
      : String(value || '').length;
    if (length <= 40) return '1_40';
    if (length <= 120) return '41_120';
    if (length <= 300) return '121_300';
    return '301_plus';
  }

  function countBucket(value) {
    const count = Math.max(0, Number.parseInt(value, 10) || 0);
    return count >= 3 ? '3_plus' : String(count);
  }

  function analyticsFailure(error) {
    if (error?.name === 'AbortError') {
      return { error_type: 'timeout', error_stage: 'request', retryable: true };
    }
    if (error?.uiCode === 'RATE_LIMITED') {
      return { error_type: 'rate_limited', error_stage: 'request', retryable: true };
    }
    if (error?.uiCode === 'INVALID_RESPONSE') {
      return { error_type: 'invalid_response', error_stage: 'finalization', retryable: true };
    }
    if (error?.uiCode === 'REQUEST_FAILED') {
      return { error_type: 'validation', error_stage: 'request', retryable: false };
    }
    if (error?.uiCode === 'UNAVAILABLE') {
      return { error_type: 'upstream', error_stage: 'request', retryable: true };
    }
    if (error instanceof TypeError) {
      return { error_type: 'network', error_stage: 'request', retryable: true };
    }
    return { error_type: 'unknown', error_stage: 'unknown', retryable: false };
  }

  function createWidgetAnalyticsAdapter({
    configUrl,
    eventUrl,
    locale,
    pageType,
    trafficType,
    fetchImpl = window.fetch?.bind(window),
    now = () => Date.now(),
    uuid = () => createAnalyticsUuid(),
  }) {
    const analyticsSessionId = uuid();
    const terminalInteractions = new Set();
    const queue = [];
    let ready = false;
    let enabled = false;
    let baseProperties = null;
    let firstOpen = true;
    let widgetShown = false;

    const initialized = initialize();

    async function initialize() {
      if (!analyticsSessionId || typeof fetchImpl !== 'function') {
        ready = true;
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetchImpl(configUrl, { cache: 'no-store', signal: controller.signal });
        const config = response.ok ? await response.json() : null;
        if (
          config?.enabled === true
          && ANALYTICS_ENVIRONMENTS.has(config.environment)
          && ANALYTICS_SCHEMA_PATTERN.test(String(config.schemaVersion || ''))
          && ANALYTICS_VERSION_PATTERN.test(String(config.widgetVersion || ''))
        ) {
          enabled = true;
          baseProperties = Object.freeze({
            schema_version: String(config.schemaVersion),
            environment: config.environment,
            widget_version: String(config.widgetVersion),
            locale,
            page_type: pageType,
            traffic_type: trafficType,
          });
        }
      } catch {
        enabled = false;
      } finally {
        clearTimeout(timer);
        ready = true;
        if (enabled) {
          for (const item of queue.splice(0)) send(item.event, item.properties);
        } else {
          queue.length = 0;
        }
      }
    }

    function capture(event, properties = {}) {
      const item = { event, properties: { ...properties } };
      if (!ready) {
        if (queue.length < 24) queue.push(item);
        return false;
      }
      if (!enabled) return false;
      send(item.event, item.properties);
      return true;
    }

    function send(event, properties) {
      const body = JSON.stringify({
        event,
        analyticsSessionId,
        properties: { ...baseProperties, ...properties },
      });
      void fetchImpl(eventUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }

    function createInteraction({ questionLength, hasProductContext, wasRetried = false }) {
      const interactionId = uuid();
      if (!interactionId) return null;
      return Object.freeze({
        interactionId,
        startedAt: now(),
        questionLength,
        hasProductContext: Boolean(hasProductContext),
        wasRetried: Boolean(wasRetried),
      });
    }

    function responseTime(attempt) {
      return Math.max(0, Math.min(180_000, Math.round(now() - attempt.startedAt)));
    }

    return Object.freeze({
      initialized,
      createInteraction,
      trackWidgetShown(renderLocation = 'storefront_overlay') {
        if (widgetShown) return false;
        widgetShown = true;
        return capture('widget_shown', { render_location: renderLocation });
      },
      trackWidgetOpened(openSource = 'launcher') {
        const isFirstOpen = firstOpen;
        firstOpen = false;
        return capture('widget_opened', {
          open_source: openSource,
          is_first_open_in_session: isFirstOpen,
        });
      },
      trackQuestionSubmitted(attempt) {
        if (!attempt) return false;
        return capture('question_submitted', {
          interaction_id: attempt.interactionId,
          question_length_bucket: questionLengthBucket(attempt.questionLength),
          input_mode: 'text',
          has_product_context: attempt.hasProductContext,
        });
      },
      trackAnswerCompleted(attempt, recommendationCount) {
        if (!attempt || terminalInteractions.has(attempt.interactionId)) return false;
        terminalInteractions.add(attempt.interactionId);
        return capture('answer_completed', {
          interaction_id: attempt.interactionId,
          response_time_ms: responseTime(attempt),
          delivery_mode: 'full',
          was_retried: attempt.wasRetried,
          recommendation_count_bucket: countBucket(recommendationCount),
        });
      },
      trackAnswerFailed(attempt, failure) {
        if (!attempt || terminalInteractions.has(attempt.interactionId)) return false;
        terminalInteractions.add(attempt.interactionId);
        return capture('answer_failed', {
          interaction_id: attempt.interactionId,
          response_time_ms: responseTime(attempt),
          error_type: failure.error_type,
          error_stage: failure.error_stage,
          retryable: failure.retryable,
          was_retried: attempt.wasRetried,
          timeout_threshold_ms: 55_000,
        });
      },
      trackProductOpened(attempt, product, position, openTarget) {
        const productId = String(product?.id || product?.sku || '').trim();
        if (!attempt || !/^[A-Za-z0-9:_./-]{1,120}$/u.test(productId)) return false;
        return capture('product_opened', {
          interaction_id: attempt.interactionId,
          product_id: productId,
          recommendation_position_bucket: position >= 3 ? '3_plus' : String(position),
          open_target: openTarget,
        });
      },
      trackOrderHandoffStarted(attempt, handoffType, productCount) {
        if (!attempt) return false;
        return capture('order_handoff_started', {
          interaction_id: attempt.interactionId,
          handoff_type: handoffType,
          product_count_bucket: countBucket(productCount),
        });
      },
      trackAnswerFeedbackSubmitted(attempt, helpful) {
        if (!attempt || typeof helpful !== 'boolean') return false;
        return capture('answer_feedback_submitted', {
          interaction_id: attempt.interactionId,
          helpful,
        });
      },
    });
  }

  async function readWidgetVisibility(configUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(configUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return true;
      const config = await response.json();
      return config?.enabled !== false;
    } catch {
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (window.__ledProjectorAgentTestOnly) {
    window.__ledProjectorAgentTestHooks = Object.freeze({
      canonicalStoreUrl,
      classifyPageType,
      chooseGuidePosition,
      createAnalyticsUuid,
      createWidgetAnalyticsAdapter,
      errorKind,
      matchProductCandidate,
      normalizeProduct,
      normalizeText,
      readWidgetVisibility,
      selectProducts,
    });
    return;
  }

  if (window.__ledProjectorAgentLoaded) return;
  window.__ledProjectorAgentLoaded = true;

  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint || 'https://ai.ledprojector.com.ua/api/chat';
  const widgetConfigEndpoint = new URL('/widget-config.json', new URL(endpoint, location.href).origin).toString();
  if (!await readWidgetVisibility(widgetConfigEndpoint)) return;
  const orderLinkEndpoint = new URL('/api/telegram/order-link', new URL(endpoint, location.href).origin).toString();
  const analyticsConfigEndpoint = new URL('/api/analytics/config', new URL(endpoint, location.href).origin).toString();
  const analyticsEventEndpoint = new URL('/api/analytics/event', new URL(endpoint, location.href).origin).toString();
  const productAnalyticsEnabled = script?.dataset.productAnalytics === 'true';
  const productAnalyticsEndpoint = new URL('/api/analytics/product', new URL(endpoint, location.href).origin).toString();
  const mascotUrl = script?.dataset.mascot || 'https://ai.ledprojector.com.ua/assets/mascot.png';
  const productTarget = script?.dataset.productTarget === '_blank' ? '_blank' : '_self';
  const panelId = 'lp-agent-panel';
  const language = document.documentElement.lang?.toLowerCase().startsWith('ru') ? 'ru' : 'uk';
  const analytics = createWidgetAnalyticsAdapter({
    configUrl: analyticsConfigEndpoint,
    eventUrl: analyticsEventEndpoint,
    locale: language,
    pageType: classifyPageType(),
    trafficType: script?.dataset.analyticsTraffic === 'synthetic' ? 'synthetic' : 'real',
  });
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
    orderStatus: 'Статус заказа',
    orderPrompt: 'Введите номер заказа. Информация откроется только после проверки телефона в Telegram.',
    orderPlaceholder: 'Номер заказа',
    orderButton: 'Проверить в Telegram',
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
    orderStatus: 'Статус замовлення',
    orderPrompt: 'Введіть номер замовлення. Інформація відкриється лише після перевірки телефону в Telegram.',
    orderPlaceholder: 'Номер замовлення',
    orderButton: 'Перевірити в Telegram',
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
  const markShown = () => {
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(root) : null;
    if (
      root.isConnected
      && !openButton.disabled
      && style?.display !== 'none'
      && style?.visibility !== 'hidden'
      && style?.opacity !== '0'
    ) analytics.trackWidgetShown();
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(markShown);
  else setTimeout(markShown, 0);

  addMessage('assistant', copy.greeting);
  addSuggestions();

  openButton.addEventListener('click', (event) => setOpen(
    root.dataset.open !== 'true',
    { openSource: event.detail === 0 ? 'keyboard' : 'launcher' },
  ));
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
    const wasOpen = root.dataset.open === 'true';
    if (open) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetGuide();
    }
    root.dataset.open = String(open);
    openButton.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-modal', 'false');
    if (open) {
      input.focus();
      if (!wasOpen) analytics.trackWidgetOpened(options.openSource || 'launcher');
    } else if (options.restoreFocus !== false) {
      restoreFocus();
    }
  }

  async function requestAnswer(text, { wasRetried = false } = {}) {
    if (busy) return;
    setBusy(true);
    const pending = addMessage('assistant', copy.thinking, { status: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    const attempt = analytics.createInteraction({
      questionLength: text.length,
      hasProductContext: classifyPageType() === 'product',
      wasRetried,
    });
    try {
      const request = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation.slice(-8), page: collectPageContext() }),
        signal: controller.signal,
      });
      analytics.trackQuestionSubmitted(attempt);
      const response = await request;
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
      const recommendationCount = addProductCards(payload.catalog, pending, attempt);
      analytics.trackAnswerCompleted(attempt, recommendationCount);
    } catch (error) {
      const kind = errorKind(error);
      pending.textContent = copy[kind];
      pending.dataset.state = 'error';
      analytics.trackAnswerFailed(attempt, analyticsFailure(error));
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
      await requestAnswer(text, { wasRetried: true });
    }, { once: true });
    afterElement.after(button);
  }

  function addProductCards(rawCatalog, afterElement, attempt) {
    const products = selectProducts(rawCatalog);
    if (products.length === 0) return 0;

    const section = document.createElement('section');
    section.className = 'lp-agent-products';
    section.setAttribute('aria-label', copy.products);
    const heading = document.createElement('h3');
    heading.className = 'lp-agent-products-title';
    heading.textContent = copy.products;
    const list = document.createElement('div');
    list.className = 'lp-agent-product-list';
    list.setAttribute('role', 'list');

    for (const [index, product] of products.entries()) {
      const position = index + 1;
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
      titleLink.addEventListener('click', () => {
        analytics.trackProductOpened(attempt, product, position, productTarget === '_blank' ? 'new_tab' : 'same_tab');
        trackProductEvent('PRODUCT_CARD_OPENED', product);
      });
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
        if (!target) {
          analytics.trackProductOpened(attempt, product, position, productTarget === '_blank' ? 'new_tab' : 'same_tab');
          trackProductEvent('PRODUCT_CARD_OPENED', product);
          return;
        }
        event.preventDefault();
        analytics.trackProductOpened(attempt, product, position, 'in_page');
        trackProductEvent('PRODUCT_GUIDE_USED', product);
        showProduct(target);
      });
      body.append(action);
      card.append(body);
      list.append(card);
      trackProductEvent('PRODUCT_CARD_SHOWN', product);
    }

    section.append(heading, list);
    afterElement.after(section);
    return products.length;
  }

  function trackProductEvent(eventType, product) {
    if (!productAnalyticsEnabled) return;
    let rawKey = product?.id || product?.sku || '';
    if (!rawKey) {
      try { rawKey = new URL(product?.url || '').pathname; } catch { rawKey = ''; }
    }
    const productKey = String(rawKey).replace(/[^A-Za-z0-9:_./-]+/g, '_').slice(0, 160);
    if (!productKey) return;
    void fetch(productAnalyticsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, productKey }),
      keepalive: true,
    }).catch(() => {});
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
    const orderButton = document.createElement('button');
    orderButton.type = 'button';
    orderButton.className = 'lp-agent-suggestion';
    orderButton.textContent = copy.orderStatus;
    orderButton.addEventListener('click', () => {
      if (!busy) addOrderLinkForm();
    });
    suggestionButtons.push(orderButton);
    group.append(orderButton);
    messagesElement.append(group);
  }

  function addOrderLinkForm() {
    if (messagesElement.querySelector('.lp-agent-order-form')) return;
    addMessage('assistant', copy.orderPrompt);
    const form = document.createElement('form');
    form.className = 'lp-agent-order-form';
    const field = document.createElement('input');
    field.className = 'lp-agent-order-input';
    field.maxLength = 64;
    field.required = true;
    field.autocomplete = 'off';
    field.placeholder = copy.orderPlaceholder;
    field.setAttribute('aria-label', copy.orderPlaceholder);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'lp-agent-order-submit';
    submit.textContent = copy.orderButton;
    form.append(field, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const orderReference = field.value.trim();
      if (!orderReference || busy) return;
      setBusy(true);
      submit.disabled = true;
      try {
        const response = await fetch(orderLinkEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderReference }),
        });
        const payload = await response.json();
        if (!response.ok || !safeTelegramLink(payload?.button?.url)) throw userInterfaceError('UNAVAILABLE');
        const link = document.createElement('a');
        link.className = 'lp-agent-order-link';
        link.href = payload.button.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = copy.orderButton;
        form.replaceWith(link);
      } catch {
        submit.disabled = false;
        addMessage('assistant', copy.unavailable);
      } finally {
        setBusy(false);
      }
    });
    messagesElement.append(form);
    field.focus();
  }

  function safeTelegramLink(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 't.me' && /^\/[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(url.pathname)
        ? url.toString()
        : '';
    } catch {
      return '';
    }
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
