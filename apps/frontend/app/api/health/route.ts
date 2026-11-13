import { apiHealth } from '@ch-alpineroute/backend/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const body = await apiHealth();
  // «degraded» bleibt 200 (die App läuft), «down» ist 503 – so lassen sich Uptime-Checks direkt anhängen.
  return NextResponse.json(body, { status: body.status === 'down' ? 503 : 200, headers: { 'cache-control': 'no-store' } });
}
