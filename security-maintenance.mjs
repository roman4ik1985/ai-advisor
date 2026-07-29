export function assessSecurityMaintenance({
  audit = {},
  secretFiles = [],
  securityHeaders = [],
} = {}) {
  const vulnerabilities = audit?.metadata?.vulnerabilities || {};
  const findings = [];
  for (const severity of ['critical', 'high', 'moderate', 'low']) {
    const count = Number(vulnerabilities[severity] || 0);
    if (count > 0) findings.push(Object.freeze({
      severity: severity.toUpperCase(),
      code: 'DEPENDENCY_VULNERABILITY',
      count,
    }));
  }
  if (secretFiles.length) findings.push(Object.freeze({
    severity: 'CRITICAL',
    code: 'TRACKED_SECRET_MARKER',
    files: Object.freeze([...new Set(secretFiles.map(String))].sort()),
  }));
  const requiredHeaders = ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy'];
  const missingHeaders = requiredHeaders.filter((header) => !securityHeaders.includes(header));
  if (missingHeaders.length) findings.push(Object.freeze({
    severity: 'HIGH',
    code: 'MISSING_SECURITY_HEADER',
    headers: Object.freeze(missingHeaders),
  }));
  const blocking = findings.filter((item) => ['CRITICAL', 'HIGH'].includes(item.severity));
  return Object.freeze({
    status: blocking.length ? 'BLOCKED' : 'PASS',
    findings: Object.freeze(findings),
    blockingCount: blocking.length,
    nextReviewDays: blocking.length ? 0 : 30,
  });
}
