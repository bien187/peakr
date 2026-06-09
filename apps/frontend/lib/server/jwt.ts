import { SignJWT, jwtVerify } from 'jose';

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-min-16chars');

export interface JwtPayload { sub: string; role: 'user' | 'admin' }

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret());
  return { sub: String(payload.sub), role: payload.role === 'admin' ? 'admin' : 'user' };
}

export async function getUserFromRequest(req: Request): Promise<JwtPayload | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return await verifyToken(token); } catch { return null; }
}
