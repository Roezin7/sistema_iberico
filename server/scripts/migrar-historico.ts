/**
 * Migración de datos históricos (Excel "LAD - Modelo financiero - IBERICO v8",
 * julio 2025 → mayo 2026) al módulo de Finanzas.
 *
 * Qué crea, por cada semana del JSON (scripts/datos-historicos.json):
 *   - `semanas` (estado cerrada, cerrada_at = fecha_fin)
 *   - `movimientos` diarios: venta_efectivo→Caja, venta_tarjeta/propina_tarjeta→Banco,
 *     gasto efectivo (origen Caja, categoría "Histórico"), gasto con tarjeta y
 *     compra_inventario (origen Banco, facturado), sueldo (origen Caja),
 *     deposito (préstamos, destino Banco), y transferencias de ajuste.
 *   - comision_terminal 1.99% sobre (tarjeta + propinas), igual que el cierre real.
 *   - `arqueos` de Caja y Banco con el saldo REAL del Excel (fecha_fin).
 *   - `cierres_semana` para todas las ubicaciones activas (saldo_final = real ?? teórico),
 *     encadenando semana a semana igual que cerrarSemana().
 *
 * El Excel no rastrea la caja fuerte ni los retiros día a día: entre semanas el
 * saldo inicial no coincide con el real anterior. Esas diferencias se migran como
 * transferencias hacia/desde la ubicación "Caja Fuerte Histórico" (se crea sola);
 * si el faltante de Caja coincide con el sobrante de Banco se detecta como
 * depósito Caja→Banco directo. Al final, el saldo de "Caja Fuerte Histórico"
 * representa caja fuerte + retiros acumulados no desglosados.
 *
 * SEMANA PUENTE — el histórico termina antes de que arrancara el registro en la app,
 * y sus saldos finales no empatan con los saldos iniciales que ya congeló la primera
 * semana real. Como `mapaSaldoInicial()` recalcula al vuelo el saldo inicial de una
 * semana a partir del cierre de la anterior, insertar el histórico "por debajo" movería
 * los números de esa primera semana real. Para evitarlo, el script cierra el hueco con
 * una semana puente que aterriza EXACTAMENTE en los saldos ya congelados:
 *   - transferencias contra "Caja Fuerte Histórico" para ajustar cada ubicación,
 *   - el remanente sale como retiro_socio repartido entre los socios (vía su caja fuerte),
 *   - arqueos por ubicación con el saldo objetivo (descuadre 0).
 * Así la primera semana real conserva sus cifras al centavo.
 *
 * NO crea snapshots_patrimonio (no hay valor de inventario histórico).
 *
 * Uso (desde server/):
 *   npx tsx scripts/migrar-historico.ts --validar    # solo valida el JSON, sin DB
 *   npx tsx scripts/migrar-historico.ts --dry-run    # lee DB, muestra qué haría
 *   npx tsx scripts/migrar-historico.ts              # migra (aborta si ya hay semanas)
 *   npx tsx scripts/migrar-historico.ts --force      # migra aunque existan semanas (las repetidas se saltan)
 *   npx tsx scripts/migrar-historico.ts --sin-puente # no genera la semana puente
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMISION_RATE = 0.0199;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** 'YYYY-MM-DD' → Date UTC a medianoche (las columnas de fecha son @db.Date). */
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const isoD = (d: Date) => d.toISOString().slice(0, 10);
const masDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

interface Dia {
  f: string;
  ve?: number; // venta efectivo → Caja
  vt?: number; // venta tarjeta → Banco
  pt?: number; // propina tarjeta → Banco
  ge?: number; // gasto efectivo (origen Caja)
  gt?: number; // gasto con tarjeta (origen Banco, facturado)
  su?: number; // sueldos (origen Caja)
  inv?: number; // compra inventario (origen Banco, facturado)
  dep?: number; // depósito recibido en Banco (préstamo)
  ret?: number; // retiro / a caja fuerte (origen Caja)
}
interface SemanaJson {
  etiqueta: string;
  inicio: string;
  fin: string;
  inicial: { caja: number; banco: number };
  real: { caja: number; banco: number };
  notas?: string;
  dias: Dia[];
}
interface Datos {
  bootstrap: { caja: number; banco: number };
  semanas: SemanaJson[];
}

const __dir = dirname(fileURLToPath(import.meta.url));
const datos: Datos = JSON.parse(readFileSync(join(__dir, 'datos-historicos.json'), 'utf8'));

const argv = process.argv.slice(2);
const MODO_VALIDAR = argv.includes('--validar');
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const SIN_PUENTE = argv.includes('--sin-puente');

const fmt = (n: number) =>
  n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12);

// ---------------------------------------------------------------------------
// Totales y validación offline (sin DB): reproduce la aritmética del Excel.
// ---------------------------------------------------------------------------
function totalesSemana(s: SemanaJson) {
  const sum = (k: keyof Dia) => r2(s.dias.reduce((a, d) => a + (Number(d[k]) || 0), 0));
  const vt = sum('vt');
  const pt = sum('pt');
  return {
    ve: sum('ve'), vt, pt, ge: sum('ge'), gt: sum('gt'), su: sum('su'),
    inv: sum('inv'), dep: sum('dep'), ret: sum('ret'),
    comision: r2((vt + pt) * COMISION_RATE),
  };
}

function validar(): boolean {
  let ok = true;
  let prevFin = '';
  let ventasTot = 0;
  console.log('\nSemana                              Ventas    Desc.Caja   Desc.Banco   Ajuste vs semana previa');
  console.log('─'.repeat(110));
  let prevReal = { caja: datos.bootstrap.caja, banco: datos.bootstrap.banco };
  for (const s of datos.semanas) {
    if (s.inicio <= prevFin) { console.error(`✗ ${s.etiqueta}: inicio ${s.inicio} <= fin anterior ${prevFin}`); ok = false; }
    for (const d of s.dias) {
      if (d.f < s.inicio || d.f > s.fin) { console.error(`✗ ${s.etiqueta}: día ${d.f} fuera de rango`); ok = false; }
    }
    const t = totalesSemana(s);
    const teoCaja = r2(s.inicial.caja + t.ve - t.ge - t.su - t.ret);
    const teoBanco = r2(s.inicial.banco + t.vt + t.pt + t.dep - t.gt - t.inv - t.comision);
    const descCaja = r2(s.real.caja - teoCaja);
    const descBanco = r2(s.real.banco - teoBanco);
    const dCaja = r2(prevReal.caja - s.inicial.caja);
    const dBanco = r2(prevReal.banco - s.inicial.banco);
    const ajuste = dCaja === 0 && dBanco === 0 ? '—' : `caja ${dCaja > 0 ? '-' : '+'}${fmt(Math.abs(dCaja)).trim()} / banco ${dBanco > 0 ? '-' : '+'}${fmt(Math.abs(dBanco)).trim()}`;
    ventasTot += t.ve + t.vt + t.pt;
    console.log(`${s.etiqueta.padEnd(32)}${fmt(r2(t.ve + t.vt + t.pt))} ${fmt(descCaja)} ${fmt(descBanco)}   ${ajuste}`);
    prevReal = s.real;
    prevFin = s.fin;
  }
  console.log('─'.repeat(110));
  console.log(`${datos.semanas.length} semanas · ventas totales $${r2(ventasTot).toLocaleString('es-MX')}`);
  console.log('(Desc. = arqueo real del Excel − saldo teórico; equivale al "A favor/En contra" de la hoja.)');
  return ok;
}

// ---------------------------------------------------------------------------
// Migración
// ---------------------------------------------------------------------------
async function migrar() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    // --- Contexto: negocio, usuario admin, ubicaciones, categoría ----------
    const negocio =
      (await prisma.negocios.findFirst({ where: { nombre: 'Ibérico' } })) ??
      (await prisma.negocios.findFirst());
    if (!negocio) throw new Error('No hay negocio en la DB.');

    const admin = await prisma.usuarios.findFirst({
      where: { negocio_id: negocio.id, rol: 'admin', activo: true },
      orderBy: { id: 'asc' },
    });
    if (!admin) throw new Error('No hay usuario admin activo.');

    const caja = await prisma.ubicaciones_fondos.findFirst({
      where: { negocio_id: negocio.id, tipo: 'efectivo', nombre: 'Caja' },
    });
    const banco = await prisma.ubicaciones_fondos.findFirst({
      where: { negocio_id: negocio.id, tipo: 'banco' },
      orderBy: { id: 'asc' },
    });
    if (!caja || !banco) throw new Error('Faltan las ubicaciones "Caja" y/o "Banco". Corre el seed primero.');

    let cf = await prisma.ubicaciones_fondos.findFirst({
      where: { negocio_id: negocio.id, nombre: 'Caja Fuerte Histórico' },
    });
    if (!cf) {
      if (DRY_RUN) {
        console.log('· [dry-run] crearía ubicación "Caja Fuerte Histórico"');
        // Se simula con un id negativo para que el dry-run calcule los mismos saldos
        // que la corrida real (si no, los movimientos contra caja fuerte se perderían).
        cf = { id: -1n, negocio_id: negocio.id, nombre: 'Caja Fuerte Histórico', tipo: 'efectivo', socio_id: null, activo: true } as typeof cf;
      } else cf = await prisma.ubicaciones_fondos.create({
        data: { negocio_id: negocio.id, nombre: 'Caja Fuerte Histórico', tipo: 'efectivo' },
      });
    }

    let categoria = await prisma.categorias_gasto.findFirst({
      where: { negocio_id: negocio.id, nombre: 'Histórico' },
    });
    if (!categoria) {
      if (DRY_RUN) {
        console.log('· [dry-run] crearía categoría de gasto "Histórico"');
        categoria = { id: -1n, negocio_id: negocio.id, nombre: 'Histórico', activo: true };
      } else categoria = await prisma.categorias_gasto.create({
        data: { negocio_id: negocio.id, nombre: 'Histórico' },
      });
    }

    const socios = await prisma.socios.findMany({
      where: { negocio_id: negocio.id, activo: true },
      orderBy: { id: 'asc' },
    });

    console.log(`Negocio: ${negocio.nombre} (id ${negocio.id}) · usuario: ${admin.nombre} · Caja #${caja.id} · Banco #${banco.id}`);

    // --- Guard: semanas existentes ------------------------------------------
    const existentes = await prisma.semanas.findMany({
      where: { negocio_id: negocio.id },
      select: { fecha_inicio: true, etiqueta: true },
    });
    if (existentes.length > 0 && !FORCE && !DRY_RUN) {
      console.error(`\n✗ Ya existen ${existentes.length} semana(s) en la DB. La migración insertaría el histórico`);
      console.error('  ANTES de esas semanas y cambia el encadenado de saldos. Revisa y corre con --force');
      console.error('  (las semanas cuya fecha de inicio ya exista se saltan).');
      process.exit(1);
    }
    const fechasExistentes = new Set(existentes.map((s) => s.fecha_inicio.toISOString().slice(0, 10)));

    // --- Ubicaciones activas -------------------------------------------------
    const ubicaciones = await prisma.ubicaciones_fondos.findMany({
      where: { negocio_id: negocio.id, activo: true },
      orderBy: { id: 'asc' },
    });
    if (!ubicaciones.some((u) => u.id === cf!.id)) ubicaciones.push(cf); // recién creada (o simulada en dry-run)

    // --- Ancla: 1ª semana YA registrada en la app, posterior al histórico -----
    // Su saldo inicial está congelado en cierres_semana, pero la app lo recalcula al
    // vuelo desde el cierre de la semana anterior. La semana puente debe aterrizar
    // justo en esos valores para que sus cifras no se muevan.
    const finHistorico = D(datos.semanas[datos.semanas.length - 1]!.fin);
    const ancla = await prisma.semanas.findFirst({
      where: { negocio_id: negocio.id, fecha_inicio: { gt: finHistorico } },
      orderBy: { fecha_inicio: 'asc' },
      include: { cierres: true },
    });
    const objetivoPuente = new Map<bigint, number>();
    if (ancla) for (const c of ancla.cierres) objetivoPuente.set(c.ubicacion_id, Number(c.saldo_inicial));

    // --- saldos_iniciales (bootstrap del Excel, julio 2025) ------------------
    // El histórico pasa a ser el arranque real del negocio: Caja y Banco toman el
    // bootstrap del Excel y el resto (cajas fuertes) arranca en 0. Si la app ya había
    // fijado saldos iniciales se REESCRIBEN; el valor viejo no se pierde, la semana
    // puente lo restituye como saldo de cierre justo antes de la 1ª semana real.
    const bootstrapPorUbic = new Map<bigint, number>(
      ubicaciones.map((u) => [
        u.id,
        u.id === caja.id ? datos.bootstrap.caja : u.id === banco.id ? datos.bootstrap.banco : 0,
      ]),
    );
    for (const u of ubicaciones) {
      const monto = bootstrapPorUbic.get(u.id)!;
      const existente = u.id > 0n
        ? await prisma.saldos_iniciales.findUnique({ where: { ubicacion_id: u.id } })
        : null;
      if (existente && r2(Number(existente.monto)) === r2(monto)) continue;
      const desde = existente ? `$${r2(Number(existente.monto))} → ` : '';
      console.log(`· ${DRY_RUN ? '[dry-run] ' : ''}saldo inicial "${u.nombre}": ${desde}$${monto}`);
      if (DRY_RUN) continue;
      await prisma.saldos_iniciales.upsert({
        where: { ubicacion_id: u.id },
        update: { monto },
        create: { negocio_id: negocio.id, ubicacion_id: u.id, monto },
      });
    }

    // --- Estado corriente de saldos por ubicación (para cierres encadenados) --
    const running = new Map<bigint, number>(bootstrapPorUbic);

    type MovData = {
      negocio_id: bigint; semana_id: bigint; fecha: Date; tipo: string; monto: number;
      ubicacion_origen_id?: bigint | null; ubicacion_destino_id?: bigint | null;
      categoria_id?: bigint | null; socio_id?: bigint | null; facturado?: boolean;
      descripcion?: string; usuario_id: bigint;
    };

    let prevReal = { caja: datos.bootstrap.caja, banco: datos.bootstrap.banco };
    let creadas = 0, saltadas = 0, totalMovs = 0;

    console.log('\nSemana                               Movs    Desc.Caja   Desc.Banco');
    console.log('─'.repeat(72));

    for (const s of datos.semanas) {
      if (fechasExistentes.has(s.inicio)) {
        console.log(`${s.etiqueta.padEnd(34)} — ya existe, se salta`);
        // Aun saltándola, avanza el estado con los datos del Excel para no romper el encadenado del reporte.
        running.set(caja.id, s.real.caja);
        running.set(banco.id, s.real.banco);
        prevReal = s.real; saltadas++;
        continue;
      }

      const movs: Omit<MovData, 'semana_id'>[] = [];
      const base = { negocio_id: negocio.id, usuario_id: admin.id };
      const desc = 'Migración histórica (Excel)';

      // 1) Ajuste vs semana anterior: el Excel movió dinero fuera del rastreo
      //    (caja fuerte, retiros, depósitos). Se refleja al inicio de la semana.
      let dCaja = r2(prevReal.caja - s.inicial.caja);   // >0: salió de Caja
      let dBanco = r2(prevReal.banco - s.inicial.banco); // >0: salió de Banco
      if (dCaja > 0 && dBanco < 0) {
        const cruce = Math.min(dCaja, -dBanco);
        movs.push({ ...base, fecha: D(s.inicio), tipo: 'deposito', monto: cruce, ubicacion_origen_id: caja.id, ubicacion_destino_id: banco.id, descripcion: `${desc}: depósito de efectivo al banco` });
        dCaja = r2(dCaja - cruce); dBanco = r2(dBanco + cruce);
      } else if (dCaja < 0 && dBanco > 0) {
        const cruce = Math.min(-dCaja, dBanco);
        movs.push({ ...base, fecha: D(s.inicio), tipo: 'transferencia', monto: cruce, ubicacion_origen_id: banco.id, ubicacion_destino_id: caja.id, descripcion: `${desc}: retiro del banco a caja` });
        dCaja = r2(dCaja + cruce); dBanco = r2(dBanco - cruce);
      }
      if (cf) {
        if (dCaja > 0) movs.push({ ...base, fecha: D(s.inicio), tipo: 'transferencia', monto: dCaja, ubicacion_origen_id: caja.id, ubicacion_destino_id: cf.id, descripcion: `${desc}: a caja fuerte / retiros` });
        if (dCaja < 0) movs.push({ ...base, fecha: D(s.inicio), tipo: 'transferencia', monto: -dCaja, ubicacion_origen_id: cf.id, ubicacion_destino_id: caja.id, descripcion: `${desc}: de caja fuerte a caja` });
        if (dBanco > 0) movs.push({ ...base, fecha: D(s.inicio), tipo: 'transferencia', monto: dBanco, ubicacion_origen_id: banco.id, ubicacion_destino_id: cf.id, descripcion: `${desc}: salida de banco no desglosada` });
        if (dBanco < 0) movs.push({ ...base, fecha: D(s.inicio), tipo: 'transferencia', monto: -dBanco, ubicacion_origen_id: cf.id, ubicacion_destino_id: banco.id, descripcion: `${desc}: entrada a banco no desglosada` });
      }

      // 2) Movimientos diarios.
      for (const d of s.dias) {
        const f = D(d.f);
        if (d.ve) movs.push({ ...base, fecha: f, tipo: 'venta_efectivo', monto: d.ve, ubicacion_destino_id: caja.id, descripcion: desc });
        if (d.vt) movs.push({ ...base, fecha: f, tipo: 'venta_tarjeta', monto: d.vt, ubicacion_destino_id: banco.id, descripcion: desc });
        if (d.pt) movs.push({ ...base, fecha: f, tipo: 'propina_tarjeta', monto: d.pt, ubicacion_destino_id: banco.id, descripcion: desc });
        if (d.ge) movs.push({ ...base, fecha: f, tipo: 'gasto', monto: d.ge, ubicacion_origen_id: caja.id, categoria_id: categoria?.id ?? null, descripcion: desc });
        if (d.gt) movs.push({ ...base, fecha: f, tipo: 'gasto', monto: d.gt, ubicacion_origen_id: banco.id, categoria_id: categoria?.id ?? null, facturado: true, descripcion: desc });
        if (d.su) movs.push({ ...base, fecha: f, tipo: 'sueldo', monto: d.su, ubicacion_origen_id: caja.id, descripcion: desc });
        if (d.inv) movs.push({ ...base, fecha: f, tipo: 'compra_inventario', monto: d.inv, ubicacion_origen_id: banco.id, facturado: true, descripcion: desc });
        if (d.dep) movs.push({ ...base, fecha: f, tipo: 'deposito', monto: d.dep, ubicacion_origen_id: cf?.id ?? null, ubicacion_destino_id: banco.id, descripcion: `${desc}: préstamo/depósito recibido` });
        if (d.ret && cf) movs.push({ ...base, fecha: f, tipo: 'transferencia', monto: d.ret, ubicacion_origen_id: caja.id, ubicacion_destino_id: cf.id, descripcion: `${desc}: retiro / a caja fuerte` });
      }

      // 3) Comisión de terminal (como cerrarSemana).
      const t = totalesSemana(s);
      if (t.comision > 0) {
        movs.push({ ...base, fecha: D(s.fin), tipo: 'comision_terminal', monto: t.comision, ubicacion_origen_id: banco.id, descripcion: 'Comisión terminal 1.99% (automática)' });
      }

      // 4) Saldos teóricos y cierres (misma lógica que calcularSaldosTeoricos).
      const teoricos = new Map(running);
      for (const m of movs) {
        if (m.ubicacion_destino_id != null) teoricos.set(m.ubicacion_destino_id, r2((teoricos.get(m.ubicacion_destino_id) ?? 0) + m.monto));
        if (m.ubicacion_origen_id != null) teoricos.set(m.ubicacion_origen_id, r2((teoricos.get(m.ubicacion_origen_id) ?? 0) - m.monto));
      }
      const reales = new Map<bigint, number>([[caja.id, s.real.caja], [banco.id, s.real.banco]]);
      const descCaja = r2(s.real.caja - (teoricos.get(caja.id) ?? 0));
      const descBanco = r2(s.real.banco - (teoricos.get(banco.id) ?? 0));

      if (!DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          const semana = await tx.semanas.create({
            data: {
              negocio_id: negocio.id, etiqueta: s.etiqueta,
              fecha_inicio: D(s.inicio), fecha_fin: D(s.fin),
              estado: 'cerrada', cerrada_at: new Date(`${s.fin}T23:59:00.000Z`),
            },
          });
          if (movs.length) {
            await tx.movimientos.createMany({ data: movs.map((m) => ({ ...m, semana_id: semana.id })) as never });
          }
          await tx.arqueos.createMany({
            data: [
              { negocio_id: negocio.id, semana_id: semana.id, fecha: D(s.fin), ubicacion_id: caja.id, monto_real: s.real.caja, usuario_id: admin.id },
              { negocio_id: negocio.id, semana_id: semana.id, fecha: D(s.fin), ubicacion_id: banco.id, monto_real: s.real.banco, usuario_id: admin.id },
            ],
          });
          await tx.cierres_semana.createMany({
            data: ubicaciones.map((u) => {
              const saldo_inicial = running.get(u.id) ?? 0;
              const saldo_teorico = teoricos.get(u.id) ?? saldo_inicial;
              const saldo_real = reales.has(u.id) ? reales.get(u.id)! : null;
              return { semana_id: semana.id, ubicacion_id: u.id, saldo_inicial, saldo_teorico, saldo_real, saldo_final: saldo_real ?? saldo_teorico };
            }),
          });
        }, { timeout: 30000, maxWait: 15000 });
      }

      // 5) Avanza el encadenado: final = real ?? teórico (igual que el cierre).
      for (const u of ubicaciones) {
        const teo = teoricos.get(u.id) ?? running.get(u.id) ?? 0;
        running.set(u.id, reales.has(u.id) ? reales.get(u.id)! : teo);
      }
      prevReal = s.real;
      creadas++; totalMovs += movs.length;
      console.log(`${s.etiqueta.padEnd(34)}${String(movs.length).padStart(4)} ${fmt(descCaja)} ${fmt(descBanco)}`);
    }

    console.log('─'.repeat(72));
    console.log(`${DRY_RUN ? '[dry-run] ' : ''}Semanas creadas: ${creadas} · saltadas: ${saltadas} · movimientos: ${totalMovs}`);
    console.log(`Saldo acumulado en "Caja Fuerte Histórico": $${fmt(running.get(cf.id) ?? 0).trim()}`);

    // -----------------------------------------------------------------------
    //  Semana puente: cierra el hueco entre el fin del histórico y la 1ª semana
    //  ya registrada en la app, aterrizando en sus saldos iniciales congelados.
    // -----------------------------------------------------------------------
    if (SIN_PUENTE) {
      console.log('\n· --sin-puente: no se genera la semana puente.');
    } else if (!ancla) {
      console.log('\n· No hay semanas posteriores al histórico: no hace falta semana puente.');
    } else if (ancla.cierres.length === 0) {
      console.warn(`\n⚠ La semana ancla (${ancla.etiqueta}) no está cerrada: no tiene saldos congelados que respetar.`);
      console.warn('  Se omite la semana puente; revisa a mano el encadenado antes de seguir.');
    } else {
      const inicioPuente = masDias(finHistorico, 1);
      const finPuente = masDias(ancla.fecha_inicio, -1);
      if (inicioPuente > finPuente) {
        console.log('\n· El histórico empalma con la 1ª semana registrada: no hace falta semana puente.');
      } else {
        const etiqueta = `Puente ${isoD(inicioPuente)} → ${isoD(finPuente)} (sin registro)`;
        const yaExiste = await prisma.semanas.findFirst({
          where: { negocio_id: negocio.id, fecha_inicio: inicioPuente },
        });
        if (yaExiste) {
          console.log(`\n· Semana puente ${isoD(inicioPuente)} ya existe: se salta.`);
        } else {
          const desc = 'Semana puente: periodo sin registro entre el histórico y el arranque de la app';
          const base = { negocio_id: negocio.id, usuario_id: admin.id, fecha: finPuente };
          const movs: Omit<MovData, 'semana_id'>[] = [];

          // 1) Ajusta cada ubicación (menos la caja fuerte histórica) a su saldo objetivo,
          //    moviendo la diferencia contra "Caja Fuerte Histórico".
          for (const u of ubicaciones) {
            if (u.id === cf.id) continue;
            const delta = r2((objetivoPuente.get(u.id) ?? 0) - (running.get(u.id) ?? 0));
            if (delta === 0) continue;
            movs.push(delta > 0
              ? { ...base, tipo: 'transferencia', monto: delta, ubicacion_origen_id: cf.id, ubicacion_destino_id: u.id, descripcion: `${desc}: reposición a ${u.nombre}` }
              : { ...base, tipo: 'transferencia', monto: -delta, ubicacion_origen_id: u.id, ubicacion_destino_id: cf.id, descripcion: `${desc}: sobrante de ${u.nombre} a caja fuerte` });
          }

          // 2) El remanente de la caja fuerte histórica sale como retiro de socios,
          //    a partes iguales y pasando por la caja fuerte de cada uno.
          const saldoCF = r2(movs.reduce(
            (a, m) => a + (m.ubicacion_destino_id === cf.id ? m.monto : 0) - (m.ubicacion_origen_id === cf.id ? m.monto : 0),
            running.get(cf.id) ?? 0,
          ));
          if (saldoCF !== 0 && socios.length > 0) {
            let restante = saldoCF;
            socios.forEach((socio, i) => {
              // El último socio absorbe el redondeo para que la caja fuerte quede exacta en 0.
              const parte = i === socios.length - 1 ? restante : r2(saldoCF / socios.length);
              restante = r2(restante - parte);
              if (parte === 0) return;
              const suCF = ubicaciones.find((u) => u.socio_id === socio.id && u.id !== cf.id);
              if (suCF) {
                movs.push({ ...base, tipo: 'transferencia', monto: parte, ubicacion_origen_id: cf.id, ubicacion_destino_id: suCF.id, descripcion: `${desc}: acumulado histórico a ${suCF.nombre}` });
                movs.push({ ...base, tipo: 'retiro_socio', monto: parte, ubicacion_origen_id: suCF.id, socio_id: socio.id, descripcion: `${desc}: retiro del acumulado histórico` });
              } else {
                movs.push({ ...base, tipo: 'retiro_socio', monto: parte, ubicacion_origen_id: cf.id, socio_id: socio.id, descripcion: `${desc}: retiro del acumulado histórico` });
              }
            });
          } else if (saldoCF !== 0) {
            console.warn(`⚠ No hay socios activos: quedan $${fmt(saldoCF).trim()} en "Caja Fuerte Histórico".`);
          }

          // 3) Verificación: los teóricos deben caer EXACTAMENTE en el objetivo.
          const teoricos = new Map(running);
          for (const m of movs) {
            if (m.ubicacion_destino_id != null) teoricos.set(m.ubicacion_destino_id, r2((teoricos.get(m.ubicacion_destino_id) ?? 0) + m.monto));
            if (m.ubicacion_origen_id != null) teoricos.set(m.ubicacion_origen_id, r2((teoricos.get(m.ubicacion_origen_id) ?? 0) - m.monto));
          }
          console.log(`\nSemana puente ${isoD(inicioPuente)} → ${isoD(finPuente)} · ${movs.length} movimientos`);
          console.log('Ubicación                        Antes      Objetivo       Queda');
          console.log('─'.repeat(66));
          let ok = true;
          for (const u of ubicaciones) {
            const objetivo = u.id === cf.id ? 0 : (objetivoPuente.get(u.id) ?? 0);
            const queda = r2(teoricos.get(u.id) ?? 0);
            if (queda !== r2(objetivo)) { ok = false; }
            console.log(`${u.nombre.padEnd(26)}${fmt(running.get(u.id) ?? 0)} ${fmt(objetivo)} ${fmt(queda)}${queda !== r2(objetivo) ? '  ✗' : ''}`);
          }
          console.log('─'.repeat(66));
          if (!ok) throw new Error('La semana puente no aterriza en los saldos objetivo. Nada se escribió de ella.');

          if (!DRY_RUN) {
            await prisma.$transaction(async (tx) => {
              const semana = await tx.semanas.create({
                data: {
                  negocio_id: negocio.id, etiqueta,
                  fecha_inicio: inicioPuente, fecha_fin: finPuente,
                  estado: 'cerrada', cerrada_at: new Date(`${isoD(finPuente)}T23:59:00.000Z`),
                },
              });
              await tx.movimientos.createMany({ data: movs.map((m) => ({ ...m, semana_id: semana.id })) as never });
              await tx.arqueos.createMany({
                data: ubicaciones.map((u) => ({
                  negocio_id: negocio.id, semana_id: semana.id, fecha: finPuente,
                  ubicacion_id: u.id, monto_real: r2(teoricos.get(u.id) ?? 0), usuario_id: admin.id,
                })),
              });
              await tx.cierres_semana.createMany({
                data: ubicaciones.map((u) => {
                  const saldo = r2(teoricos.get(u.id) ?? 0);
                  return { semana_id: semana.id, ubicacion_id: u.id, saldo_inicial: running.get(u.id) ?? 0, saldo_teorico: saldo, saldo_real: saldo, saldo_final: saldo };
                }),
              });
            }, { timeout: 30000, maxWait: 15000 });
          }
          for (const u of ubicaciones) running.set(u.id, r2(teoricos.get(u.id) ?? 0));
          creadas++; totalMovs += movs.length;
          console.log(`${DRY_RUN ? '[dry-run] ' : ''}✓ La semana ${ancla.etiqueta} conserva sus saldos iniciales al centavo.`);
        }
      }
    }

    console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}TOTAL — semanas: ${creadas} · saltadas: ${saltadas} · movimientos: ${totalMovs}`);
    console.log('Nota: no se generaron snapshots de patrimonio (no hay valor de inventario histórico).');
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
async function main() {
  const ok = validar();
  if (!ok) { console.error('\n✗ El JSON tiene errores; corrígelos antes de migrar.'); process.exit(1); }
  if (MODO_VALIDAR) return;
  await migrar();
}

main().catch((e) => { console.error(e); process.exit(1); });
