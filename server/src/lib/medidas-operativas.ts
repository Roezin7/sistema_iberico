/** Cantidad y etiqueta son inseparables: nunca mostrar gramos/ml con nombre
 * de envase. La base no se modifica para corregir la presentación visual. */
export function medidaOperativa(input: {
  cantidad_base: number; cantidad_operativa?: number | null;
  unidad_base?: string | null; unidad_operativa?: string | null;
  contenido_compra?: number | null;
}) {
  const base = input.unidad_base;
  const factor = base === 'pieza' ? 1 : Number(input.contenido_compra);
  const tieneFactor = Number.isFinite(factor) && factor > 0;
  const unidad = input.unidad_operativa?.trim();
  // Un valor operativo sin unidad o una etiqueta sin conversión no son
  // evidencia suficiente: mostrar la cantidad base con su unidad explícita.
  if (unidad && (input.cantidad_operativa != null || tieneFactor)) {
    const cantidad = input.cantidad_operativa ?? input.cantidad_base / factor;
    if (Number.isFinite(cantidad)) return { cantidad, unidad, contenido_base: tieneFactor ? factor : null, unidad_base: base ?? null };
  }
  return { cantidad: input.cantidad_base, unidad: base || 'unidad base', contenido_base: 1, unidad_base: base ?? null };
}

export function textoMedida(input: Parameters<typeof medidaOperativa>[0]) {
  const m = medidaOperativa(input);
  const cantidad = m.cantidad.toLocaleString('es-MX', { maximumFractionDigits: 4 });
  const plurales: Record<string,string> = {botella:'botellas',bolsa:'bolsas',pieza:'piezas',paquete:'paquetes',envase:'envases',bote:'botes',lata:'latas',frasco:'frascos',bloque:'bloques',garrafon:'garrafones',manojo:'manojos',caja:'cajas',lote:'lotes',unidad:'unidades'};
  const unidad = m.cantidad === 1 ? m.unidad : plurales[m.unidad] ?? m.unidad;
  const detalle = m.contenido_base != null && m.contenido_base > 1 && ['g','ml'].includes(m.unidad_base ?? '')
    ? ` de ${m.contenido_base.toLocaleString('es-MX')} ${m.unidad_base}` : '';
  return `${cantidad} ${unidad}${detalle}`;
}
