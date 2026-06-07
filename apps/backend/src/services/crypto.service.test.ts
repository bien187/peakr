import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.service';

describe('crypto.service (AES-256-GCM)', () => {
  it('verschlüsselt und entschlüsselt verlustfrei (Round-Trip)', () => {
    const secret = 'sk-test-1234567890-geheimer-openai-key';
    const { ciphertext, iv } = encryptSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(decryptSecret(ciphertext, iv)).toBe(secret);
  });

  it('erzeugt pro Aufruf einen anderen IV/Ciphertext', () => {
    const a = encryptSecret('gleicher-input');
    const b = encryptSecret('gleicher-input');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('erkennt Manipulation am Ciphertext (Auth-Tag)', () => {
    const { ciphertext, iv } = encryptSecret('integritaet');
    ciphertext[0] ^= 0xff; // ein Bit kippen
    expect(() => decryptSecret(ciphertext, iv)).toThrow();
  });
});
