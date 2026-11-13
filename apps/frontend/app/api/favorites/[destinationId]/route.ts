import { apiAddFavorite, apiRemoveFavorite } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ destinationId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { destinationId } = await params;
  return handle(() => apiAddFavorite(req.headers.get('authorization'), destinationId), { status: 201 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { destinationId } = await params;
  return handle(() => apiRemoveFavorite(req.headers.get('authorization'), destinationId));
}
