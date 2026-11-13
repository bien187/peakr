/**
 * Kategorien der amtlichen Wanderwege (swissTLM3D). Eigenes Modul, damit der
 * Routengraph sie nutzen kann, ohne den GeoPackage-Leser (node:sqlite) zu laden.
 */
export const TRAIL_NONE = 0;
export const TRAIL_WANDERWEG = 1;
export const TRAIL_BERGWANDERWEG = 2;
export const TRAIL_ALPINWANDERWEG = 3;
