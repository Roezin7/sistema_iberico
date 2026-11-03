import { etiquetaCanonica } from '../finanzas/weeks.js';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { cargarLibroFisico, proyectarProducto, efectivaLote, ordenLote, diaDb, q4, type DbInventario } from './libro-fisico.js';
import { conciliarCapas } from './conciliacion-capas.js';
import { filtroConsumoFifoActivo } from './fuentes.js';
import type { AnclaZona } from './cronologia.js';

/** Todas las mutaciones del libro comparten el mismo lock, antes de los locks
 * de filas. Evita calcular un cierre sobre compras/ventas que cambian a mitad. */
export async function bloquearLibro(db: Prisma.TransactionClient, negocioId: bigint) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`iberico-inventario-${negocioId}`}, 0))`;
}

export async function exigirPeriodoMutable(db: DbInventario, negocioId: bigint, instante: Date) {
  if (instante.getTime() > Date.now() + 60_000) throw new HttpError(400, 'La hora efectiva no puede ser futura');
  const cerrado = await db.inventory_control_closures.findFirst({ where: { negocio_id: negocioId, corte_at: { gte: instante } } });
  if (cerrado) throw new HttpError(409, 'Ese momento ya está conciliado. Conserva el cierre y registra una corrección actual con evidencia; no reescribas el historial.');
}

export async function prepararControlCierre(db: DbInventario, negocioId: bigint, semanaId: bigint, corteConfirmado?: Date) {
  const ciclo = await db.inventario_semanal.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } });
  const semana = await db.semanas.findFirst({ where: { negocio_id: negocioId, id: semanaId } });
  if (!semana) throw new HttpError(404,'Semana no encontrada');
  if (!ciclo?.apertura_snapshot_id) throw new HttpError(409,'Falta guardar la apertura física de esta semana');
  if (!ciclo.cierre_snapshot_id) throw new HttpError(409,'Apertura lista. Falta guardar el conteo físico de cierre de esta semana.');
  const snapshots = await db.inventory_snapshot.findMany({ where: { negocio_id: negocioId, id: { in: [ciclo.apertura_snapshot_id, ciclo.cierre_snapshot_id] } }, include: { inventory_lines: true } });
  const apertura = snapshots.find(s => s.id === ciclo.apertura_snapshot_id)!;
  const cierre = snapshots.find(s => s.id === ciclo.cierre_snapshot_id)!;
  if (!apertura || !cierre) throw new HttpError(409, 'Conteo del negocio no encontrado');
  const zonas = await db.zonas_inventario.findMany({ where: { negocio_id: negocioId } });
  const faltantes = zonas.filter(z => !cierre.inventory_lines.some(l => l.zona_id === z.id));
  if (faltantes.length) throw new HttpError(409, `Falta contar la zona: ${faltantes.map(z => z.nombre).join(', ')}`);
  const fin = new Date(`${ciclo ? semana.fecha_fin.toISOString().slice(0, 10) : ''}T00:00:00-06:00`); fin.setUTCDate(fin.getUTCDate() + 1);
  const maxConteo = Math.max(...cierre.inventory_lines.map(l => (l.contado_at ?? cierre.created_at).getTime()));
  const corte = corteConfirmado ?? new Date(Math.max(Math.min(fin.getTime(), Date.now()), maxConteo));
  if (corte.getTime() < maxConteo || corte.getTime() > Date.now() || corte.getTime() > Math.max(fin.getTime(),maxConteo)) throw new HttpError(409, 'El corte cambió o es inválido; vuelve a revisar');
  if (maxConteo > Date.now()) throw new HttpError(409, 'El conteo tiene una hora futura');
  // Una corrección cargada el martes para el cierre de la semana anterior
  // no convierte el martes en apertura ni omite las compras del lunes/martes.
  // Sin hora observada se declara un límite legado, nunca una hora inventada.
  const limiteLegado = new Date(new Date(`${semana.fecha_inicio.toISOString().slice(0,10)}T00:00:00-06:00`).getTime()-1);
  const horaApertura = (l: { contado_at: Date | null }) => l.contado_at ?? (apertura.semana_id !== semanaId ? limiteLegado : apertura.created_at);
  const inicio = new Date(Math.min(...apertura.inventory_lines.map(l => horaApertura(l).getTime())));
  if (!Number.isFinite(inicio.getTime()) || inicio > corte) throw new HttpError(409, 'La hora de apertura es posterior al cierre');
  const libro = await cargarLibroFisico(db, negocioId, corte, inicio);
  if (apertura.semana_id !== semanaId && apertura.inventory_lines.some(l=>!l.contado_at)) libro.errores.push({ referencia: `snapshot:${apertura.id}`, mensaje: 'Apertura legada sin hora observada: se usa el límite del periodo anterior, no la fecha de carga de su corrección. Revisión histórica provisional.' });
  const productos = await db.products.findMany({ where: { negocio_id: negocioId, active: true }, orderBy: { name: 'asc' } });
  const noContados = productos.flatMap(p => zonas.filter(z => !cierre.inventory_lines.some(l => l.product_id === p.id && l.zona_id === z.id)).map(z => `${p.name} / ${z.nombre}`));
  if (noContados.length) throw new HttpError(409, `Faltan ${noContados.length} cantidades explícitas de cierre (no contado no es cero): ${noContados.slice(0, 5).join(', ')}`);
  const consumos = await db.inventory_consumptions.findMany({ where: { negocio_id: negocioId, ...filtroConsumoFifoActivo({ incluirAjustes: true }) }, include: { epos_venta: { select: { fecha: true } } } });
  const instante = (c: typeof consumos[number]) => c.epos_venta?.fecha ?? c.efectiva_at ?? new Date(`${c.fecha.toISOString().slice(0, 10)}T00:00:00-06:00`);
  const porLote = new Map<string, { antes: number; despues: number; filasPosteriores: typeof consumos }>();
  for (const c of consumos) {
    const k = c.lote_id.toString(); const sum = porLote.get(k) ?? { antes: 0, despues: 0, filasPosteriores: [] };
    if (instante(c) <= corte) sum.antes += Number(c.cantidad); else { sum.despues += Number(c.cantidad); sum.filasPosteriores.push(c); }
    porLote.set(k, sum);
  }
  const anclas = (snapshot: typeof apertura, pid: bigint): AnclaZona[] => zonas.map(z => ({ zonaId: Number(z.id), nombre: z.nombre,
    corte: snapshot === apertura ? horaApertura(snapshot.inventory_lines.find(l=>l.zona_id===z.id) ?? { contado_at:null }) : snapshot.inventory_lines.find(l => l.zona_id === z.id)?.contado_at ?? snapshot.created_at,
    cantidad: snapshot.inventory_lines.filter(l => l.product_id === pid && l.zona_id === z.id).reduce((s, l) => s + Number(l.qty_captura) * Number(l.factor), 0),
  }));
  const filas = productos.map(p => {
    const inicial = anclas(apertura, p.id);
    const final = anclas(cierre, p.id);
    const esperado = proyectarProducto(inicial, libro.eventos, p.id, corte, new Set([apertura.id]));
    const contado = proyectarProducto(final, libro.eventos, p.id, corte, new Set([cierre.id]));
    const local = inicial.find(z => z.nombre.trim().toLowerCase() === 'local');
    const eventosPeriodo = libro.eventos.filter(e => e.product_id === p.id && (!e.incluido_snapshot_id || e.incluido_snapshot_id !== apertura.id) && e.fecha <= corte && (e.tipo === 'venta' ? !local?.corte || e.fecha > local.corte : e.tipo === 'entrada' || e.tipo === 'salida' ? !inicial.find(z => z.zonaId === e.zonaId)?.corte || e.fecha > inicial.find(z => z.zonaId === e.zonaId)!.corte! : false));
    const compras = eventosPeriodo.filter(e => e.tipo === 'entrada' && e.referencia.startsWith('lote:') && libro.lotes.find(l => `lote:${l.id}` === e.referencia)?.purchase_id).reduce((s, e) => s + e.cantidad, 0);
    const ventasTeoricas = eventosPeriodo.filter(e => e.tipo === 'venta').reduce((s, e) => s + e.cantidad, 0);
    const fifoVentas = consumos.filter(c => c.product_id === p.id && c.epos_venta_id != null && instante(c) <= corte && (!local?.corte || instante(c) > local.corte)).reduce((s, c) => s + Number(c.cantidad), 0);
    const lotesTodos = libro.lotes.filter(l => l.product_id === p.id && efectivaLote(l) <= corte);
    const lotes = lotesTodos.filter(l => l.fuente !== 'historico_prueba');
    const capas = lotes.map(l => ({ id: l.id, cantidad: q4(Number(l.cantidad_inicial) - (porLote.get(l.id.toString())?.antes ?? 0)), reservado: q4(porLote.get(l.id.toString())?.despues ?? 0), costo: Number(l.costo_unitario), orden: ordenLote(l) })).filter(c => c.cantidad > 0.0001 || c.reservado > 0);
    let plan: ReturnType<typeof conciliarCapas>;
    try { plan = conciliarCapas(capas, contado.total); } catch (e) { throw new HttpError(409, `${p.name}: ${(e as Error).message}`); }
    const costoCatalogo = p.unit_cost == null ? null : Number(p.unit_cost) / (p.unidad_base === 'pieza' ? 1 : Number(p.contenido_compra) || 1);
    const aperturaCorte = new Date(Math.max(...inicial.map(a => a.corte!.getTime())));
    const fisicoApertura = proyectarProducto(inicial, libro.eventos, p.id, aperturaCorte, new Set([apertura.id])).total;
    const fifoApertura = lotes.filter(l => efectivaLote(l) <= aperturaCorte).reduce((sum, l) => sum + Number(l.cantidad_inicial) - consumos.filter(c => c.lote_id === l.id && instante(c) <= aperturaCorte).reduce((v, c) => v + Number(c.cantidad), 0), 0);
    const arrastre = q4(fisicoApertura - fifoApertura);
    const diferencia = q4(contado.total - esperado.total);
    let omitir = Math.max(0, -arrastre), pendienteValorar = Math.max(0, -diferencia), valorDiferencia = 0;
    for (const c of plan.detalle) {
      const saltar = Math.min(omitir, c.ajuste); omitir -= saltar;
      const tomar = Math.min(pendienteValorar, c.ajuste - saltar);
      valorDiferencia += tomar * c.costo; pendienteValorar -= tomar;
    }
    const costo = plan.saldo > 0 ? capas.reduce((s, c) => s + c.cantidad * c.costo, 0) / plan.saldo : costoCatalogo;
    return { product_id: Number(p.id), producto: p.name, unidad: p.unidad_base, apertura: q4(inicial.reduce((s, a) => s + a.cantidad, 0)), entradas: q4(esperado.entradas), compras: q4(compras), consumo_ventas: q4(ventasTeoricas), consumo_fifo: q4(fifoVentas), salidas_operativas: q4(esperado.consumos - ventasTeoricas), consumos: q4(esperado.consumos), esperado: q4(esperado.total), contado: q4(contado.total), diferencia: q4(contado.total - esperado.total), no_cubierto: q4(esperado.noCubierto),
      formato_fijo: p.presentacion_modo === 'exacta' && Number(p.contenido_compra)>0 ? { contenido:Number(p.contenido_compra),unidad:p.unidad_base } : null, fifo_apertura: q4(fifoApertura), fisico_apertura: q4(fisicoApertura), fifo_al_corte: plan.saldo, arrastre_previo: arrastre,
      costo_diferencia: diferencia < 0 && pendienteValorar < 0.0001 ? valorDiferencia / Math.abs(diferencia) : costo,
      diferencia_estimada: diferencia > 0 || pendienteValorar > 0.0001 || Math.abs(arrastre) > 0.0001 || esperado.noCubierto > 0,
      costo_unitario: costo, costo_estimado: plan.sobrante > 0 || capas.some(c => libro.lotes.find(l => l.id === c.id)?.costo_estimado),
      zonas: final.map(a => ({ zona_id: a.zonaId, cantidad: q4(contado.saldos.get(a.zonaId) ?? 0) })), plan,
    };
  });
  return { semana, ciclo, apertura, cierre, libro, corte, filas, porLote };
}

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x));
const revisionControl = (p: Awaited<ReturnType<typeof prepararControlCierre>>) => crypto.createHash('sha256').update(JSON.stringify(jsonSafe({ snapshot_id:p.cierre.id,corte:p.corte,filas:p.filas,advertencias:p.libro.errores }))).digest('hex');

export async function faltantesCierre(db: DbInventario, negocioId: bigint, semanaId: bigint) {
  const ciclo = await db.inventario_semanal.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } });
  if (!ciclo?.cierre_snapshot_id) return null;
  const [snapshot, productos, zonas] = await Promise.all([
    db.inventory_snapshot.findFirstOrThrow({ where: { negocio_id: negocioId, id: ciclo.cierre_snapshot_id }, include: { inventory_lines:true } }),
    db.products.findMany({ where: { negocio_id: negocioId, active:true }, orderBy:{ name:'asc' } }),
    db.zonas_inventario.findMany({ where: { negocio_id: negocioId } }),
  ]);
  const faltantes = productos.flatMap(p=>zonas.filter(z=>!snapshot.inventory_lines.some(l=>l.product_id===p.id&&l.zona_id===z.id)).map(z=>({ product_id:Number(p.id), producto:p.name, zona_id:Number(z.id), zona:z.nombre, unidad:p.unidad_base ?? 'pieza' })));
  return { snapshot, faltantes };
}

export async function completarCierre(negocioId: bigint, usuarioId: bigint, semanaId: bigint, snapshotId: bigint, lineas: { product_id:number;zona_id:number;cantidad_base:number }[]) {
  return prisma.$transaction(async tx=>{
    await bloquearLibro(tx, negocioId);
    if(await tx.inventory_control_closures.findFirst({where:{negocio_id:negocioId,semana_id:semanaId}})) throw new HttpError(409,'El cierre ya está conciliado');
    const p=await faltantesCierre(tx,negocioId,semanaId);
    if(!p || p.snapshot.id!==snapshotId) throw new HttpError(409,'El conteo cambió; vuelve a revisarlo');
    const claves=new Set<string>();
    for(const l of lineas){const k=`${l.product_id}:${l.zona_id}`;if(claves.has(k)||!Number.isFinite(l.cantidad_base)||l.cantidad_base<0||!p.faltantes.some(f=>f.product_id===l.product_id&&f.zona_id===l.zona_id))throw new HttpError(400,'Sólo se pueden completar cantidades faltantes explícitas, sin reemplazar conteos existentes');claves.add(k);}
    const nuevo=await tx.inventory_snapshot.create({data:{negocio_id:negocioId,semana_id:semanaId,tipo:'cierre',motivo:'Completar cantidades omitidas del mismo conteo',nota:`Continúa snapshot ${snapshotId}; cantidades explícitas del usuario, sin asumir ceros. Conserva las horas originales.`}});
    await tx.inventory_lines.createMany({data:[...p.snapshot.inventory_lines.map(l=>({snapshot_id:nuevo.id,product_id:l.product_id,zona_id:l.zona_id,qty_captura:l.qty_captura,factor:l.factor,contado_at:l.contado_at??p.snapshot.created_at})),...lineas.map(l=>({snapshot_id:nuevo.id,product_id:BigInt(l.product_id),zona_id:BigInt(l.zona_id),qty_captura:l.cantidad_base,factor:1,contado_at:p.snapshot.inventory_lines.find(x=>x.zona_id===BigInt(l.zona_id))?.contado_at??p.snapshot.inventory_lines.find(x=>x.contado_at!=null)?.contado_at??p.snapshot.created_at}))]});
    await tx.inventario_semanal.updateMany({where:{negocio_id:negocioId,semana_id:semanaId,cierre_snapshot_id:snapshotId},data:{cierre_snapshot_id:nuevo.id,cierre_valor:null}});
    await tx.auditoria_eventos.create({data:{negocio_id:negocioId,usuario_id:usuarioId,entidad:'snapshot_inventario',entidad_id:String(nuevo.id),accion:'completar_omitidos',antes:JSON.stringify({snapshot_id:String(snapshotId)}),despues:JSON.stringify({lineas}),metadata:JSON.stringify({sin_supuesto_cero:true,sin_movimiento_dinero:true,horas_originales:true})}});
    return {snapshot_id:Number(nuevo.id)};
  },{timeout:30000});
}

export async function vistaPreviaControl(negocioId: bigint, semanaId: bigint) {
  const existente = await prisma.inventory_control_closures.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } });
  if (existente) return { confirmada: true, cierre_id: Number(existente.id), corte_at: existente.corte_at.toISOString(), ...existente.resumen as object };
  const incompleto=await faltantesCierre(prisma,negocioId,semanaId);
  if(incompleto?.faltantes.length) return {confirmada:false,pendiente_conteo:true,snapshot_id:Number(incompleto.snapshot.id),corte_at:incompleto.snapshot.created_at.toISOString(),faltantes:incompleto.faltantes,filas:[],advertencias:[]};
  const p = await prepararControlCierre(prisma, negocioId, semanaId);
  return { confirmada: false, revision:revisionControl(p), corte_at: p.corte.toISOString(), snapshot_id: Number(p.cierre.id), advertencias: p.libro.errores, filas: p.filas.map(({ plan, ...f }) => f), requiere_confirmacion: true };
}

export async function confirmarControlCierre(negocioId: bigint, usuarioId: bigint, semanaId: bigint, snapshotId: bigint, solicitud: string, revision?: { corte_at:string; hash:string }) {
  return prisma.$transaction(async tx => {
    await bloquearLibro(tx, negocioId);
    const repetida = await tx.inventory_control_closures.findFirst({ where: { negocio_id: negocioId, semana_id: semanaId } });
    if (repetida) {
      if (repetida.snapshot_id !== snapshotId) throw new HttpError(409, 'El cierre ya está conciliado con otro conteo; usa una corrección documentada');
      return { cierre_id: Number(repetida.id), repetida: true, ...repetida.resumen as object };
    }
    const p = await prepararControlCierre(tx, negocioId, semanaId, revision ? new Date(revision.corte_at) : undefined);
    if(revision && revisionControl(p)!==revision.hash) throw new HttpError(409, 'Las cantidades o costos cambiaron desde la revisión; actualiza antes de confirmar');
    if (p.cierre.id !== snapshotId) throw new HttpError(409, 'El conteo cambió: revisa nuevamente antes de confirmar');
    const resumen = { valor_fifo: q4(p.filas.reduce((s,f)=>s+f.plan.detalle.reduce((n,c)=>n+c.conservar*c.costo,0)+f.plan.sobrante*(f.costo_unitario??0),0)), valor_estimado: p.filas.some(f=>f.costo_estimado), snapshot_id: Number(p.cierre.id), corte_at: p.corte.toISOString(), advertencias: p.libro.errores, filas: p.filas.map(({ plan, ...f }) => f) };
    const control = await tx.inventory_control_closures.create({ data: { negocio_id: negocioId, semana_id: semanaId, snapshot_id: snapshotId, apertura_snapshot_id: p.apertura.id, corte_at: p.corte, usuario_id: usuarioId, solicitud_id: solicitud, resumen: jsonSafe(resumen) } });
    const casos: Prisma.inventory_variance_casesCreateManyInput[] = [];
    const consumos: Prisma.inventory_consumptionsCreateManyInput[] = [];
    const nuevos: Prisma.inventory_lotsCreateManyInput[] = [];
    const idsAgotados: bigint[] = [];
    for (const f of p.filas) {
      for (const [origen, esperado, contado, diferencia] of [ ['semanal', f.esperado, f.contado, f.diferencia], ['arrastre_previo', f.fifo_apertura, f.fisico_apertura, f.arrastre_previo] ] as const) {
        if (Math.abs(diferencia) > 0.0001 || (origen === 'semanal' && f.no_cubierto > 0)) casos.push({ negocio_id: negocioId, cierre_id: control.id, semana_id: semanaId, product_id: BigInt(f.product_id), origen, esperado, contado, diferencia, costo_unitario: origen === 'semanal' ? f.costo_diferencia : f.costo_unitario, costo_estimado: f.costo_estimado || (origen === 'semanal' ? f.diferencia_estimada : true), nota: f.no_cubierto ? `${f.no_cubierto} de consumo sin saldo suficiente en su momento; revisar cronología` : null });
      }
      for (const capa of f.plan.detalle) {
        const l = p.libro.lotes.find(l => l.id === capa.id)!;
        idsAgotados.push(l.id);
        if (capa.ajuste > 0) consumos.push({ negocio_id: negocioId, product_id: l.product_id, lote_id: l.id, cantidad: capa.ajuste, costo_unitario: l.costo_unitario, costo_total: capa.ajuste * Number(l.costo_unitario), fecha: diaDb(p.corte), efectiva_at: p.corte, fuente: 'conciliacion_faltante' });
        if (capa.conservar > 0) {
          consumos.push({ negocio_id: negocioId, product_id: l.product_id, lote_id: l.id, cantidad: capa.conservar, costo_unitario: l.costo_unitario, costo_total: capa.conservar * Number(l.costo_unitario), fecha: diaDb(p.corte), efectiva_at: p.corte, fuente: 'traspaso_cierre' });
          nuevos.push({ negocio_id: negocioId, product_id: l.product_id, zona_id: l.zona_id, recibido_at: l.recibido_at, disponible_desde: p.corte, orden_fifo_at: ordenLote(l), cantidad_inicial: capa.conservar, cantidad_restante: q4(capa.conservar - capa.reservado), costo_unitario: l.costo_unitario, costo_estimado: l.costo_estimado, contenido_presentacion: l.contenido_presentacion ?? f.formato_fijo?.contenido, unidad_presentacion: l.unidad_presentacion ?? f.formato_fijo?.unidad, lote_origen_id: l.id, cierre_control_id: control.id, fuente: 'apertura_conciliada', ticket_ref: `CIERRE-${control.id}`, estado: capa.conservar - capa.reservado <= 0.0001 ? 'agotado' : 'abierto', notas: 'Capa conservada, no es compra. Ubicación heredada; el conteo por zona es la referencia física.' });
        }
      }
      if (f.plan.sobrante > 0) nuevos.push({ negocio_id: negocioId, product_id: BigInt(f.product_id), recibido_at: diaDb(p.corte), disponible_desde: p.corte, orden_fifo_at: p.corte, cantidad_inicial: f.plan.sobrante, cantidad_restante: f.plan.sobrante, costo_unitario: f.costo_unitario ?? 0, costo_estimado: true, contenido_presentacion:f.formato_fijo?.contenido,unidad_presentacion:f.formato_fijo?.unidad,cierre_control_id: control.id, fuente: 'apertura_conciliada', ticket_ref: `CIERRE-${control.id}`, notas: f.costo_unitario == null ? 'Sobrante físico confirmado; costo desconocido, no costo cero confirmado' : 'Sobrante físico confirmado; costo estimado de referencia, pendiente de evidencia' });
    }
    if (casos.length) await tx.inventory_variance_cases.createMany({ data: casos });
    if (consumos.length) await tx.inventory_consumptions.createMany({ data: consumos });
    if (idsAgotados.length) await tx.inventory_lots.updateMany({ where: { negocio_id: negocioId, id: { in: idsAgotados } }, data: { cantidad_restante: 0, estado: 'agotado' } });
    const hijos = nuevos.length ? await tx.inventory_lots.createManyAndReturn({ data: nuevos }) : [];
    // Relocalizar asignaciones posteriores conserva cantidades/costos/ventas;
    // el origen queda explícito y se registra antes/después en bitácora.
    for (const hijo of hijos.filter(h => h.lote_origen_id != null)) {
      const filas = p.porLote.get(hijo.lote_origen_id!.toString())?.filasPosteriores ?? [];
      if (filas.length) {
        await tx.inventory_consumptions.updateMany({ where: { negocio_id: negocioId, id: { in: filas.map(c => c.id) }, lote_original_id: null }, data: { lote_original_id: hijo.lote_origen_id } });
        await tx.inventory_consumptions.updateMany({ where: { negocio_id: negocioId, id: { in: filas.map(c => c.id) } }, data: { lote_id: hijo.id } });
      }
    }
    const siguienteInicio = new Date(p.semana.fecha_fin); siguienteInicio.setUTCDate(siguienteInicio.getUTCDate() + 1);
    const siguienteFin = new Date(siguienteInicio); siguienteFin.setUTCDate(siguienteFin.getUTCDate() + 6);
    let siguiente = await tx.semanas.findFirst({ where: { negocio_id: negocioId, fecha_inicio: siguienteInicio } });
    if (!siguiente) siguiente = await tx.semanas.create({ data: { negocio_id: negocioId, fecha_inicio: siguienteInicio, fecha_fin: siguienteFin, etiqueta: etiquetaCanonica(siguienteInicio,siguienteFin) } });
    const cicloSiguiente = await tx.inventario_semanal.findUnique({ where: { semana_id: siguiente.id } });
    if (cicloSiguiente?.apertura_snapshot_id && cicloSiguiente.apertura_snapshot_id !== snapshotId) throw new HttpError(409, 'La siguiente semana ya tiene otra apertura: revisa la cadena antes de reemplazarla');
    const aperturaNueva = await tx.inventory_snapshot.create({ data: { negocio_id: negocioId, semana_id: siguiente.id, tipo: 'apertura_conciliada', motivo: `Continuidad desde conteo ${snapshotId}; movimientos hasta ${p.corte.toISOString()}`, nota: 'Saldo derivado del físico confirmado y movimientos posteriores; no es un nuevo conteo observado.' } });
    await tx.inventory_lines.createMany({ data: p.filas.flatMap(f => f.zonas.map(z => ({ snapshot_id: aperturaNueva.id, product_id: BigInt(f.product_id), zona_id: BigInt(z.zona_id), qty_captura: z.cantidad, factor: 1, contado_at: p.corte }))) });
    const valor = hijos.reduce((s, h) => s + Number(h.cantidad_inicial) * Number(h.costo_unitario), 0);
    await tx.inventario_semanal.upsert({ where: { semana_id: siguiente.id }, create: { negocio_id: negocioId, semana_id: siguiente.id, apertura_snapshot_id: aperturaNueva.id, apertura_valor: valor, apertura_origen: 'cierre_conciliado_con_costos_conservados' }, update: { apertura_snapshot_id: aperturaNueva.id, apertura_valor: valor, apertura_origen: 'cierre_conciliado_con_costos_conservados' } });
    await tx.inventory_control_closures.update({ where: { id: control.id }, data: { siguiente_snapshot_id: aperturaNueva.id } });
    await tx.auditoria_eventos.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, entidad: 'cierre_inventario', entidad_id: String(control.id), accion: 'conciliar_y_continuar', despues: JSON.stringify({ ...resumen, siguiente_semana_id: Number(siguiente.id), apertura_snapshot_id: Number(aperturaNueva.id), capas_nuevas: hijos.length, incidencias: casos.length, consumos_relocalizados: [...p.porLote.values()].flatMap(c => c.filasPosteriores).map(c => ({ id: String(c.id), lote: String(c.lote_id), cantidad: String(c.cantidad), costo: String(c.costo_total) })) }), metadata: JSON.stringify({ sin_egreso: true, cierre_financiero_sin_cambio: true }) } });
    return { cierre_id: Number(control.id), repetida: false, siguiente_semana_id: Number(siguiente.id), apertura_snapshot_id: Number(aperturaNueva.id), incidencias: casos.length, ...resumen };
  }, { timeout: 90000, maxWait: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
