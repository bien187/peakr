import { ok } from '@/lib/server/response';

export async function GET() {
  return ok({ status: 'ok', service: 'peakr-frontend-api', timestamp: new Date().toISOString() });
}
