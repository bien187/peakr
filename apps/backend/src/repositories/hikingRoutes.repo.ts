// hiking_routes table removed (no PostGIS) — all functions are stubs

export async function insertHikingRoute(): Promise<void> { /* no-op */ }

export async function countHikingRoutes(): Promise<number> { return 0; }

export async function nearestHikingRouteM(): Promise<number | null> { return null; }

export async function updateNearestRouteDistances(): Promise<number> { return 0; }

export async function clearHikingRoutes(): Promise<void> { /* no-op */ }
