import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

// AES-256-GCM für den optionalen OpenAI-Key. Der Master-Key kommt aus ENCRYPTION_KEY
// (64 Hex = 32 Byte). Niemals den Klartext loggen oder an den Browser senden.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // empfohlen für GCM
const AUTH_TAG_LENGTH = 16;

function masterKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY muss 32 Byte (64 Hex-Zeichen) sein.');
  }
  return key;
}

export interface EncryptedSecret {
  /** Ciphertext inkl. angehängtem Auth-Tag. */
  ciphertext: Buffer;
  iv: Buffer;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, authTag]), iv };
}

export function decryptSecret(ciphertext: Buffer, iv: Buffer): string {
  if (ciphertext.length <= AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext zu kurz.');
  }
  const data = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_LENGTH);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
