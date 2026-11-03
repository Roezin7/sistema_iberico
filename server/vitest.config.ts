import { defineConfig } from 'vitest/config';

// Las pruebas puras y de contrato no requieren una conexión real. Nunca
// heredan la URL de producción del shell ni necesitan secretos para arrancar.
export default defineConfig({ test: { env: {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/iberico_unit_test',
  JWT_SECRET: 'iberico-local-unit-tests-only',
  EPOS_API_KEY: '', EPOS_API_SECRET: '', ANTHROPIC_API_KEY: '',
} } });
