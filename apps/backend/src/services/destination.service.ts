import type { DestinationDetail, DriveInfo, LatLng } from '@ch-alpineroute/shared';
import { getDestinationDetail } from '../repositories/destination.repo';
import { computeDriveContext, driveTimeTo } from '../routing/driveTime';

/** Obergrenze für die Fahrzeit in der Detailansicht: deckt jede Strecke innerhalb der Schweiz ab. */
const DETAIL_MAX_MINUTES = 420;
/** Strasse endet weiter als so viele Meter vor der Talstation → Zufahrt nur teilweise mit dem Auto. */
const ROAD_GAP_PARTIAL_M = 600;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Detailansicht eines Ziels. Mit Startort wird für jeden Ausgangspunkt die
 * Autofahrzeit über das Strassennetz ergänzt – nie eine Schätzung: ohne
 * Strassenroute bleibt der Wert leer und der Status sagt, weshalb.
 */
export async function destinationDetail(id: string, origin?: LatLng): Promise<DestinationDetail | null> {
  const found = await getDestinationDetail(id);
  if (!found) return null;
  const { detail, drivePoints } = found;
  if (!origin) return detail;

  const drive = computeDriveContext(origin, DETAIL_MAX_MINUTES);
  const none = (status: DriveInfo['status']): DriveInfo => ({ minutes: null, distanceKm: null, status });
  const driveFor = (trailheadId: string, roadGapM: number | null): DriveInfo => {
    if (drive.status === 'unavailable') return none('unavailable');
    if (drive.status === 'origin_off_road') return none('no_route');
    const point = drivePoints.get(trailheadId);
    const time = point ? driveTimeTo(drive.ctx, point.lat, point.lng) : null;
    if (!time) return none('no_route');
    return {
      minutes: round1(time.minutes),
      distanceKm: round1(time.distanceKm),
      status: (roadGapM ?? 0) > ROAD_GAP_PARTIAL_M ? 'partial' : 'ok',
    };
  };

  return {
    ...detail,
    routes: detail.routes.map((r) => ({ ...r, drive: driveFor(r.trailhead.id, null) })),
    accessDrive: detail.access ? driveFor(detail.access.id, detail.access.roadGapM) : null,
  };
}
