import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  // Auf Vercel (Serverless) + Supabase Transaction-Pooler sind keine Prepared
  // Statements erlaubt — sonst "prepared statement does not exist"-Fehler.
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export default sql;
