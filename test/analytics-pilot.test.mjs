import assert from 'node:assert/strict';
import test from 'node:test';
import { PostHog as RealPostHog } from 'posthog-node';
import { createAnalyticsPilot } from '../analytics-pilot.mjs';

const SESSION_ID = '018f1d5e-7b2c-4a9d-8f31-0c8ac6b8d001';
const INTERACTION_ID = '018f1d5e-7b2c-4a9d-8f31-0c8ac6b8d002';

function enabledEnv(overrides = {}) {
  return {
    AI_ADVISOR_ANALYTICS_ENABLED: 'true',
    AI_ADVISOR_ANALYTICS_PROVIDER: 'posthog',
    AI_ADVISOR_ANALYTICS_ENVIRONMENT: 'staging',
    AI_ADVISOR_ANALYTICS_PILOT_START: '2026-08-01',
    AI_ADVISOR_ANALYTICS_PILOT_END: '2026-08-31',
    AI_ADVISOR_ANALYTICS_SCHEMA_VERSION: '1.0',
    AI_ADVISOR_ANALYTICS_WIDGET_VERSION: '0.1.0',
    POSTHOG_PROJECT_TOKEN: 'phc_test_token_not_real',
    POSTHOG_API_HOST: 'https://eu.i.posthog.com',
    NODE_ENV: 'staging',
    ...overrides,
  };
}

function widgetShown(properties = {}) {
  return {
    event: 'widget_shown',
    analyticsSessionId: SESSION_ID,
    properties: {
      schema_version: '1.0',
      environment: 'staging',
      widget_version: '0.1.0',
      locale: 'uk',
      page_type: 'product',
      traffic_type: 'synthetic',
      render_location: 'storefront_overlay',
      ...properties,
    },
  };
}

function questionSubmitted(properties = {}) {
  return {
    event: 'question_submitted',
    analyticsSessionId: SESSION_ID,
    properties: {
      schema_version: '1.0',
      environment: 'staging',
      widget_version: '0.1.0',
      locale: 'uk',
      page_type: 'product',
      traffic_type: 'synthetic',
      interaction_id: INTERACTION_ID,
      question_length_bucket: '41_120',
      input_mode: 'text',
      has_product_context: true,
      ...properties,
    },
  };
}

function productOpened(productId) {
  return {
    event: 'product_opened',
    analyticsSessionId: SESSION_ID,
    properties: {
      schema_version: '1.0',
      environment: 'staging',
      widget_version: '0.1.0',
      locale: 'uk',
      page_type: 'product',
      traffic_type: 'synthetic',
      interaction_id: INTERACTION_ID,
      product_id: productId,
      recommendation_position_bucket: '1',
      open_target: 'same_tab',
    },
  };
}

function harness({ env = enabledEnv(), captureImpl } = {}) {
  const calls = [];
  let options;
  class PostHog {
    constructor(token, receivedOptions) {
      assert.equal(token, 'phc_test_token_not_real');
      options = receivedOptions;
    }

    capture(payload) {
      const gated = options.before_send({
        event: payload.event,
        properties: {
          ...payload.properties,
          $lib: 'posthog-node',
          $lib_version: '5.48.0',
          $is_server: true,
          $geoip_disable: true,
        },
      });
      assert.ok(gated);
      calls.push({
        ...gated,
        distinctId: payload.distinctId,
        disableGeoip: payload.disableGeoip,
      });
      return captureImpl?.(gated);
    }
  }
  const pilot = createAnalyticsPilot({
    env,
    now: () => new Date('2026-08-05T23:59:59.999Z'),
    loadSdk: async () => ({ PostHog }),
  });
  return { pilot, calls, getOptions: () => options };
}

test('accepts an allow-listed event and sends only privacy-safe PostHog properties', async () => {
  const { pilot, calls, getOptions } = harness();
  assert.deepEqual(pilot.publicConfig, {
    enabled: true,
    schemaVersion: '1.0',
    environment: 'staging',
    widgetVersion: '0.1.0',
  });
  assert.equal(await pilot.capture(widgetShown()), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].distinctId, SESSION_ID);
  assert.equal(calls[0].disableGeoip, true);
  assert.equal('analytics_session_id' in calls[0].properties, false);
  assert.equal(calls[0].properties.$process_person_profile, false);
  assert.equal(calls[0].properties.$geoip_disable, true);
  assert.equal('$lib' in calls[0].properties, false);
  assert.equal('$lib_version' in calls[0].properties, false);
  assert.equal('$is_server' in calls[0].properties, false);
  assert.equal(getOptions().disableGeoip, true);
  assert.equal(getOptions().privacyMode, true);
  assert.equal(getOptions().enableExceptionAutocapture, false);
  assert.equal('token' in pilot.publicConfig, false);
  assert.equal(JSON.stringify(pilot.publicConfig).includes('phc_test_token_not_real'), false);
});

test('the installed PostHog SDK accepts the final allow-listed event shape', async () => {
  const queued = [];
  class InspectablePostHog extends RealPostHog {
    processBeforeEnqueue(message) {
      const gated = super.processBeforeEnqueue(message);
      queued.push(gated);
      return null;
    }
  }
  const pilot = createAnalyticsPilot({
    env: enabledEnv(),
    now: () => new Date('2026-08-05T12:00:00Z'),
    loadSdk: async () => ({ PostHog: InspectablePostHog }),
  });

  assert.equal(await pilot.capture(widgetShown()), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].distinct_id, SESSION_ID);
  assert.equal(queued[0].event, 'widget_shown');
  assert.equal(queued[0].properties.$process_person_profile, false);
  assert.equal(queued[0].properties.$geoip_disable, true);
  assert.equal(queued[0].properties.$lib, 'posthog-node');
  assert.equal(queued[0].properties.$lib_version, '5.48.0');
  assert.equal(queued[0].properties.$is_server, true);
  assert.equal('analytics_session_id' in queued[0].properties, false);
});

test('rejects unknown events, unknown properties, and invalid enums', async () => {
  const { pilot, calls } = harness();
  assert.equal(await pilot.capture({ ...widgetShown(), event: 'pageview' }), false);
  assert.equal(await pilot.capture(widgetShown({ arbitrary: 'value' })), false);
  assert.equal(await pilot.capture(widgetShown({ page_type: 'account' })), false);
  assert.equal(await pilot.capture(widgetShown({ environment: 'production' })), false);
  assert.equal(await pilot.capture(widgetShown({ schema_version: '2.0' })), false);
  assert.equal(await pilot.capture(widgetShown({ widget_version: '9.9.9' })), false);
  assert.equal(calls.length, 0);
});

test('rejects question and answer text plus PII and credential-shaped values', async () => {
  const { pilot, calls } = harness();
  const rejected = [
    questionSubmitted({ question: 'Який проектор мені купити?' }),
    questionSubmitted({ answer: 'Ось рекомендована відповідь' }),
    productOpened('buyer@example.com'),
    productOpened('+380-67-123-45-67'),
    productOpened('https://example.test/item?email=a'),
    productOpened('https://example.test/item#private'),
    productOpened('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123'),
    productOpened('Bearer secret-value'),
    productOpened('api_key=very-secret-value'),
    productOpened('SalesDrive'),
    productOpened('order-ID-1234'),
  ];
  for (const envelope of rejected) assert.equal(await pilot.capture(envelope), false);
  assert.equal(calls.length, 0);
});

test('rejects nested SalesDrive/order/error data, stack traces, and long free text', async () => {
  const { pilot, calls } = harness();
  const rejected = [
    questionSubmitted({ salesdrive: { phone: '+380671234567' } }),
    questionSubmitted({ order_id: 'SD-1234' }),
    questionSubmitted({ raw_error: new Error('private') }),
    questionSubmitted({ stack: 'Error: private\n at handler (server.mjs:10:2)' }),
    questionSubmitted({ product_category: 'x'.repeat(121) }),
    { ...questionSubmitted(), properties: { ...questionSubmitted().properties, interaction_id: { nested: true } } },
  ];
  for (const envelope of rejected) assert.equal(await pilot.capture(envelope), false);
  assert.equal(calls.length, 0);
});

test('is disabled by default and for expired, invalid-length, or missing pilot configuration', async () => {
  for (const env of [
    {},
    enabledEnv({ AI_ADVISOR_ANALYTICS_ENABLED: 'false' }),
    enabledEnv({ AI_ADVISOR_ANALYTICS_PILOT_START: '2026-07-01', AI_ADVISOR_ANALYTICS_PILOT_END: '2026-07-31' }),
    enabledEnv({ AI_ADVISOR_ANALYTICS_PILOT_END: '2026-08-30' }),
    enabledEnv({ POSTHOG_PROJECT_TOKEN: '' }),
    enabledEnv({ POSTHOG_PROJECT_TOKEN: 'phx_personal_key_not_allowed' }),
    enabledEnv({ POSTHOG_API_HOST: 'https://example.test' }),
  ]) {
    const pilot = createAnalyticsPilot({ env, now: () => new Date('2026-08-05T12:00:00Z') });
    assert.equal(pilot.publicConfig.enabled, false);
    assert.equal(await pilot.capture(widgetShown()), false);
  }
});

test('uses a server-authoritative UTC window with an exclusive end boundary', async () => {
  for (const now of ['2026-08-01T00:00:00.000Z', '2026-08-30T23:59:59.999Z']) {
    const { pilot } = harness();
    const boundaryPilot = createAnalyticsPilot({
      env: enabledEnv(),
      now: () => new Date(now),
      loadSdk: async () => class {},
    });
    assert.equal(boundaryPilot.publicConfig.enabled, true);
    assert.equal(pilot.publicConfig.enabled, true);
  }
  const expired = createAnalyticsPilot({
    env: enabledEnv(),
    now: () => new Date('2026-08-31T00:00:00.000Z'),
  });
  assert.equal(expired.publicConfig.enabled, false);
  assert.equal(await expired.capture(widgetShown()), false);
});

test('a long-running process automatically stops capturing at PILOT_END', async () => {
  let current = new Date('2026-08-30T23:59:59.999Z');
  const { pilot, calls } = harness();
  const dynamic = createAnalyticsPilot({
    env: enabledEnv(),
    now: () => current,
    loadSdk: async () => ({
      PostHog: class {
        constructor(_token, options) {
          this.options = options;
        }

        capture(payload) {
          const gated = this.options.before_send(payload);
          if (gated) calls.push(gated);
        }
      },
    }),
  });

  assert.equal(await dynamic.capture(widgetShown()), true);
  current = new Date('2026-08-31T00:00:00.000Z');
  assert.equal(dynamic.publicConfig.enabled, false);
  assert.equal(await dynamic.capture(widgetShown()), false);
  assert.equal(calls.length, 1);
  assert.equal(pilot.publicConfig.enabled, true);
});

test('missing SDK and synchronous or asynchronous SDK failures remain contained', async () => {
  const missing = createAnalyticsPilot({
    env: enabledEnv(),
    now: () => new Date('2026-08-05T12:00:00Z'),
    loadSdk: async () => {
      throw new Error('blocked by ad blocker');
    },
  });
  assert.equal(await missing.capture(widgetShown()), false);

  const throwing = harness({ captureImpl: () => { throw new Error('network unavailable'); } });
  assert.equal(await throwing.pilot.capture(widgetShown()), false);

  const rejecting = harness({ captureImpl: () => Promise.reject(new Error('network unavailable')) });
  assert.equal(await rejecting.pilot.capture(widgetShown()), true);
  await new Promise((resolve) => setImmediate(resolve));
});

test('CI, test, and development are always no-op and never load the SDK', async () => {
  for (const env of [
    enabledEnv({ CI: 'true' }),
    enabledEnv({ NODE_ENV: 'test', AI_ADVISOR_ANALYTICS_ENVIRONMENT: 'production' }),
    enabledEnv({ NODE_ENV: 'development', AI_ADVISOR_ANALYTICS_ENVIRONMENT: 'staging' }),
    enabledEnv({ AI_ADVISOR_ANALYTICS_ENVIRONMENT: 'development', NODE_ENV: 'production' }),
  ]) {
    let loaded = false;
    const pilot = createAnalyticsPilot({
      env,
      now: () => new Date('2026-08-05T12:00:00Z'),
      loadSdk: async () => {
        loaded = true;
        return {};
      },
    });
    assert.equal(pilot.publicConfig.enabled, false);
    assert.equal(await pilot.capture(widgetShown()), false);
    assert.equal(loaded, false);
  }
});
