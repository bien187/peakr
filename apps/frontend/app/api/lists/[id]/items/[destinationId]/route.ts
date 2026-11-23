import { apiRemoveListItem } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; destinationId: string }> }) {
  const { id, destinationId } = await params;
  return handle(() => apiRemoveListItem(req.headers.get('authorization'), id, destinationId));
}
