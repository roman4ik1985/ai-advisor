const SUPPORTED_EVENTS = new Set([
  'widget_shown',
  'widget_opened',
  'question_submitted',
  'answer_completed',
  'answer_failed',
  'product_opened',
  'order_handoff_started',
  'answer_feedback_submitted',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,119}$/u;
const PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]{12,}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const COMMON_SCHEMA = Object.freeze({
  schema_version: { type: 'safeVersion', required: true },
  environment: { type: 'enum', values: ['production', 'staging'], required: true },
  widget_version: { type: 'safeVersion', required: true },
  locale: { type: 'enum', values: ['uk', 'ru'], required: true },
  page_type: { type: 'enum', values: ['home', 'category', 'product', 'search', 'cart', 'checkout', 'other'], required: true },
  traffic_type: { type: 'enum', values: ['real', 'synthetic'], required: true },
});

const EVENT_SCHEMAS = Object.freeze({
  widget_shown: schema({
    render_location: { type: 'enum', values: ['storefront_overlay', 'inline'], required: true },
  }),
  widget_opened: schema({
    open_source: { type: 'enum', values: ['launcher', 'inline_button', 'keyboard', 'automatic', 'other'], required: true },
    is_first_open_in_session: { type: 'boolean', required: true },
  }),
  question_submitted: schema({
    interaction_id: { type: 'uuid', required: true },
    question_length_bucket: { type: 'enum', values: ['1_40', '41_120', '121_300', '301_plus'], required: true },
    input_mode: { type: 'enum', values: ['text'], required: true },
    has_product_context: { type: 'boolean', required: true },
  }),
  answer_completed: schema({
    interaction_id: { type: 'uuid', required: true },
    response_time_ms: { type: 'integer', min: 0, max: 300_000, required: true },
    response_time_bucket: { type: 'enum', values: ['under_1s', '1_3s', '3_10s', '10_30s', '30_60s', '60s_plus'] },
    delivery_mode: { type: 'enum', values: ['full', 'stream'], required: true },
    was_retried: { type: 'boolean', required: true },
    recommendation_count_bucket: { type: 'enum', values: ['0', '1', '2', '3_plus'], required: true },
  }),
  answer_failed: schema({
    interaction_id: { type: 'uuid', required: true },
    response_time_ms: { type: 'integer', min: 0, max: 300_000, required: true },
    error_type: { type: 'enum', values: ['timeout', 'network', 'rate_limited', 'validation', 'upstream', 'cancelled', 'invalid_response', 'unknown'], required: true },
    error_stage: { type: 'enum', values: ['client', 'request', 'stream', 'finalization', 'render', 'handoff', 'unknown'], required: true },
    retryable: { type: 'boolean', required: true },
    was_retried: { type: 'boolean', required: true },
    timeout_threshold_ms: { type: 'integer', min: 1, max: 300_000, required: true },
  }),
  product_opened: schema({
    interaction_id: { type: 'uuid', required: true },
    product_id: { type: 'identifier', required: true },
    product_category: { type: 'slug' },
    recommendation_position_bucket: { type: 'enum', values: ['1', '2', '3_plus'], required: true },
    open_target: { type: 'enum', values: ['same_tab', 'new_tab', 'in_page'], required: true },
  }),
  order_handoff_started: schema({
    interaction_id: { type: 'uuid', required: true },
    handoff_type: { type: 'enum', values: ['cart', 'checkout', 'salesdrive', 'callback_form', 'messenger', 'other'], required: true },
    product_count_bucket: { type: 'enum', values: ['0', '1', '2', '3_plus'], required: true },
  }),
  answer_feedback_submitted: schema({
    interaction_id: { type: 'uuid', required: true },
    helpful: { type: 'boolean', required: true },
  }),
});

function schema(specific) {
  return Object.freeze({ ...COMMON_SCHEMA, ...specific });
}

function isTruthyCi(value) {
  if (value === undefined || value === null || value === '') return false;
  return !/^(?:0|false|no|off)$/iu.test(String(value).trim());
}

function parseDateOnly(value) {
  if (!ISO_DATE_PATTERN.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function readConfiguration(env, now) {
  const environment = String(env.AI_ADVISOR_ANALYTICS_ENVIRONMENT || env.NODE_ENV || '').trim().toLowerCase();
  const schemaVersion = String(env.AI_ADVISOR_ANALYTICS_SCHEMA_VERSION || '').trim();
  const widgetVersion = String(
    env.AI_ADVISOR_ANALYTICS_WIDGET_VERSION
      || env.AI_ADVISOR_WIDGET_VERSION
      || env.npm_package_version
      || '',
  ).trim();
  const provider = String(env.AI_ADVISOR_ANALYTICS_PROVIDER || '').trim().toLowerCase();
  const host = String(env.POSTHOG_API_HOST || '').trim().replace(/\/+$/u, '');
  const token = String(env.POSTHOG_PROJECT_TOKEN || '').trim();
  const startValue = String(env.AI_ADVISOR_ANALYTICS_PILOT_START || '').trim();
  const endValue = String(env.AI_ADVISOR_ANALYTICS_PILOT_END || '').trim();
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);
  const exactThirtyDays = Boolean(start && end && (end.getTime() - start.getTime()) / 86_400_000 === 30);
  const configured = (
    String(env.AI_ADVISOR_ANALYTICS_ENABLED || '').trim().toLowerCase() === 'true'
    && provider === 'posthog'
    && ['production', 'staging'].includes(environment)
    && !['test', 'development'].includes(String(env.NODE_ENV || '').trim().toLowerCase())
    && !isTruthyCi(env.CI)
    && PROJECT_TOKEN_PATTERN.test(token)
    && ['https://eu.i.posthog.com', 'https://us.i.posthog.com'].includes(host)
    && SAFE_VERSION_PATTERN.test(schemaVersion)
    && SAFE_VERSION_PATTERN.test(widgetVersion)
    && exactThirtyDays
  );

  return Object.freeze({
    configured,
    environment,
    schemaVersion,
    widgetVersion,
    host,
    token,
    startMs: start?.getTime() ?? Number.NaN,
    endMs: end?.getTime() ?? Number.NaN,
  });
}

function isPilotActive(configuration, current) {
  const timestamp = current instanceof Date ? current.getTime() : new Date(current).getTime();
  return (
    configuration.configured
    && Number.isFinite(timestamp)
    && timestamp >= configuration.startMs
    && timestamp < configuration.endMs
  );
}

function containsSensitiveValue(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 120) return true;
  return (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value)
    || /(?:\+?\d[\s().-]*){10,}/u.test(value)
    || /https?:\/\/\S*[?#]\S*/iu.test(value)
    || /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/u.test(value)
    || /\bBearer\s+\S+/iu.test(value)
    || /\b(?:api[_-]?key|authorization|cookie|secret|token)\s*[:=]\s*\S+/iu.test(value)
    || /\b(?:phc|phx|phs|sk)[_-][A-Za-z0-9_-]{12,}\b/u.test(value)
    || /\bSalesDrive\b/iu.test(value)
    || /\b(?:order|замовлен|заказ)[ _-]?(?:id|number|номер|№)?\s*[:#=№-]?\s*[A-Za-z0-9-]{3,}\b/iu.test(value)
    || /\b(?:Error|Exception):\s/u.test(value)
    || /\bat\s+\S+\s+\([^)\r\n]+:\d+:\d+\)/u.test(value)
  );
}

function validateValue(value, rule) {
  if (containsSensitiveValue(value)) return false;
  if (rule.type === 'boolean') return typeof value === 'boolean';
  if (rule.type === 'integer') {
    return Number.isInteger(value) && value >= rule.min && value <= rule.max;
  }
  if (typeof value !== 'string') return false;
  if (rule.type === 'uuid') return UUID_PATTERN.test(value);
  if (rule.type === 'enum') return rule.values.includes(value);
  if (rule.type === 'safeVersion') return SAFE_VERSION_PATTERN.test(value);
  if (rule.type === 'identifier') return SAFE_IDENTIFIER_PATTERN.test(value);
  if (rule.type === 'slug') return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value);
  return false;
}

export function sanitizeAnalyticsEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  if (Object.keys(envelope).some((key) => !['event', 'analyticsSessionId', 'properties'].includes(key))) return null;
  const { event, analyticsSessionId, properties } = envelope;
  if (!SUPPORTED_EVENTS.has(event) || !UUID_PATTERN.test(String(analyticsSessionId || ''))) return null;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;

  const eventSchema = EVENT_SCHEMAS[event];
  const keys = Object.keys(properties);
  if (keys.some((key) => !Object.hasOwn(eventSchema, key))) return null;
  for (const [key, rule] of Object.entries(eventSchema)) {
    if (rule.required && !Object.hasOwn(properties, key)) return null;
    if (Object.hasOwn(properties, key) && !validateValue(properties[key], rule)) return null;
  }

  return Object.freeze({
    event,
    analyticsSessionId,
    properties: Object.freeze({ ...properties }),
  });
}

function finalBeforeSend(candidate, configuration) {
  if (!candidate || typeof candidate !== 'object') return null;
  const properties = candidate.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
  if (properties.$process_person_profile !== false || properties.$geoip_disable !== true) return null;
  const analyticsSessionId = String(properties.analytics_session_id || '');
  if (!UUID_PATTERN.test(analyticsSessionId)) return null;

  const publicProperties = Object.fromEntries(
    Object.entries(properties).filter(([key]) => ![
      'analytics_session_id',
      '$process_person_profile',
      '$geoip_disable',
      '$lib',
      '$lib_version',
      '$is_server',
    ].includes(key)),
  );
  const safe = sanitizeAnalyticsEnvelope({
    event: candidate.event,
    analyticsSessionId,
    properties: publicProperties,
  });
  if (!safe) return null;
  if (
    safe.properties.environment !== configuration.environment
    || safe.properties.schema_version !== configuration.schemaVersion
    || safe.properties.widget_version !== configuration.widgetVersion
  ) return null;

  return {
    ...candidate,
    event: safe.event,
    properties: {
      ...safe.properties,
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };
}

export function createAnalyticsPilot({
  env = process.env,
  now = () => new Date(),
  loadSdk = () => import('posthog-node'),
} = {}) {
  let configuration;
  try {
    configuration = readConfiguration(env, now());
  } catch {
    configuration = readConfiguration({}, new Date(Number.NaN));
  }

  const publicConfig = Object.freeze({
    get enabled() {
      return isPilotActive(configuration, now());
    },
    schemaVersion: configuration.schemaVersion,
    environment: configuration.environment,
    widgetVersion: configuration.widgetVersion,
  });

  let clientPromise;
  async function getClient() {
    if (!isPilotActive(configuration, now())) return null;
    if (!clientPromise) {
      clientPromise = Promise.resolve()
        .then(loadSdk)
        .then((sdk) => {
          const PostHog = sdk?.PostHog;
          if (typeof PostHog !== 'function') return null;
          return new PostHog(configuration.token, {
            host: configuration.host,
            disableGeoip: true,
            privacyMode: true,
            enableExceptionAutocapture: false,
            before_send: (event) => finalBeforeSend(event, configuration),
          });
        })
        .catch(() => null);
    }
    return clientPromise;
  }

  async function capture(envelope) {
    if (!isPilotActive(configuration, now())) return false;
    const safe = sanitizeAnalyticsEnvelope(envelope);
    if (!safe) return false;
    if (
      safe.properties.environment !== configuration.environment
      || safe.properties.schema_version !== configuration.schemaVersion
      || safe.properties.widget_version !== configuration.widgetVersion
    ) return false;
    const client = await getClient();
    if (!client || typeof client.capture !== 'function') return false;
    try {
      const result = client.capture({
        distinctId: safe.analyticsSessionId,
        event: safe.event,
        properties: {
          ...safe.properties,
          analytics_session_id: safe.analyticsSessionId,
          $process_person_profile: false,
          $geoip_disable: true,
        },
        disableGeoip: true,
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({ publicConfig, capture });
}
