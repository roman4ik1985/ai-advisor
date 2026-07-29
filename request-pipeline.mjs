import { buildFreshnessEvidence, buildRouteDecision, getRoutePolicy, routeInstruction } from './intent-router.mjs';
import { resolveLiveEvidence } from './live-resolvers.mjs';
import { validateAssistantAnswer } from './response-validator.mjs';

export async function executeRequestPipeline({
  question,
  messages,
  page,
  queryCatalog,
  queryKnowledge,
  buildPrompt,
  askSupport,
  askVerifier,
  now = () => new Date(),
}) {
  const route = buildRouteDecision({ question, messages });
  const live = await resolveLiveEvidence({ route, queryCatalog, now });
  const knowledge = getRoutePolicy(route.intent).knowledge ? await queryKnowledge() : [];
  const freshness = buildFreshnessEvidence({
    intent: route.intent,
    catalogDiagnostics: live.catalogDiagnostics,
    knowledge,
    liveEvidence: live.evidence,
    now,
  });

  if (route.route === 'ESCALATE') {
    return {
      answer: managerFallback(question),
      catalog: live.catalog,
      catalogDiagnostics: live.catalogDiagnostics,
      knowledge,
      route,
      freshness,
      validation: { accepted: false, action: 'ESCALATE', answer: managerFallback(question), reasons: ['ROUTE_ESCALATION'] },
      verification: { status: 'SKIPPED', reason: 'ROUTE_ESCALATION' },
    };
  }

  const answer = await askSupport({
    prompt: `${buildPrompt({ messages, page, catalog: live.catalog, knowledge })}\n${routeInstruction(route.intent)}`,
    messages,
    page,
    catalog: live.catalog,
    knowledge,
  });
  const validation = validateAssistantAnswer({
    answer,
    catalog: live.catalog,
    knowledge,
    question,
    freshness,
    route,
  });
  const verification = await verifyWhenRequired({
    route,
    question,
    answer: validation.answer,
    validation,
    freshness,
    catalog: live.catalog,
    knowledge,
    askVerifier,
  });

  if (verification.status === 'REJECTED') {
    return {
      answer: managerFallback(question),
      catalog: live.catalog,
      catalogDiagnostics: live.catalogDiagnostics,
      knowledge,
      route,
      freshness,
      validation: { accepted: false, action: 'ESCALATE', answer: managerFallback(question), reasons: [...validation.reasons, 'VERIFICATION_REJECTED'] },
      verification,
    };
  }

  return {
    answer: validation.answer,
    catalog: live.catalog,
    catalogDiagnostics: live.catalogDiagnostics,
    knowledge,
    route,
    freshness,
    validation,
    verification,
  };
}

async function verifyWhenRequired({ route, question, answer, validation, freshness, catalog, knowledge, askVerifier }) {
  if (!validation.accepted) return { status: 'SKIPPED', reason: 'VALIDATION_REJECTED' };
  if (!route.requiresVerification) return { status: 'SKIPPED', reason: 'LOWER_RISK_ROUTE' };

  const verdict = await askVerifier({
    question,
    draft: answer,
    route,
    resolverResults: freshness.live,
    facts: {
      catalog: (Array.isArray(catalog) ? catalog : []).map((product) => ({
        name: product?.name,
        url: product?.url,
        prices: product?.prices,
      })),
      knowledge: (Array.isArray(knowledge) ? knowledge : []).map((entry) => ({
        title: entry?.title,
        text: entry?.text,
        sourceUrl: entry?.sourceUrl,
        reviewedAt: entry?.reviewedAt,
      })),
    },
    validation,
  });
  return verdict?.approved
    ? { status: 'APPROVED', reason: null }
    : { status: 'REJECTED', reason: String(verdict?.reason || 'VERIFIER_REJECTED') };
}

function managerFallback(question) {
  return /[іїєґ]/iu.test(String(question || '')) || !/[а-яё]/iu.test(String(question || ''))
    ? 'Щоб надати точну відповідь, передамо це питання менеджеру магазину.'
    : 'Чтобы дать точный ответ, передадим этот вопрос менеджеру магазина.';
}
