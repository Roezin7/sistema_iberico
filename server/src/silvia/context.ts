import { prisma } from '../db.js';
import { resumen, etiquetaCanonica } from '../finanzas/service.js';
import { listarSnapshots } from '../patrimonio/service.js';
import { inventarioActual, listaCompras } from '../inventario/service.js';

const mxn = (n: number | null | undefined) =>
  n == null ? 's/d' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Reúne los KPIs reales del negocio para dárselos a Silvia como contexto.
 * Devuelve un texto compacto (no inventa nada; si no hay datos, lo dice).
 */
export async function contextoNegocio(negocioId: bigint): Promise<string> {
  const negocio = await prisma.negocios.findUnique({ where: { id: negocioId } });
  const partes: string[] = [];
  partes.push(`Negocio: ${negocio?.nombre ?? 'Ibérico'} (${negocio?.tipo ?? 'bar'}).`);

  // --- Finanzas: últimas semanas ---
  const semanas = await prisma.semanas.findMany({
    where: { negocio_id: negocioId },
    orderBy: { fecha_inicio: 'desc' },
    take: 6,
  });
  if (semanas.length === 0) {
    partes.push('Finanzas: aún no hay semanas registradas.');
  } else {
    const filas: string[] = [];
    for (const s of [...semanas].reverse()) {
      try {
        const r = await resumen(negocioId, s.id);
        const etiqueta = etiquetaCanonica(s.fecha_inicio, s.fecha_fin);
        filas.push(
          `  ${etiqueta} (${s.estado}): ventas ${mxn(r.ventas.total)}, flujo de caja ${mxn(r.flujo_caja_neto)}, ` +
            `resultado operativo ${mxn(r.resultado_operativo)}, inventario físico ${mxn(r.inventario.valor_patrimonio)} ` +
            `(fuente ${r.inventario.valor_patrimonio_fuente}), FIFO contable restante ${mxn(r.inventario.valor_fifo_corte)}, ` +
            `facturado(+/-) ${mxn(r.facturado.balance)}`,
        );
      } catch {
        /* semana sin datos suficientes */
      }
    }
    partes.push('Finanzas por semana (más reciente al final):\n' + filas.join('\n'));
  }

  // --- Patrimonio ---
  const snaps = await listarSnapshots(negocioId);
  if (snaps.length > 0) {
    const ult = snaps[snaps.length - 1]!;
    const tendencia =
      snaps.length > 1
        ? `; hace ${snaps.length} cierres estaba en ${mxn(snaps[0]!.patrimonio_neto)}`
        : '';
    partes.push(
      `Patrimonio neto actual: ${mxn(ult.patrimonio_neto)} (banco ${mxn(ult.total_banco)}, ` +
        `efectivo ${mxn(ult.total_efectivo)}, inventario ${mxn(ult.total_inventario)}, pasivos ${mxn(ult.total_pasivos)})${tendencia}.`,
    );
  }

  // --- Inventario ---
  try {
    const [inv, compras] = await Promise.all([inventarioActual(negocioId, { vista: 'operativa' }), listaCompras(negocioId)]);
    partes.push(
      `Inventario: valor FIFO disponible ${mxn(inv.valor_fifo_actual_total)}; compra sugerida ${mxn(compras.total)} ` +
        `en ${compras.grupos.length} tiendas` +
        (inv.sin_costo.length ? `; ${inv.sin_costo.length} productos sin costo` : '') +
        `. El detalle completo por producto, categoría, tienda y zona está disponible en la herramienta consultar_inventario.`,
    );
  } catch {
    /* sin inventario */
  }

  return partes.join('\n\n');
}
