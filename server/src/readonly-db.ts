import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

let readonlyPrisma: PrismaClient | null = null;

function client() {
  if (!env.DATABASE_READONLY_URL) return null;
  return (readonlyPrisma ??= new PrismaClient({ datasourceUrl: env.DATABASE_READONLY_URL }));
}

/** Comprueba la conexión opcional de lectura sin ejecutar mutaciones. */
export async function readonlyHealth() {
  const db = client();
  if (!db) return { configured: false, ok: false, read_only: null };

  try {
    const rows = await db.$queryRaw<Array<{
      current_user: string;
      current_database: string;
      transaction_read_only: string;
    }>>`SELECT current_user, current_database(), current_setting('transaction_read_only') AS transaction_read_only`;
    const row = rows[0];
    return {
      configured: true,
      ok: Boolean(row),
      read_only: row?.transaction_read_only === 'on',
      user: row?.current_user ?? null,
      database: row?.current_database ?? null,
    };
  } catch {
    return { configured: true, ok: false, read_only: null };
  }
}
