/**
 * Actualiza los precios de venta del catálogo local a partir de la carta
 * IBÉRICO MENU 2026 y genera una lectura de costo por FIFO.
 *
 * Por seguridad el script sólo cambia precio_venta en productos_menu. Los
 * costos históricos de products.unit_cost no se sobreescriben: son la base de
 * compras y el costo vigente de la carta se calcula desde los lotes FIFO
 * abiertos (con último consumo FIFO como respaldo).
 *
 * Uso:
 *   tsx scripts/actualizar-menu-2026.ts          # vista previa
 *   tsx scripts/actualizar-menu-2026.ts --apply  # actualiza precios locales
 */
import { prisma } from '../src/db.js';
import { convertirCantidad, costoLinea } from '../src/recetas/costeo.js';
import { consumirFIFO } from '../src/inventario/fifo.js';
import { filtroConsumoFifoActivo } from '../src/inventario/fuentes.js';

const NEGOCIO_ID = 1n;
const APPLY = process.argv.includes('--apply');
const normalizar = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Precios de la carta: producto local (o alias) -> precio MXN.
const MENU: Record<string, number> = {
  'Montado Ibérico': 55, 'Montado Sevillano (Quesos y Serrano)': 55,
  'Montado Castellano': 45, 'Montado Mediterráneo': 45,
  'Tabla de Quesos y Embutidos': 195, 'Tabla de Tapas Mixtas': 185,
  'Papas Ibéricas': 95, 'Papas a la francesa': 55,
  'Pizza Catalana': 135, 'Pizza Gallega': 135, 'Pizza Ibérica': 125,
  'Pizza Madrileña (4 quesos)': 125, 'Pizza Castellana': 115,
  'Pizza Canaria': 115, 'Pizza Margarita': 105,
  'Affogato': 55, 'Affogato Ibérico': 55,
  'Negroni Ibérico': 95, 'Gin Tonic Rojo': 85, 'Gin Tonic Verde': 85, 'Gin Tonic Rosa': 85,
  'Aperol Spritz': 120, 'Raspberry Spritz': 120, 'Coco Spritz': 120,
  'Mezcalita Piña': 120, 'Mezcalita Mango': 120,
  'Mezca-tonic': 105, 'Mezcal Mule': 105,
  'Mimosa Ibérica': 85, 'Mimosa Clásica': 80,
  'Tinto de Verano': 75, 'Sangría Española': 75,
  'Carajillo': 105, 'Baileys': 115, 'Oro Blanco': 115, 'Ronchata': 95,
  'Piñada': 55, 'Piña Colada': 100,
  'Mojito Tinto': 95, 'Mojito Clásico': 85,
  'Margarita': 85, 'Margarita de Fresa': 95,
  'Vampiro Chico': 70, 'Vampiro Grande': 120,
  'Paloma Chica': 60, 'Paloma Grande': 110,
  'Cubanito Chico': 60, 'Cubanito Grande': 100,
  'Azulito Chico': 60, 'Azulito Grande': 100,
  'Michelada Chica': 55, 'Michelada Grande': 95, 'Chabela Vargas (Zanahoria)': 50,
  'Limonada Ibérica': 65, 'Limonada': 55, 'Naranjada': 55, 'Refresco': 25,
  // La carta dice “Agua”; el catálogo histórico la conserva como Agua mineral.
  'Agua mineral': 20,
  'Corona': 40, 'Victoria': 40, 'Pacífico': 40, 'Stella Artois': 45, 'Michelob Ultra': 45, 'Modelo': 45,
  'Cuba de tequila 8': 140, 'Cuba de 1800': 140,
  'Cuba de Dobel Diamante': 110, 'Cuba de Hacienda de Tepa': 70,
  'Tequila 8 Botella': 1750, '1800 Cristalino Botella': 1950,
  'Dobel Diamante Botella': 1750, 'Hacienda de Tepa Botella': 900,
};

const MENU_NORMALIZADO = new Map(Object.entries(MENU).map(([nombre, precio]) => [normalizar(nombre), { nombre, precio }]));

function costoFifoPorProducto(lotes: any[], consumos: any[]) {
  const costoPorProducto = new Map<string, { costo: number; fecha: string }>();
  for (const lote of lotes) {
    const key = lote.product_id.toString();
    const cantidad = Number(lote.cantidad_restante);
    if (cantidad > 0 && !costoPorProducto.has(key)) {
      costoPorProducto.set(key, { costo: Number(lote.costo_unitario), fecha: lote.recibido_at.toISOString().slice(0, 10) });
    }
  }
  for (const consumo of consumos) {
    const key = consumo.product_id.toString();
    if (!costoPorProducto.has(key)) costoPorProducto.set(key, { costo: Number(consumo.costo_unitario), fecha: consumo.fecha.toISOString().slice(0, 10) });
  }
  return costoPorProducto;
}

async function main() {
  const menus = await prisma.productos_menu.findMany({
    where: { negocio_id: NEGOCIO_ID },
    orderBy: { nombre: 'asc' },
    include: {
      recetas: {
        where: { estado: 'validada' }, orderBy: { version: 'desc' }, take: 1,
        include: { lineas: { include: { products: { select: { id: true, name: true, unit_cost: true, unidad_base: true, contenido_compra: true, rendimiento_util: true } } } } },
      },
    },
  });

  const plans = menus.flatMap((menu) => {
    const match = MENU_NORMALIZADO.get(normalizar(menu.nombre));
    if (!match || Number(menu.precio_venta ?? -1) === match.precio) return [];
    return [{ id: Number(menu.id), nombre: menu.nombre, antes: menu.precio_venta == null ? null : Number(menu.precio_venta), despues: match.precio }];
  });
  const matched = new Set(menus.map((m) => normalizar(m.nombre)).filter((name) => MENU_NORMALIZADO.has(name)));
  const noMapeados = [...MENU_NORMALIZADO.entries()].filter(([name]) => !matched.has(name)).map(([, value]) => value);

  if (APPLY && plans.length) {
    await prisma.$transaction(plans.map((plan) => prisma.productos_menu.update({ where: { id: BigInt(plan.id) }, data: { precio_venta: plan.despues } })));
  }

  const productIds = [...new Set(menus.flatMap((m) => m.recetas[0]?.lineas.map((l) => l.product_id) ?? []))];
  const [lotes, consumos] = productIds.length ? await Promise.all([
    prisma.inventory_lots.findMany({ where: { negocio_id: NEGOCIO_ID, product_id: { in: productIds }, estado: 'abierto', cantidad_restante: { gt: 0 } }, orderBy: [{ recibido_at: 'asc' }, { id: 'asc' }], select: { id: true, product_id: true, recibido_at: true, cantidad_restante: true, costo_unitario: true } }),
    prisma.inventory_consumptions.findMany({ where: { negocio_id: NEGOCIO_ID, product_id: { in: productIds }, ...filtroConsumoFifoActivo() }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], select: { product_id: true, fecha: true, costo_unitario: true } }),
  ]) : [[], []];
  const fifo = costoFifoPorProducto(lotes, consumos);
  const lotesPorProducto = new Map<string, any[]>();
  for (const lote of lotes) {
    const key = lote.product_id.toString();
    const rows = lotesPorProducto.get(key) ?? [];
    rows.push({ id: Number(lote.id ?? 0), recibidoAt: lote.recibido_at.toISOString().slice(0, 10), cantidadRestante: Number(lote.cantidad_restante), costoUnitario: Number(lote.costo_unitario) });
    lotesPorProducto.set(key, rows);
  }
  const costos = menus.filter((m) => m.recetas[0]).map((menu) => {
    const receta = menu.recetas[0];
    let total = 0; let completo = true; let fuenteMasReciente: string | null = null; let modoCosto: 'fifo' | 'ultimo_consumo' | 'receta' = 'fifo';
    for (const linea of receta.lineas) {
      const base = fifo.get(linea.product_id.toString());
      const cantidad = Number(linea.cantidad);
      const cantidadBase = linea.products.unidad_base ? convertirCantidad(cantidad, linea.unidad, linea.products.unidad_base) : null;
      const lotesProducto = lotesPorProducto.get(linea.product_id.toString()) ?? [];
      const toma = cantidadBase == null ? null : consumirFIFO(lotesProducto, cantidadBase);
      if (toma && toma.faltante <= 0.0001) {
        total += toma.costoTotal;
        if (toma.consumos.length) fuenteMasReciente = toma.consumos.map((c) => c.recibidoAt).sort().at(-1) ?? fuenteMasReciente;
      } else if (cantidadBase != null && base) {
        // Igual que la pantalla de costos: cuando no queda lote suficiente,
        // conserva el último costo FIFO aplicado como referencia operativa.
        total += cantidadBase * base.costo;
        modoCosto = 'ultimo_consumo';
        fuenteMasReciente = base.fecha;
      } else {
        const recetaCoste = costoLinea(cantidad, linea.unidad, { unitCost: linea.products.unit_cost == null ? null : Number(linea.products.unit_cost), unidadBase: linea.products.unidad_base, contenidoCompra: linea.products.contenido_compra == null ? null : Number(linea.products.contenido_compra), rendimientoUtil: linea.products.rendimiento_util == null ? 1 : Number(linea.products.rendimiento_util) });
        if (recetaCoste.costoEstimado == null) completo = false;
        else { total += recetaCoste.costoEstimado; modoCosto = 'receta'; }
      }
      if (base?.fecha && (!fuenteMasReciente || base.fecha > fuenteMasReciente)) fuenteMasReciente = base.fecha;
    }
    return { id: Number(menu.id), nombre: menu.nombre, precio_venta: menu.precio_venta == null ? null : Number(menu.precio_venta), costo_fifo: completo ? Number(total.toFixed(2)) : null, costo_fifo_desde: fuenteMasReciente, fuente_costo: completo ? modoCosto : null };
  });

  console.log(JSON.stringify({ modo: APPLY ? 'apply' : 'dry-run', precios_actualizados: plans, productos_menu_sin_mapeo: noMapeados, costos_fifo: costos }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
