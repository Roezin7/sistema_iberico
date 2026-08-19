import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  DATABASE_READONLY_URL: z.string().url().or(z.string().startsWith('postgres')).optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  EPOS_API_BASE_URL: z.string().url().optional().default('https://api.eposnowhq.com/api'),
  EPOS_API_KEY: z.string().optional().default(''),
  EPOS_API_SECRET: z.string().optional().default(''),
  EPOS_LOCATION_ID: z.coerce.number().int().positive().optional(),
  EPOS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  // Orígenes permitidos para CORS, separados por coma. Vacío = solo mismo origen
  // (lo normal en el despliegue de un solo servicio).
  ALLOWED_ORIGINS: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
