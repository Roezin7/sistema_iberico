import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Icono } from '../../icons';
import { Cargando } from '../../ui/Cargando';

type EstadoFactura = 'no_facturado' | 'facturado';
interface Factura {
  id: number;
  compra_id: number;
  mes: string;
  fecha: string;
  proveedor: string | null;
  ticket_ref: string | null;
  total: number;
  moneda: string;
  origen_pago: string;
  estado: EstadoFactura;
  comprobante: boolean;
  comprobante_mime: string | null;
  comprobante_nombre: string | null;
  notas: string | null;
}
interface MesFacturas { mes: string; compras: number; facturadas: number; no_facturadas: number; total: number; facturas: Factura[] }
interface FacturacionData { meses: MesFacturas[]; total_compras: number; total_facturadas: number; total_no_facturadas: number }

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fechaMes = (mes: string) => new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(`${mes}-01T12:00:00`));

function archivoBase64(file: File): Promise<{ data: string; mime: string; nombre: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el comprobante'));
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      resolve({ data: raw.includes(',') ? raw.split(',')[1]! : raw, mime: file.type || 'application/pdf', nombre: file.name });
    };
    reader.readAsDataURL(file);
  });
}

export default function Facturacion() {
  const [data, setData] = useState<FacturacionData | null>(null);
  const [mes, setMes] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState<number | null>(null);

  async function cargar() {
    try {
      const respuesta = await api<FacturacionData>('/facturacion');
      setData(respuesta);
      setMes((actual) => actual && respuesta.meses.some((m) => m.mes === actual) ? actual : respuesta.meses[0]?.mes ?? '');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : 'No se pudo cargar el archivo de facturas.');
    }
  }
  useEffect(() => { void cargar(); }, []);

  const grupo = useMemo(() => data?.meses.find((m) => m.mes === mes) ?? null, [data, mes]);
  async function cambiarEstado(factura: Factura, estado: EstadoFactura) {
    setGuardando(factura.id); setMensaje('');
    try { await api(`/facturacion/${factura.id}`, { method: 'PATCH', body: { estado } }); await cargar(); }
    catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo actualizar la factura.'); }
    finally { setGuardando(null); }
  }
  async function adjuntar(factura: Factura, file?: File) {
    if (!file) return;
    setGuardando(factura.id); setMensaje('');
    try {
      const comprobante = await archivoBase64(file);
      await api(`/facturacion/${factura.id}`, { method: 'PATCH', body: { comprobante_data: comprobante.data, comprobante_mime: comprobante.mime, comprobante_nombre: comprobante.nombre } });
      await cargar();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo adjuntar el comprobante.'); }
    finally { setGuardando(null); }
  }
  async function verComprobante(factura: Factura) {
    try {
      const comprobante = await api<{ data: string; mime: string; nombre: string | null }>(`/facturacion/${factura.id}/comprobante`);
      const ventana = window.open('', '_blank');
      if (!ventana) throw new Error('El navegador bloqueó la ventana del comprobante.');
      ventana.document.write(`<title>${comprobante.nombre ?? 'Comprobante'}</title><iframe src="data:${comprobante.mime};base64,${comprobante.data}" style="border:0;width:100%;height:100vh"></iframe>`);
      ventana.document.close();
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo abrir el comprobante.'); }
  }

  if (!data) return <div className="page facturacion-page"><Cargando etiqueta="Cargando facturas…" /></div>;
  return <div className="page facturacion-page">
    <header className="page-head">
      <div><div className="page-title"><Icono name="file" size={24} className="ttl-icon" /><h1>Facturación</h1></div><p className="muted">Archivo mensual de compras pagadas desde Banco.</p></div>
      <span className="chip chip--ok">{data.total_no_facturadas} por facturar</span>
    </header>
    <section className="resumen-card facturacion-overview">
      <div className="facturacion-overview__head"><div><span className="eyebrow">Control fiscal</span><strong className="big-number">{data.total_compras}</strong><span className="muted"> compras bancarias</span></div><div className="facturacion-overview__status"><span><b>{data.total_facturadas}</b> facturadas</span><span><b>{data.total_no_facturadas}</b> no facturadas</span></div></div>
      <div className="facturacion-months" role="list" aria-label="Meses con compras bancarias">{data.meses.map((m) => <button type="button" key={m.mes} className={m.mes === mes ? 'facturacion-month facturacion-month--on' : 'facturacion-month'} onClick={() => setMes(m.mes)}><strong>{fechaMes(m.mes)}</strong><small>{m.no_facturadas} pendientes · {mxn(m.total)}</small></button>)}</div>
    </section>
    {mensaje && <div className="info-box" role="status">{mensaje}</div>}
    {!grupo ? <div className="empty-state"><strong>No hay compras bancarias</strong><p>Las compras confirmadas con origen Banco aparecerán aquí automáticamente.</p></div> : <>
      <div className="section-heading facturacion-section-heading"><div><span className="eyebrow">Archivo mensual</span><h2>{fechaMes(grupo.mes)}</h2></div><strong>{mxn(grupo.total)}</strong></div>
      <section className="facturacion-list">{grupo.facturas.map((factura) => <article className={`card factura-card factura-card--${factura.estado}`} key={factura.id}>
        <div className="factura-card__main"><div><div className="factura-card__title"><strong>{factura.proveedor || 'Compra sin proveedor'}</strong><span className={`status status--${factura.estado === 'facturado' ? 'ok' : 'warning'}`}>{factura.estado === 'facturado' ? 'Facturado' : 'No facturado'}</span></div><p className="muted">{factura.fecha} · {factura.ticket_ref || `Compra #${factura.compra_id}`} · {factura.origen_pago}</p></div><strong className="factura-card__total">{mxn(factura.total)}</strong></div>
        <div className="factura-card__actions"><select value={factura.estado} disabled={guardando === factura.id} onChange={(e) => void cambiarEstado(factura, e.target.value as EstadoFactura)} aria-label={`Estado de factura de ${factura.proveedor || factura.compra_id}`}><option value="no_facturado">No facturado</option><option value="facturado">Facturado</option></select><label className="btn-secondary file-button">{factura.comprobante ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => void adjuntar(factura, e.target.files?.[0])} /></label>{factura.comprobante && <button type="button" className="btn-ghost" onClick={() => void verComprobante(factura)}>Ver comprobante</button>}<Link className="btn-ghost" to={`/compras?fecha=${factura.fecha}`}>Ver compra</Link></div>
        {factura.notas && <small className="muted">{factura.notas}</small>}
      </article>)}</section>
    </>}
  </div>;
}
