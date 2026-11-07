/** Contrato compartido por captura y servidor. Una unidad métrica explícita
 * significa lo mismo aunque cambie el tamaño comercial del catálogo. */
export function normalizarUnidadCompra(valor?: string | null): string | null {
  const u = (valor ?? '').trim().toLowerCase();
  if (!u) return null;
  if (/^(g|gr|gramo|gramos)$/.test(u)) return 'g';
  if (/^(kg|kgs|kilo|kilos|kilogramo|kilogramos)$/.test(u)) return 'kg';
  if (/^(ml|cc|mililitro|mililitros)$/.test(u)) return 'ml';
  if (/^(l|lt|litro|litros)$/.test(u)) return 'l';
  if (/^(pz|pza|pzas|pieza|piezas|unidad|unidades|ud)$/.test(u)) return 'pieza';
  return u;
}

export function unidadesMetricasIncompatibles(origen?: string | null, destino?: string | null) {
  const a = normalizarUnidadCompra(origen), b = normalizarUnidadCompra(destino);
  const dimension = (u: string | null) => u === 'g' || u === 'kg' ? 'peso' : u === 'ml' || u === 'l' ? 'volumen' : null;
  return dimension(a) != null && dimension(b) != null && dimension(a) !== dimension(b);
}

export function convertirCompraABase(input: {
  cantidadCompra?: number | null; unidadCompra?: string | null;
  contenidoPorPresentacion?: number | null; unidadBase?: string | null;
  rendimientoUtil?: number | null;
}) {
  const cantidad = Number(input.cantidadCompra);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  const origen = normalizarUnidadCompra(input.unidadCompra), destino = normalizarUnidadCompra(input.unidadBase);
  if (unidadesMetricasIncompatibles(origen, destino)) return null;
  const rendimiento = Number(input.rendimientoUtil ?? 1);
  if (!Number.isFinite(rendimiento) || rendimiento <= 0 || rendimiento > 1) return null;
  // Antes de considerar botellas/paquetes, resolver gramos, kg, ml y litros.
  if (origen && origen === destino && ['g', 'kg', 'ml', 'l'].includes(origen)) return cantidad * rendimiento;
  if (origen === 'kg' && destino === 'g') return cantidad * 1000 * rendimiento;
  if (origen === 'l' && destino === 'ml') return cantidad * 1000 * rendimiento;
  const contenido = Number(input.contenidoPorPresentacion);
  if (Number.isFinite(contenido) && contenido > 0) return cantidad * contenido * rendimiento;
  if (origen && origen === destino) return cantidad;
  return null;
}
