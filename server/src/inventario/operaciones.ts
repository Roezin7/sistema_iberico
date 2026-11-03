import { inventarioActual } from './service.js';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { instanteReal } from './cronologia.js';
import { filtroConsumoFifoActivo } from './fuentes.js';
import { bloquearLibro, exigirPeriodoMutable } from './control-cierre.js';
import { cargarLibroFisico, efectivaLote, ordenLote, diaDb, q4 } from './libro-fisico.js';

export const CAUSAS_INVENTARIO = ['sin_explicar', 'merma', 'cortesia', 'consumo_interno', 'error_conteo', 'error_presentacion', 'compra_omitida', 'venta_omitida', 'receta', 'arrastre_previo'] as const;
export interface OperacionInput {
  tipo: 'merma' | 'cortesia' | 'consumo_interno' | 'produccion'; efectiva_at: string; motivo: string; responsable: string; solicitud_id: string; epos_venta_id?: number | null;
  lineas: { product_id: number; zona_id: number; cantidad: number; contenido_presentacion?: number | null; unidad_presentacion?: string | null }[];
}

export async function registrarOperacion(negocioId: bigint, usuarioId: bigint, input: OperacionInput) {
  const fecha = instanteReal(input.efectiva_at)!;
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return prisma.$transaction(async tx => {
    await bloquearLibro(tx, negocioId);
    const repetida = await tx.inventory_operations.findFirst({ where: { negocio_id: negocioId, solicitud_id: input.solicitud_id } });
    if (repetida) { if (repetida.solicitud_hash !== hash) throw new HttpError(409, 'La clave de reintento corresponde a otros datos'); return { id: Number(repetida.id), repetida: true }; }
    await exigirPeriodoMutable(tx, negocioId, fecha);
    const cerrado = await tx.inventory_control_closures.findFirst({ where: { negocio_id: negocioId, corte_at: { gte: fecha } } });
    if (cerrado) throw new HttpError(409, 'Ese momento ya está conciliado. Documenta la causa en su incidencia; no registres una segunda salida histórica.');
    const semana = await tx.semanas.findFirst({ where: { negocio_id: negocioId, fecha_inicio: { lte: diaDb(fecha) }, fecha_fin: { gte: diaDb(fecha) }, estado: 'abierta' } });
    if (!semana) throw new HttpError(409, 'No hay semana abierta para esa fecha');
    if (!input.motivo.trim() || !input.responsable.trim() || !input.lineas.length || input.lineas.some(l => !Number.isFinite(l.cantidad) || q4(l.cantidad) === 0)) throw new HttpError(400, 'Completa motivo, responsable y cantidades válidas');
    if (input.tipo !== 'produccion' && input.lineas.some(l => l.cantidad > 0)) throw new HttpError(400, 'Una salida usa cantidades negativas');
    if (input.tipo === 'produccion' && (!input.lineas.some(l => l.cantidad > 0) || !input.lineas.some(l => l.cantidad < 0))) throw new HttpError(400, 'La producción requiere ingredientes consumidos y producto obtenido');
    const productIds = [...new Set(input.lineas.map(l => BigInt(l.product_id)))];
    const [productos, zonas] = await Promise.all([tx.products.findMany({ where: { negocio_id: negocioId, id: { in: productIds }, active: true } }), tx.zonas_inventario.findMany({ where: { negocio_id: negocioId, id: { in: input.lineas.map(l => BigInt(l.zona_id)) } } })]);
    if (productos.length !== productIds.length || input.lineas.some(l => !zonas.some(z => z.id === BigInt(l.zona_id)))) throw new HttpError(400, 'Producto o zona no pertenece al negocio');
    // Una línea Epos ya representa la salida. Sólo se permite clasificarla;
    // se reconstruyen sus ingredientes desde la receta, no se toman cantidades
    // manuales diferentes ni se vuelve a afectar FIFO.
    let venta: Awaited<ReturnType<typeof tx.epos_ventas.findFirst>> = null;
    if (input.epos_venta_id) {
      if (input.tipo === 'produccion') throw new HttpError(400, 'La producción no se clasifica como venta Epos');
      venta = await tx.epos_ventas.findFirst({ where: { negocio_id: negocioId, id: BigInt(input.epos_venta_id) } });
      if (!venta || venta.fecha.getTime() !== fecha.getTime()) throw new HttpError(400, 'Usa la fecha y hora exactas de la línea Epos');
      if (await tx.inventory_operations.findFirst({ where: { epos_venta_id: venta.id } })) throw new HttpError(409, 'La salida Epos ya fue clasificada');
      if (Number(venta.venta_neta ?? venta.venta_bruta) !== 0 && input.tipo === 'cortesia') throw new HttpError(400, 'La línea Epos tiene ingreso; revisa la cortesía antes de clasificar');
    }
    if (!venta) {
      const fisico = await inventarioActual(negocioId,{hasta:fecha});
      const requeridas = new Map<string,number>();
      for(const l of input.lineas.filter(l=>l.cantidad<0)) { const k=`${l.product_id}:${l.zona_id}`; requeridas.set(k,(requeridas.get(k)??0)+Math.abs(l.cantidad)); }
      for(const [k,q] of requeridas){const [pid,zid]=k.split(':').map(Number);const p=fisico.productos.find(p=>p.product_id===pid);const z=p?.por_zona.find(z=>z.zona_id===zid);const saldo=z?z.qty_captura*z.factor:0;if(q>saldo+0.0001)throw new HttpError(409,`${p?.nombre??'Producto'}: la zona sólo tiene ${q4(saldo)} al momento indicado. Corrige el conteo o documenta el traslado; no se fuerza inventario negativo.`);}
    }
    let costosEpos = new Map<string, { cantidad: number; costo: number; estimado: boolean }>();
    if (venta) {
      const libro = await cargarLibroFisico(tx, negocioId, fecha, fecha);
      const ingredientes = new Map<string, number>();
      for (const e of libro.eventos.filter(e => e.referencia === `venta:${venta!.id}`)) ingredientes.set(String(e.product_id), (ingredientes.get(String(e.product_id)) ?? 0) + e.cantidad);
      const manual = new Map<string, number>();
      for (const l of input.lineas) manual.set(String(l.product_id), (manual.get(String(l.product_id)) ?? 0) + Math.abs(l.cantidad));
      if (!ingredientes.size || ingredientes.size !== manual.size || [...ingredientes].some(([id, q]) => Math.abs(q - (manual.get(id) ?? 0)) > 0.0001)) throw new HttpError(400, 'Las cantidades deben coincidir con los ingredientes de la venta Epos; clasificar no crea otra salida');
      const asignados = await tx.inventory_consumptions.findMany({ where: { negocio_id: negocioId, epos_venta_id: venta.id, ...filtroConsumoFifoActivo() }, include: { lote: true } });
      for (const c of asignados) { const id = String(c.product_id); const sum = costosEpos.get(id) ?? { cantidad: 0, costo: 0, estimado: false }; sum.cantidad += Number(c.cantidad); sum.costo += Number(c.costo_total); sum.estimado ||= c.lote.costo_estimado; costosEpos.set(id, sum); }
    }
    const op = await tx.inventory_operations.create({ data: { negocio_id: negocioId, semana_id: semana.id, tipo: input.tipo, efectiva_at: fecha, motivo: input.motivo.trim(), responsable: input.responsable.trim(), solicitud_id: input.solicitud_id, solicitud_hash: hash, usuario_id: usuarioId, epos_venta_id: venta?.id } });
    const resultados: { id: number; cantidad: number; costo_conocido: number; pendiente_cantidad: number; costo_estimado: boolean }[] = [];
    let costoIngredientes = 0, incompleto = false;
    for (const l of input.lineas.filter(l => l.cantidad < 0)) {
      const producto = productos.find(p => p.id === BigInt(l.product_id))!;
      const linea = await tx.inventory_operation_lines.create({ data: { operacion_id: op.id, product_id: producto.id, zona_id: BigInt(l.zona_id), cantidad: q4(l.cantidad), contenido_presentacion: l.contenido_presentacion, unidad_presentacion: l.unidad_presentacion } });
      let pendiente = Math.abs(l.cantidad), costo = 0, estimado = false;
      if (venta) { const asignado = costosEpos.get(String(l.product_id)); const totalProducto = input.lineas.filter(x => x.product_id === l.product_id).reduce((s, x) => s + Math.abs(x.cantidad), 0); const proporcion = Math.abs(l.cantidad) / totalProducto; costo = (asignado?.costo ?? 0) * proporcion; pendiente = q4(Math.max(0, totalProducto - (asignado?.cantidad ?? 0)) * proporcion); estimado = asignado?.estimado ?? true; }
      else {
        const todos = await tx.inventory_lots.findMany({ where: { negocio_id: negocioId, product_id: producto.id, estado: 'abierto', cantidad_restante: { gt: 0 }, fuente: { not: 'historico_prueba' } }, include: { purchases: { select: { recibida_at: true } } } });
        const lotes = todos.filter(lote => efectivaLote(lote) <= fecha && (!l.contenido_presentacion || Number(lote.contenido_presentacion) === l.contenido_presentacion)).sort((a, b) => ordenLote(a).getTime() - ordenLote(b).getTime() || Number(a.id - b.id));
        for (const lote of lotes) {
          if (pendiente <= 0.0001) break;
          const toma = Math.min(pendiente, Number(lote.cantidad_restante));
          await tx.inventory_consumptions.create({ data: { negocio_id: negocioId, product_id: producto.id, lote_id: lote.id, fecha: diaDb(fecha), efectiva_at: fecha, operacion_linea_id: linea.id, cantidad: toma, costo_unitario: lote.costo_unitario, costo_total: toma * Number(lote.costo_unitario), fuente: 'salida_operativa' } });
          const restante = q4(Number(lote.cantidad_restante) - toma);
          await tx.inventory_lots.update({ where: { id: lote.id }, data: { cantidad_restante: restante, estado: restante <= 0.0001 ? 'agotado' : 'abierto' } });
          costo += toma * Number(lote.costo_unitario); pendiente = q4(pendiente - toma); estimado ||= lote.costo_estimado;
        }
      }
      await tx.inventory_operation_lines.update({ where: { id: linea.id }, data: { costo_total: costo, pendiente_cantidad: pendiente, costo_estimado: estimado } });
      costoIngredientes += costo; incompleto ||= pendiente > 0 || estimado;
      resultados.push({ id: Number(linea.id), cantidad: l.cantidad, costo_conocido: costo, pendiente_cantidad: pendiente, costo_estimado: estimado });
    }
    const positivas = input.lineas.filter(l => l.cantidad > 0);
    if (positivas.length > 1) throw new HttpError(400, 'Una producción registra un producto obtenido por operación, para asignar su costo sin supuestos');
    for (const l of positivas) {
      const linea = await tx.inventory_operation_lines.create({ data: { operacion_id: op.id, product_id: BigInt(l.product_id), zona_id: BigInt(l.zona_id), cantidad: l.cantidad, costo_total: costoIngredientes, costo_estimado: incompleto, contenido_presentacion: l.contenido_presentacion, unidad_presentacion: l.unidad_presentacion } });
      await tx.inventory_lots.create({ data: { negocio_id: negocioId, product_id: BigInt(l.product_id), zona_id: BigInt(l.zona_id), operacion_linea_id: linea.id, recibido_at: diaDb(fecha), disponible_desde: fecha, orden_fifo_at: fecha, cantidad_inicial: l.cantidad, cantidad_restante: l.cantidad, costo_unitario: costoIngredientes / l.cantidad, costo_estimado: incompleto, contenido_presentacion: l.contenido_presentacion, unidad_presentacion: l.unidad_presentacion, fuente: 'produccion_interna', notas: `Producción ${op.id}; el costo proviene de ingredientes, no de un pago` } });
      resultados.push({ id: Number(linea.id), cantidad: l.cantidad, costo_conocido: costoIngredientes, pendiente_cantidad: 0, costo_estimado: incompleto });
    }
    await tx.auditoria_eventos.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, entidad: 'salida_inventario', entidad_id: String(op.id), accion: venta ? 'clasificar_epos_sin_duplicar' : 'registrar', despues: JSON.stringify({ ...input, lineas: resultados }), metadata: JSON.stringify({ sin_movimiento_de_caja: true }) } });
    return { id: Number(op.id), repetida: false, lineas: resultados, pendiente_costo: incompleto, clasificacion_epos: !!venta };
  }, { timeout: 45000 });
}

export async function clasificarDiferencia(negocioId: bigint, usuarioId: bigint, id: bigint, input: { version: number; causa: string; estado: string; responsable: string; evidencia?: string; nota: string }) {
  if (!(CAUSAS_INVENTARIO as readonly string[]).includes(input.causa)) throw new HttpError(400, 'Causa inválida');
  if (!input.responsable.trim() || input.nota.trim().length < 5) throw new HttpError(400, 'Indica responsable y explicación');
  if (input.estado === 'documentada' && input.causa === 'sin_explicar') throw new HttpError(400, 'Una diferencia sin explicar permanece abierta o investigando');
  return prisma.$transaction(async tx => {
    const antes = await tx.inventory_variance_cases.findFirst({ where: { id, negocio_id: negocioId } });
    if (!antes) throw new HttpError(404, 'Incidencia no encontrada');
    const update = await tx.inventory_variance_cases.updateMany({ where: { id, negocio_id: negocioId, version: input.version }, data: { causa: input.causa, estado: input.estado, responsable: input.responsable.trim(), evidencia: input.evidencia?.trim() || null, nota: input.nota.trim(), version: { increment: 1 } } });
    if (update.count !== 1) throw new HttpError(409, 'La incidencia cambió en otra sesión; vuelve a cargar');
    await tx.auditoria_eventos.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, entidad: 'incidencia_inventario', entidad_id: String(id), accion: 'clasificar_sin_segunda_salida', antes: JSON.stringify(antes, (_, v) => typeof v === 'bigint' ? String(v) : v), despues: JSON.stringify(input) } });
    return { id: Number(id), version: input.version + 1 };
  });
}

export async function controlInventario(negocioId: bigint) {
  const [casos, cierres, productos, operaciones] = await Promise.all([
    prisma.inventory_variance_cases.findMany({ where: { negocio_id: negocioId }, orderBy: [{ semana_id: 'desc' }, { id: 'desc' }], take: 500 }),
    prisma.inventory_control_closures.findMany({ where: { negocio_id: negocioId }, orderBy: { corte_at: 'desc' }, take: 12 }),
    prisma.products.findMany({ where: { negocio_id: negocioId }, select: { id: true, name: true, unidad_base: true } }),
    prisma.inventory_operations.findMany({ where: { negocio_id: negocioId }, orderBy: { efectiva_at: 'desc' }, take: 30 }),
  ]);
  const operacionesParaAlertas = await prisma.inventory_operations.findMany({where:{negocio_id:negocioId,semana_id:{in:cierres.slice(0,4).map(c=>c.semana_id)}}});
  const todasOperaciones=[...new Map([...operaciones,...operacionesParaAlertas].map(o=>[String(o.id),o])).values()];
  const lineasOperacion = todasOperaciones.length ? await prisma.inventory_operation_lines.findMany({ where: { operacion_id: { in: todasOperaciones.map(o=>o.id) } } }) : [];
  const serializarCaso = (c: typeof casos[number]) => ({ ...c, id: Number(c.id), negocio_id: undefined, cierre_id: Number(c.cierre_id), semana_id: Number(c.semana_id), product_id: Number(c.product_id), producto: productos.find(p => p.id === c.product_id)?.name ?? 'Producto', unidad: productos.find(p => p.id === c.product_id)?.unidad_base, esperado: Number(c.esperado), contado: Number(c.contado), diferencia: Number(c.diferencia), costo_unitario: c.costo_unitario == null ? null : Number(c.costo_unitario), valor: c.costo_unitario == null ? null : q4(Math.abs(Number(c.diferencia)) * Number(c.costo_unitario)) });
  const casosSerializados=casos.map(serializarCaso);
  const casosRecientes=(await prisma.inventory_variance_cases.findMany({where:{negocio_id:negocioId,cierre_id:{in:cierres.slice(0,4).map(c=>c.id)}}})).map(serializarCaso);
  const recientes = new Set(cierres.slice(0, 4).map(c => c.id.toString()));
  const patrones = new Map<string, { producto: string; semanas: Set<number>; cantidad: number; valor: number; signo: string; causa: string; unidad: string | null | undefined }>();
  for (const c of casosRecientes.filter(c => c.origen === 'semanal' && recientes.has(String(c.cierre_id)) && c.diferencia !== 0 && !['error_conteo','error_presentacion','compra_omitida','venta_omitida','receta'].includes(c.causa))) {
    const signo = c.diferencia < 0 ? 'faltante' : 'sobrante'; const key = `${c.product_id}:${signo}:${c.causa}`;
    const p = patrones.get(key) ?? { producto: c.producto, semanas: new Set(), cantidad: 0, valor: 0, signo, causa: c.causa, unidad: c.unidad };
    p.semanas.add(c.semana_id); p.cantidad += Math.abs(c.diferencia); p.valor += c.valor ?? 0; patrones.set(key, p);
  }
  const semanasRecientes=new Set(cierres.slice(0,4).map(c=>String(c.semana_id)));
  for(const o of operacionesParaAlertas.filter(o=>['merma','cortesia','consumo_interno'].includes(o.tipo)&&semanasRecientes.has(String(o.semana_id)))) for(const l of lineasOperacion.filter(l=>l.operacion_id===o.id&&Number(l.cantidad)<0)) {
    const prod=productos.find(p=>p.id===l.product_id); const key=`${l.product_id}:faltante:${o.tipo}`;
    const p=patrones.get(key)??{producto:prod?.name??'Producto',semanas:new Set<number>(),cantidad:0,valor:0,signo:'faltante',causa:o.tipo,unidad:prod?.unidad_base};p.semanas.add(Number(o.semana_id));p.cantidad+=Math.abs(Number(l.cantidad));p.valor+=Number(l.costo_total??0);patrones.set(key,p);
  }
  const ventasTardias = await Promise.all(cierres.map(async c=>({semana_id:Number(c.semana_id),ventas:await prisma.epos_ventas.count({where:{negocio_id:negocioId,fecha:{lte:c.corte_at,gte:new Date(`${(await prisma.semanas.findUniqueOrThrow({where:{id:c.semana_id}})).fecha_inicio.toISOString().slice(0,10)}T00:00:00-06:00`)},creado_at:{gt:c.creado_at}}})})));
  const alertas = [...patrones.values()].filter(p => p.semanas.size >= 2).map(p => ({ ...p, semanas: [...p.semanas], cantidad: q4(p.cantidad), valor: q4(p.valor), mensaje: `${p.producto}: ${p.signo} en ${p.semanas.size} cierres distintos de los últimos cuatro. Causa: ${p.causa}.` }));
  return { ventas_tardias:ventasTardias.filter(v=>v.ventas>0), casos: casosSerializados, alertas, cierres: cierres.map(c => ({ id: Number(c.id), semana_id: Number(c.semana_id), corte_at: c.corte_at, snapshot_id: Number(c.snapshot_id) })), operaciones: operaciones.map(o => ({ id: Number(o.id), tipo: o.tipo, efectiva_at: o.efectiva_at, motivo: o.motivo, responsable: o.responsable, clasificacion_epos: !!o.epos_venta_id, pendiente_costo: lineasOperacion.some(l=>l.operacion_id===o.id && (Number(l.pendiente_cantidad)>0 || l.costo_estimado)) })), criterio_alerta: 'Aviso de repetición en al menos dos de los últimos cuatro cierres; no es tolerancia de merma ni prueba de causa.' };
}
