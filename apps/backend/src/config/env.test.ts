import { describe, expect, it } from 'vitest';
import { jwtSecretProblem } from './env';

describe('JWT-Geheimnis', () => {
  it('ist ausserhalb der Produktion nie ein Hindernis', () => {
    expect(jwtSecretProblem('development', 'kurz')).toBeNull();
    expect(jwtSecretProblem('test', '')).toBeNull();
  });

  it('meldet in Produktion fehlende, Standard- und zu kurze Werte – ohne den Wert zu nennen', () => {
    expect(jwtSecretProblem('production', 'dev-only-insecure-secret-change-me-please')).toMatch(/nicht gesetzt/);
    expect(jwtSecretProblem('production', '   ')).toMatch(/nicht gesetzt/);
    const short = 'x'.repeat(31);
    const problem = jwtSecretProblem('production', short);
    expect(problem).toMatch(/32 Zeichen/);
    expect(problem).not.toContain(short);
  });

  it('akzeptiert ein ausreichend langes Geheimnis', () => {
    expect(jwtSecretProblem('production', 'y'.repeat(64))).toBeNull();
  });
});
