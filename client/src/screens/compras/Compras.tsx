import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';
import { useAuth } from '../../auth';

interface Producto { id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null }
interface Lote { id: number; producto: string; unidad_base: string | null; recibido_at: string; cantidad_inicial: number; cantidad_restante: number; costo_unitario: number; estado: string; ticket_ref: string | null }
interface ConsumoResult { confirmar: boolean; ventas: number; costeadas: number; excepciones: number; ya_costeadas: number; costo_fifo: number; detalle: { venta_id: number; producto: string; estado: string; costo_fifo: number; error: string | null }[] }
interface ExceptionRow { venta_id: number; fecha: string; producto: string; cantidad: number; error: string }
interface RefCompra { productos: Producto[]; ubicaciones: { id: number; nombre: string; tipo: string }[] }
interface LineaRapida { product_id: number | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_base: string; unidad_compra: string; contenido_compra: string; costo_unitario: string; importe: string; confianza: number | null }
interface Pendiente { id: number; fecha_recepcion: string; proveedor: string | null; ticket_ref: string | null; total: number; estado: string; foto: boolean; origen_pago_id: number | null; lineas: Array<{ id: number; product_id: number | null; producto: string | null; tipo_linea: 'inventario' | 'gasto' | 'pendiente'; descripcion_fuente: string; cantidad_base: number | null; unidad_compra: string | null; contenido_compra: number | null; costo_unitario: number | null; importe: number; confianza: number | null; notas: string | null }> }
interface CompraDia { id: number; fecha: string; proveedor: string | null; ticket_ref: string | null; total: number; estado: string; lineas: { tipo: string; producto: string; importe: number }[] }

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
  const fechaInicial = new URLSearchParams(window.location.search).get('fecha') || hoy;
  const [tab, setTab] = useState<'lotes' | 'epos' | 'pendientes'>('lotes');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [from, setFrom] = useState(hoy);
  const [to, setTo] = useState(hoy);
  const [preview, setPreview] = useState<ConsumoResult | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);

  const productosOrdenados = useMemo(() => [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre)), [productos]);
  useEffect(() => { if (esAdmin) void cargar(); }, [esAdmin]);

  async function cargar() {
    try {
      const [p, l, pend] = await Promise.all([api<Producto[]>('/catalogo/products'), api<Lote[]>('/inventario/lotes'), api<Pendiente[]>('/inventario/compras/pendientes')]);
      setProductos(p); setLotes(l);
      setPendientes(pend);
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar el inventario.'); }
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

  return <div className="page">
    <header className="page-head"><div className="page-title"><Icono name="package" size={24} className="ttl-icon" /><h1>Compras e inventario FIFO</h1></div><p className="muted">Cada compra confirmada crea lotes con su costo real.</p></header>
    <CapturaRapida fechaInicial={fechaInicial} onSaved={() => { if (esAdmin) void cargar(); }} />
    {esAdmin && <nav className="tabs">
      <button className={tab === 'lotes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('lotes'); void cargar(); }}>Lotes FIFO</button>
      <button className={tab === 'epos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('epos')}>Ventas Epos y excepciones</button>
      <button className={tab === 'pendientes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('pendientes'); void cargar(); }}>Pendientes {pendientes.length ? `(${pendientes.length})` : ''}</button>
    </nav>}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {esAdmin && tab === 'lotes' && <Lotes lotes={lotes} />}
    {esAdmin && tab === 'epos' && <EposPanel from={from} setFrom={setFrom} to={to} setTo={setTo} preview={preview} consultando={consultando} consultar={consultarEpos} />}
    {esAdmin && tab === 'pendientes' && <Pendientes filas={pendientes} productos={productosOrdenados} onChange={() => void cargar()} />}
  </div>;
}

function CapturaRapida({ fechaInicial, onSaved }: { fechaInicial: string; onSaved: () => void }) {
  const [refs, setRefs] = useState<RefCompra | null>(null);
  const [fecha, setFecha] = useState(fechaInicial);
  const [proveedor, setProveedor] = useState('');
  const [ticket, setTicket] = useState('');
  const [total, setTotal] = useState('');
  const [origen, setOrigen] = useState('');
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<{ data: string; mime: string } | null>(null);
  const [lineas, setLineas] = useState<LineaRapida[]>([{ product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '' , confianza: null }]);
  const [mensaje, setMensaje] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [comprasDia, setComprasDia] = useState<CompraDia[]>([]);

  useEffect(() => { api<RefCompra>('/inventario/compras/referencias').then((r) => { setRefs(r); const caja = r.ubicaciones.find((u) => u.tipo === 'efectivo'); if (caja) setOrigen(String(caja.id)); }).catch(() => setMensaje('No se pudieron cargar las referencias de compra.')); }, []);
  async function cargarDia() { try { setComprasDia(await api<CompraDia[]>(`/inventario/compras?fecha=${encodeURIComponent(fecha)}`)); } catch { setComprasDia([]); } }
  useEffect(() => { void cargarDia(); }, [fecha]);

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
      const r = await api<{ proveedor: string | null; fecha: string | null; total: number | null; lineas: Array<{ descripcion_fuente: string; product_id: number | null; cantidad: number | null; costo_unitario: number | null; importe: number; confianza: 'alta' | 'media' | 'baja' }> }>('/inventario/compras/rapidas/ocr', { method: 'POST', body: { imagen_base64: foto.data, imagen_tipo: foto.mime } });
      if (r.proveedor) setProveedor(r.proveedor); if (r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) setFecha(r.fecha); if (r.total != null) setTotal(String(r.total));
      setLineas(r.lineas.map((l) => ({ product_id: l.product_id, tipo_linea: l.product_id != null && l.confianza === 'alta' ? 'inventario' : 'pendiente', descripcion_fuente: l.descripcion_fuente, cantidad_base: l.cantidad == null ? '' : String(l.cantidad), unidad_compra: '', contenido_compra: '', costo_unitario: l.costo_unitario == null ? '' : String(l.costo_unitario), importe: String(l.importe), confianza: l.confianza === 'alta' ? 0.95 : l.confianza === 'media' ? 0.7 : 0.3 })));
      setMensaje('Ticket leído. Revisa cada línea y clasifica lo que no sea inventario.');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo leer el ticket; puedes capturarlo manualmente.'); }
    finally { setLeyendo(false); }
  }

  function editar(i: number, campo: keyof LineaRapida, valor: string | number | null) { setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l)); }
  async function guardar() {
    const validas = lineas.filter((l) => l.descripcion_fuente.trim() && Number(l.importe) >= 0);
    if (!fecha || !total.trim() || !origen || !validas.length || !Number.isFinite(Number(total))) { setMensaje('Completa fecha, total, forma de pago y al menos una línea.'); return; }
    setGuardando(true); setMensaje('');
    try {
      await api('/inventario/compras/rapidas', { method: 'POST', body: { fecha_recepcion: fecha, proveedor: proveedor || null, ticket_ref: ticket || null, total: Number(total), origen_pago_id: Number(origen), notas: notas || null, foto_data: foto?.data ?? null, foto_mime: foto?.mime ?? null, lineas: validas.map((l) => ({ product_id: l.product_id, tipo_linea: l.tipo_linea, descripcion_fuente: l.descripcion_fuente, cantidad_base: l.cantidad_base ? Number(l.cantidad_base) : null, unidad_compra: l.unidad_compra || null, contenido_compra: l.contenido_compra ? Number(l.contenido_compra) : null, costo_unitario: l.costo_unitario ? Number(l.costo_unitario) : null, importe: Number(l.importe), confianza: l.confianza })) } });
      setMensaje('Compra enviada a revisión. No afecta FIFO ni caja hasta confirmarla.'); setProveedor(''); setTicket(''); setTotal(''); setNotas(''); setFoto(null); setLineas([{ product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '', confianza: null }]); await cargarDia(); onSaved();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo guardar la compra.'); }
    finally { setGuardando(false); }
  }

  return <section className="card quick-purchase"><div className="section-heading"><div><h2>Compra rápida</h2><p className="muted">Toma una foto, revisa las líneas y envíala a revisión. La confirmación crea FIFO y el movimiento del corte.</p></div></div>
    <div className="quick-purchase__actions"><label className="btn-primary file-button">📷 Tomar foto<input type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" onChange={(e) => fotoSeleccionada(e.target.files?.[0])} /></label><button className="btn-secondary" onClick={() => void leerTicket()} disabled={!foto || leyendo}>{leyendo ? 'Leyendo…' : 'Leer ticket'}</button></div>
    {foto && <img className="ticket-preview" src={foto.data} alt="Vista previa del ticket" />}
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    <div className="form-grid form-grid--three"><label>Fecha<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><label>Proveedor<input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej. Costco" /></label><label>Ticket / folio<input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Opcional, evita duplicados" /></label><label>Total del ticket<input type="number" min="0" step="0.01" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label><label>Pago desde<select value={origen} onChange={(e) => setOrigen(e.target.value)}><option value="">Seleccionar…</option>{refs?.ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.tipo}</option>)}</select></label></div>
    <div className="quick-lines">{lineas.map((l, i) => <div className="quick-line" key={i}><div className="quick-line__head"><strong>Línea {i + 1}</strong>{l.confianza != null && <span className="muted">sugerencia {Math.round(l.confianza * 100)}%</span>}</div><input placeholder="Descripción del ticket" value={l.descripcion_fuente} onChange={(e) => editar(i, 'descripcion_fuente', e.target.value)} /><select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value as LineaRapida['tipo_linea'])}><option value="pendiente">Pendiente de clasificar</option><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option></select>{l.tipo_linea === 'inventario' && <select value={l.product_id ?? ''} onChange={(e) => editar(i, 'product_id', e.target.value ? Number(e.target.value) : null)}><option value="">Producto…</option>{refs?.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.unidad_base ?? 'sin unidad'}</option>)}</select>}<div className="quick-line__numbers"><input type="number" min="0" step="any" placeholder="Cantidad base" value={l.cantidad_base} onChange={(e) => editar(i, 'cantidad_base', e.target.value)} /><input type="number" min="0" step="0.01" placeholder="Importe" value={l.importe} onChange={(e) => editar(i, 'importe', e.target.value)} /></div>{lineas.length > 1 && <button className="btn-ghost" onClick={() => setLineas((v) => v.filter((_, idx) => idx !== i))}>Quitar</button>}</div>)}</div>
    <div className="sticky-action"><button className="btn-secondary" onClick={() => setLineas((v) => [...v, { product_id: null, tipo_linea: 'pendiente', descripcion_fuente: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario: '', importe: '', confianza: null }])}>Agregar línea</button><button className="btn-primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Enviando…' : 'Enviar a revisión'}</button></div>
    <div className="quick-day"><div className="section-heading"><div><h3>Compras del día</h3><p className="muted">Una compra confirmada aparece aquí y en el cierre diario.</p></div></div>{comprasDia.length === 0 ? <p className="muted">No hay compras registradas para esta fecha.</p> : comprasDia.map((c) => <div className="quick-day__row" key={c.id}><span><strong>{c.proveedor || 'Sin proveedor'}</strong><small className="muted">{c.ticket_ref || 'sin folio'} · {c.estado}</small></span><strong>{mxn(c.total)}</strong></div>)}</div>
  </section>;
}

function Pendientes({ filas, productos, onChange }: { filas: Pendiente[]; productos: Producto[]; onChange: () => void }) {
  if (!filas.length) return <div className="empty-state"><strong>No hay compras pendientes</strong><p>Las capturas nuevas aparecerán aquí para revisión.</p></div>;
  return <section className="quick-pending">{filas.map((f) => <PendienteCard key={f.id} fila={f} productos={productos} onChange={onChange} />)}</section>;
}

function PendienteCard({ fila, productos, onChange }: { fila: Pendiente; productos: Producto[]; onChange: () => void }) {
  const [lineas, setLineas] = useState(fila.lineas);
  const [foto, setFoto] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const editar = (i: number, campo: string, valor: unknown) => setLineas((v) => v.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l));
  async function guardarLineas() { await api(`/inventario/compras/${fila.id}/lineas`, { method: 'PUT', body: { lineas: lineas.map((l) => ({ ...l, product_id: l.product_id ? Number(l.product_id) : null, cantidad_base: l.cantidad_base == null ? null : Number(l.cantidad_base), contenido_compra: l.contenido_compra == null ? null : Number(l.contenido_compra), costo_unitario: l.costo_unitario == null ? null : Number(l.costo_unitario), importe: Number(l.importe) })) } }); }
  async function confirmar() { try { await guardarLineas(); await api(`/inventario/compras/${fila.id}/confirmar`, { method: 'POST', body: {} }); setMensaje('Compra confirmada: FIFO y cierre actualizados.'); onChange(); } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo confirmar'); } }
  async function rechazar() { const nota = window.prompt('Motivo del rechazo') || ''; await api(`/inventario/compras/${fila.id}/rechazar`, { method: 'POST', body: { nota } }); onChange(); }
  async function verFoto() { const r = await api<{ mime: string; data: string }>(`/inventario/compras/${fila.id}/foto`); setFoto(`data:${r.mime};base64,${r.data}`); }
  return <article className="card quick-pending__card"><div className="section-heading"><div><h2>{fila.proveedor || 'Compra sin proveedor'}</h2><p className="muted">{fila.fecha_recepcion} · {fila.ticket_ref || 'sin folio'} · {mxn(fila.total)}</p></div>{fila.foto && <button className="btn-secondary" onClick={() => void verFoto()}>Ver ticket</button>}</div>{foto && <img className="ticket-preview" src={foto} alt="Ticket original" />}<div className="quick-lines">{lineas.map((l, i) => <div className="quick-line" key={l.id}><strong>{l.descripcion_fuente}</strong><select value={l.tipo_linea} onChange={(e) => editar(i, 'tipo_linea', e.target.value)}><option value="pendiente">Pendiente</option><option value="inventario">Inventario FIFO</option><option value="gasto">Gasto operativo</option></select>{l.tipo_linea === 'inventario' && <select value={l.product_id ?? ''} onChange={(e) => editar(i, 'product_id', e.target.value ? Number(e.target.value) : null)}><option value="">Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}<div className="quick-line__numbers"><input type="number" min="0" step="any" value={l.cantidad_base ?? ''} placeholder="Cantidad base" onChange={(e) => editar(i, 'cantidad_base', e.target.value)} /><input type="number" min="0" step="0.01" value={l.importe} placeholder="Importe" onChange={(e) => editar(i, 'importe', e.target.value)} /></div></div>)}</div>{mensaje && <div className="info-box">{mensaje}</div>}<div className="sticky-action"><button className="btn-secondary" onClick={() => void rechazar()}>Rechazar</button><button className="btn-primary" onClick={() => void confirmar()}>Guardar y confirmar</button></div></article>;
}

function Lotes({ lotes }: { lotes: Lote[] }) {
  if (!lotes.length) return <div className="empty-state"><strong>No hay lotes FIFO registrados</strong><p>Confirma una compra para crear el primer lote.</p></div>;
  return <section className="card"><div className="section-heading"><div><h2>Libro de lotes</h2><p className="muted">Ordenados por fecha de recepción; el más antiguo sale primero.</p></div></div><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Ticket</th><th>Inicial</th><th>Restante</th><th>Costo base</th><th>Estado</th></tr></thead><tbody>{lotes.map((l) => <tr key={l.id}><td>{l.recibido_at}</td><td><strong>{l.producto}</strong><small className="muted">{l.unidad_base ?? 'sin unidad'}</small></td><td>{l.ticket_ref ?? '—'}</td><td>{l.cantidad_inicial}</td><td>{l.cantidad_restante}</td><td>{mxn(l.costo_unitario)}</td><td><span className={`status status--${l.estado === 'abierto' ? 'ok' : 'cargando'}`}>{l.estado}</span></td></tr>)}</tbody></table></div></section>;
}

function EposPanel(props: { from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; preview: ConsumoResult | null; consultando: boolean; consultar: (confirmar?: boolean) => void }) {
  const [excepciones, setExcepciones] = useState<ExceptionRow[]>([]);
  useEffect(() => {
    const desde = `${props.from}T00:00:00-06:00`;
    const hasta = finEposExclusivo(props.to);
    api<ExceptionRow[]>(`/epos/exceptions?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`).then(setExcepciones).catch(() => setExcepciones([]));
  }, [props.from, props.to]);
  const puedeConfirmar = !!props.preview && props.preview.costeadas > 0;
  return <section className="card"><div className="section-heading"><div><h2>Ventas Epos → consumo FIFO</h2><p className="muted">Primero consulta. Sólo se descontarán ventas con receta validada y lotes suficientes.</p></div></div><div className="form-grid form-grid--three"><label>Desde<input type="date" value={props.from} onChange={(e) => props.setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={props.to} onChange={(e) => props.setTo(e.target.value)} /></label><div className="form-actions"><button className="btn-secondary" disabled={props.consultando} onClick={() => props.consultar(false)}>Vista previa</button><button className="btn-primary" disabled={!puedeConfirmar || props.consultando} onClick={() => props.consultar(true)}>Confirmar costeables</button></div></div>{props.preview && <><div className="summary-grid"><div><small>Ventas</small><strong>{props.preview.ventas}</strong></div><div><small>Costeables</small><strong>{props.preview.costeadas}</strong></div><div><small>Excepciones</small><strong className={props.preview.excepciones ? 'text-danger' : ''}>{props.preview.excepciones}</strong></div><div><small>Costo FIFO</small><strong>{mxn(props.preview.costo_fifo)}</strong></div></div><div className="exception-list"><h3>Revisión de esta consulta</h3>{props.preview.detalle.map((d) => <div className={`exception-row ${d.estado === 'excepcion' ? 'exception-row--bad' : ''}`} key={d.venta_id}><span>{d.producto}</span><span>{d.estado === 'costeable' ? mxn(d.costo_fifo) : d.error ?? d.estado}</span></div>)}</div></>}{excepciones.length > 0 && <div className="exception-list"><h3>Excepciones pendientes guardadas ({excepciones.length})</h3>{excepciones.map((e) => <div className="exception-row exception-row--bad" key={e.venta_id}><span>{e.fecha.slice(0, 10)} · {e.producto} × {e.cantidad}</span><span>{e.error}</span></div>)}</div>}</section>;
}
