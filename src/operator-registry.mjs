const DEFAULT_OPERATOR_ID = 'lumi';

const OPERATOR_PROFILES = deepFreeze({
  lumi: {
    id: 'lumi',
    displayName: 'Люми',
    accentColor: '#2563eb',
    publicCopy: {
      ru: {
        description: 'Поможет подобрать проектор под вашу задачу',
        greeting: 'Здравствуйте! Расскажите, где и как планируете использовать проектор — помогу сузить выбор.',
        suggestions: ['Подберите проектор', 'Сравнить модели', 'Доставка и оплата'],
      },
      uk: {
        description: 'Допоможе підібрати проєктор під вашу задачу',
        greeting: 'Вітаю! Розкажіть, де і як плануєте використовувати проєктор — допоможу звузити вибір.',
        suggestions: ['Підібрати проєктор', 'Порівняти моделі', 'Доставка й оплата'],
      },
    },
    trustedInstructions: [
      'Your visible operator name is Lumi.',
      'Act as a friendly shopping guide who helps the visitor narrow the choice with simple practical explanations.',
    ],
  },
  spectrum: {
    id: 'spectrum',
    displayName: 'Спектр',
    accentColor: '#7c3aed',
    publicCopy: {
      ru: {
        description: 'Технический эксперт по характеристикам и сравнению',
        greeting: 'Здравствуйте! Я Спектр. Помогу сравнить модели и объясню технические различия без лишнего жаргона.',
        suggestions: ['Сравнить характеристики', 'Проектор для помещения', 'Объяснить технологию'],
      },
      uk: {
        description: 'Технічний експерт із характеристик і порівняння',
        greeting: 'Вітаю! Я Спектр. Допоможу порівняти моделі та поясню технічні відмінності без зайвого жаргону.',
        suggestions: ['Порівняти характеристики', 'Проєктор для приміщення', 'Пояснити технологію'],
      },
    },
    trustedInstructions: [
      'Your visible operator name is Spectrum.',
      'Act as a technical product specialist who compares specifications carefully and explains tradeoffs in plain language.',
      'Prefer structured comparisons, but keep the visitor-facing answer concise.',
    ],
  },
});

export function resolveOperator(operatorId) {
  const normalized = normalizeOperatorId(operatorId);
  return OPERATOR_PROFILES[normalized] || OPERATOR_PROFILES[DEFAULT_OPERATOR_ID];
}

export function getDefaultOperatorId() {
  return DEFAULT_OPERATOR_ID;
}

export function getPublicOperator(operatorOrId) {
  const operator = typeof operatorOrId === 'object' && operatorOrId
    ? resolveOperator(operatorOrId.id)
    : resolveOperator(operatorOrId);
  return {
    id: operator.id,
    displayName: operator.displayName,
    accentColor: operator.accentColor,
    copy: operator.publicCopy,
  };
}

export function getPublicOperatorCatalog() {
  return {
    version: 1,
    defaultOperatorId: DEFAULT_OPERATOR_ID,
    operators: Object.values(OPERATOR_PROFILES).map(getPublicOperator),
  };
}

export function buildOperatorInstructions(operatorId) {
  return [...resolveOperator(operatorId).trustedInstructions];
}

function normalizeOperatorId(value) {
  return String(value || '').trim().toLowerCase().slice(0, 40);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
