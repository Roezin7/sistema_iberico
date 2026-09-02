import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';

// La app se importa sin arrancar el listener normal; cada prueba usa un puerto
// efímero y sólo valida el contrato HTTP, sin autenticarse ni tocar la DB.
process.env.IBERICO_NO_LISTEN = '1';
const { app } = await import('./index.js');

let servidor: ReturnType<typeof app.listen>;
let base = '';

beforeAll(async () => {
  servidor = app.listen(0);
  await new Promise<void>((resolve) => servidor.once('listening', resolve));
  const direccion = servidor.address() as AddressInfo;
  base = `http://127.0.0.1:${direccion.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
});

describe('contrato HTTP de seguridad', () => {
  it('protege el mando de decisiones para usuarios autenticados', async () => {
    const res = await fetch(`${base}/api/finanzas/tablero-decisiones?semanas=8`);
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/autentic|sesión/i);
  });

  it('protege el inventario y devuelve JSON de error', async () => {
    const res = await fetch(`${base}/api/inventario/snapshots`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });
});
