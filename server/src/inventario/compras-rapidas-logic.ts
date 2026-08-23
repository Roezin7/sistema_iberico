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

export type SeveridadDiscrepancia = 'error' | 'advertencia';

export interface ProductoReglaCompra {
  id: bigint | number | string;
  name: string;
  unidad_base?: string | null;
  contenido_compra?: number | null;
  unidad_compra?: string | null;
  rendimiento_util?: number | null;
  aliases?: string[];
}

export interface LineaCompraValidable extends LineaCompraResumen {
  product_id?: bigint | number | string | null;
  descripcion_fuente: string;
  cantidad_base?: number | null;
  unidad_compra?: string | null;
  contenido_compra?: number | null;
  costo_unitario?: number | null;
}

export interface DiscrepanciaCompra {
  codigo: string;
  severidad: SeveridadDiscrepancia;
  linea?: number;
  producto?: string;
  mensaje: string;
}

export interface ValidacionCompra {
  errores: DiscrepanciaCompra[];
  advertencias: DiscrepanciaCompra[];
  valida: boolean;
}

function redondear(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizarTexto(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizarUnidad(value?: string | null) {
  const unidad = normalizarTexto(value ?? '');
  if (!unidad) return null;
  if (/^(ml|mililitro|mililitros|cc)$/.test(unidad)) return 'ml';
  if (/^(g|gramo|gramos|gr)$/.test(unidad)) return 'g';
  if (/^(kg|kilo|kilos)$/.test(unidad)) return 'kg';
  if (/^(pieza|piezas|pz|pzas|unidad|unidades|ud)$/.test(unidad)) return 'pieza';
  if (/^(l|litro|litros)$/.test(unidad)) return 'l';
  return unidad;
}

/** Convierte la presentación capturada a la unidad base del catálogo. */
export function cantidadBaseDesdePresentacion(input: {
  cantidadCompra?: number | null;
  unidadCompra?: string | null;
  contenidoPorPresentacion?: number | null;
  unidadBase?: string | null;
  rendimientoUtil?: number | null;
}) {
  const cantidad = Number(input.cantidadCompra);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  const contenido = Number(input.contenidoPorPresentacion);
  const rendimiento = Number(input.rendimientoUtil ?? 1);
  const factor = Number.isFinite(rendimiento) && rendimiento > 0 && rendimiento <= 1 ? rendimiento : 1;
  if (Number.isFinite(contenido) && contenido > 0) return cantidad * contenido * factor;
  const origen = normalizarUnidad(input.unidadCompra);
  const destino = normalizarUnidad(input.unidadBase);
  if (origen === destino) return cantidad;
  if (origen === 'kg' && destino === 'g') return cantidad * 1000;
  if (origen === 'l' && destino === 'ml') return cantidad * 1000;
  return null;
}

// Alias de proveedor que históricamente han provocado errores al capturar tickets.
// Se mantienen aquí para que OCR, captura manual y futuras importaciones compartan la misma regla.
const ALIAS_TICKET: Record<string, string[]> = {
  schweppes: ['tonica', 'agua tonica'],
  penafiel: ['agua mineral'],
  'pan de cebolla': ['pan'],
  'salsa heinz': ['ketchup'],
  'salsa prego': ['prego'],
  'chorizo redondo esp': ['chorizo'],
  'chorizo espanol': ['chorizo'],
};

function descripcionCoincideProducto(descripcion: string, producto: ProductoReglaCompra) {
  const fuente = normalizarTexto(descripcion);
  const nombre = normalizarTexto(producto.name);
  const aliasCatalogo = (producto.aliases ?? []).map(normalizarTexto).filter(Boolean);
  if (fuente.includes(nombre) || aliasCatalogo.some((alias) => fuente.includes(alias))) return true;
  return Object.entries(ALIAS_TICKET).some(([alias, nombres]) => {
    if (!fuente.includes(alias)) return false;
    return nombres.some((esperado) => nombre.includes(esperado) || aliasCatalogo.some((a) => a.includes(esperado)));
  });
}

function discrepancia(codigo: string, severidad: SeveridadDiscrepancia, mensaje: string, linea?: number, producto?: string): DiscrepanciaCompra {
  return { codigo, severidad, mensaje, ...(linea == null ? {} : { linea }), ...(producto ? { producto } : {}) };
}

/**
 * Reglas comunes para detectar errores de OCR/captura antes de crear un lote FIFO.
 * Las advertencias no bloquean: quedan registradas para revisión humana.
 */
export function validarDiscrepanciasCompra(total: number, lineas: LineaCompraValidable[], productos: ProductoReglaCompra[] = []): ValidacionCompra {
  const errores: DiscrepanciaCompra[] = [];
  const advertencias: DiscrepanciaCompra[] = [];
  const porProducto = new Map<string, number>();
  const productosMap = new Map(productos.map((p) => [String(p.id), p]));
  const resumen = resumirCompra(total, lineas);

  if (!resumen.cuadra) {
    errores.push(discrepancia('TOTAL_NO_CUADRA', 'error', `Las líneas suman $${resumen.totalLineas.toFixed(2)} y el ticket declara $${redondear(total).toFixed(2)}.`));
  }

  lineas.forEach((linea, index) => {
    const n = index + 1;
    if (!Number.isFinite(linea.importe) || linea.importe < 0) {
      errores.push(discrepancia('IMPORTE_INVALIDO', 'error', 'El importe debe ser un número no negativo.', n));
    }
    if (linea.tipo_linea === 'pendiente') {
      errores.push(discrepancia('LINEA_PENDIENTE', 'error', 'La línea todavía no está clasificada como inventario o gasto.', n));
    }
    if (linea.tipo_linea !== 'inventario') return;
    if (linea.product_id == null) {
      errores.push(discrepancia('INVENTARIO_SIN_PRODUCTO', 'error', 'Asocia la línea a un producto del inventario.', n));
      return;
    }
    const key = String(linea.product_id);
    porProducto.set(key, (porProducto.get(key) ?? 0) + 1);
    const producto = productosMap.get(key);
    if (!producto) {
      errores.push(discrepancia('PRODUCTO_NO_ENCONTRADO', 'error', 'El producto no existe o no está activo en este negocio.', n));
      return;
    }
    const cantidad = Number(linea.cantidad_base ?? 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      errores.push(discrepancia('CANTIDAD_BASE_INVALIDA', 'error', 'La cantidad base debe ser mayor que cero.', n, producto.name));
      return;
    }
    const unidadLinea = normalizarUnidad(linea.unidad_compra);
    const unidadProducto = normalizarUnidad(producto.unidad_base);
    if (unidadLinea && unidadProducto && unidadLinea !== unidadProducto) {
      advertencias.push(discrepancia('UNIDAD_INCOMPATIBLE', 'advertencia', `La línea usa ${unidadLinea} y el catálogo usa ${unidadProducto}.`, n, producto.name));
    }
    const contenido = Number(linea.contenido_compra ?? producto.contenido_compra ?? 0);
    if (contenido > 0 && Number.isFinite(contenido)) {
      const paquetes = cantidad / contenido;
      if (Math.abs(paquetes - Math.round(paquetes)) > 0.02) {
        advertencias.push(discrepancia('PRESENTACION_NO_MULTIPLO', 'advertencia', `La cantidad ${cantidad} no corresponde a múltiplos completos de la presentación (${contenido}). Revisa paquetes, piezas o conversión.`, n, producto.name));
      }
    }
    if (linea.costo_unitario != null && Number.isFinite(Number(linea.costo_unitario))) {
      const costoCalculado = Number(linea.importe) / cantidad;
      const costoCapturado = Number(linea.costo_unitario);
      const diferencia = Math.abs(costoCalculado - costoCapturado);
      if (diferencia > 0.01 && diferencia / Math.max(Math.abs(costoCalculado), 0.01) > 0.01) {
        advertencias.push(discrepancia('COSTO_UNITARIO_INCONSISTENTE', 'advertencia', `El costo capturado (${costoCapturado.toFixed(4)}) no coincide con importe/cantidad (${costoCalculado.toFixed(4)}).`, n, producto.name));
      }
    }
    if (!descripcionCoincideProducto(linea.descripcion_fuente, producto)) {
      advertencias.push(discrepancia('DESCRIPCION_PRODUCTO_NO_COINCIDE', 'advertencia', `La descripción “${linea.descripcion_fuente}” no coincide claramente con “${producto.name}”.`, n, producto.name));
    }
  });

  for (const [productId, count] of porProducto) {
    if (count > 1) {
      const producto = productosMap.get(productId);
      advertencias.push(discrepancia('PRODUCTO_REPETIDO', 'advertencia', `El producto aparece ${count} veces; se consolidará antes de crear el lote FIFO.`, undefined, producto?.name));
    }
  }
  return { errores, advertencias, valida: errores.length === 0 };
}

export function notasDeValidacion(base: string | null | undefined, validacion: ValidacionCompra) {
  if (!validacion.advertencias.length) return base?.trim() || null;
  const detalle = validacion.advertencias.map((d) => `[${d.codigo}] ${d.mensaje}`).join(' | ');
  return [base?.trim(), `Validación automática: ${detalle}`].filter(Boolean).join('\n');
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
