// Lógica pura de inventario (sin DB). Es donde más duele un error, así que va testeada.
// Reglas (spec §5.2):
//   total_base de un producto = Σ_zonas (qty_captura * factor)
//   faltante de compra        = max(0, minimo_base - total_base)
//   valor de inventario       = Σ (total_base * unit_cost) [productos sin unit_cost no suman]
//   lista de compras          = productos con faltante > 0, agrupados por store con subtotales

export interface LineaConteo {
  qty_captura: number;
  factor: number;
}

/** Unidades en las que se expresa el inventario y las recetas.
 * Las presentaciones comerciales (botella, bolsa, paquete, caja, etc.)
 * nunca deben convertirse en una unidad base distinta: se describen con
 * `unidad_compra` y `contenido_compra`.
 */
export const UNIDADES_BASE_CANONICAS = ['g', 'ml', 'pieza'] as const;
export type UnidadBaseCanonica = typeof UNIDADES_BASE_CANONICAS[number];

/** Normaliza abreviaturas y unidades discretas a la unidad física base. */
export function normalizarUnidadBase(value?: string | null): UnidadBaseCanonica | null {
  const unidad = (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  if (!unidad) return null;
  if (/^(g|gramo|gramos|gr)$/.test(unidad)) return 'g';
  if (/^(ml|mililitro|mililitros|cc)$/.test(unidad)) return 'ml';
  if (/^(pieza|piezas|pz|pzas|unidad|unidades|ud|rollo|rollos|paquete|paquetes|pack|packs|bolsa|bolsas|caja|cajas|lata|latas)$/.test(unidad)) return 'pieza';
  return null;
}

/**
 * Unidad operativa que debe ver una persona al contar inventario.
 *
 * El libro interno sigue usando g/ml para recetas y FIFO, pero el conteo
 * cotidiano se expresa en unidades físicas comprables: botellas, bolsas,
 * paquetes o piezas. Para productos que ya son discretos conservamos pieza;
 * para líquidos y graneles usamos la presentación configurada, sin mostrar su
 * contenido en g/ml en la interfaz de inventario.
 */
export function unidadOperativaInventario(unidadBase?: string | null, unidadCompra?: string | null): string {
  if (normalizarUnidadBase(unidadBase) === 'pieza') return 'pieza';
  const texto = (unidadCompra ?? '').trim().toLowerCase();
  if (!texto) return 'unidad';
  const primera = texto.split(/\s|\(|\//)[0] ?? texto;
  if (/^(g|gr|gramo|gramos|ml|cc|mililitro|mililitros)$/.test(primera)) return 'unidad';
  return primera || 'unidad';
}

/** Convierte una existencia interna a la unidad física que se cuenta. */
export function cantidadOperativaInventario(input: {
  totalBase: number;
  unidadBase?: string | null;
  contenidoCompra?: number | null;
}): number {
  const total = Number(input.totalBase);
  if (!Number.isFinite(total)) return 0;
  if (normalizarUnidadBase(input.unidadBase) === 'pieza') return redondear(total);
  const contenido = input.contenidoCompra == null ? null : Number(input.contenidoCompra);
  if (contenido == null || !Number.isFinite(contenido) || contenido <= 0) return redondear(total);
  return redondear(total / contenido);
}

/** Faltante expresado en unidades físicas, no en g/ml. */
export function faltanteOperativoInventario(minimo: number, actual: number): number {
  const min = Number(minimo);
  const existencia = Number(actual);
  if (!Number.isFinite(min) || !Number.isFinite(existencia)) return 0;
  return redondear(Math.max(0, min - existencia));
}

export function unidadBaseCanonicaValida(value?: string | null): value is UnidadBaseCanonica {
  return normalizarUnidadBase(value) != null;
}

/** Suma qty_captura * factor sobre todas las líneas/zonas de un producto. */
export function totalBaseProducto(lineas: LineaConteo[]): number {
  return redondear(lineas.reduce((acc, l) => acc + l.qty_captura * l.factor, 0));
}

/** Lo que hay que comprar para llegar al stock mínimo (base_qty). Nunca negativo. */
export function faltanteCompra(baseQty: number, totalBase: number): number {
  return redondear(Math.max(0, baseQty - totalBase));
}

/**
 * Convierte el mínimo configurado en presentaciones a la unidad base.
 *
 * El catálogo histórico guardó `base_qty` como número de presentaciones para
 * muchos productos (p. ej. 1 botella), mientras que los conteos se convierten
 * a ml, g o piezas. Comparar esos valores directamente hace que un stock de
 * 500 ml parezca suficiente para un mínimo de 1 botella. Cuando conocemos el
 * contenido de la presentación, el mínimo físico correcto es:
 *
 *   mínimo de presentaciones × contenido por presentación
 *
 * Sin contenido se conserva el valor original para no inventar conversiones.
 */
export function minimoBaseDesdePresentacion(input: {
  minimoPresentaciones: number;
  contenidoCompra?: number | null;
}): number {
  const minimo = Number(input.minimoPresentaciones);
  const contenido = input.contenidoCompra == null ? null : Number(input.contenidoCompra);
  if (!Number.isFinite(minimo) || minimo <= 0) return 0;
  if (contenido == null || !Number.isFinite(contenido) || contenido <= 0) return redondear(minimo);
  return redondear(minimo * contenido);
}

/** Número de presentaciones completas necesarias para cubrir un faltante. */
export function presentacionesNecesarias(faltanteBase: number, contenidoCompra?: number | null): number | null {
  const faltante = Number(faltanteBase);
  const contenido = contenidoCompra == null ? null : Number(contenidoCompra);
  if (!Number.isFinite(faltante) || faltante <= 0) return 0;
  if (contenido == null || !Number.isFinite(contenido) || contenido <= 0) return null;
  return Math.ceil(faltante / contenido);
}

/** Valor a costo de un producto. Sin costo => 0 (y se reporta aparte). */
export function valorProducto(totalBase: number, unitCost: number | null): number {
  if (unitCost == null) return 0;
  return redondear(totalBase * unitCost);
}

/**
 * Convierte el precio de una presentación de compra a costo por unidad base.
 * La lista de compras compara existencias físicas contra el mínimo físico;
 * por eso no aplica rendimiento útil aquí (ese rendimiento sólo interviene al
 * consumir recetas). Si falta la presentación, devuelve null para no inflar
 * el total usando accidentalmente el precio completo del paquete.
 */
export function costoBaseDesdePresentacion(input: {
  costoPresentacion: number | null | undefined;
  contenidoCompra: number | null | undefined;
  unidadBase?: string | null;
}): number | null {
  const costo = input.costoPresentacion == null ? null : Number(input.costoPresentacion);
  const contenido = input.contenidoCompra == null ? null : Number(input.contenidoCompra);
  if (costo == null || !Number.isFinite(costo) || costo < 0) return null;
  if (!input.unidadBase || contenido == null || !Number.isFinite(contenido) || contenido <= 0) return null;
  return costo / contenido;
}

export interface ProductoFaltante {
  product_id: number;
  nombre: string;
  store_id: number;
  store: string;
  base_qty: number;
  /** Mínimo efectivo en unidad base (base_qty × contenido_compra). */
  minimo_base?: number;
  total_base: number;
  faltante: number;
  /** Valores para el operador: siempre en presentaciones/piezas físicas. */
  unidad_operativa?: string;
  minimo_operativo?: number;
  total_operativo?: number;
  faltante_operativo?: number;
  unit_cost: number | null;
  valor_faltante: number; // faltante * unit_cost (0 si sin costo)
  /** Costo de una unidad base (g, ml o pieza), no de la presentación. */
  unit_cost_base?: number | null;
  unidad_base?: string | null;
  contenido_compra?: number | null;
  unidad_compra?: string | null;
  rendimiento_util?: number | null;
  /** Presentaciones completas que deben comprarse para cubrir el faltante. */
  presentaciones_faltantes?: number | null;
  /** Permite distinguir un costo cero real de una configuración faltante. */
  costo_configurado?: boolean;
}

export interface GrupoTienda {
  store_id: number;
  store: string;
  items: ProductoFaltante[];
  subtotal: number;
}

export interface ListaCompras {
  grupos: GrupoTienda[];
  total: number;
}

/** Agrupa los productos con faltante > 0 por tienda, con subtotal por tienda y total general. */
export function armarListaCompras(faltantes: ProductoFaltante[]): ListaCompras {
  const conFaltante = faltantes.filter((f) => f.faltante > 0);
  const porTienda = new Map<number, GrupoTienda>();

  for (const item of conFaltante) {
    let grupo = porTienda.get(item.store_id);
    if (!grupo) {
      grupo = { store_id: item.store_id, store: item.store, items: [], subtotal: 0 };
      porTienda.set(item.store_id, grupo);
    }
    grupo.items.push(item);
    grupo.subtotal = redondear(grupo.subtotal + item.valor_faltante);
  }

  const grupos = [...porTienda.values()].sort((a, b) => a.store.localeCompare(b.store, 'es'));
  const total = redondear(grupos.reduce((acc, g) => acc + g.subtotal, 0));
  return { grupos, total };
}

/** Redondeo a 2 decimales evitando ruido de punto flotante. */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
