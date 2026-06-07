import { loginInputSchema, registerInputSchema } from '@ch-alpineroute/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, isUniqueViolation, validate } from '../lib/errors';
import { signToken } from '../lib/jwt';
import { setAuthCookie } from '../plugins/auth';
import { createUser, findAuthByEmail, getPublicUser } from '../repositories/user.repo';
import { hashPassword, verifyPassword } from '../services/auth.service';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const input = validate(registerInputSchema, request.body);
    const passwordHash = await hashPassword(input.password);

    let id: string;
    try {
      id = await createUser({
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Diese E-Mail ist bereits registriert.');
      }
      throw err;
    }

    const user = await getPublicUser(id);
    const token = await signToken({ sub: id, role: 'user' });
    setAuthCookie(reply, token);
    return reply.code(201).send({ token, user });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = validate(loginInputSchema, request.body);
    const auth = await findAuthByEmail(input.email);
    const ok = auth ? await verifyPassword(auth.passwordHash, input.password) : false;
    if (!auth || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-Mail oder Passwort ist falsch.');
    }
    const token = await signToken({ sub: auth.id, role: auth.role });
    const user = await getPublicUser(auth.id);
    setAuthCookie(reply, token);
    return reply.send({ token, user });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ message: 'Erfolgreich abgemeldet.' });
  });
}
