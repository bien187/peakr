import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

/** Roher postgres.js-Client (auch für rohe ST_*-SQL-Queries nutzbar). */
export const queryClient = postgres(env.DATABASE_URL, { max: 10 });

/** Drizzle-Instanz mit vollem Schema. */
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
