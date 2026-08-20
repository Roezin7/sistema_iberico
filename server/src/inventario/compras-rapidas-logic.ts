export type TipoLineaCompra = 'inventario' | 'gasto' | 'pendiente';

export interface LineaCompraResumen {
  tipo_linea: TipoLineaCompra;
  importe: number;
}

export interface ResumenCompra {
  totalLineas: number;
  inventario: number;
  gasto: number;
  pendiente: number;
  cuadra: boolean;
}

function redondear(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Resume un ticket ya capturado sin convertir diferencias en gasto inventado. */
export function resumirCompra(total: number, lineas: LineaCompraResumen[]): ResumenCompra {
  const porTipo = (tipo: TipoLineaCompra) => redondear(lineas.filter((l) => l.tipo_linea === tipo).reduce((a, l) => a + l.importe, 0));
  const totalLineas = redondear(lineas.reduce((a, l) => a + l.importe, 0));
  return {
    totalLineas,
    inventario: porTipo('inventario'),
    gasto: porTipo('gasto'),
    pendiente: porTipo('pendiente'),
    cuadra: Math.abs(totalLineas - redondear(total)) <= 0.01,
  };
}
