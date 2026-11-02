import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { costearVentasPendientesEnVivo } from '../src/inventario/consumo-epos.js';

const prisma = new PrismaClient();
const NEGOCIO = 1n;
const FECHA_APERTURA = new Date('2026-10-26T00:00:00.000Z');
const SHOT_EPOS = 4051841;
const SHOT_NOMBRE = 'Shot de 1800|Maestro dobel';
const MARCA = 'CORRECCION-EXCEPCIONES-ACTUALES-2026-11-01';

const serializar = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

async function main() {
  const resultado = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.inventory_snapshot.findFirst({
      where: { negocio_id: NEGOCIO },
      orderBy: { id: 'desc' },
      select: { id: true, semana_id: true, created_at: true },
    });
    if (!snapshot) throw new Error('No existe un inventario físico de cierre para cuadrar las aperturas');

    const productos = await tx.products.findMany({
      where: { negocio_id: NEGOCIO, name: { in: ['1800 Cristalino', 'Squirt', 'Perejil'] } },
      select: { id: true, name: true, unidad_base: true, contenido_compra: true, unit_cost: true },
    });
    const porNombre = new Map(productos.map((p) => [p.name, p]));
    const shotProduct = porNombre.get('1800 Cristalino');
    const squirt = porNombre.get('Squirt');
    const perejil = porNombre.get('Perejil');
    if (!shotProduct || !squirt || !perejil) throw new Error('Faltan productos base para resolver las excepciones');

    // Publica el producto Epos que está llegando sin mapeo. Se interpreta como
    // un shot de 1800 de 2 oz; el catálogo ya tiene Dobel como producto distinto.
    let menu = await tx.productos_menu.findFirst({ where: { negocio_id: NEGOCIO, epos_product_id: SHOT_EPOS } });
    if (!menu) {
      menu = await tx.productos_menu.create({
        data: {
          negocio_id: NEGOCIO,
          nombre: SHOT_NOMBRE,
          epos_product_id: SHOT_EPOS,
          precio_venta: 130,
          activo: true,
        },
      });
    } else if (menu.nombre !== SHOT_NOMBRE || !menu.activo) {
      menu = await tx.productos_menu.update({ where: { id: menu.id }, data: { nombre: SHOT_NOMBRE, activo: true } });
    }

    let receta = await tx.recetas.findFirst({
      where: { producto_menu_id: menu.id, estado: 'validada' },
      orderBy: { version: 'desc' },
      include: { lineas: true },
    });
    const recetaCorrecta = receta?.lineas.length === 1
      && receta.lineas[0]?.product_id === shotProduct.id
      && Number(receta.lineas[0]?.cantidad) === 59.15
      && receta.lineas[0]?.unidad === 'ml';
    if (!recetaCorrecta) {
      const ultima = await tx.recetas.findFirst({ where: { producto_menu_id: menu.id }, orderBy: { version: 'desc' }, select: { version: true } });
      receta = await tx.recetas.create({
        data: {
          producto_menu_id: menu.id,
          version: (ultima?.version ?? 0) + 1,
          estado: 'validada',
          fuente: 'Corrección de excepciones FIFO 2026-11-01',
          notas: `${MARCA}. Shot de 1800 interpretado como 2 oz (59.15 ml) de 1800 Cristalino. No se usa Tequila Dobel; tiene producto Epos y receta propia.`,
          vigente_desde: FECHA_APERTURA,
          lineas: { create: [{ product_id: shotProduct.id, cantidad: 59.15, unidad: 'ml', nota: '2 oz de 1800 Cristalino' }] },
        },
        include: { lineas: true },
      });
    }

    // El último cierre físico es la fuente de verdad. Calculamos la apertura
    // faltante para que, después de costear las ventas pendientes, el saldo FIFO
    // restante coincida con el conteo físico y no se genere stock fantasma.
    const lineasCierre = await tx.inventory_lines.findMany({
      where: { snapshot_id: snapshot.id, product_id: { in: [squirt.id, perejil.id] } },
      select: { product_id: true, qty_captura: true, factor: true },
    });
    const fisico = new Map();
    for (const linea of lineasCierre) {
      const key = linea.product_id.toString();
      fisico.set(key, (fisico.get(key) ?? 0) + Number(linea.qty_captura) * Number(linea.factor));
    }

    const ventasPendientes = await tx.epos_ventas.findMany({
      where: { negocio_id: NEGOCIO, costeo_estado: 'excepcion', producto_nombre: { in: ['Vampiro Grande', 'Paloma Grande', 'Cuba de Hacienda de Tepa', 'Tabla de Tapas Mixtas'] } },
      select: { producto_nombre: true },
    });
    const requerimiento = new Map([
      [squirt.id.toString(), ventasPendientes.filter((v) => ['Vampiro Grande', 'Paloma Grande'].includes(v.producto_nombre)).length * 200 + ventasPendientes.filter((v) => v.producto_nombre === 'Cuba de Hacienda de Tepa').length * 250],
      [perejil.id.toString(), ventasPendientes.filter((v) => v.producto_nombre === 'Tabla de Tapas Mixtas').length],
    ]);

    const ajustes = [];
    for (const product of [squirt, perejil]) {
      const existentes = await tx.inventory_lots.aggregate({
        where: { negocio_id: NEGOCIO, product_id: product.id, estado: 'abierto', cantidad_restante: { gt: 0 } },
        _sum: { cantidad_restante: true },
      });
      const saldoAbierto = Number(existentes._sum.cantidad_restante ?? 0);
      const objetivoCierre = fisico.get(product.id.toString()) ?? 0;
      const consumoPendiente = requerimiento.get(product.id.toString()) ?? 0;
      const faltanteApertura = Math.max(0, Number((objetivoCierre + consumoPendiente - saldoAbierto).toFixed(4)));
      if (faltanteApertura <= 0) continue;
      const ref = `${MARCA}-${product.name.toUpperCase().replaceAll(' ', '-')}`;
      let lote = await tx.inventory_lots.findFirst({ where: { negocio_id: NEGOCIO, ticket_ref: ref } });
      if (!lote) {
        const costo = Number(product.unit_cost ?? 0) / Number(product.contenido_compra ?? 1);
        lote = await tx.inventory_lots.create({
          data: {
            negocio_id: NEGOCIO,
            product_id: product.id,
            recibido_at: FECHA_APERTURA,
            cantidad_inicial: faltanteApertura,
            cantidad_restante: faltanteApertura,
            costo_unitario: costo,
            moneda: 'MXN',
            fuente: 'ajuste_inventario',
            ticket_ref: ref,
            notas: `${MARCA}. Apertura faltante calculada contra el cierre físico snapshot ${snapshot.id.toString()}; cubre sólo ventas pendientes y deja el saldo físico esperado. No es compra y no afecta Caja/Banco.`,
          },
        });
      }
      ajustes.push({ product: product.name, lote: lote.id, agregado: faltanteApertura, saldo_fisico_objetivo: objetivoCierre, consumo_pendiente: consumoPendiente, saldo_fifo_previo: saldoAbierto });
    }

    return {
      snapshot: { id: snapshot.id, semana_id: snapshot.semana_id, created_at: snapshot.created_at },
      menu: { id: menu.id, nombre: menu.nombre, epos_product_id: menu.epos_product_id, receta_id: receta?.id ?? null, receta_version: receta?.version ?? null },
      ajustes,
    };
  }, { maxWait: 60_000, timeout: 120_000 });

  const costeo = await costearVentasPendientesEnVivo({ negocioId: NEGOCIO });
  const pendientes = await prisma.epos_ventas.findMany({
    where: { negocio_id: NEGOCIO, costeo_estado: { in: ['pendiente', 'excepcion'] } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    select: { id: true, producto_nombre: true, costeo_estado: true, costeo_error: true },
  });
  console.log(serializar({ ok: true, resultado, costeo, pendientes }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
