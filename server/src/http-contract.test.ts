import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from './db.js';
import { firmarToken } from './auth/jwt.js';
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

  it('protege las cantidades originales de un conteo', async () => {
    const res = await fetch(`${base}/api/inventario/snapshots/115`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });

  it('recupera la cantidad base con el factor histórico, no el catálogo', async () => {
    const consulta = vi.spyOn(prisma.inventory_snapshot, 'findFirst').mockResolvedValue({
      id: 115n, tipo: 'apertura_conciliada', semana_id: 75n, created_at: new Date('2026-11-02T06:00:00Z'),
      inventory_lines: [{ product_id: 84n, zona_id: 1n, qty_captura: 440, factor: 1, contado_at: null }],
    } as never);
    try {
      const token = firmarToken({ sub: '1', negocio_id: '1', rol: 'admin', nombre: 'QA' });
      const res = await fetch(`${base}/api/inventario/snapshots/115`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      const body = await res.json() as { lineas: { cantidad_base: number; factor: number }[] };
      expect(body.lineas[0]).toMatchObject({ cantidad_base: 440, factor: 1 });
      expect(consulta).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 115n, negocio_id: 1n } }));
    } finally { consulta.mockRestore(); }
  });

  it('no entrega el conteo de otro negocio', async () => {
    const consulta = vi.spyOn(prisma.inventory_snapshot, 'findFirst').mockResolvedValue(null);
    try {
      const token = firmarToken({ sub: '2', negocio_id: '2', rol: 'admin', nombre: 'Otro negocio' });
      const res = await fetch(`${base}/api/inventario/snapshots/115`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(404);
      expect(consulta).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 115n, negocio_id: 2n } }));
    } finally { consulta.mockRestore(); }
  });

  it('protege el resumen agregado de operación', async () => {
    const res = await fetch(`${base}/api/operacion/resumen`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });
});
