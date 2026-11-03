import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fueEncolado } from '../../api';
import { Icono } from '../../icons';
import { useAuth } from '../../auth';
import { Cargando } from '../../ui/Cargando';
import { todayMexico, weekLabel, weekStateLabel } from '../../operating';
import WeekSelector from '../../components/WeekSelector';
import { cantidadBaseDesdePresentacion, cantidadBaseCompra } from './fifo-form';
import { LineaCompra } from './LineaCompra';
import { leerBorrador, guardarBorrador, borrarBorrador } from './borradores';

interface Producto {
  id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null; rendimiento_util?: number | null;
  existencia_actual_operativa?: number; minimo_operativo?: number; faltante_operativo?: number;
  existencia_fifo_operativa?: number | null; diferencia_fifo_vs_fisico_base?: number | null;
  presentacion_modo?: 'exacta' | 'por_lote' | 'variable' | string | null; presentacion_nota?: string | null;
  fuente_existencia_actual?: 'fisico'; ultimo_costo_fifo_base?: number | null; ultimo_costo_fifo_fecha?: string | null;
  precio_ultimo_fifo?: number | null; precio_catalogo?: number | null;
}
interface Lote { id: number; producto: string; unidad_base: string | null; recibido_at: string; cantidad_inicial: number; cantidad_restante: number; costo_unitario: number; estado: string; ticket_ref: string | null }
interface ConsumoResult { confirmar: boolean; ventas: number; costeadas: number; excepciones: number; ya_costeadas: number; costo_fifo: number; detalle: { venta_id: number; producto: string; estado: string; costo_fifo: number; error: string | null }[] }
interface LiveStatus { lotes_abiertos: number; unidades_base_abiertas: number; valor_fifo_abierto: number; ventas_pendientes: number; ventas_excepcion: number; costeo: 'en_vivo' }
interface ExceptionRow { venta_id: number; fecha: string; producto: string; cantidad: number; error: string }
interface RefCompra { productos: Producto[]; ubicaciones: { id: number; nombre: string; tipo: string }[] }
interface LineaRapida { product_id: number | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_fuente: string; unidad_fuente: string; cantidad_base: string; unidad_compra: string; contenido_compra: string; costo_unitario: string; importe: string; confianza: number | null; importe_auto?: boolean }
interface Pendiente { id: number; fecha_recepcion: string; proveedor: string | null; ticket_ref: string | null; total: number | null; fuente?: string; estado: string; foto: boolean; origen_pago_id: number | null; notas?: string | null; lineas: Array<{ id: number; product_id: number | null; producto: string | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_fuente: number | null; unidad_fuente: string | null; cantidad_base: number | null; unidad_compra: string | null; contenido_compra: number | null; costo_unitario: number | null; importe: number; confianza: number | null; notas: string | null }> }
interface ValidacionCompra { valida: boolean; errores: Array<{ codigo: string; mensaje: string; linea?: number; producto?: string }>; advertencias: Array<{ codigo: string; mensaje: string; linea?: number; producto?: string }> }
interface CompraDia { id: number; fecha: string; proveedor: string | null; ticket_ref: string | null; total: number; fuente?: string; estado: string; foto?: boolean; origen_pago_id: number | null; origen_pago?: string | null; lineas: { tipo: string; producto: string; importe: number }[] }
export interface Semana { id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string; estado: 'abierta' | 'cerrada' }

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const hoy = todayMexico();

function nuevaLineaCompra(): LineaRapida {
  return { product_id: null, tipo_linea: 'inventario', descripcion_fuente: '', cantidad_fuente: '', unidad_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '', confianza: null, importe_auto: true };
}

// Sólo las presentaciones marcadas como exactas pueden precargarse. Para
// mezcladores por lote y productos variables se exige leer el ticket o
// capturar una estimación explícita en cada compra.
function contenidoCatalogoSiExacto(producto?: Producto | null) {
  return producto?.presentacion_modo === 'exacta' ? producto.contenido_compra ?? null : null;
}

function totalDeLineas(lineas: Array<{ importe: number | null | undefined }>) {
  return Math.round((lineas.reduce((s, l) => s + (Number(l.importe) || 0), 0) + Number.EPSILON) * 100) / 100;
}

function normalizarNombreCompra(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function finEposExclusivo(fecha: string) {
  const dia = new Date(`${fecha}T12:00:00-06:00`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return `${dia.toISOString().slice(0, 10)}T00:00:00-06:00`;
}

export default function Compras({ embebida = false }: { embebida?: boolean }) {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const parametros = new URLSearchParams(window.location.search);
  const fechaInicial = parametros.get('fecha') || hoy;
  const semanaInicial = Number(parametros.get('semana'));
  const volverAFinanzas = parametros.get('return') === 'finanzas';
  const tabInicial = parametros.get('comprasTab') || parametros.get('tab');
  const focoInicial = parametros.get('focus') || undefined;
  const [tab, setTab] = useState<'tickets' | 'lotes' | 'epos' | 'pendientes'>(tabInicial === 'epos' || tabInicial === 'lotes' || tabInicial === 'pendientes' ? tabInicial : 'tickets');
  const [mostrarAuditoria, setMostrarAuditoria] = useState(tabInicial === 'epos' || tabInicial === 'lotes');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [from, setFrom] = useState(hoy);
  const [to, setTo] = useState(hoy);
  const [preview, setPreview] = useState<ConsumoResult | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [compras, setCompras] = useState<CompraDia[]>([]);
  const [cargandoCompras, setCargandoCompras] = useState(true);
  const [semanas, setSemanas] = useState<Semana[]>([]);
  const [semanaId, setSemanaId] = useState<number | null>(null);
  const [cargandoSemanas, setCargandoSemanas] = useState(true);

  const productosOrdenados = useMemo(() => [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre)), [productos]);
  const semana = semanas.find((s) => s.id === semanaId) ?? null;
  const comprasSemana = useMemo(() => semana ? compras.filter((c) => c.fecha >= semana.fecha_inicio && c.fecha <= semana.fecha_fin) : compras, [compras, semana]);
  const lotesSemana = useMemo(() => semana ? lotes.filter((l) => l.recibido_at >= semana.fecha_inicio && l.recibido_at <= semana.fecha_fin) : lotes, [lotes, semana]);
  const pendientesSemana = useMemo(() => semana ? pendientes.filter((p) => p.fecha_recepcion >= semana.fecha_inicio && p.fecha_recepcion <= semana.fecha_fin) : pendientes, [pendientes, semana]);
  useEffect(() => { if (esAdmin) void cargar(); }, [esAdmin]);
  useEffect(() => {
    if (!esAdmin) return;
    setCargandoSemanas(true);
    api<Semana[]>('/finanzas/semanas')
      .then((filas) => { setSemanas(filas); setSemanaId((prev) => prev ?? (Number.isFinite(semanaInicial) && semanaInicial > 0 ? semanaInicial : null) ?? filas.find((s) => s.estado === 'abierta')?.id ?? filas[0]?.id ?? null); })
      .catch((e) => setMensaje(e instanceof Error ? e.message : 'No se pudieron cargar las semanas.'))
      .finally(() => setCargandoSemanas(false));
  }, [esAdmin]);
  useEffect(() => {
    if (semana) { setFrom(semana.fecha_inicio); setTo(semana.fecha_fin); setPreview(null); }
  }, [semana?.id]);

  async function cargar() {
    setCargandoCompras(true);
    try {
      const [p, l, pend, tickets] = await Promise.all([api<Producto[]>('/catalogo/products'), api<Lote[]>('/inventario/lotes'), api<Pendiente[]>('/inventario/compras/pendientes'), api<CompraDia[]>('/inventario/compras')]);
      setProductos(p); setLotes(l); setPendientes(pend); setCompras(tickets);
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar el inventario.'); }
    finally { setCargandoCompras(false); }
  }

  async function cargarTickets() {
    setCargandoCompras(true);
    try { setCompras(await api<CompraDia[]>('/inventario/compras')); }
    catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudieron cargar las compras.'); }
    finally { setCargandoCompras(false); }
  }

  async function consultarEpos(confirmar = false) {
    if (!from || !to) return;
    setConsultando(true); setMensaje('');
    try {
      const r = await api<ConsumoResult>('/inventario/consumo-epos', { method: 'POST', body: { from: `${from}T00:00:00-06:00`, to: finEposExclusivo(to), confirmar } });
      setPreview(r);
      setMensaje(confirmar ? 'Se reprocesaron las ventas pendientes; las excepciones reales quedaron visibles.' : 'Revisión lista. El costeo normal ocurre automáticamente al importar ventas.');
      if (confirmar) await cargar();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo consultar Epos.'); }
    finally { setConsultando(false); }
  }

  return <div className={embebida ? 'compras-page compras-page--embedded' : 'page compras-page'}>
    {!embebida && <header className="page-head"><div className="page-title"><Icono name="package" size={24} className="ttl-icon" /><h1>Entradas</h1></div><p className="muted">Registra compras y gastos.</p>{volverAFinanzas && <Link className="inline-link" to={`/finanzas?semana=${semanaId ?? ''}&tab=cuadre`}>← Volver a Semana</Link>}</header>}
    {!esAdmin && <div className="info-box purchase-operator-note"><strong>Para registrar una compra</strong><span>Sube la foto, confirma fecha y forma de pago y envíala a revisión. No necesitas calcular FIFO.</span></div>}
    {esAdmin && <WeekSelector
      semanas={semanas}
      value={semanaId}
      onChange={setSemanaId}
      label="Periodo de entradas"
      description="Compras y lotes recibidos en la semana."
      ariaLabel="Semana de consulta"
      loading={cargandoSemanas}
      disabled={!semanas.length}
    />}
    <CapturaRapida key={semana?.id ?? fechaInicial} fechaInicial={semana ? fechaInicial < semana.fecha_inicio ? semana.fecha_inicio : fechaInicial > semana.fecha_fin ? semana.fecha_fin : fechaInicial : fechaInicial} onSaved={() => { if (esAdmin) void cargar(); }} />
    {esAdmin && semana && <GastoRapido semana={semana} onSaved={() => void cargarTickets()} />}
    {esAdmin && <nav className="tabs">
      <button className={tab === 'tickets' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('tickets'); void cargarTickets(); }}>Historial de entradas</button>
      <button className={tab === 'pendientes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('pendientes'); void cargar(); }}>Por revisar {pendientesSemana.length ? `(${pendientesSemana.length})` : ''}</button>
      <button className="tab tab--audit" onClick={() => { setMostrarAuditoria((v) => !v); if (mostrarAuditoria && (tab === 'lotes' || tab === 'epos')) setTab('tickets'); }}>{mostrarAuditoria ? 'Ocultar auditoría técnica' : 'Auditoría técnica'}</button>
      {mostrarAuditoria && <><button className={tab === 'lotes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('lotes'); void cargar(); }}>Lotes FIFO</button><button className={tab === 'epos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('epos')}>FIFO activo</button></>}
    </nav>}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {esAdmin && semana && <ResumenSemana semana={semana} compras={comprasSemana} lotes={lotesSemana} />}
    {esAdmin && tab === 'tickets' && <Tickets compras={comprasSemana} cargando={cargandoCompras} />}
    {esAdmin && tab === 'lotes' && <Lotes lotes={lotesSemana} />}
    {esAdmin && tab === 'epos' && <EposPanel from={from} setFrom={setFrom} to={to} setTo={setTo} preview={preview} consultando={consultando} consultar={consultarEpos} focus={focoInicial} />}
    {esAdmin && tab === 'pendientes' && <Pendientes filas={pendientesSemana} productos={productosOrdenados} onChange={() => void cargar()} />}
  </div>;
}

interface RefGasto { ubicaciones: { id: number; nombre: string; tipo: string }[]; categorias: { id: number; nombre: string }[] }

/** Gasto operativo sin ticket: mantiene Entradas como la única puerta de captura. */
function GastoRapido({ semana, onSaved }: { semana: Semana; onSaved: () => void }) {
  const [refs, setRefs] = useState<RefGasto | null>(null);
  const [fecha, setFecha] = useState(semana.fecha_inicio);
  const [monto, setMonto] = useState('');
  const [origen, setOrigen] = useState('');
  const [categoria, setCategoria] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api<RefGasto>('/finanzas/referencias').then((r) => {
      setRefs(r);
    }).catch(() => setMensaje('No se pudieron cargar las categorías de gasto.'));
  }, []);
  useEffect(() => { setFecha(semana.fecha_inicio); }, [semana.id, semana.fecha_inicio]);

  async function guardar() {
    const valor = Number(monto);
    if (semana.estado !== 'abierta') { setMensaje('La semana está cerrada; registra este gasto en una semana abierta.'); return; }
    if (!fecha || fecha < semana.fecha_inicio || fecha > semana.fecha_fin || !Number.isFinite(valor) || valor <= 0 || !origen || !descripcion.trim()) {
      setMensaje('Completa fecha dentro de la semana, monto, origen y descripción.'); return;
    }
    setGuardando(true); setMensaje('');
    try {
      await api('/finanzas/movimientos', { method: 'POST', body: { semana_id: semana.id, tipo: 'gasto', monto: valor, fecha, ubicacion_origen_id: Number(origen), categoria_id: categoria ? Number(categoria) : null, descripcion: descripcion.trim() } });
      setMonto(''); setDescripcion(''); setCategoria(''); setMensaje('Gasto registrado en la semana.'); onSaved();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo registrar el gasto.'); }
    finally { setGuardando(false); }
  }

  return <details className="card entry-secondary"><summary><span><strong>Registrar gasto sin ticket</strong><small>Limpieza, transporte u otro servicio</small></span><span className="muted">Para insumos, usa Registrar compra</span></summary>
    <div className="form-grid form-grid--three entry-secondary__form"><label>Fecha<input type="date" min={semana.fecha_inicio} max={semana.fecha_fin} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><label>Monto<input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Ej. 250" value={monto} onChange={(e) => setMonto(e.target.value)} /></label><label>Origen<select value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="">Seleccionar…</option>{refs?.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label><label>Categoría (opcional)<select value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Sin categoría</option>{refs?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label><label className="span-all">Descripción<input placeholder="Ej. Manzana para servicio" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></label><div className="form-actions"><button className="btn-primary" disabled={guardando || semana.estado !== 'abierta'} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Registrar gasto'}</button></div></div>
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
  </details>;
}

export function CapturaRapida({ fechaInicial, onSaved }: { fechaInicial: string; onSaved: () => void }) {
  const { usuario } = useAuth();
  const claveBorrador = `${usuario?.id}:${fechaInicial}`;
  const [refs, setRefs] = useState<RefCompra | null>(null);
  const [fecha, setFecha] = useState(fechaInicial);
  const [proveedor, setProveedor] = useState('');
  const [ticket, setTicket] = useState('');
  const [modo, setModo] = useState<'ticket' | 'orden_manuscrita'>('ticket');
  const [total, setTotal] = useState('');
  const [origen, setOrigen] = useState('');
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<{ data: string; mime: string } | null>(null);
  const [lineas, setLineas] = useState<LineaRapida[]>([nuevaLineaCompra()]);
  const [mensaje, setMensaje] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cargandoRefs, setCargandoRefs] = useState(true);
  const [borradorListo, setBorradorListo] = useState(false);
  const [borradorGuardado, setBorradorGuardado] = useState(false);

  useEffect(() => {
    let activo = true;
    void leerBorrador<{ fecha: string; proveedor: string; ticket: string; modo: typeof modo; total: string; origen: string; notas: string; foto: typeof foto; lineas: LineaRapida[] }>(claveBorrador).then((b) => {
      if (!activo || !b) return;
      setFecha(b.fecha); setProveedor(b.proveedor); setTicket(b.ticket); setModo(b.modo); setTotal(b.total); setOrigen(b.origen); setNotas(b.notas); setFoto(b.foto); setLineas(b.lineas);
    }).catch(() => {}).finally(() => { if (activo) setBorradorListo(true); });
    return () => { activo = false; };
  }, [claveBorrador]);

  useEffect(() => {
    if (!borradorListo) return;
    const tieneDatos = !!(proveedor || ticket || total || notas || foto || lineas.some((l) => l.product_id || l.descripcion_fuente || l.importe));
    const persistir = tieneDatos ? guardarBorrador(claveBorrador, { fecha, proveedor, ticket, modo, total, origen, notas, foto, lineas }) : borrarBorrador(claveBorrador);
    void persistir.then(() => setBorradorGuardado(tieneDatos)).catch(() => setBorradorGuardado(false));
  }, [borradorListo, claveBorrador, fecha, proveedor, ticket, modo, total, origen, notas, foto, lineas]);

  useEffect(() => {
    setCargandoRefs(true);
    api<RefCompra>('/inventario/compras/referencias')
      .then(setRefs)
      .catch(() => setMensaje('No se pudieron cargar las referencias de compra. Puedes revisar la conexión y volver a intentar.'))
      .finally(() => setCargandoRefs(false));
  }, []);

  function fotoSeleccionada(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFoto({ data: String(reader.result), mime: file.type || 'image/jpeg' });
    reader.readAsDataURL(file);
  }

  async function leerTicket() {
    if (!foto) { setMensaje('Toma primero una foto del ticket.'); return; }
    setLeyendo(true); setMensaje('Leyendo ticket; la propuesta se revisa antes de guardar.');
    try {
      const r = await api<{ proveedor: string | null; fecha: string | null; total: number | null; lineas: Array<{ descripcion_fuente: string; product_id: number | null; cantidad: number | null; unidad_fuente: string | null; contenido_compra?: number | null; costo_unitario: number | null; importe: number; confianza: 'alta' | 'media' | 'baja' }> }>('/inventario/compras/rapidas/ocr', { method: 'POST', body: { imagen_base64: foto.data, imagen_tipo: foto.mime, modo } });
      if (r.proveedor) setProveedor(r.proveedor); if (r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) setFecha(r.fecha); if (r.total != null) setTotal(String(r.total));
      setLineas(r.lineas.map((l) => {
        const producto = l.product_id == null ? undefined : refs?.productos.find((p) => p.id === l.product_id);
        const unidadFuente = l.unidad_fuente ?? producto?.unidad_compra ?? '';
        const contenido = l.contenido_compra != null ? String(l.contenido_compra) : producto?.presentacion_modo === 'exacta' && producto.contenido_compra != null ? String(producto.contenido_compra) : '';
        const base = modo === 'orden_manuscrita' ? null : cantidadBaseDesdePresentacion({ cantidadCompra: Number(l.cantidad), unidadCompra: unidadFuente, contenidoPorPresentacion: Number(contenido), unidadBase: producto?.unidad_base, rendimientoUtil: producto?.rendimiento_util });
        return { product_id: l.product_id, tipo_linea: modo === 'orden_manuscrita' ? 'pendiente' : l.product_id != null && l.confianza === 'alta' ? 'inventario' : 'pendiente', descripcion_fuente: l.descripcion_fuente, cantidad_fuente: l.cantidad == null ? '' : String(l.cantidad), unidad_fuente: unidadFuente, cantidad_base: base == null ? '' : String(base), unidad_compra: producto?.unidad_compra ?? '', contenido_compra: contenido, costo_unitario: l.costo_unitario == null ? '' : String(l.costo_unitario), importe: String(l.importe), confianza: l.confianza === 'alta' ? 0.95 : l.confianza === 'media' ? 0.7 : 0.3, importe_auto: false };
      }));
      setMensaje(modo === 'orden_manuscrita' ? 'Orden manuscrita leída. Confirma unidad, conversión y precio antes de clasificar.' : 'Ticket leído. Revisa cada línea y clasifica lo que no sea inventario.');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo leer el ticket; puedes capturarlo manualmente.'); }
    finally { setLeyendo(false); }
  }

  function editar(i: number, campo: keyof LineaRapida, valor: string | number | null) {
    setLineas((v) => v.map((l, idx) => {
      if (idx !== i) return l;
      const siguiente = { ...l, [campo]: valor };
      if (campo === 'product_id') {
        const producto = refs?.productos.find((p) => p.id === Number(valor));
        if (producto) {
          if (!siguiente.descripcion_fuente.trim()) siguiente.descripcion_fuente = producto.nombre;
          siguiente.cantidad_base = '';
          siguiente.unidad_fuente = producto.unidad_compra ?? siguiente.unidad_fuente;
          siguiente.unidad_compra = producto.unidad_compra ?? siguiente.unidad_compra;
          siguiente.contenido_compra = producto.presentacion_modo === 'exacta' && producto.contenido_compra != null ? String(producto.contenido_compra) : '';
        }
      }
      if (campo === 'cantidad_fuente' || campo === 'unidad_fuente' || campo === 'unidad_compra' || campo === 'contenido_compra' || campo === 'product_id') {
        const producto = refs?.productos.find((p) => p.id === Number(siguiente.product_id));
        const base = cantidadBaseCompra(siguiente, producto);
        siguiente.cantidad_base = producto?.presentacion_modo === 'variable' ? siguiente.cantidad_base : base == null ? '' : String(base);
      }
      if (campo === 'importe') siguiente.importe_auto = false;

      return siguiente;
    }));
  }
  async function guardar() {
    const validas = lineas.filter((l) => l.descripcion_fuente.trim() && l.importe.trim() !== '' && Number(l.importe) >= 0);
    if (validas.length !== lineas.length) { setMensaje('Completa la descripción y el importe de cada artículo, o quita los vacíos.'); return; }
    if (!fecha || (modo === 'ticket' && (!total.trim() || !origen || !Number.isFinite(Number(total)))) || !validas.length) { setMensaje(modo === 'orden_manuscrita' ? 'Completa fecha y al menos una línea. El total y el pago pueden definirse durante la revisión.' : 'Completa fecha, total, forma de pago y al menos una línea.'); return; }
    setGuardando(true); setMensaje('');
    try {
      const respuesta = await api('/inventario/compras/rapidas', { method: 'POST', body: { fecha_recepcion: fecha, proveedor: proveedor || null, ticket_ref: ticket || null, tipo_documento: modo, total: total.trim() ? Number(total) : null, origen_pago_id: origen ? Number(origen) : null, notas: notas || null, foto_data: foto?.data ?? null, foto_mime: foto?.mime ?? null, lineas: validas.map((l) => ({ product_id: l.product_id, tipo_linea: l.tipo_linea, descripcion_fuente: l.descripcion_fuente, cantidad_fuente: l.cantidad_fuente ? Number(l.cantidad_fuente) : null, unidad_fuente: l.unidad_fuente || null, cantidad_base: l.cantidad_base ? Number(l.cantidad_base) : null, unidad_compra: l.unidad_compra || null, contenido_compra: l.contenido_compra ? Number(l.contenido_compra) : null, costo_unitario: l.costo_unitario ? Number(l.costo_unitario) : null, importe: Number(l.importe || 0), confianza: l.confianza })) } });
      await borrarBorrador(claveBorrador).catch(() => {});
      setMensaje(fueEncolado(respuesta) ? 'Guardada en este dispositivo. Se enviará al recuperar conexión.' : 'Compra guardada para revisión.'); setProveedor(''); setTicket(''); setTotal(''); setNotas(''); setFoto(null); setLineas([nuevaLineaCompra()]); onSaved();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo guardar la compra.'); }
    finally { setGuardando(false); }
  }

  const suma = lineas.reduce((sum, l) => sum + (Number(l.importe) || 0), 0);
  return <section className="card quick-purchase" aria-labelledby="captura-compra-titulo">
    <div className="section-heading"><div><h2 id="captura-compra-titulo">Registrar compra</h2><p className="muted">Foto opcional, datos del pago y artículos recibidos.</p></div></div>
    <div className="quick-purchase__actions"><label className="btn-secondary file-button">Adjuntar ticket<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(e) => fotoSeleccionada(e.target.files?.[0])} /></label>{foto && <button className="btn-secondary" onClick={() => void leerTicket()} disabled={leyendo}>{leyendo ? 'Leyendo…' : 'Leer ticket'}</button>}</div>
    {foto && <details className="entry-secondary"><summary>Ver comprobante</summary><img className="ticket-preview" src={foto.data} alt="Ticket adjunto" /></details>}
    {cargandoRefs && <Cargando etiqueta="Preparando captura…" />}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {borradorGuardado && <small className="muted" role="status">Borrador guardado en este dispositivo.</small>}
    <div className="form-grid form-grid--three purchase-meta">
      <label>Fecha de recepción<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label>Proveedor<input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej. La Comer" /></label>
      <label>Se pagó con<select value={origen} onChange={(e) => setOrigen(e.target.value)} disabled={cargandoRefs}><option value="">Seleccionar…</option>{refs?.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
    </div>
    <div className="quick-lines">{lineas.map((l, i) => <LineaCompra key={i} linea={l} productos={refs?.productos ?? []} numero={i + 1} editar={(campo, valor) => editar(i, campo, valor)} quitar={lineas.length > 1 ? () => setLineas((v) => v.filter((_, idx) => idx !== i)) : undefined} />)}</div>
    <button className="btn-secondary" disabled={guardando || leyendo} onClick={() => setLineas((v) => [...v, nuevaLineaCompra()])}>+ Agregar artículo</button>
    <details className="purchase-item__details"><summary>Folio, notas u orden incompleta</summary><div className="form-grid form-grid--three">
      <label>Folio<input value={ticket} onChange={(e) => setTicket(e.target.value)} /></label><label>Notas<input value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
      <label>Comprobante<select value={modo} onChange={(e) => setModo(e.target.value as 'ticket' | 'orden_manuscrita')}><option value="ticket">Ticket completo</option><option value="orden_manuscrita">Orden por completar</option></select></label>
    </div></details>
    <div className="purchase-total"><span>Suma de artículos <strong>{mxn(suma)}</strong></span><label>Total del ticket<input type="number" min="0" step="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={suma.toFixed(2)} /></label></div>
    <div className="ticket-form-actions"><small className="muted">Se guarda para revisión. Al confirmar, entrará a bodega y se registrará el pago.</small><button className="btn-primary" disabled={guardando || leyendo || cargandoRefs} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar para revisión'}</button></div>
  </section>;
}

/**
 * Panel de Compras embebible en Operación. Mantiene una sola fuente de verdad:
 * una captura aparece aquí como pendiente, al confirmarse crea sus movimientos
 * y lotes FIFO, y después queda disponible en el historial semanal.
 */
export function RegistroComprasPanel({ semana, onChange }: { semana: Semana; onChange: () => void }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [compras, setCompras] = useState<CompraDia[]>([]);
  const [tab, setTab] = useState<'pendientes' | 'tickets' | 'lotes'>('pendientes');
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');

  const comprasSemana = useMemo(() => compras.filter((c) => c.fecha >= semana.fecha_inicio && c.fecha <= semana.fecha_fin), [compras, semana]);
  const lotesSemana = useMemo(() => lotes.filter((l) => l.recibido_at >= semana.fecha_inicio && l.recibido_at <= semana.fecha_fin), [lotes, semana]);
  const pendientesSemana = useMemo(() => pendientes.filter((p) => p.fecha_recepcion >= semana.fecha_inicio && p.fecha_recepcion <= semana.fecha_fin), [pendientes, semana]);

  async function cargar() {
    setCargando(true);
    try {
      const [p, l, pend, tickets] = await Promise.all([
        api<Producto[]>('/catalogo/products'),
        api<Lote[]>('/inventario/lotes'),
        api<Pendiente[]>('/inventario/compras/pendientes'),
        api<CompraDia[]>('/inventario/compras'),
      ]);
      setProductos(p); setLotes(l); setPendientes(pend); setCompras(tickets);
      if (pend.filter((x) => x.fecha_recepcion >= semana.fecha_inicio && x.fecha_recepcion <= semana.fecha_fin).length > 0) setTab('pendientes');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : 'No se pudo cargar el registro de compras.');
    } finally { setCargando(false); }
  }

  useEffect(() => { void cargar(); }, [semana.id]);

  return <section className="unified-purchases" aria-labelledby="compras-titulo">
    <div className="section-heading unified-purchases__heading">
      <div><h2 id="compras-titulo">Compras de la semana</h2><p className="muted">Un ticket actualiza inventario y caja.</p></div>
      <span className={`status status--${semana.estado === 'abierta' ? 'ok' : 'cargando'}`}>{semana.estado === 'abierta' ? 'Captura abierta' : 'Consulta histórica'}</span>
    </div>
    <div className="purchase-flow-guide" aria-label="Flujo de compras"><span><strong>1</strong> Registrar</span><span><strong>2</strong> Revisar</span><span><strong>3</strong> Confirmar</span></div>
    {semana.estado === 'abierta' && <details className="operation-capture" open={pendientesSemana.length === 0}>
      <summary><strong>Registrar entrada</strong><span className="muted">Toma una foto o captura los datos</span></summary>
      <div className="operation-capture__body"><CapturaRapida key={semana.id} fechaInicial={semana.fecha_inicio} onSaved={() => { void cargar(); onChange(); }} /></div>
    </details>}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    <nav className="tabs unified-purchases__tabs" aria-label="Compras de la semana">
      <button className={tab === 'pendientes' ? 'tab tab--on' : 'tab'} onClick={() => setTab('pendientes')}>Por revisar {pendientesSemana.length ? `(${pendientesSemana.length})` : ''}</button>
      <button className={tab === 'tickets' ? 'tab tab--on' : 'tab'} onClick={() => setTab('tickets')}>Tickets ({comprasSemana.length})</button>
      <button className={tab === 'lotes' ? 'tab tab--on' : 'tab'} onClick={() => setTab('lotes')}>Lotes FIFO ({lotesSemana.length})</button>
    </nav>
    {cargando ? <section className="card"><Cargando etiqueta="Cargando compras y lotes…" /></section> : <>
      {tab === 'pendientes' && <Pendientes filas={pendientesSemana} productos={[...productos].sort((a, b) => a.nombre.localeCompare(b.nombre))} onChange={() => { void cargar(); onChange(); }} />}
      {tab === 'tickets' && <Tickets compras={comprasSemana} cargando={false} />}
      {tab === 'lotes' && <Lotes lotes={lotesSemana} />}
    </>}
  </section>;
}

function Pendientes({ filas, productos, onChange }: { filas: Pendiente[]; productos: Producto[]; onChange: () => void }) {
  const [ubicaciones, setUbicaciones] = useState<RefCompra['ubicaciones']>([]);
  const [productosEstado, setProductosEstado] = useState<Producto[]>(productos);

  useEffect(() => {
    if (!filas.length) return;
    api<RefCompra>('/inventario/compras/referencias')
      .then((r) => { setUbicaciones(r.ubicaciones); setProductosEstado(r.productos); })
      .catch(() => { setUbicaciones([]); setProductosEstado(productos); });
  }, [filas.length, productos]);

  if (!filas.length) return <div className="empty-state"><strong>No hay compras pendientes</strong><p>Las capturas nuevas aparecerán aquí para revisión.</p></div>;
  return <section className="quick-pending">{filas.map((f) => <PendienteCardV2 key={f.id} fila={f} productos={productosEstado} ubicaciones={ubicaciones} onChange={onChange} />)}</section>;
}

function PendienteCardV2({ fila, productos, ubicaciones, onChange }: { fila: Pendiente; productos: Producto[]; ubicaciones: RefCompra['ubicaciones']; onChange: () => void }) {
  const [lineas, setLineas] = useState(fila.lineas);
  const totalInicial = fila.total == null && fila.fuente !== 'orden_manuscrita' ? totalDeLineas(fila.lineas) : fila.total;
  const [total, setTotal] = useState(totalInicial == null ? '' : String(totalInicial));
  const [origen, setOrigen] = useState(fila.origen_pago_id == null ? '' : String(fila.origen_pago_id));
  const [foto, setFoto] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [validacion, setValidacion] = useState<ValidacionCompra | null>(null);
  const [validando, setValidando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Si OCR/manual ya clasificó una línea como inventario pero no guardó el
  // producto, seleccionamos únicamente una coincidencia exacta y única. No
  // hacemos coincidencias difusas para no enviar una compra al producto errado.
  useEffect(() => {
    if (!productos.length) return;
    setLineas((actuales) => {
      let cambio = false;
      const siguientes = actuales.map((linea) => {
        if (linea.tipo_linea !== 'inventario' || linea.product_id != null) return linea;
        const nombre = normalizarNombreCompra(linea.descripcion_fuente);
        const coincidencias = productos.filter((producto) => normalizarNombreCompra(producto.nombre) === nombre);
        if (coincidencias.length !== 1) return linea;
        const producto = coincidencias[0];
        cambio = true;
        return {
          ...linea,
          product_id: producto.id,
          unidad_fuente: linea.unidad_fuente || producto.unidad_compra || '',
          unidad_compra: linea.unidad_compra || producto.unidad_compra || '',
          contenido_compra: linea.contenido_compra || contenidoCatalogoSiExacto(producto),
        };
      });
      return cambio ? siguientes : actuales;
    });
  }, [productos]);

  function editar(i: number, campo: string, valor: unknown) {
    setLineas((v) => v.map((l, idx) => {
      if (idx !== i) return l;
      const siguiente = { ...l, [campo]: valor };
      if (campo === 'product_id') {
        const producto = productos.find((p) => p.id === Number(valor));
        if (producto) {
          siguiente.cantidad_base = null;
          if (!siguiente.descripcion_fuente.trim()) siguiente.descripcion_fuente = producto.nombre;
          siguiente.unidad_fuente = producto.unidad_compra ?? siguiente.unidad_fuente;
          siguiente.unidad_compra = producto.unidad_compra ?? siguiente.unidad_compra;
          siguiente.contenido_compra = contenidoCatalogoSiExacto(producto) ?? null;
        }
      }
      if (campo === 'cantidad_fuente' || campo === 'unidad_fuente' || campo === 'unidad_compra' || campo === 'contenido_compra' || campo === 'product_id') {
        const producto = productos.find((p) => p.id === Number(siguiente.product_id));
        const base = cantidadBaseCompra(siguiente, producto);
        siguiente.cantidad_base = producto?.presentacion_modo === 'variable' ? siguiente.cantidad_base : base;

      }
      return siguiente;
    }));
    setValidacion(null);
  }

  function payloadLineas() {
    return lineas.map((l) => ({ ...l, product_id: l.product_id ? Number(l.product_id) : null, cantidad_fuente: l.cantidad_fuente == null ? null : Number(l.cantidad_fuente), unidad_fuente: l.unidad_fuente || null, cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base), contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra), costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario), importe: Number(l.importe) }));
  }

  function totalParaValidar() {
    const elegido = total.trim() ? Number(total) : (fila.fuente !== 'orden_manuscrita' ? totalDeLineas(lineas) : null);
    return Number.isFinite(elegido) && elegido != null && elegido >= 0 ? elegido : null;
  }

  async function guardarLineas(totalCompra: number) {
    await api(`/inventario/compras/${fila.id}/lineas`, { method: 'PUT', body: { total: totalCompra, lineas: payloadLineas() } });
  }

  async function validar(totalCompra = totalParaValidar()) {
    if (totalCompra == null) { setMensaje('Completa el total antes de validar.'); return null; }
    setValidando(true);
    try {
      const r = await api<ValidacionCompra>('/inventario/compras/validar', { method: 'POST', body: { total: totalCompra, lineas: payloadLineas() } });
      setValidacion(r); setMensaje(r.errores.length ? 'Corrige los errores antes de confirmar.' : r.advertencias.length ? 'Hay advertencias; puedes confirmarlas después de revisarlas.' : 'Validación correcta.');
      return r;
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo validar la compra.'); return null; }
    finally { setValidando(false); }
  }

  async function guardarYValidar() {
    const totalCompra = totalParaValidar();
    if (!origen) { setMensaje('Selecciona el origen del pago antes de confirmar.'); return; }
    if (totalCompra == null) { setMensaje('Completa el total antes de validar.'); return; }
    setGuardando(true); setMensaje('');
    try {
      await guardarLineas(totalCompra);
      await api(`/inventario/compras/${fila.id}/pago`, { method: 'PATCH', body: { origen_pago_id: Number(origen) } });
      const r = await validar(totalCompra);
      if (!r || r.errores.length) return;
      setMensaje('Revisa los artículos y las advertencias. Confirma abajo para registrar inventario y pago.');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo preparar la compra'); }
    finally { setGuardando(false); }
  }

  async function confirmarRevisada() {
    if (!validacion?.valida) return;
    setGuardando(true);
    try {
      const confirmada = await api<{ discrepancias?: ValidacionCompra['advertencias'] }>(`/inventario/compras/${fila.id}/confirmar`, { method: 'POST', body: {} });
      setMensaje(confirmada.discrepancias?.length ? `Compra confirmada con ${confirmada.discrepancias.length} advertencia(s) registrada(s).` : 'Compra confirmada: FIFO y cierre actualizados.');
      onChange();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo confirmar'); }
    finally { setGuardando(false); }
  }

  async function verFoto() {
    try { const r = await api<{ mime: string; data: string }>(`/inventario/compras/${fila.id}/foto`); setFoto(`data:${r.mime};base64,${r.data}`); }
    catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar la fuente.'); }
  }

  return <article className="card quick-pending__card">
    <div className="section-heading"><div><h2>{fila.proveedor || 'Compra sin proveedor'}</h2><p className="muted">{fila.fecha_recepcion} · {fila.fuente === 'orden_manuscrita' ? 'orden manuscrita' : (fila.ticket_ref || 'sin folio')} · {fila.total == null ? (fila.fuente === 'orden_manuscrita' ? 'total pendiente' : `${mxn(totalDeLineas(lineas))} · total calculado`) : mxn(fila.total)}</p><span className="status status--cargando">Pendiente de revisión</span></div>{fila.foto && <button className="btn-secondary" onClick={() => void verFoto()}>Ver ticket</button>}</div>
    <div className="quick-pending__meta"><label>Total de la compra<input type="number" min="0" step="0.01" inputMode="decimal" value={total} onChange={(e) => { setTotal(e.target.value); setValidacion(null); }} placeholder="Ej. 1,282.10" />{fila.total == null && fila.fuente !== 'orden_manuscrita' && <small className="muted">Calculado con la suma de las líneas del ticket.</small>}</label><label>¿Cómo se pagó?<select value={origen} onChange={(e) => { setOrigen(e.target.value); setValidacion(null); }}><option value="">Seleccionar…</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}</select></label></div>
    {fila.fuente === 'orden_manuscrita' && <div className="info-box">Captura cantidad y presentación. FIFO calculará el total en gramos, mililitros o piezas.</div>}
    {fila.notas && <div className="info-box">{fila.notas}</div>}
    {foto && <img className="ticket-preview" src={foto} alt="Fuente original" />}
    <div className="quick-lines">{lineas.map((l, i) => <LineaCompra key={l.id} linea={l} productos={productos} numero={i + 1} editar={(campo, valor) => editar(i, campo, valor)} />)}</div>
    {validacion && <div className="info-box">{validacion.errores.length > 0 && <div><strong>Errores</strong>{validacion.errores.map((d) => <div key={`${d.codigo}-${d.linea ?? ''}`}>[{d.codigo}] {d.mensaje}</div>)}</div>}{validacion.advertencias.length > 0 && <div><strong>Advertencias</strong>{validacion.advertencias.map((d) => <div key={`${d.codigo}-${d.linea ?? ''}`}>[{d.codigo}] {d.mensaje}</div>)}</div>}</div>}
    {mensaje && <div className="info-box">{mensaje}</div>}
    <div className="sticky-action">{validacion?.valida ? <button className="btn-primary" disabled={guardando} onClick={() => void confirmarRevisada()}>{guardando ? 'Confirmando…' : 'Confirmar entrada y pago'}</button> : <button className="btn-primary" disabled={validando || guardando} onClick={() => void guardarYValidar()}>{guardando ? 'Revisando…' : 'Guardar y revisar'}</button>}</div>
  </article>;
}

function fechaCompra(fecha: string) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function estadoCompraTexto(estado: string) {
  if (estado === 'confirmada') return 'Confirmada';
  if (estado === 'rechazada') return 'Rechazada';
  if (estado === 'pendiente') return 'Pendiente de revisión';
  return estado;
}

function ResumenSemana({ semana, compras, lotes }: { semana: Semana; compras: CompraDia[]; lotes: Lote[] }) {
  const totalCompras = compras.reduce((s, c) => s + c.total, 0);
  const totalFifo = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0);
  const confirmadas = compras.filter((c) => c.estado === 'confirmada').length;
  return <section className="card compras-week-summary"><div className="section-heading"><div><h2>{weekLabel(semana)}</h2><p className="muted">{weekStateLabel(semana)} · entradas</p></div><span className="muted">Semana</span></div><div className="summary-grid"><div><small>Tickets</small><strong>{compras.length}</strong><span>{confirmadas} confirmadas</span></div><div><small>Compras registradas</small><strong>{mxn(totalCompras)}</strong><span>Esta semana</span></div><div><small>Lotes FIFO recibidos</small><strong>{lotes.length}</strong><span>Recepciones</span></div><div><small>Valor recibido FIFO</small><strong>{mxn(totalFifo)}</strong><span>Valor inicial</span></div></div></section>;
}

function Tickets({ compras, cargando }: { compras: CompraDia[]; cargando: boolean }) {
  const [limite, setLimite] = useState(20);
  useEffect(() => setLimite(20), [compras]);
  const visibles = compras.slice(0, limite);
  const totalVisible = visibles.reduce((s, c) => s + c.total, 0);
  const porDia = new Map<string, CompraDia[]>();
  visibles.forEach((compra) => porDia.set(compra.fecha, [...(porDia.get(compra.fecha) ?? []), compra]));
  if (cargando) return <section className="card"><Cargando etiqueta="Cargando tickets…" /></section>;
  if (!compras.length) return <div className="empty-state"><strong>No hay tickets capturados</strong><p>Las compras ingresadas aparecerán aquí, agrupadas por fecha y proveedor.</p></div>;
  return <section className="card tickets-panel">
    <div className="section-heading"><div><h2>Compras por ticket</h2><p className="muted">Tickets capturados.</p></div></div>
    <div className="tickets-summary"><strong>{compras.length} tickets registrados</strong><span>{mxn(totalVisible)} en la vista</span></div>
    <div className="ticket-list">{Array.from(porDia.entries()).map(([fecha, filas]) => <section className="ticket-day" key={fecha}>
      <div className="ticket-day__head"><strong>{fechaCompra(fecha)}</strong><span>{filas.length} {filas.length === 1 ? 'ticket' : 'tickets'}</span></div>
      {filas.map((c) => <details className="ticket-card" key={c.id}>
        <summary><span><strong>{c.proveedor || 'Compra sin proveedor'}</strong><small>{c.ticket_ref || 'Sin folio'} · {estadoCompraTexto(c.estado)}</small></span><span><strong>{mxn(c.total)}</strong><small>{c.origen_pago || 'Pago no registrado'}</small></span></summary>
        <div className="ticket-lines">{c.lineas.length ? c.lineas.map((linea, i) => <div className="ticket-line" key={`${c.id}-${i}`}><span><small>{linea.tipo === 'gasto' ? 'Gasto' : 'Inventario'}</small>{linea.producto}</span><strong>{mxn(linea.importe)}</strong></div>) : <p className="muted">Este ticket no tiene líneas detalladas.</p>}{c.foto && <TicketSource purchaseId={c.id} />}</div>
      </details>)}
    </section>)}</div>
    {compras.length > limite && <button className="btn-secondary tickets-more" onClick={() => setLimite((n) => Math.min(n + 20, compras.length))}>Mostrar más ({compras.length - limite} restantes)</button>}
  </section>;
}

function TicketSource({ purchaseId }: { purchaseId: number }) {
  const [foto, setFoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function abrir() {
    try {
      const r = await api<{ mime: string; data: string }>(`/inventario/compras/${purchaseId}/foto`);
      setFoto(`data:${r.mime};base64,${r.data}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la fuente.'); }
  }
  return <div className="ticket-source"><button className="btn-ghost" onClick={() => void abrir()}>{foto ? 'Ocultar fuente' : 'Ver recibo original'}</button>{foto && <img className="ticket-preview" src={foto} alt="Recibo original" />}{error && <small className="error-msg">{error}</small>}</div>;
}

function Lotes({ lotes }: { lotes: Lote[] }) {
  const [limite, setLimite] = useState(50);
  useEffect(() => setLimite(50), [lotes]);
  if (!lotes.length) return <div className="empty-state"><strong>No hay lotes FIFO registrados</strong><p>Confirma una compra para crear el primer lote.</p></div>;
  const visibles = lotes.slice(0, limite);
  return <section className="card fifo-panel"><details>
    <summary><span><strong>Libro de lotes FIFO</strong><small>Ordenado por recepción; el más antiguo sale primero.</small></span><span className="fifo-panel__count">{lotes.length} lotes</span></summary>
    <div className="fifo-panel__body"><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Ticket</th><th>Inicial</th><th>Restante</th><th>Costo base</th><th>Estado</th></tr></thead><tbody>{visibles.map((l) => <tr key={l.id}><td>{l.recibido_at}</td><td><strong>{l.producto}</strong><small className="muted">{l.unidad_base ?? 'sin unidad'}</small></td><td>{l.ticket_ref ?? '—'}</td><td>{l.cantidad_inicial}</td><td>{l.cantidad_restante}</td><td>{mxn(l.costo_unitario)}</td><td><span className={`status status--${l.estado === 'abierto' ? 'ok' : 'cargando'}`}>{l.estado}</span></td></tr>)}</tbody></table></div><div className="fifo-panel__footer"><span className="muted">Mostrando {visibles.length} de {lotes.length} lotes.</span>{lotes.length > limite && <button className="btn-secondary" onClick={() => setLimite((n) => Math.min(n + 50, lotes.length))}>Mostrar 50 más</button>}{limite > 50 && <button className="btn-ghost" onClick={() => setLimite(50)}>Ver sólo los primeros 50</button>}</div></div>
  </details></section>;
}

function EposPanel(props: { from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; preview: ConsumoResult | null; consultando: boolean; consultar: (confirmar?: boolean) => void; focus?: string }) {
  const [excepciones, setExcepciones] = useState<ExceptionRow[]>([]);
  const [estado, setEstado] = useState<LiveStatus | null>(null);
  useEffect(() => {
    const desde = `${props.from}T00:00:00-06:00`;
    const hasta = finEposExclusivo(props.to);
    api<ExceptionRow[]>(`/epos/exceptions?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`).then(setExcepciones).catch(() => setExcepciones([]));
    api<LiveStatus>('/inventario/fifo/live-status').then(setEstado).catch(() => setEstado(null));
  }, [props.from, props.to]);
  useEffect(() => {
    if (props.focus !== 'ventas-pendientes') return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>('[data-epos-target="ventas-pendientes"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    return () => window.clearTimeout(timer);
  }, [props.focus]);
  const puedeConfirmar = !!props.preview && props.preview.costeadas > 0;
  return <section className={`card compras-epos ${props.focus === 'ventas-pendientes' ? 'compras-epos--focus' : ''}`}><div className="quick-purchase__intro"><span className="quick-purchase__step">2</span><div><h2>Estado FIFO en vivo</h2><p className="muted">Las ventas se costean automáticamente al sincronizar Epos y las compras confirmadas agregan lotes de inmediato.</p></div></div>{estado && <div className="summary-grid"><div><small>Lotes abiertos</small><strong>{estado.lotes_abiertos}</strong><span>Se conservan entre semanas</span></div><div><small>Valor FIFO abierto</small><strong>{mxn(estado.valor_fifo_abierto)}</strong><span>Inventario disponible</span></div><div data-epos-target="ventas-pendientes"><small>Ventas pendientes</small><strong>{estado.ventas_pendientes}</strong><span>Sin receta validada</span></div><div><small>Excepciones reales</small><strong className={estado.ventas_excepcion ? 'text-danger' : ''}>{estado.ventas_excepcion}</strong><span>Mapeo o existencia</span></div></div>}<details className="fifo-advanced"><summary>Revisar o reprocesar un periodo</summary><div className="form-grid form-grid--three"><label>Desde<input type="date" value={props.from} onChange={(e) => props.setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={props.to} onChange={(e) => props.setTo(e.target.value)} /></label><div className="form-actions"><button className="btn-secondary" disabled={props.consultando} onClick={() => props.consultar(false)}>Revisar</button><button className="btn-primary" disabled={!puedeConfirmar || props.consultando} onClick={() => props.consultar(true)}>Reprocesar pendientes</button></div></div></details>{props.preview && <><div className="summary-grid"><div><small>Ventas revisadas</small><strong>{props.preview.ventas}</strong></div><div><small>Costeadas ahora</small><strong>{props.preview.costeadas}</strong></div><div><small>Excepciones reales</small><strong className={props.preview.excepciones ? 'text-danger' : ''}>{props.preview.excepciones}</strong></div><div><small>Costo aplicado</small><strong>{mxn(props.preview.costo_fifo)}</strong></div></div><div className="exception-list"><h3>Detalle de revisión</h3>{props.preview.detalle.map((d) => <div className={`exception-row ${d.estado === 'excepcion' ? 'exception-row--bad' : ''}`} key={d.venta_id}><span>{d.producto}</span><span>{d.estado === 'costeable' ? mxn(d.costo_fifo) : d.error ?? d.estado}</span></div>)}</div></>}{excepciones.length > 0 && <div className="exception-list"><h3>Excepciones del periodo ({excepciones.length})</h3>{excepciones.map((e) => <div className="exception-row exception-row--bad" key={e.venta_id}><span>{e.fecha.slice(0, 10)} · {e.producto} × {e.cantidad}</span><span>{e.error}</span></div>)}</div>}</section>;
}
