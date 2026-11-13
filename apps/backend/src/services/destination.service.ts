import type { DestinationDetail, DriveInfo, LatLng, TourPlan } from '@ch-alpineroute/shared';
import { evaluateHikeRoute, evaluateSkiResort } from '../availability/engine';
import { resolvePlan } from '../availability/time';
import { logger } from '../lib/logger';
import { getConditions } from '../repositories/conditions.repo';
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
export async function destinationDetail(id: string, origin?: LatLng, wantedPlan?: TourPlan): Promise<DestinationDetail | null> {
  const found = await getDestinationDetail(id);
  if (!found) return null;
  const { drivePoints } = found;
  const detail = await withAvailability(found.detail, found.weatherCell, wantedPlan);
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

/**
 * Verfügbarkeit je Routenvariante (Wandern) bzw. für das Gebiet (Ski) zur
 * geplanten Zeit. Fällt die Prüfung aus, fehlt sie – die Detailseite bleibt nutzbar.
 */
async function withAvailability(detail: DestinationDetail, weatherCell: string | null, wanted?: TourPlan): Promise<DestinationDetail> {
  try {
    const now = new Date();
    const plan = resolvePlan(wanted, now);
    const { conditions } = await getConditions();
    if (detail.type === 'ski_resort') {
      const live = detail.live;
      const availability = evaluateSkiResort(
        {
          lat: detail.location.lat, lng: detail.location.lng, topElevM: detail.elevationTopM, baseElevM: detail.elevationBaseM,
          slfRegionId: detail.slfRegionId,
          lifts: { liftsOpen: live?.liftsOpen ?? null, liftsTotal: live?.liftsTotal ?? null, source: live?.liftSource ?? null, capturedAt: live?.capturedAt ?? null },
          snowTopCm: live?.snowDepthTopCm ?? null, snowValleyCm: live?.snowDepthValleyCm ?? null, snowAt: live?.capturedAt ?? null,
          forecast: weatherCell ? conditions.forecasts.get(weatherCell) : undefined,
        },
        conditions, plan, now,
      );
      return { ...detail, availability };
    }
    return {
      ...detail,
      routes: detail.routes.map((r) => ({
        ...r,
        availability: evaluateHikeRoute(
          {
            destinationId: detail.id, rank: r.rank, lat: detail.location.lat, lng: detail.location.lng,
            minElevM: r.minElevM, maxElevM: r.maxElevM ?? detail.elevationTopM, durationUpMin: r.durationUpMin,
            durationDownMin: r.durationDownMin, officialShare: r.officialShare, weatherCell, slfRegionId: detail.slfRegionId,
          },
          conditions, plan, now,
        ),
      })),
    };
  } catch (err) {
    logger.warn({ id: detail.id, error: err instanceof Error ? err.message : String(err) }, 'Verfügbarkeit nicht berechenbar');
    return detail;
  }
}
