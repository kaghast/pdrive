import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const getSqlConnectionConfig = () => ({
  host: process.env.SQL_HOST || process.env.POSTGRES_HOST,
  port: process.env.SQL_PORT
    ? Number(process.env.SQL_PORT)
    : process.env.POSTGRES_PORT
      ? Number(process.env.POSTGRES_PORT)
      : 5432,
  user: process.env.SQL_USER || process.env.POSTGRES_USER,
  password: process.env.SQL_PASSWORD || process.env.POSTGRES_PASSWORD,
  database: process.env.SQL_DB_NAME || process.env.POSTGRES_DB,
  ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

export const createPool = () => {
  if (!global._postgresPool) {
    const cfg = getSqlConnectionConfig();
    global._postgresPool = new Pool({
      ...cfg,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();

export const db = drizzle(pool, { schema });
