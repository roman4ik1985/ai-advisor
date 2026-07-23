import { isIP } from 'node:net';

export function getRateLimitClientId(request) {
  const remoteAddress = request.socket?.remoteAddress || 'unknown';
  if (!isLoopbackAddress(remoteAddress)) return remoteAddress;

  const forwarded = firstHeaderValue(request.headers?.['cf-connecting-ip']);
  return isIP(forwarded) ? `cf:${forwarded}` : remoteAddress;
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}
