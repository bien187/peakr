import { customType } from 'drizzle-orm/pg-core';

/**
 * PostGIS-Spaltentypen als Drizzle-customType.
 *
 * Wichtig: Geometrien werden in Queries fast immer über rohe SQL-Ausdrücke
 * (ST_MakePoint, ST_AsGeoJSON, ST_DWithin …) gelesen/geschrieben — nicht über
 * Drizzles Serialisierung. Diese Typen dienen primär dazu, dass `drizzle-kit`
 * die korrekte DDL (`geography(...)`) erzeugt.
 */

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
});

export const geographyLineString = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(LineString,4326)';
  },
});

export const geographyMultiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(MultiPolygon,4326)';
  },
});

export const geographyGeometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Geometry,4326)';
  },
});
