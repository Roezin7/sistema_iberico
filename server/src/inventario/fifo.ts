export interface LoteFIFO {
  id: number;
  recibidoAt: string;
  cantidadRestante: number;
  costoUnitario: number;
}

export interface ConsumoFIFO {
  loteId: number;
  cantidad: number;
  costoUnitario: number;
  costoTotal: number;
}

export interface ResultadoFIFO {
  consumos: ConsumoFIFO[];
  cantidadSolicitada: number;
  cantidadConsumida: number;
  faltante: number;
  costoTotal: number;
}

/**
 * Asigna una cantidad a lotes en orden de recepción. La función es pura para
 * poder probar el cálculo antes de conectarlo a una transacción de Prisma.
 * Nunca inventa existencia: si no alcanza, devuelve faltante explícito.
 */
export function consumirFIFO(lotes: LoteFIFO[], cantidad: number): ResultadoFIFO {
  const solicitada = Math.max(0, cantidad);
  let pendiente = solicitada;
  const consumos: ConsumoFIFO[] = [];
  const ordenados = [...lotes]
    .filter((lote) => lote.cantidadRestante > 0 && Number.isFinite(lote.costoUnitario))
    .sort((a, b) => a.recibidoAt.localeCompare(b.recibidoAt) || a.id - b.id);

  for (const lote of ordenados) {
    if (pendiente <= 0) break;
    const toma = Math.min(pendiente, lote.cantidadRestante);
    if (toma <= 0) continue;
    consumos.push({
      loteId: lote.id,
      cantidad: toma,
      costoUnitario: lote.costoUnitario,
      costoTotal: redondear(toma * lote.costoUnitario),
    });
    pendiente = redondear(pendiente - toma);
  }

  const cantidadConsumida = redondear(solicitada - pendiente);
  return {
    consumos,
    cantidadSolicitada: solicitada,
    cantidadConsumida,
    faltante: redondear(pendiente),
    costoTotal: redondear(consumos.reduce((total, consumo) => total + consumo.costoTotal, 0)),
  };
}

function redondear(n: number) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
