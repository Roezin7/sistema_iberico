import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Icono } from '../../icons';
import { useAuth } from '../../auth';
import { Cargando } from '../../ui/Cargando';

interface Producto { id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null }
interface Lote { id: number; producto: string; unidad_base: string | null; recibido_at: string; cantidad_inicial: number; cantidad_restante: number; costo_unitario: number; estado: string; ticket_ref: string | null }
interface ConsumoResult { confirmar: boolean; ventas: number; costeadas: number; excepciones: number; ya_costeadas: number; costo_fifo: number; detalle: { venta_id: number; producto: string; estado: string; costo_fifo: number; error: string | null }[] }
interface ExceptionRow { venta_id: number; fecha: string; producto: string; cantidad: number; error: string }
interface RefCompra { productos: Producto[]; ubicaciones: { id: number; nombre: string; tipo: string }[] }
interface LineaRapida { product_id: number | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_fuente: string; unidad_fuente: string; cantidad_base: string; unidad_compra: string; contenido_compra: string; costo_unitario: string; importe: string; confianza: number | null }
interface Pendiente { id: number; fecha_recepcion: string; proveedor: string | null; ticket_ref: string | null; total: number | null; fuente?: string; estado: string; foto: boolean; origen_pago_id: number | null; notas?: string | null; lineas: Array<{ id: number; product_id: number | null; producto: string | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_fuente: number | null; unidad_fuente: string | null; cantidad_base: number | null; unidad_compra: string | null; contenido_compra: number | null; costo_unitario: number | null; importe: number; confianza: number | null; notas: string | null }> }
interface ValidacionCompra { valida: boolean; errores: Array<{ codigo: string; mensaje: string; linea?: number; producto?: string }>; advertencias: Array<{ codigo: string; mensaje: string; linea?: number; producto?: string }> }
interface CompraDia { id: number; fecha: string; proveedor: string | null; ticket_ref: string | null; total: number; fuente?: string; estado: string; origen_pago_id: number | null; origen_pago?: string | null; lineas: { tipo: string; producto: string; importe: number }[] }
interface Semana { id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string; estado: 'abierta' | 'cerrada' }

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const hoy = new Date().toISOString().slice(0, 10);

function finEposExclusivo(fecha: string) {
  const dia = new Date(`${fecha}T12:00:00-06:00`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return `${dia.toISOString().slice(0, 10)}T00:00:00-06:00`;
}

export default function Compras() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const parametros = new URLSearchParams(window.location.search);
  const fechaInicial = parametros.get('fecha') || hoy;
  const volverAFinanzas = parametros.get('return') === 'finanzas';
  const [tab, setTab] = useState<'tickets' | 'lotes' | 'epos' | 'pendientes'>('tickets');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ubicaciones, setUbicaciones] = useState<RefCompra['ubicaciones']>([]);
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
      .then((filas) => { setSemanas(filas); setSemanaId((prev) => prev ?? filas.find((s) => s.estado === 'abierta')?.id ?? filas[0]?.id ?? null); })
      .catch((e) => setMensaje(e instanceof Error ? e.message : 'No se pudieron cargar las semanas.'))
      .finally(() => setCargandoSemanas(false));
  }, [esAdmin]);
  useEffect(() => {
    if (semana) { setFrom(semana.fecha_inicio); setTo(semana.fecha_fin); setPreview(null); }
  }, [semana?.id]);

  async function cargar() {
    setCargandoCompras(true);
    try {
      const [p, l, pend, tickets, refs] = await Promise.all([api<Producto[]>('/catalogo/products'), api<Lote[]>('/inventario/lotes'), api<Pendiente[]>('/inventario/compras/pendientes'), api<CompraDia[]>('/inventario/compras'), api<RefCompra>('/inventario/compras/referencias')]);
      setProductos(p); setLotes(l); setPendientes(pend); setCompras(tickets); setUbicaciones(refs.ubicaciones);
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
      setMensaje(confirmar ? 'Se confirmaron únicamente las ventas costeables; las excepciones quedaron pendientes.' : 'Vista previa lista. Todavía no se descontó inventario.');
      if (confirmar) await cargar();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo consultar Epos.'); }
    finally { setConsultando(false); }
  }

  return <div className="page compras-page">
    <header className="page-head"><div className="page-title"><Icono name="package" size={24} className="ttl-icon" /><h1>Registro de compras</h1></div><p className="muted">Captura tickets una sola vez; al confirmar se actualizan FIFO, el registro único y el cierre.</p>{volverAFinanzas && <Link className="inline-link" to="/finanzas">← Volver a Operación</Link>}</header>
    {esAdmin && <div className="compras-weekbar"><label>Semana de consulta<select value={semanaId ?? ''} onChange={(e) => setSemanaId(Number(e.target.value))} disabled={cargandoSemanas || !semanas.length}><option value="">{cargandoSemanas ? 'Cargando semanas…' : 'Seleccionar semana'}</option>{semanas.map((s) => <option key={s.id} value={s.id}>{s.etiqueta}{s.estado === 'cerrada' ? ' · cerrada' : ' · abierta'}</option>)}</select></label>{semana && <span className={`status status--${semana.estado === 'abierta' ? 'ok' : 'cargando'}`}>{semana.estado === 'abierta' ? 'Semana abierta' : 'Semana cerrada'}</span>}</div>}
    <CapturaRapida fechaInicial={fechaInicial} onSaved={() => { if (esAdmin) void cargar(); }} />
    {esAdmin && <nav className="tabs">
      <button className={tab === 'tickets' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('tickets'); void cargarTickets(); }}>Tickets</button>
      <button className={tab === 'lotes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('lotes'); void cargar(); }}>Lotes FIFO</button>
      <button className={tab === 'epos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('epos')}>Costeo FIFO</button>
      <button className={tab === 'pendientes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('pendientes'); void cargar(); }}>Revisión {pendientesSemana.length ? `(${pendientesSemana.length})` : ''}</button>
    </nav>}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {esAdmin && semana && <ResumenSemana semana={semana} compras={comprasSemana} lotes={lotesSemana} />}
    {esAdmin && tab === 'tickets' && <Tickets compras={comprasSemana} cargando={cargandoCompras} />}
    {esAdmin && tab === 'lotes' && <Lotes lotes={lotesSemana} />}
    {esAdmin && tab === 'epos' && <EposPanel from={from} setFrom={setFrom} to={to} setTo={setTo} preview={preview} consultando={consultando} consultar={consultarEpos} />}
    {esAdmin && tab === 'pendientes' && <Pendientes filas={pendientesSemana} productos={productosOrdenados} ubicaciones={ubicaciones} onChange={() => void cargar()} />}
  </div>;
}

export function CapturaRapida({ fechaInicial, onSaved }: { fechaInicial: string; onSaved: () => void }) {
  const [refs, setRefs] = useState<RefCompra | null>(null);
  const [fecha, setFecha] = useState(fechaInicial);
  const [proveedor, setProveedor] = useState('');
  const [ticket, setTicket] = useState('');
  const [modo, setModo] = useState<'ticket' | 'orden_manuscrita'>('ticket');
  const [total, setTotal] = useState('');
  const [origen, setOrigen] = useState('');
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<{ data: string; mime: string } | null>(null);
  const [lineas, setLineas] = useState<LineaRapida[]>([{ product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_fuente: '', unidad_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '' , confianza: null }]);
  const [mensaje, setMensaje] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cargandoRefs, setCargandoRefs] = useState(true);

  useEffect(() => {
    setCargandoRefs(true);
    api<RefCompra>('/inventario/compras/referencias')
      .then((r) => { setRefs(r); const caja = r.ubicaciones.find((u) => u.tipo === 'efectivo'); if (caja) setOrigen(String(caja.id)); })
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
      const r = await api<{ proveedor: string | null; fecha: string | null; total: number | null; lineas: Array<{ descripcion_fuente: string; product_id: number | null; cantidad: number | null; unidad_fuente: string | null; costo_unitario: number | null; importe: number; confianza: 'alta' | 'media' | 'baja' }> }>('/inventario/compras/rapidas/ocr', { method: 'POST', body: { imagen_base64: foto.data, imagen_tipo: foto.mime, modo } });
      if (r.proveedor) setProveedor(r.proveedor); if (r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) setFecha(r.fecha); if (r.total != null) setTotal(String(r.total));
      setLineas(r.lineas.map((l) => ({ product_id: l.product_id, tipo_linea: modo === 'orden_manuscrita' ? 'pendiente' : l.product_id != null && l.confianza === 'alta' ? 'inventario' : 'pendiente', descripcion_fuente: l.descripcion_fuente, cantidad_fuente: l.cantidad == null ? '' : String(l.cantidad), unidad_fuente: l.unidad_fuente ?? '', cantidad_base: modo === 'orden_manuscrita' ? '' : l.cantidad == null ? '' : String(l.cantidad), unidad_compra: '', contenido_compra: '', costo_unitario: l.costo_unitario == null ? '' : String(l.costo_unitario), importe: String(l.importe), confianza: l.confianza === 'alta' ? 0.95 : l.confianza === 'media' ? 0.7 : 0.3 })));
      setMensaje(modo === 'orden_manuscrita' ? 'Orden manuscrita leída. Confirma unidad, conversión y precio antes de clasificar.' : 'Ticket leído. Revisa cada línea y clasifica lo que no sea inventario.');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo leer el ticket; puedes capturarlo manualmente.'); }
    finally { setLeyendo(false); }
  }

  function editar(i: number, campo: keyof LineaRapida, valor: string | number | null) { setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l)); }
  async function guardar() {
    const validas = lineas.filter((l) => l.descripcion_fuente.trim() && Number(l.importe) >= 0);
    if (!fecha || (modo === 'ticket' && (!total.trim() || !origen || !Number.isFinite(Number(total)))) || !validas.length) { setMensaje(modo === 'orden_manuscrita' ? 'Completa fecha y al menos una línea. El total y el pago pueden definirse durante la revisión.' : 'Completa fecha, total, forma de pago y al menos una línea.'); return; }
    setGuardando(true); setMensaje('');
    try {
      await api('/inventario/compras/rapidas', { method: 'POST', body: { fecha_recepcion: fecha, proveedor: proveedor || null, ticket_ref: ticket || null, tipo_documento: modo, total: total.trim() ? Number(total) : null, origen_pago_id: origen ? Number(origen) : null, notas: notas || null, foto_data: foto?.data ?? null, foto_mime: foto?.mime ?? null, lineas: validas.map((l) => ({ product_id: l.product_id, tipo_linea: l.tipo_linea, descripcion_fuente: l.descripcion_fuente, cantidad_fuente: l.cantidad_fuente ? Number(l.cantidad_fuente) : null, unidad_fuente: l.unidad_fuente || null, cantidad_base: l.cantidad_base ? Number(l.cantidad_base) : null, unidad_compra: l.unidad_compra || null, contenido_compra: l.contenido_compra ? Number(l.contenido_compra) : null, costo_unitario: l.costo_unitario ? Number(l.costo_unitario) : null, importe: Number(l.importe || 0), confianza: l.confianza })) } });
      setMensaje('Captura enviada a revisión. No afecta FIFO ni caja hasta confirmarla.'); setProveedor(''); setTicket(''); setTotal(''); setNotas(''); setFoto(null); setLineas([{ product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_fuente: '', unidad_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '', confianza: null }]); onSaved();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo guardar la compra.'); }
    finally { setGuardando(false); }
  }

  return <section className="card quick-purchase" aria-labelledby="captura-compra-titulo"><div className="quick-purchase__intro"><span className="quick-purchase__step">1</span><div><h2 id="captura-compra-titulo">Capturar compra</h2><p className="muted">Foto de la fuente → revisa líneas → envía a revisión.</p></div></div>
    <div className="quick-purchase__mode"><strong>Tipo de fuente</strong><button className={modo === 'ticket' ? 'tab tab--on' : 'tab'} onClick={() => setModo('ticket')}>Ticket final</button><button className={modo === 'orden_manuscrita' ? 'tab tab--on' : 'tab'} onClick={() => setModo('orden_manuscrita')}>Orden manuscrita</button><span className="muted">{modo === 'orden_manuscrita' ? 'Lee unidades y deja precios pendientes para revisión.' : 'Extrae total e importes del ticket.'}</span></div>
    <div className="quick-purchase__actions"><label className="btn-primary file-button">📷 Foto de {modo === 'orden_manuscrita' ? 'la orden' : 'ticket'}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(e) => fotoSeleccionada(e.target.files?.[0])} /></label><button className="btn-secondary" onClick={() => void leerTicket()} disabled={!foto || leyendo}>{leyendo ? 'Leyendo…' : 'Leer fuente'}</button></div>
    {cargandoRefs && <div className="quick-purchase__loading"><Cargando etiqueta="Preparando captura de compras…" /></div>}
    {foto && <img className="ticket-preview" src={foto.data} alt="Vista previa del ticket" />}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    <div className="quick-purchase__section-label">Datos de la fuente</div><div className="form-grid form-grid--three"><label>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><label>Proveedor<input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej. Costco o proveedor local" /></label><label>Ticket / folio<input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Opcional" /></label><label>Total {modo === 'orden_manuscrita' && '(opcional)'}<input type="number" min="0" step="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label><label>Pago desde {modo === 'orden_manuscrita' && '(se define al confirmar)'}<select value={origen} onChange={(e) => setOrigen(e.target.value)} disabled={cargandoRefs}><option value="">{cargandoRefs ? 'Cargando…' : 'Seleccionar…'}</option>{refs?.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}</select></label></div>
    <div className="quick-lines">{lineas.map((l, i) => <div className="quick-line" key={i}><div className="quick-line__head"><strong>Línea {i + 1}</strong>{l.confianza != null && <span className="muted">sugerencia {Math.round(l.confianza * 100)}%</span>}</div><input placeholder="Descripción de la fuente" value={l.descripcion_fuente} onChange={(e) => editar(i, 'descripcion_fuente', e.target.value)} /><select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value as LineaRapida['tipo_linea'])}><option value="pendiente">Pendiente de clasificar</option><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option></select>{l.tipo_linea === 'inventario' && <select value={l.product_id ?? ''} onChange={(e) => editar(i, 'product_id', e.target.value ? Number(e.target.value) : null)}><option value="">Producto…</option>{refs?.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.unidad_base ?? 'sin unidad'}</option>)}</select>}<div className="quick-line__numbers"><input type="number" min="0" step="any" placeholder={modo === 'orden_manuscrita' ? 'Cantidad fuente' : 'Cantidad base'} value={l.cantidad_fuente} onChange={(e) => editar(i, 'cantidad_fuente', e.target.value)} /><input placeholder={modo === 'orden_manuscrita' ? 'Unidad (kg, pz…)' : 'Unidad de compra'} value={modo === 'orden_manuscrita' ? l.unidad_fuente : l.unidad_compra} onChange={(e) => editar(i, modo === 'orden_manuscrita' ? 'unidad_fuente' : 'unidad_compra', e.target.value)} /><input type="number" min="0" step="any" placeholder={modo === 'orden_manuscrita' ? 'Cantidad base convertida' : 'Cantidad base'} value={l.cantidad_base} onChange={(e) => editar(i, 'cantidad_base', e.target.value)} /><input type="number" min="0" step="0.01" placeholder="Importe" value={l.importe} onChange={(e) => editar(i, 'importe', e.target.value)} /></div>{lineas.length > 1 && <button className="btn-ghost" onClick={() => setLineas((v) => v.filter((_, idx) => idx !== i))}>Quitar</button>}</div>)}</div>
    <div className="sticky-action"><button className="btn-secondary" onClick={() => setLineas((v) => [...v, { product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_fuente: '', unidad_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '', confianza: null }])}>Agregar línea</button><button className="btn-primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Enviando…' : 'Enviar a revisión'}</button></div>
    <div className="info-box quick-purchase__single-source"><strong>Registro único:</strong> después de enviar, revisa y confirma el ticket en la pestaña <button className="link-btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Revisión</button>. Una compra confirmada aparece automáticamente en FIFO, el registro de operaciones y el cierre del día.</div>
  </section>;
}

function Pendientes({ filas, productos, ubicaciones, onChange }: { filas: Pendiente[]; productos: Producto[]; ubicaciones: RefCompra['ubicaciones']; onChange: () => void }) {
  if (!filas.length) return <div className="empty-state"><strong>No hay compras pendientes</strong><p>Las capturas nuevas aparecerán aquí para revisión.</p></div>;
  return <section className="quick-pending">{filas.map((f) => <PendienteCard key={f.id} fila={f} productos={productos} ubicaciones={ubicaciones} onChange={onChange} />)}</section>;
}

function PendienteCard({ fila, productos, ubicaciones, onChange }: { fila: Pendiente; productos: Producto[]; ubicaciones: RefCompra['ubicaciones']; onChange: () => void }) {
  const [lineas, setLineas] = useState(fila.lineas);
  const [total, setTotal] = useState(fila.total == null ? '' : String(fila.total));
  const [origen, setOrigen] = useState(fila.origen_pago_id == null ? '' : String(fila.origen_pago_id));
  const [foto, setFoto] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [validacion, setValidacion] = useState<ValidacionCompra | null>(null);
  const [validando, setValidando] = useState(false);
  const editar = (i: number, campo: string, valor: unknown) => setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l));
  async function guardarLineas() { await api(`/inventario/compras/${fila.id}/lineas`, { method: 'PUT', body: { total: total.trim() ? Number(total) : null, lineas: lineas.map((l) => ({ ...l, product_id: l.product_id ? Number(l.product_id) : null, cantidad_fuente: l.cantidad_fuente == null ? null : Number(l.cantidad_fuente), unidad_fuente: l.unidad_fuente || null, cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base), contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra), costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario), importe: Number(l.importe) })) } }); }
  function payloadLineas() { return lineas.map((l) => ({ ...l, product_id: l.product_id ? Number(l.product_id) : null, cantidad_fuente: l.cantidad_fuente == null ? null : Number(l.cantidad_fuente), unidad_fuente: l.unidad_fuente || null, cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base), contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra), costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario), importe: Number(l.importe) })); }
  async function validar() { if (!total.trim() || !Number.isFinite(Number(total))) { setMensaje('Completa el total de la orden manuscrita antes de validar.'); return null; } setValidando(true); try { const r = await api<ValidacionCompra>('/inventario/compras/validar', { method: 'POST', body: { total: Number(total), lineas: payloadLineas() } }); setValidacion(r); setMensaje(r.errores.length ? 'Corrige los errores antes de confirmar.' : r.advertencias.length ? 'Hay advertencias; puedes confirmarlas después de revisarlas.' : 'Validación correcta.'); return r; } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo validar la compra.'); return null; } finally { setValidando(false); } }
  async function confirmar() { try { if (!origen) { setMensaje('Selecciona el origen del pago antes de confirmar.'); return; } await api(`/inventario/compras/${fila.id}/pago`, { method: 'PATCH', body: { origen_pago_id: Number(origen) } }); const r = await validar(); if (!r || r.errores.length) return; await guardarLineas(); const confirmada = await api<{ discrepancias?: ValidacionCompra['advertencias'] }>(`/inventario/compras/${fila.id}/confirmar`, { method: 'POST', body: {} }); setMensaje(confirmada.discrepancias?.length ? `Compra confirmada con ${confirmada.discrepancias.length} advertencia(s) registrada(s).` : 'Compra confirmada: FIFO y cierre actualizados.'); onChange(); } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo confirmar'); } }
  async function rechazar() { const nota = window.prompt('Motivo del rechazo') || ''; await api(`/inventario/compras/${fila.id}/rechazar`, { method: 'POST', body: { nota } }); onChange(); }
  async function verFoto() { const r = await api<{ mime: string; data: string }>(`/inventario/compras/${fila.id}/foto`); setFoto(`data:${r.mime};base64,${r.data}`); }
  return <article className="card quick-pending__card"><div className="section-heading"><div><h2>{fila.proveedor || 'Compra sin proveedor'}</h2><p className="muted">{fila.fecha_recepcion} · {fila.fuente === 'orden_manuscrita' ? 'orden manuscrita' : (fila.ticket_ref || 'sin folio')} · {fila.total == null ? 'total pendiente' : mxn(fila.total)}</p></div>{fila.foto && <button className="btn-secondary" onClick={() => void verFoto()}>Ver fuente</button>}</div>{fila.fuente === 'orden_manuscrita' && <div className="info-box">Orden manuscrita: confirma cantidades, unidades, conversiones, precios y total antes de crear FIFO.</div>}{fila.notas && <div className="info-box">{fila.notas}</div>}{foto && <img className="ticket-preview" src={foto} alt="Fuente original" />}<div className="quick-lines">{lineas.map((l, i) => <div className="quick-line" key={l.id}><strong>{l.descripcion_fuente}</strong>{(l.cantidad_fuente != null || l.unidad_fuente) && <small className="muted">Fuente: {l.cantidad_fuente ?? '—'} {l.unidad_fuente ?? ''}</small>}<select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value)}><option value="pendiente">Pendiente</option><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option></select>{l.tipo_linea === 'inventario' && <select value={l.product_id ?? ''} onChange={(e) => editar(i, 'product_id', e.target.value ? Number(e.target.value) : null)}><option value="">Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}<div className="quick-line__numbers"><input type="number" min="0" step="any" value={l.cantidad_base ?? ''} placeholder="Cantidad base convertida" onChange={(e) => editar(i, 'cantidad_base', e.target.value)} /><input value={l.unidad_compra ?? ''} placeholder="Unidad de compra" onChange={(e) => editar(i, 'unidad_compra', e.target.value)} /><input type="number" min="0" step="0.01" value={l.importe} placeholder="Importe" onChange={(e) => editar(i, 'importe', e.target.value)} /></div></div>)}</div>{validacion && <div className="info-box">{validacion.errores.length > 0 && <div><strong>Errores</strong>{validacion.errores.map((d) => <div key={`${d.codigo}-${d.linea ?? ''}`}>[{d.codigo}] {d.mensaje}</div>)}</div>}{validacion.advertencias.length > 0 && <div><strong>Advertencias</strong>{validacion.advertencias.map((d) => <div key={`${d.codigo}-${d.linea ?? ''}`}>[{d.codigo}] {d.mensaje}</div>)}</div>}</div>}{mensaje && <div className="info-box">{mensaje}</div>}<div className="sticky-action"><button className="btn-secondary" disabled={validando} onClick={() => void validar()}>{validando ? 'Validando…' : 'Validar discrepancias'}</button><button className="btn-secondary" onClick={() => void rechazar()}>Rechazar</button><button className="btn-primary" onClick={() => void confirmar()}>Guardar y confirmar</button></div></article>;
}

function fechaCompra(fecha: string) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function ResumenSemana({ semana, compras, lotes }: { semana: Semana; compras: CompraDia[]; lotes: Lote[] }) {
  const totalCompras = compras.reduce((s, c) => s + c.total, 0);
  const totalFifo = lotes.reduce((s, l) => s + l.cantidad_inicial * l.costo_unitario, 0);
  const confirmadas = compras.filter((c) => c.estado === 'confirmada').length;
  return <section className="card compras-week-summary"><div className="section-heading"><div><h2>{semana.etiqueta}</h2><p className="muted">{semana.estado === 'abierta' ? 'En operación' : 'Cierre histórico'}</p></div><span className="muted">Vista semanal</span></div><div className="summary-grid"><div><small>Tickets</small><strong>{compras.length}</strong><span>{confirmadas} confirmadas</span></div><div><small>Compras registradas</small><strong>{mxn(totalCompras)}</strong><span>Según tickets de la semana</span></div><div><small>Lotes FIFO recibidos</small><strong>{lotes.length}</strong><span>Ordenados por recepción</span></div><div><small>Valor recibido FIFO</small><strong>{mxn(totalFifo)}</strong><span>Valor inicial de los lotes</span></div></div></section>;
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
    <div className="section-heading"><div><h2>Compras por ticket</h2><p className="muted">Registro de compras capturadas, ordenado del más reciente al más antiguo. Abre un ticket para ver sus líneas.</p></div></div>
    <div className="tickets-summary"><strong>{compras.length} tickets registrados</strong><span>{mxn(totalVisible)} en la vista</span></div>
    <div className="ticket-list">{Array.from(porDia.entries()).map(([fecha, filas]) => <section className="ticket-day" key={fecha}>
      <div className="ticket-day__head"><strong>{fechaCompra(fecha)}</strong><span>{filas.length} {filas.length === 1 ? 'ticket' : 'tickets'}</span></div>
      {filas.map((c) => <details className="ticket-card" key={c.id}>
        <summary><span><strong>{c.proveedor || 'Compra sin proveedor'}</strong><small>{c.ticket_ref || 'Sin folio'} · {c.estado}</small></span><span><strong>{mxn(c.total)}</strong><small>{c.origen_pago || 'Pago no registrado'}</small></span></summary>
        <div className="ticket-lines">{c.lineas.length ? c.lineas.map((linea, i) => <div className="ticket-line" key={`${c.id}-${i}`}><span><small>{linea.tipo === 'gasto' ? 'Gasto' : 'Inventario'}</small>{linea.producto}</span><strong>{mxn(linea.importe)}</strong></div>) : <p className="muted">Este ticket no tiene líneas detalladas.</p>}</div>
      </details>)}
    </section>)}</div>
    {compras.length > limite && <button className="btn-secondary tickets-more" onClick={() => setLimite((n) => Math.min(n + 20, compras.length))}>Mostrar más ({compras.length - limite} restantes)</button>}
  </section>;
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

function EposPanel(props: { from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; preview: ConsumoResult | null; consultando: boolean; consultar: (confirmar?: boolean) => void }) {
  const [excepciones, setExcepciones] = useState<ExceptionRow[]>([]);
  useEffect(() => {
    const desde = `${props.from}T00:00:00-06:00`;
    const hasta = finEposExclusivo(props.to);
    api<ExceptionRow[]>(`/epos/exceptions?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`).then(setExcepciones).catch(() => setExcepciones([]));
  }, [props.from, props.to]);
  const puedeConfirmar = !!props.preview && props.preview.costeadas > 0;
  return <section className="card compras-epos"><div className="quick-purchase__intro"><span className="quick-purchase__step">2</span><div><h2>Costeo FIFO</h2><p className="muted">Las ventas se importan desde Cierre. Aquí sólo se revisa y aplica el costo FIFO.</p></div></div><div className="form-grid form-grid--three"><label>Desde<input type="date" value={props.from} onChange={(e) => props.setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={props.to} onChange={(e) => props.setTo(e.target.value)} /></label><div className="form-actions"><button className="btn-secondary" disabled={props.consultando} onClick={() => props.consultar(false)}>Revisar costo</button><button className="btn-primary" disabled={!puedeConfirmar || props.consultando} onClick={() => props.consultar(true)}>Aplicar costo FIFO</button></div></div>{props.preview && <><div className="summary-grid"><div><small>Ventas importadas</small><strong>{props.preview.ventas}</strong></div><div><small>Costeables</small><strong>{props.preview.costeadas}</strong></div><div><small>Excepciones</small><strong className={props.preview.excepciones ? 'text-danger' : ''}>{props.preview.excepciones}</strong></div><div><small>Costo FIFO</small><strong>{mxn(props.preview.costo_fifo)}</strong></div></div><div className="exception-list"><h3>Detalle de costeo</h3>{props.preview.detalle.map((d) => <div className={`exception-row ${d.estado === 'excepcion' ? 'exception-row--bad' : ''}`} key={d.venta_id}><span>{d.producto}</span><span>{d.estado === 'costeable' ? mxn(d.costo_fifo) : d.error ?? d.estado}</span></div>)}</div></>}{excepciones.length > 0 && <div className="exception-list"><h3>Excepciones guardadas ({excepciones.length})</h3>{excepciones.map((e) => <div className="exception-row exception-row--bad" key={e.venta_id}><span>{e.fecha.slice(0, 10)} · {e.producto} × {e.cantidad}</span><span>{e.error}</span></div>)}</div>}</section>;
}
