import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';

// --- Tipos de la API ---
interface Zona { id: number; nombre: string; orden: number }
interface Unidad { zona_id: number; unidad_captura: string; factor: number }
interface Producto {
  id: number; nombre: string; store: string; base_qty: number | null;
  unit_cost: number | null; unidades: Unidad[];
}
interface ProductoActual {
  product_id: number; nombre: string; store: string; base_qty: number;
  total_base: number; unit_cost: number | null; valor: number;
}
interface Actual {
  snapshot_id: number | null; fecha: string | null; productos: ProductoActual[];
  valor_total: number; sin_costo: { product_id: number; nombre: string }[];
}
interface ItemCompra { product_id: number; nombre: string; faltante: number; unit_cost: number | null; valor_faltante: number }
interface GrupoCompra { store: string; items: ItemCompra[]; subtotal: number }
interface ListaCompras { grupos: GrupoCompra[]; total: number }

const mxn = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

type Tab = 'conteo' | 'borrador' | 'actual' | 'compras';

export default function Inventario() {
  const [tab, setTab] = useState<Tab>('conteo');
  const [iaDisponible, setIaDisponible] = useState(false);
  useEffect(() => {
    api<{ disponible: boolean }>('/inventario/draft/estado').then((e) => setIaDisponible(e.disponible)).catch(() => setIaDisponible(false));
  }, []);
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="package" size={24} className="ttl-icon" />
          <h1>Inventario</h1>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'conteo' ? 'tab tab--on' : 'tab'} onClick={() => setTab('conteo')}>Conteo</button>
        {iaDisponible && <button className={tab === 'borrador' ? 'tab tab--on' : 'tab'} onClick={() => setTab('borrador')}>Borrador IA</button>}
        <button className={tab === 'actual' ? 'tab tab--on' : 'tab'} onClick={() => setTab('actual')}>Actual</button>
        <button className={tab === 'compras' ? 'tab tab--on' : 'tab'} onClick={() => setTab('compras')}>Compras</button>
      </nav>
      <div className="tab-body">
        {tab === 'conteo' && <Conteo onGuardado={() => setTab('actual')} />}
        {tab === 'borrador' && <BorradorIA onGuardado={() => setTab('actual')} />}
        {tab === 'actual' && <InventarioActual />}
        {tab === 'compras' && <ListaDeCompras />}
      </div>
    </div>
  );
}

// ===========================================================================
//  CONTEO
// ===========================================================================
function Conteo({ onGuardado }: { onGuardado: () => void }) {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [zonaActiva, setZonaActiva] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({}); // `${pid}:${zid}` -> texto
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([api<Zona[]>('/catalogo/zonas'), api<Producto[]>('/catalogo/products')]).then(
      ([z, p]) => {
        setZonas(z);
        setProductos(p);
        if (z[0]) setZonaActiva(z[0].id);
      },
    );
  }, []);

  const filtrados = useMemo(
    () => productos.filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase())),
    [productos, filtro],
  );

  const unidadDe = (p: Producto, zonaId: number): Unidad =>
    p.unidades.find((u) => u.zona_id === zonaId) ?? { zona_id: zonaId, unidad_captura: 'unidad base', factor: 1 };

  const setVal = (pid: number, zid: number, v: string) =>
    setValores((prev) => ({ ...prev, [`${pid}:${zid}`]: v }));

  async function guardar() {
    const lineas = Object.entries(valores)
      .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
      .map(([k, v]) => {
        const [product_id, zona_id] = k.split(':').map(Number);
        return { product_id, zona_id, qty_captura: Number(v) };
      });
    if (lineas.length === 0) {
      setMsg('Captura al menos un producto.');
      return;
    }
    setGuardando(true);
    setMsg('');
    try {
      await api('/inventario/snapshots', { method: 'POST', body: { lineas } });
      setValores({});
      onGuardado();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  const capturados = Object.values(valores).filter((v) => v !== '').length;

  return (
    <>
      <div className="zona-tabs">
        {zonas.map((z) => (
          <button key={z.id} className={z.id === zonaActiva ? 'pill pill--on' : 'pill'} onClick={() => setZonaActiva(z.id)}>
            {z.nombre}
          </button>
        ))}
      </div>
      <input className="buscador" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />

      <ul className="conteo-list">
        {zonaActiva != null &&
          filtrados.map((p) => {
            const u = unidadDe(p, zonaActiva);
            const key = `${p.id}:${zonaActiva}`;
            const esBool = u.unidad_captura === 'boolean';
            return (
              <li key={p.id} className="conteo-row">
                <div className="conteo-info">
                  <strong>{p.nombre}</strong>
                  <small className="muted">{u.unidad_captura}{u.factor !== 1 ? ` ×${u.factor}` : ''} · {p.store}</small>
                </div>
                {esBool ? (
                  <div className="bool-toggle">
                    <button className={valores[key] === '1' ? 'pill pill--on' : 'pill'} onClick={() => setVal(p.id, zonaActiva, '1')}>Sí</button>
                    <button className={valores[key] === '0' ? 'pill pill--on' : 'pill'} onClick={() => setVal(p.id, zonaActiva, '0')}>No</button>
                  </div>
                ) : (
                  <input
                    className="conteo-input"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={valores[key] ?? ''}
                    onChange={(e) => setVal(p.id, zonaActiva, e.target.value)}
                  />
                )}
              </li>
            );
          })}
      </ul>

      {msg && <p className="error-msg">{msg}</p>}
      <div className="sticky-action">
        <span className="muted">{capturados} capturados</span>
        <button className="btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar conteo'}
        </button>
      </div>
    </>
  );
}

// ===========================================================================
//  BORRADOR IA (Fase 7) — la IA propone, tú confirmas
// ===========================================================================
interface LineaBorrador {
  nombre_detectado: string;
  product_id: number | null;
  nombre_producto: string | null;
  qty_captura: number;
  confianza: 'alta' | 'media' | 'baja';
}

function leerImagenBase64(file: File): Promise<{ base64: string; tipo: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const base64 = res.includes(',') ? res.split(',')[1]! : res;
      resolve({ base64, tipo: file.type || 'image/jpeg' });
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function BorradorIA({ onGuardado }: { onGuardado: () => void }) {
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [zonaId, setZonaId] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [imagen, setImagen] = useState<{ base64: string; tipo: string } | null>(null);
  const [lineas, setLineas] = useState<LineaBorrador[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([api<Zona[]>('/catalogo/zonas'), api<Producto[]>('/catalogo/products')]).then(([z, p]) => {
      setZonas(z); setProductos(p); if (z[0]) setZonaId(z[0].id);
    });
  }, []);

  async function generar() {
    setMsg(''); setCargando(true); setLineas(null);
    try {
      const r = await api<{ lineas: LineaBorrador[] }>('/inventario/draft', {
        method: 'POST',
        body: { texto: texto.trim() || undefined, imagen_base64: imagen?.base64, imagen_tipo: imagen?.tipo },
      });
      setLineas(r.lineas);
      if (r.lineas.length === 0) setMsg('La IA no detectó renglones. Revisa el texto o la foto.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo generar el borrador.');
    } finally { setCargando(false); }
  }

  function editar(i: number, cambio: Partial<LineaBorrador>) {
    setLineas((ls) => ls && ls.map((l, idx) => (idx === i ? { ...l, ...cambio } : l)));
  }

  async function confirmar() {
    if (!lineas || zonaId == null) return;
    const validas = lineas.filter((l) => l.product_id != null && l.qty_captura >= 0);
    if (validas.length === 0) { setMsg('Asigna al menos un producto antes de guardar.'); return; }
    setCargando(true); setMsg('');
    try {
      await api('/inventario/snapshots', {
        method: 'POST',
        body: { lineas: validas.map((l) => ({ product_id: l.product_id, zona_id: zonaId, qty_captura: l.qty_captura })) },
      });
      onGuardado();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al guardar');
    } finally { setCargando(false); }
  }

  const sinMatch = lineas?.filter((l) => l.product_id == null).length ?? 0;

  return (
    <>
      <div className="aviso">
        Pega tu conteo (ej. “Corona 48, Ultra 67…”) o sube una foto. La IA propone un borrador;
        tú lo revisas y confirmas. <b>Nada se guarda hasta que confirmes.</b>
      </div>

      <div className="form-mov">
        <label className="muted">Zona del conteo
          <select value={zonaId ?? ''} onChange={(e) => setZonaId(Number(e.target.value))}>
            {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
        </label>
        <textarea rows={5} placeholder="Pega aquí el conteo…" value={texto} onChange={(e) => setTexto(e.target.value)}
          style={{ resize: 'vertical' }} />
        <label className="muted">Foto del conteo (opcional)
          <input type="file" accept="image/*" onChange={async (e) => {
            const f = e.target.files?.[0]; setImagen(f ? await leerImagenBase64(f) : null);
          }} />
        </label>
        <button className="btn-primary" onClick={generar} disabled={cargando || (!texto.trim() && !imagen)}>
          {cargando && !lineas ? 'Analizando…' : '✨ Generar borrador'}
        </button>
        {msg && <p className="error-msg">{msg}</p>}
      </div>

      {lineas && lineas.length > 0 && (
        <>
          {sinMatch > 0 && <p className="aviso">⚠️ {sinMatch} renglón(es) sin producto asignado. Elige el producto o quedarán fuera.</p>}
          <ul className="conteo-list">
            {lineas.map((l, i) => (
              <li key={i} className="conteo-row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                <div className="conteo-info" style={{ flex: '1 1 120px' }}>
                  <select value={l.product_id ?? ''} onChange={(e) => editar(i, { product_id: e.target.value === '' ? null : Number(e.target.value) })}
                    style={{ minHeight: 38, borderColor: l.product_id == null ? 'var(--danger)' : undefined }}>
                    <option value="">— Sin asignar —</option>
                    {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <small className="muted">
                    detectado: “{l.nombre_detectado}”
                    {l.confianza !== 'alta' && <span className={l.confianza === 'baja' ? 'chip chip--danger' : 'chip chip--warn'} style={{ marginLeft: 6 }}>{l.confianza}</span>}
                  </small>
                </div>
                <input className="conteo-input" type="number" inputMode="decimal" step="any" value={l.qty_captura}
                  onChange={(e) => editar(i, { qty_captura: Number(e.target.value) })} />
              </li>
            ))}
          </ul>
          <div className="sticky-action">
            <span className="muted">{lineas.filter((l) => l.product_id != null).length} de {lineas.length} listos</span>
            <button className="btn-primary" onClick={confirmar} disabled={cargando}>{cargando ? 'Guardando…' : 'Confirmar conteo'}</button>
          </div>
        </>
      )}
    </>
  );
}

// ===========================================================================
//  INVENTARIO ACTUAL
// ===========================================================================
function InventarioActual() {
  const [data, setData] = useState<Actual | null>(null);
  useEffect(() => { api<Actual>('/inventario/current').then(setData); }, []);
  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <>
      <div className="resumen-card">
        <span className="muted">Valor de inventario (a costo)</span>
        <strong className="big-number">{mxn(data.valor_total)}</strong>
        <small className="muted">
          {data.fecha ? `Último conteo: ${new Date(data.fecha).toLocaleString('es-MX')}` : 'Sin conteos aún'}
        </small>
      </div>
      {data.sin_costo.length > 0 && (
        <p className="aviso">⚠️ Sin costo (no suman al valor): {data.sin_costo.map((s) => s.nombre).join(', ')}</p>
      )}
      <ul className="conteo-list">
        {data.productos.map((p) => (
          <li key={p.product_id} className="conteo-row">
            <div className="conteo-info">
              <strong>{p.nombre}</strong>
              <small className="muted">{p.total_base} / {p.base_qty} mín · {p.store}</small>
            </div>
            <span>{mxn(p.valor)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ===========================================================================
//  LISTA DE COMPRAS
// ===========================================================================
function ListaDeCompras() {
  const [data, setData] = useState<ListaCompras | null>(null);
  useEffect(() => { api<ListaCompras>('/inventario/shopping-list').then(setData); }, []);
  if (!data) return <p className="muted">Cargando…</p>;
  if (data.grupos.length === 0) return <p className="muted">No falta nada por comprar. 🎉</p>;

  return (
    <>
      <div className="resumen-card">
        <span className="muted">Total estimado de compra</span>
        <strong className="big-number">{mxn(data.total)}</strong>
      </div>
      {data.grupos.map((g) => (
        <div key={g.store} className="grupo-tienda">
          <div className="grupo-head">
            <strong>{g.store}</strong>
            <span className="muted">{mxn(g.subtotal)}</span>
          </div>
          <ul className="conteo-list">
            {g.items.map((it) => (
              <li key={it.product_id} className="conteo-row">
                <div className="conteo-info">
                  <strong>{it.nombre}</strong>
                  <small className="muted">faltan {it.faltante}</small>
                </div>
                <span>{mxn(it.valor_faltante)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
