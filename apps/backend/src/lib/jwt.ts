import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  const role = payload.role === 'admin' ? 'admin' : 'user';
  return { sub: String(payload.sub), role };
}
