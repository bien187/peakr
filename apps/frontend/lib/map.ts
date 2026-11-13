import * as maplibregl from 'maplibre-gl';

/** Pfad des MapLibre-Workers (von scripts/copy-map-worker.mjs nach public/ kopiert). */
const WORKER_URL = '/maplibre-gl-worker.mjs';
let configured = false;

/** MapLibre einmalig konfigurieren, bevor die erste Karte entsteht. */
export function mapLib(): typeof maplibregl {
  if (!configured) {
    maplibregl.setWorkerUrl(new URL(WORKER_URL, window.location.origin).href);
    configured = true;
  }
  return maplibregl;
}
