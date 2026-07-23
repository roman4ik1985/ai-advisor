(() => {
  if (window.__ledProjectorAgentLoaded) return;
  window.__ledProjectorAgentLoaded = true;

  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint || 'https://ai.ledprojector.com.ua/api/chat';
  const mascotUrl = script?.dataset.mascot || 'https://ai.ledprojector.com.ua/assets/mascot.png';
  const panelId = 'lp-agent-panel';
  const language = document.documentElement.lang?.toLowerCase().startsWith('ru') ? 'ru' : 'uk';
  const copy = language === 'ru' ? {
    title: 'Помощник LedProjector', status: 'Подберу проектор под ваши задачи',
    bubble: 'Помочь выбрать проектор?', greeting: 'Здравствуйте! Расскажите, где и как планируете использовать проектор — помогу сузить выбор.',
    placeholder: 'Напишите ваш вопрос…', send: 'Отправить', close: 'Закрыть консультанта', open: 'Открыть AI-консультанта',
    suggestions: ['Подберите проектор', 'Сравнить модели', 'Доставка и оплата'], thinking: 'Думаю…', error: 'Не удалось получить ответ. Попробуйте ещё раз.', timeout: 'Ответ занимает слишком долго. Попробуйте ещё раз.',
  } : {
    title: 'Помічник LedProjector', status: 'Підберу проєктор під ваші задачі',
    bubble: 'Допомогти обрати проєктор?', greeting: 'Вітаю! Розкажіть, де і як плануєте використовувати проєктор — допоможу звузити вибір.',
    placeholder: 'Напишіть ваше питання…', send: 'Надіслати', close: 'Закрити консультанта', open: 'Відкрити AI-консультанта',
    suggestions: ['Підібрати проєктор', 'Порівняти моделі', 'Доставка й оплата'], thinking: 'Думаю…', error: 'Не вдалося отримати відповідь. Спробуйте ще раз.', timeout: 'Відповідь надходить надто довго. Спробуйте ще раз.',
  };

  const root = document.createElement('aside');
  root.className = 'lp-agent-root';
  root.dataset.open = 'false';
  root.dataset.position = 'right';
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
    <button class="lp-agent-mascot-button" type="button" data-action="open" aria-label="${escapeAttribute(copy.open)}" aria-controls="${panelId}" aria-expanded="false">
      <img class="lp-agent-mascot" src="${escapeAttribute(mascotUrl)}" alt="" />
    </button>`;

  document.body.append(root);
  const panel = root.querySelector('.lp-agent-panel');
  const messagesElement = root.querySelector('.lp-agent-messages');
  const input = root.querySelector('.lp-agent-input');
  const sendButton = root.querySelector('.lp-agent-send');
  const openButton = root.querySelector('[data-action="open"]');
  const conversation = [];
  const suggestionButtons = [];
  let busy = false;
  let walkTimer;
  let lastFocusedElement = null;

  addMessage('assistant', copy.greeting);
  addSuggestions();
  scheduleWalk();

  openButton.addEventListener('click', () => setOpen(root.dataset.open !== 'true'));
  root.querySelector('[data-action="close"]').addEventListener('click', () => setOpen(false));
  root.querySelector('.lp-agent-composer').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    await ask(text);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.dataset.open === 'true') setOpen(false);
  });

  function setOpen(open) {
    if (open) lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.dataset.open = String(open);
    openButton.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-modal', 'false');
    if (open) {
      clearTimeout(walkTimer);
      input.focus();
    } else {
      scheduleWalk();
      restoreFocus();
    }
  }

  async function ask(text) {
    if (busy) return;
    setBusy(true);
    addMessage('user', text);
    conversation.push({ role: 'user', content: text });
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
      const payload = await response.json();
      if (!response.ok || !payload.answer) throw new Error(payload.error || 'Request failed');
      pending.textContent = payload.answer;
      conversation.push({ role: 'assistant', content: payload.answer });
    } catch (error) {
      pending.textContent = error.name === 'AbortError' ? copy.timeout : (error.message || copy.error);
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
      button.addEventListener('click', () => ask(suggestion));
      suggestionButtons.push(button);
      group.append(button);
    }
    messagesElement.append(group);
  }

  function collectPageContext() {
    const selectors = ['h1', '.product-model', '.price', '.product-price', '.description', '#tab-description'];
    const visibleText = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)].slice(0, 3))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 4000);
    return { title: document.title, url: location.href, language, visibleText };
  }

  function scheduleWalk() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || innerWidth < 700) return;
    clearTimeout(walkTimer);
    walkTimer = setTimeout(() => {
      const positions = ['right', 'center', 'left'];
      const current = positions.indexOf(root.dataset.position);
      root.dataset.position = positions[(current + 1) % positions.length];
      scheduleWalk();
    }, 9000 + Math.random() * 6000);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function escapeAttribute(value) { return escapeHtml(value); }
})();
