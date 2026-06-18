import { describe, it, expect } from 'vitest';
import {
  totalBaseProducto,
  faltanteCompra,
  valorProducto,
  armarListaCompras,
  type ProductoFaltante,
} from './logic.js';

describe('totalBaseProducto', () => {
  it('cerveza por unidad en ambas zonas (factor 1): 30 en Local + 48 en Bodega = 78', () => {
    expect(
      totalBaseProducto([
        { qty_captura: 30, factor: 1 },
        { qty_captura: 48, factor: 1 },
      ]),
    ).toBe(78);
  });

  it('producto con factor de empaque (caja x24): 2 cajas = 48', () => {
    expect(totalBaseProducto([{ qty_captura: 2, factor: 24 }])).toBe(48);
  });

  it('botella abierta medida por nivel (factor 1) admite fracciones', () => {
    expect(totalBaseProducto([{ qty_captura: 0.25, factor: 1 }])).toBe(0.25);
  });

  it('histórico ya en unidad base (factor 1) no se infla', () => {
    expect(totalBaseProducto([{ qty_captura: 67.2, factor: 1 }])).toBe(67.2);
  });

  it('booleano: 1 (sí) con factor 1 = 1', () => {
    expect(totalBaseProducto([{ qty_captura: 1, factor: 1 }])).toBe(1);
  });

  it('sin líneas = 0', () => {
    expect(totalBaseProducto([])).toBe(0);
  });
});

describe('faltanteCompra', () => {
  it('faltante normal: base 48, hay 30 => 18', () => {
    expect(faltanteCompra(48, 30)).toBe(18);
  });
  it('sobra stock => 0 (nunca negativo)', () => {
    expect(faltanteCompra(48, 60)).toBe(0);
  });
  it('exacto => 0', () => {
    expect(faltanteCompra(48, 48)).toBe(0);
  });
});

describe('valorProducto', () => {
  it('total 72 * costo 18 = 1296', () => {
    expect(valorProducto(72, 18)).toBe(1296);
  });
  it('sin costo => 0', () => {
    expect(valorProducto(72, null)).toBe(0);
  });
});

describe('armarListaCompras', () => {
  const base: ProductoFaltante[] = [
    { product_id: 35, nombre: 'Corona', store_id: 3, store: 'Modelo', base_qty: 48, total_base: 30, faltante: 18, unit_cost: 18, valor_faltante: 324 },
    { product_id: 36, nombre: 'Victoria', store_id: 3, store: 'Modelo', base_qty: 48, total_base: 48, faltante: 0, unit_cost: 18, valor_faltante: 0 },
    { product_id: 61, nombre: 'Nieve', store_id: 4, store: 'Costco', base_qty: 5, total_base: 2, faltante: 3, unit_cost: 150, valor_faltante: 450 },
  ];

  it('omite productos sin faltante', () => {
    const lista = armarListaCompras(base);
    const modelo = lista.grupos.find((g) => g.store === 'Modelo')!;
    expect(modelo.items.map((i) => i.nombre)).toEqual(['Corona']); // Victoria fuera
  });

  it('agrupa por tienda con subtotal y total correctos', () => {
    const lista = armarListaCompras(base);
    expect(lista.grupos).toHaveLength(2);
    expect(lista.grupos.find((g) => g.store === 'Costco')!.subtotal).toBe(450);
    expect(lista.grupos.find((g) => g.store === 'Modelo')!.subtotal).toBe(324);
    expect(lista.total).toBe(774);
  });

  it('lista vacía si nada falta', () => {
    const lista = armarListaCompras([base[1]!]); // solo Victoria (faltante 0)
    expect(lista.grupos).toHaveLength(0);
    expect(lista.total).toBe(0);
  });
});
