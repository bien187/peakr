import { describe, expect, it } from 'vitest';
import { describeError } from './http';

describe('describeError', () => {
  it('nennt die Ursache hinter «fetch failed»', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), {
      code: 'ECONNREFUSED', syscall: 'connect', address: '1.2.3.4', port: 443,
    });
    const err = new TypeError('fetch failed', { cause });
    expect(describeError(err)).toBe('fetch failed (ECONNREFUSED connect 1.2.3.4:443)');
  });

  it('listet die Einzelfehler bei mehreren Verbindungsversuchen (IPv4/IPv6)', () => {
    const v6 = { code: 'ENETUNREACH', syscall: 'connect', address: '2a01::1', port: 443 };
    const v4 = { code: 'ETIMEDOUT', syscall: 'connect', address: '1.2.3.4', port: 443 };
    const err = new TypeError('fetch failed', { cause: Object.assign(new AggregateError([v6, v4]), { code: 'ETIMEDOUT' }) });
    expect(describeError(err)).toContain('ENETUNREACH connect 2a01::1:443; ETIMEDOUT connect 1.2.3.4:443');
  });

  it('lässt Fehler ohne Ursache unverändert', () => {
    expect(describeError(new Error('HTTP 500'))).toBe('HTTP 500');
    expect(describeError('kaputt')).toBe('kaputt');
  });
});
