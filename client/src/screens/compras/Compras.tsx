import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';

interface Producto { id: number; nombre: string; unidad_base: string | null; unidad_compra?: string | null; contenido_compra?: number | null }
interface Linea { product_id: number | ''; cantidad_base: string; unidad_compra: string; contenido_compra: string; costo_unitario_base: string }
interface Lote { id: number; producto: string; unidad_base: string | null; recibido_at: string; cantidad_inicial: number; cantidad_restante: number; costo_unitario: number; estado: string; ticket_ref: string | null }
interface CompraResult { purchase_id: number; total: number; lotes: { id: number; product_id: number; cantidad_inicial: number; costo_unitario: number }[] }
interface ConsumoResult { confirmar: boolean; ventas: number; costeadas: number; excepciones: number; ya_costeadas: number; costo_fifo: number; detalle: { venta_id: number; producto: string; estado: string; costo_fifo: number; error: string | null }[] }
interface ExceptionRow { venta_id: number; fecha: string; producto: string; cantidad: number; error: string }

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const hoy = new Date().toISOString().slice(0, 10);
const lineaVacia = (): Linea => ({ product_id: '', cantidad_base: '', unidad_compra: '', contenido_compra: '', costo_unitario_base: '' });

export default function Compras() {
  const [tab, setTab] = useState<'captura' | 'lotes' | 'epos'>('captura');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [fecha, setFecha] = useState(hoy);
  const [proveedor, setProveedor] = useState('');
  const [ticket, setTicket] = useState('');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia()]);
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [from, setFrom] = useState(hoy);
  const [to, setTo] = useState(hoy);
  const [preview, setPreview] = useState<ConsumoResult | null>(null);
  const [consultando, setConsultando] = useState(false);

  const productosOrdenados = useMemo(() => [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre)), [productos]);
  useEffect(() => { void cargar(); }, []);

  async function cargar() {
    try {
      const [p, l] = await Promise.all([api<Producto[]>('/catalogo/products'), api<Lote[]>('/inventario/lotes')]);
      setProductos(p); setLotes(l);
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo cargar el inventario.'); }
  }

  function editarLinea(i: number, campo: keyof Linea, valor: string | number) {
    setLineas((prev) => prev.map((linea, idx) => idx === i ? { ...linea, [campo]: valor } : linea));
  }

  async function guardarCompra() {
    const validas = lineas.filter((l) => l.product_id !== '' && Number(l.cantidad_base) > 0 && Number(l.costo_unitario_base) >= 0);
    if (!fecha || validas.length === 0) { setMensaje('Captura fecha y al menos una línea completa.'); return; }
    setGuardando(true); setMensaje('');
    try {
      const result = await api<CompraResult>('/inventario/compras', { method: 'POST', body: {
        confirmada: true, fecha_recepcion: fecha, proveedor: proveedor || null, ticket_ref: ticket || null, notas: notas || null,
        lineas: validas.map((l) => ({ product_id: Number(l.product_id), cantidad_base: Number(l.cantidad_base), unidad_compra: l.unidad_compra || null, contenido_compra: l.contenido_compra ? Number(l.contenido_compra) : null, costo_unitario_base: Number(l.costo_unitario_base) })),
      } });
      setMensaje(`Compra #${result.purchase_id} confirmada. Se crearon ${result.lotes.length} lotes FIFO.`);
      setLineas([lineaVacia()]); setTicket(''); setNotas(''); await cargar(); setTab('lotes');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo registrar la compra.'); }
    finally { setGuardando(false); }
  }

  async function consultarEpos(confirmar = false) {
    if (!from || !to) return;
    setConsultando(true); setMensaje('');
    try {
      const r = await api<ConsumoResult>('/inventario/consumo-epos', { method: 'POST', body: { from: `${from}T00:00:00-06:00`, to: `${to}T00:00:00-06:00`, confirmar } });
      setPreview(r);
      setMensaje(confirmar ? 'Se confirmaron únicamente las ventas costeables; las excepciones quedaron pendientes.' : 'Vista previa lista. Todavía no se descontó inventario.');
      if (confirmar) await cargar();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo consultar Epos.'); }
    finally { setConsultando(false); }
  }

  return <div className="page">
    <header className="page-head"><div className="page-title"><Icono name="package" size={24} className="ttl-icon" /><h1>Compras e inventario FIFO</h1></div><p className="muted">Cada compra confirmada crea lotes con su costo real.</p></header>
    <nav className="tabs">
      <button className={tab === 'captura' ? 'tab tab--on' : 'tab'} onClick={() => setTab('captura')}>Capturar compra</button>
      <button className={tab === 'lotes' ? 'tab tab--on' : 'tab'} onClick={() => { setTab('lotes'); void cargar(); }}>Lotes FIFO</button>
      <button className={tab === 'epos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('epos')}>Ventas Epos y excepciones</button>
    </nav>
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {tab === 'captura' && <CapturaCompra productos={productosOrdenados} fecha={fecha} setFecha={setFecha} proveedor={proveedor} setProveedor={setProveedor} ticket={ticket} setTicket={setTicket} notas={notas} setNotas={setNotas} lineas={lineas} editarLinea={editarLinea} agregar={() => setLineas((prev) => [...prev, lineaVacia()])} quitar={(i) => setLineas((prev) => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)} guardar={guardarCompra} guardando={guardando} />}
    {tab === 'lotes' && <Lotes lotes={lotes} />}
    {tab === 'epos' && <EposPanel from={from} setFrom={setFrom} to={to} setTo={setTo} preview={preview} consultando={consultando} consultar={consultarEpos} />}
  </div>;
}

function CapturaCompra(props: { productos: Producto[]; fecha: string; setFecha: (v: string) => void; proveedor: string; setProveedor: (v: string) => void; ticket: string; setTicket: (v: string) => void; notas: string; setNotas: (v: string) => void; lineas: Linea[]; editarLinea: (i: number, c: keyof Linea, v: string | number) => void; agregar: () => void; quitar: (i: number) => void; guardar: () => void; guardando: boolean }) {
  return <section className="card"><div className="section-heading"><div><h2>Compra recibida</h2><p className="muted">Revisa el ticket antes de confirmar. La confirmación es irreversible en el libro FIFO.</p></div></div>
    <div className="form-grid form-grid--three"><label>Fecha de recepción<input type="date" value={props.fecha} onChange={(e) => props.setFecha(e.target.value)} /></label><label>Proveedor<input value={props.proveedor} onChange={(e) => props.setProveedor(e.target.value)} placeholder="Ej. Costco" /></label><label>Ticket / factura<input value={props.ticket} onChange={(e) => props.setTicket(e.target.value)} placeholder="Folio o referencia" /></label></div>
    <div className="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad base</th><th>Presentación</th><th>Contenido</th><th>Costo por unidad base</th><th /></tr></thead><tbody>{props.lineas.map((l, i) => <tr key={i}><td><select value={l.product_id} onChange={(e) => props.editarLinea(i, 'product_id', e.target.value ? Number(e.target.value) : '')}><option value="">Seleccionar…</option>{props.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.unidad_base ?? 'sin unidad'}</option>)}</select></td><td><input type="number" min="0" step="any" value={l.cantidad_base} onChange={(e) => props.editarLinea(i, 'cantidad_base', e.target.value)} /></td><td><input value={l.unidad_compra} onChange={(e) => props.editarLinea(i, 'unidad_compra', e.target.value)} placeholder="pack, caja…" /></td><td><input type="number" min="0" step="any" value={l.contenido_compra} onChange={(e) => props.editarLinea(i, 'contenido_compra', e.target.value)} /></td><td><input type="number" min="0" step="any" value={l.costo_unitario_base} onChange={(e) => props.editarLinea(i, 'costo_unitario_base', e.target.value)} /></td><td><button className="btn-ghost" onClick={() => props.quitar(i)} aria-label="Quitar línea">Quitar</button></td></tr>)}</tbody></table></div>
    <label className="field-block">Notas<textarea value={props.notas} onChange={(e) => props.setNotas(e.target.value)} placeholder="Descuento, sustitución, evidencia pendiente…" /></label>
    <div className="sticky-action"><button className="btn-secondary" onClick={props.agregar}>Agregar línea</button><button className="btn-primary" disabled={props.guardando} onClick={props.guardar}>{props.guardando ? 'Confirmando…' : 'Confirmar compra y crear lotes'}</button></div>
  </section>;
}

function Lotes({ lotes }: { lotes: Lote[] }) {
  if (!lotes.length) return <div className="empty-state"><strong>No hay lotes FIFO registrados</strong><p>Confirma una compra para crear el primer lote.</p></div>;
  return <section className="card"><div className="section-heading"><div><h2>Libro de lotes</h2><p className="muted">Ordenados por fecha de recepción; el más antiguo sale primero.</p></div></div><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Ticket</th><th>Inicial</th><th>Restante</th><th>Costo base</th><th>Estado</th></tr></thead><tbody>{lotes.map((l) => <tr key={l.id}><td>{l.recibido_at}</td><td><strong>{l.producto}</strong><small className="muted">{l.unidad_base ?? 'sin unidad'}</small></td><td>{l.ticket_ref ?? '—'}</td><td>{l.cantidad_inicial}</td><td>{l.cantidad_restante}</td><td>{mxn(l.costo_unitario)}</td><td><span className={`status status--${l.estado === 'abierto' ? 'ok' : 'cargando'}`}>{l.estado}</span></td></tr>)}</tbody></table></div></section>;
}

function EposPanel(props: { from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; preview: ConsumoResult | null; consultando: boolean; consultar: (confirmar?: boolean) => void }) {
  const [excepciones, setExcepciones] = useState<ExceptionRow[]>([]);
  useEffect(() => {
    const desde = `${props.from}T00:00:00-06:00`;
    const hasta = `${props.to}T00:00:00-06:00`;
    api<ExceptionRow[]>(`/epos/exceptions?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`).then(setExcepciones).catch(() => setExcepciones([]));
  }, [props.from, props.to]);
  const puedeConfirmar = !!props.preview && props.preview.costeadas > 0;
  return <section className="card"><div className="section-heading"><div><h2>Ventas Epos → consumo FIFO</h2><p className="muted">Primero consulta. Sólo se descontarán ventas con receta validada y lotes suficientes.</p></div></div><div className="form-grid form-grid--three"><label>Desde<input type="date" value={props.from} onChange={(e) => props.setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={props.to} onChange={(e) => props.setTo(e.target.value)} /></label><div className="form-actions"><button className="btn-secondary" disabled={props.consultando} onClick={() => props.consultar(false)}>Vista previa</button><button className="btn-primary" disabled={!puedeConfirmar || props.consultando} onClick={() => props.consultar(true)}>Confirmar costeables</button></div></div>{props.preview && <><div className="summary-grid"><div><small>Ventas</small><strong>{props.preview.ventas}</strong></div><div><small>Costeables</small><strong>{props.preview.costeadas}</strong></div><div><small>Excepciones</small><strong className={props.preview.excepciones ? 'text-danger' : ''}>{props.preview.excepciones}</strong></div><div><small>Costo FIFO</small><strong>{mxn(props.preview.costo_fifo)}</strong></div></div><div className="exception-list"><h3>Revisión de esta consulta</h3>{props.preview.detalle.map((d) => <div className={`exception-row ${d.estado === 'excepcion' ? 'exception-row--bad' : ''}`} key={d.venta_id}><span>{d.producto}</span><span>{d.estado === 'costeable' ? mxn(d.costo_fifo) : d.error ?? d.estado}</span></div>)}</div></>}{excepciones.length > 0 && <div className="exception-list"><h3>Excepciones pendientes guardadas ({excepciones.length})</h3>{excepciones.map((e) => <div className="exception-row exception-row--bad" key={e.venta_id}><span>{e.fecha.slice(0, 10)} · {e.producto} × {e.cantidad}</span><span>{e.error}</span></div>)}</div>}</section>;
}
