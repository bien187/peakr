import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isProd } from '../config/env';
import { AppError } from '../lib/errors';
import { verifyToken } from '../lib/jwt';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

/** Registriert den `authenticate`-PreHandler + `request.user`. */
export function installAuth(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.decorate(
    'authenticate',
    async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const header = request.headers.authorization;
      const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      const token = bearer ?? request.cookies?.token;
      if (!token) {
        reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Authentifizierung erforderlich.' } });
        return;
      }
      try {
        const payload = await verifyToken(token);
        request.user = { id: payload.sub, role: payload.role };
      } catch {
        reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Token ungültig oder abgelaufen.' } });
      }
    },
  );
}

/** Holt den authentifizierten User oder wirft 401 (für Handler nach `authenticate`). */
export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentifizierung erforderlich.');
  }
  return request.user;
}

export function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}
