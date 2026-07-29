const BOT_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,100}$/u;

export function createTelegramOrderSender({
  botToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
  maxAttempts = 3,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const token = String(botToken ?? '').trim();
  if (
    !BOT_TOKEN.test(token)
    || typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > 5
    || typeof delay !== 'function'
  ) {
    throw new TypeError('A valid Telegram bot token and fetch adapter are required.');
  }
  const baseUrl = `https://api.telegram.org/bot${token}`;

  async function dispatch(action) {
    if (action?.type === 'SEND_MESSAGE') {
      return request('sendMessage', {
        chat_id: action.chatId,
        text: action.text,
        ...(action.replyMarkup ? { reply_markup: normalizeReplyMarkup(action.replyMarkup) } : {}),
      });
    }
    if (action?.type === 'ANSWER_CALLBACK') {
      return request('answerCallbackQuery', { callback_query_id: action.callbackQueryId });
    }
    return false;
  }

  async function request(method, body) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/${method}`, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response?.ok && (await response.json())?.ok === true) return true;
      } catch {
        // Retry with the same idempotent transport command.
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxAttempts) await delay(attempt * 100);
    }
    return false;
  }

  return Object.freeze({ dispatch });
}

function normalizeReplyMarkup(markup) {
  if (Array.isArray(markup.inlineKeyboard)) {
    return {
      inline_keyboard: markup.inlineKeyboard.map((row) => row.map((button) => ({
        text: String(button.text),
        callback_data: String(button.callbackData),
      }))),
    };
  }
  if (Array.isArray(markup.keyboard)) {
    return {
      keyboard: markup.keyboard.map((row) => row.map((button) => ({
        text: String(button.text),
        ...(button.requestContact ? { request_contact: true } : {}),
      }))),
      resize_keyboard: markup.resizeKeyboard === true,
      one_time_keyboard: markup.oneTimeKeyboard === true,
    };
  }
  return {};
}
