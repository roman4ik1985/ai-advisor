import { buildRouteDecision } from './intent-router.mjs';

export function runQualityBenchmark(scenarios) {
  const results = (Array.isArray(scenarios) ? scenarios : []).map((scenario) => {
    const decision = buildRouteDecision({ question: scenario.question });
    const actual = {
      intent: decision.intent,
      route: decision.route,
      resolvers: decision.requiredResolvers,
    };
    const passed = actual.intent === scenario.expected.intent
      && actual.route === scenario.expected.route
      && JSON.stringify(actual.resolvers) === JSON.stringify(scenario.expected.resolvers);
    return Object.freeze({
      id: String(scenario.id || ''),
      passed,
      actual: Object.freeze(actual),
      expected: Object.freeze(scenario.expected),
      modelCallBudget: ['COMPLEX'].includes(decision.route) ? 2 : decision.route === 'ESCALATE' ? 0 : 1,
    });
  });
  const passed = results.filter((item) => item.passed).length;
  const totalModelCallBudget = results.reduce((sum, item) => sum + item.modelCallBudget, 0);
  return Object.freeze({
    status: results.length > 0 && passed === results.length ? 'PASS' : 'FAIL',
    scenarioCount: results.length,
    passed,
    failed: results.length - passed,
    totalModelCallBudget,
    averageModelCallBudget: results.length ? Number((totalModelCallBudget / results.length).toFixed(2)) : 0,
    results: Object.freeze(results),
  });
}
