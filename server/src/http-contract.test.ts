import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from './db.js';
import { firmarToken } from './auth/jwt.js';
import type { AddressInfo } from 'node:net';

// La app se importa sin arrancar el listener normal; cada prueba usa un puerto
// efímero y sólo valida el contrato HTTP, sin autenticarse ni tocar la DB.
process.env.IBERICO_NO_LISTEN = '1';
const { app } = await import('./index.js');

let servidor: ReturnType<typeof app.listen>;
let base = '';

beforeEach(() => {
  vi.spyOn(prisma.usuarios, 'findUnique').mockImplementation((args) => Promise.resolve({
    id: args.where.id, negocio_id: args.where.id === 2n ? 2n : 1n, activo: true, rol: 'admin',
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

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
  it('limita colecciones antes de la validación de los campos', async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sobrante: Array(1001).fill(null) }) });
    expect(r.status).toBe(413);
    expect(await r.json()).toHaveProperty('error');
  });
  it('un PUT parcial no convierte ventas omitidas en cero', async () => {
    const token = firmarToken({ sub:'1',negocio_id:'1',rol:'admin',nombre:'QA' });
    const r = await fetch(`${base}/api/finanzas/semanas/75/dias`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({fecha:'2026-11-06',sueldos:520})});
    expect(r.status).toBe(400);
  });
  it('un saldo real null no se convierte en arqueo cero', async () => {
    const token = firmarToken({ sub:'1',negocio_id:'1',rol:'admin',nombre:'QA' });
    const r = await fetch(`${base}/api/finanzas/arqueos`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({semana_id:75,ubicacion_id:1,monto_real:null})});
    expect(r.status).toBe(400);
  });
  it('rechaza de inmediato un token de usuario desactivado', async () => {
    vi.mocked(prisma.usuarios.findUnique).mockResolvedValue({ id: 1n, negocio_id: 1n, activo: false, rol: 'admin' } as never);
    const token = firmarToken({ sub: '1', negocio_id: '1', rol: 'admin', nombre: 'QA' });
    const r = await fetch(`${base}/api/inventario/snapshots`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(401);
  });
  it('no conserva permisos admin cuando el rol cambió', async () => {
    vi.mocked(prisma.usuarios.findUnique).mockResolvedValue({ id: 1n, negocio_id: 1n, activo: true, rol: 'empleado' } as never);
    const token = firmarToken({ sub: '1', negocio_id: '1', rol: 'admin', nombre: 'QA' });
    const r = await fetch(`${base}/api/finanzas/semanas`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(401);
  });
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
