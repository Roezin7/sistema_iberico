import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';
import { Cargando } from '../../ui/Cargando';
import { weekLabel, weekStateLabel } from '../../operating';

// --- Tipos de la API ---
interface Zona { id: number; nombre: string; orden: number }
interface Categoria { id: number; nombre: string; orden: number; activo: boolean }
interface Unidad { zona_id: number; unidad_captura: string; factor: number }
interface SemanaRef { id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string; estado: string }
interface Producto {
  id: number; nombre: string; store: string; base_qty: number | null;
  unit_cost: number | null; unidad_base: string | null; unidad_compra: string | null; contenido_compra: number | null;
  unidades: Unidad[]; categoria_id: number | null; categoria: string | null;
}
interface ProductoActual {
  product_id: number; nombre: string; store: string; base_qty: number;
  minimo_base: number;
  total_base: number; unit_cost: number | null; unit_cost_base: number | null;
  unidad_base: string | null; contenido_compra: number | null; unidad_compra: string | null;
  unidad_operativa: string; minimo_operativo: number; total_operativo: number;
  valor: number; valor_fifo: number; valor_catalogo: number;
  cantidad_fifo_base: number | null; cantidad_fifo_operativa: number | null;
  valor_fifo_actual: number | null;
  existencia_fisica_base?: number; existencia_fisica_operativa?: number;
  existencia_fifo_base?: number | null; existencia_fifo_operativa?: number | null;
  diferencia_fifo_vs_fisico_base?: number | null;
  existencia_actual_base: number; existencia_actual_operativa: number;
  fuente_existencia_actual: 'fisico';
  costo_fifo_base: number | null; cantidad_con_lote: number; cantidad_sin_lote: number;
  fuente_valoracion: 'fifo' | 'catalogo' | 'mixta' | 'sin_costo';
  categoria_id: number | null; categoria: string | null;
  por_zona: { zona_id: number; zona: string; qty_captura: number; factor: number; unidad_captura?: string }[];
}

// Agrupa por categoría, respetando el orden configurado; "Sin categoría" al final.
function agruparPorCategoria<T extends { categoria_id: number | null; categoria: string | null }>(
  items: T[], cats: Categoria[],
): { id: number | null; nombre: string; items: T[] }[] {
  const orden = new Map(cats.map((c, i) => [c.id, c.orden * 1000 + i]));
  const grupos = new Map<number | null, { nombre: string; items: T[] }>();
  for (const it of items) {
    const k = it.categoria_id;
    if (!grupos.has(k)) grupos.set(k, { nombre: it.categoria ?? 'Sin categoría', items: [] });
    grupos.get(k)!.items.push(it);
  }
  return [...grupos.entries()]
    .map(([id, g]) => ({ id, nombre: g.nombre, items: g.items }))
    .sort((a, b) => {
      if (a.id == null) return 1;
      if (b.id == null) return -1;
      return (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0);
    });
}

function SeccionCategoria({ titulo, count, children }: { titulo: string; count: number; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="cat-group">
      <button className="cat-head" onClick={() => setAbierto((o) => !o)}>
        <span className="cat-head__title">{titulo} <small className="muted">{count}</small></span>
        <Icono name="chevron" size={16} style={{ transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {abierto && children}
    </div>
  );
}
interface Actual {
  snapshot_id: number | null; fecha: string | null; tipo: string | null; semana_id: number | null; productos: ProductoActual[];
  valor_total: number; valor_fifo_total: number; valor_catalogo_total: number; valor_fifo_actual_total: number;
  fuente_existencia_actual: 'fisico';
  sin_costo: { product_id: number; nombre: string }[];
}
interface ItemCompra {
  product_id: number;
  nombre: string;
  base_qty: number;
  minimo_base?: number;
  total_base: number;
  faltante: number;
  unidad_operativa?: string;
  minimo_operativo?: number;
  total_operativo?: number;
  existencia_actual_base?: number;
  existencia_actual_operativa?: number;
  fuente_existencia_actual?: 'fifo' | 'fisico';
  faltante_operativo?: number;
  unit_cost: number | null;
  unit_cost_base?: number | null;
  unidad_base?: string | null;
  contenido_compra?: number | null;
  unidad_compra?: string | null;
  rendimiento_util?: number | null;
  presentaciones_faltantes?: number | null;
  costo_configurado?: boolean;
  valor_faltante: number;
}
interface GrupoCompra { store: string; items: ItemCompra[]; subtotal: number }
interface ListaCompras { grupos: GrupoCompra[]; total: number }
interface SnapshotHistorial {
  id: number; tipo: 'apertura' | 'cierre' | 'ajuste' | 'conteo_operativo' | string;
  semana_id: number | null; motivo: string | null; nota: string | null; creado_at: string; lineas: number;
}

const mxn = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const formatoCantidad = (n: number | null | undefined) =>
  n == null ? '0' : n.toLocaleString('es-MX', { maximumFractionDigits: 2 });

function pluralUnidad(unidad: string | null | undefined, cantidad?: number) {
  const u = (unidad ?? 'unidad').trim().toLowerCase();
  if (cantidad === 1) return u;
  const plurales: Record<string, string> = {
    botella: 'botellas', lata: 'latas', bolsa: 'bolsas', bote: 'botes',
    envase: 'envases', frasco: 'frascos', paquete: 'paquetes', bloque: 'bloques',
    pieza: 'piezas', unidad: 'unidades', kg: 'kg', litro: 'litros', garrafon: 'garrafones',
    manojo: 'manojos', ramo: 'ramos', caja: 'cajas', pack: 'packs', lote: 'lotes',
  };
  return plurales[u] ?? `${u}s`;
}

/** Unidad que se muestra al operador. El contenido en g/ml sólo vive en el
 * cálculo interno; el conteo se expresa en unidades físicas comprables. */
function unidadOperativaProducto(p: Producto, u: Unidad): string {
  if (p.unidad_base === 'pieza') return 'pieza';
  const texto = (p.unidad_compra || u.unidad_captura || 'unidad').trim().toLowerCase();
  const primera = texto.split(/\s|\(|\//)[0] || 'unidad';
  // El operador nunca debe ver la unidad técnica (g/ml) ni el contenido de
  // la presentación; sólo la unidad física que puede contar.
  return /^(g|gr|gramo|gramos|ml|cc|mililitro|mililitros)$/.test(primera) ? 'unidad' : primera;
}

/** Convierte una captura histórica (qty × factor = base) a unidades físicas. */
function capturaAOperativa(qtyCaptura: number, p: Producto | undefined, u: Unidad): number {
  const base = Number(qtyCaptura) * (Number(u.factor) || 1);
  if (!p || p.unidad_base === 'pieza') return base;
  const contenido = Number(p.contenido_compra);
  return Number.isFinite(contenido) && contenido > 0 ? base / contenido : Number(qtyCaptura);
}

type Tab = 'conteo' | 'actual' | 'compras';

/** Recorre la columna de captura sin alterar el valor del input numérico. */
function moverConteoConFlecha(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-conteo-input="true"]'));
  const actual = inputs.indexOf(event.currentTarget);
  if (actual < 0) return;
  const siguiente = inputs[actual + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!siguiente) return;
  siguiente.focus();
  siguiente.select();
}

export default function Inventario() {
  const [tab, setTab] = useState<Tab>('conteo');
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
        <button className={tab === 'actual' ? 'tab tab--on' : 'tab'} onClick={() => setTab('actual')}>Existencia actual</button>
        <button className={tab === 'compras' ? 'tab tab--on' : 'tab'} onClick={() => setTab('compras')}>Lista de compras</button>
      </nav>
      <div className="tab-body">
        {tab === 'conteo' && <Conteo onGuardado={() => setTab('actual')} />}
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
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [zonaActiva, setZonaActiva] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({}); // `${pid}:${zid}` -> texto
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  const [tipo, setTipo] = useState<'conteo_operativo' | 'apertura' | 'cierre' | 'ajuste'>('conteo_operativo');
  const [semanas, setSemanas] = useState<SemanaRef[]>([]);
  const [semanaId, setSemanaId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    Promise.all([
      api<Zona[]>('/catalogo/zonas'),
      api<Producto[]>('/catalogo/products'),
      api<Categoria[]>('/catalogo/categorias-inventario'),
      api<Actual>('/inventario/current?vista=fisica'),
      api<SemanaRef[]>('/finanzas/semanas'),
    ]).then(([z, p, c, actual, ss]) => {
      setZonas(z);
      setProductos(p);
      setCategorias(c);
      setSemanas(ss);
      const abierta = ss.find((s) => s.estado === 'abierta');
      if (abierta) setSemanaId(abierta.id);
      if (z[0]) setZonaActiva(z[0].id);
      // Pre-carga el último conteo de cada zona: así, para corregir una cantidad
      // basta editar ese campo y guardar, sin recapturar todo de nuevo.
      const previos: Record<string, string> = {};
      for (const prod of actual.productos) {
        for (const pz of prod.por_zona) {
          const producto = p.find((item) => item.id === prod.product_id);
          const unidad = producto?.unidades.find((item) => item.zona_id === pz.zona_id)
            ?? { zona_id: pz.zona_id, unidad_captura: pz.unidad_captura ?? 'unidad', factor: pz.factor || 1 };
          previos[`${prod.product_id}:${pz.zona_id}`] = String(capturaAOperativa(pz.qty_captura, producto, unidad));
        }
      }
      setValores(previos);
    });
  }, []);

  const filtrados = useMemo(
    () => productos.filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase())),
    [productos, filtro],
  );
  const grupos = useMemo(() => agruparPorCategoria(filtrados, categorias), [filtrados, categorias]);

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
      if ((tipo === 'apertura' || tipo === 'cierre') && semanaId == null) {
        setMsg('Selecciona la semana que estás abriendo o cerrando.');
        return;
      }
      if (tipo === 'ajuste' && motivo.trim().length < 5) {
        setMsg('Describe el motivo del ajuste (mínimo 5 caracteres).');
        return;
      }
      await api('/inventario/snapshots', {
        method: 'POST',
        body: { lineas, tipo, semana_id: semanaId, motivo: motivo.trim() || null, unidad_conteo: 'operativa' },
      });
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
      <section className="inventory-capture-context">
        <div className="section-heading"><div><strong>¿Qué estás contando?</strong><p className="muted">Cada captura queda identificada y no reemplaza el historial.</p></div></div>
        <div className="pill-row">
          {([
            ['conteo_operativo', 'Conteo operativo'],
            ['apertura', 'Apertura de semana'],
            ['cierre', 'Cierre de semana'],
            ['ajuste', 'Ajuste documentado'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={tipo === value ? 'pill pill--on' : 'pill'} onClick={() => setTipo(value)}>{label}</button>
          ))}
        </div>
        {tipo !== 'conteo_operativo' && <div className="form-grid form-grid--two">
          {(tipo === 'apertura' || tipo === 'cierre') && <label>Semana<select aria-label="Semana del conteo" value={semanaId ?? ''} onChange={(e) => setSemanaId(e.target.value ? Number(e.target.value) : null)}><option value="">Selecciona…</option>{semanas.map((s) => <option key={s.id} value={s.id}>{weekLabel(s)} · {weekStateLabel(s)}</option>)}</select></label>}
          {tipo === 'ajuste' && <label>Motivo del ajuste<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. conteo corregido de cajas" /></label>}
        </div>}
        <p className="muted inventory-unit-help">Captura botellas, cajas, paquetes o piezas. El sistema convierte automáticamente para FIFO y costeo.</p>
      </section>
      <div className="zona-tabs">
        {zonas.map((z) => (
          <button key={z.id} className={z.id === zonaActiva ? 'pill pill--on' : 'pill'} onClick={() => setZonaActiva(z.id)}>
            {z.nombre}
          </button>
        ))}
      </div>
      <input className="buscador" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <p className="muted" style={{ fontSize: '0.82rem', margin: '0 0 0.4rem' }}>
        Se muestra tu último conteo por zona como referencia. Elige arriba si esto es una apertura, cierre o ajuste antes de guardar.
      </p>

      {zonaActiva != null && grupos.map((g) => (
        <SeccionCategoria key={g.id ?? 'sin'} titulo={g.nombre} count={g.items.length}>
          <ul className="conteo-list">
            {g.items.map((p) => {
              const u = unidadDe(p, zonaActiva);
              const key = `${p.id}:${zonaActiva}`;
              const esBool = u.unidad_captura === 'boolean';
              const unidadOperativa = unidadOperativaProducto(p, u);
              return (
                <li key={p.id} className="conteo-row">
                  <div className="conteo-info">
                    <strong>{p.nombre}</strong>
                    <small className="muted">Se captura en {pluralUnidad(unidadOperativa, 2)} · {p.store}</small>
                  </div>
                  {esBool ? (
                    <div className="bool-toggle">
                      <button className={valores[key] === '1' ? 'pill pill--on' : 'pill'} onClick={() => setVal(p.id, zonaActiva, '1')}>Sí</button>
                      <button className={valores[key] === '0' ? 'pill pill--on' : 'pill'} onClick={() => setVal(p.id, zonaActiva, '0')}>No</button>
                    </div>
                  ) : (
                    <input
                      className="conteo-input"
                      data-conteo-input="true"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={valores[key] ?? ''}
                      onChange={(e) => setVal(p.id, zonaActiva, e.target.value)}
                      onKeyDown={moverConteoConFlecha}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </SeccionCategoria>
      ))}

      {msg && <p className="error-msg">{msg}</p>}
      <div className="sticky-action">
        <span className="muted">{capturados} capturados</span>
        <button className="btn-secondary" onClick={() => setValores({})} disabled={guardando || capturados === 0}>
          Limpiar
        </button>
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

// Retenido sólo para rollback; no se expone en la navegación de Inventario.
export function BorradorIA({ onGuardado }: { onGuardado: () => void }) {
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
          {sinMatch > 0 && (
            <p className="aviso">
              <Icono name="alertTriangle" size={16} />
              {sinMatch} renglón(es) sin producto asignado. Elige el producto o quedarán fuera.
            </p>
          )}
          <ul className="conteo-list">
            {lineas.map((l, i) => (
              <li key={i} className="conteo-row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                <div className="conteo-info" style={{ flex: '1 1 120px' }}>
                  <select value={l.product_id ?? ''} onChange={(e) => editar(i, { product_id: e.target.value === '' ? null : Number(e.target.value) })}
                    className="field-sm" style={{ borderColor: l.product_id == null ? 'var(--danger)' : undefined }}>
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
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [historial, setHistorial] = useState<SnapshotHistorial[]>([]);
  useEffect(() => {
    api<Actual>('/inventario/current?vista=fisica').then(setData);
    api<Categoria[]>('/catalogo/categorias-inventario').then(setCategorias).catch(() => {});
    api<SnapshotHistorial[]>('/inventario/snapshots').then(setHistorial).catch(() => {});
  }, []);
  if (!data) return <Cargando />;
  const grupos = agruparPorCategoria(data.productos, categorias);
  const diferenciaFisicoFifo = Math.round((data.valor_fifo_actual_total - data.valor_total) * 100) / 100;
  const etiquetaValuacion: Record<ProductoActual['fuente_valoracion'], string> = {
    fifo: 'FIFO', catalogo: 'catálogo', mixta: 'mixta', sin_costo: 'sin costo',
  };

  return (
    <>
      <div className="resumen-card" style={{ gap: '0.8rem' }}>
        <span className="muted">Valuación del inventario físico</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.7rem' }}>
          <div><small className="muted">Inventario físico real</small><strong className="big-number" style={{ display: 'block' }}>{mxn(data.valor_total)}</strong><small className="muted">Último conteo por zona</small></div>
          <div><small className="muted">FIFO esperado</small><strong className="big-number" style={{ display: 'block' }}>{mxn(data.valor_fifo_actual_total)}</strong><small className="muted">Auditoría de compras y consumos</small></div>
          <div><small className="muted">Diferencia FIFO − físico</small><strong className="big-number" style={{ display: 'block', color: diferenciaFisicoFifo === 0 ? undefined : '#e3b341' }}>{mxn(diferenciaFisicoFifo)}</strong><small className="muted">No cambia la existencia real</small></div>
          <div><small className="muted">Físico a costo catálogo</small><strong className="big-number" style={{ display: 'block' }}>{mxn(data.valor_catalogo_total)}</strong><small className="muted">Referencia de valuación</small></div>
        </div>
        <small className="muted">
          {data.fecha ? `Último conteo: ${new Date(data.fecha).toLocaleString('es-MX')} · ${data.tipo === 'cierre' ? 'cierre' : data.tipo === 'apertura' ? 'apertura' : data.tipo === 'ajuste' ? 'ajuste' : 'operativo'}${data.semana_id ? ` · semana ${data.semana_id}` : ''}` : 'Sin conteos aún'}
        </small>
        <small className="muted">Esta pantalla toma como existencia principal el último conteo físico. El saldo FIFO abierto se conserva aparte para costeo, rotación y lista de compras; no se suman ambos.</small>
      </div>
      {data.sin_costo.length > 0 && (
        <p className="aviso">
          <Icono name="alertTriangle" size={16} />
          Sin costo (no suman al valor): {data.sin_costo.map((s) => s.nombre).join(', ')}
        </p>
      )}
      {grupos.map((g) => (
        <SeccionCategoria key={g.id ?? 'sin'} titulo={g.nombre} count={g.items.length}>
          <ul className="conteo-list">
            {g.items.map((p) => (
              (() => {
                const totalOperativo = p.existencia_fisica_operativa ?? p.existencia_actual_operativa ?? p.total_operativo ?? p.total_base;
                const minimoOperativo = p.minimo_operativo ?? p.base_qty;
                const valorActual = p.valor;
                return <li key={p.product_id} className="conteo-row">
                  <div className="conteo-info">
                    <strong>{p.nombre}</strong>
                    <small className="muted">
                      Existencia {formatoCantidad(totalOperativo)} {pluralUnidad(p.unidad_operativa, totalOperativo)}
                      {' · '}conteo físico
                      {p.diferencia_fifo_vs_fisico_base != null && Math.abs(p.diferencia_fifo_vs_fisico_base) > 0.0001
                        ? <> · FIFO esperado {formatoCantidad(p.cantidad_fifo_operativa ?? 0)} {pluralUnidad(p.unidad_operativa, p.cantidad_fifo_operativa ?? 0)}</>
                        : ''}
                      {p.fuente_existencia_actual === 'fifo' && p.total_operativo !== totalOperativo
                        ? ` · físico ${formatoCantidad(p.total_operativo)} ${pluralUnidad(p.unidad_operativa, p.total_operativo)}`
                        : ''}
                      {' · '}mínimo {formatoCantidad(minimoOperativo)} {pluralUnidad(p.unidad_operativa, minimoOperativo)}
                      {' · '}{p.store}
                    </small>
                    <small className="muted">
                      Valuación física · {mxn(valorActual)}
                      {p.diferencia_fifo_vs_fisico_base != null && Math.abs(p.diferencia_fifo_vs_fisico_base) > 0.0001
                        ? <> · diferencia FIFO {formatoCantidad(p.diferencia_fifo_vs_fisico_base)}</>
                        : ''}
                      {p.cantidad_sin_lote > 0 ? ' · parte sin lote' : ''}
                    </small>
                  </div>
                  <span>{mxn(valorActual)}</span>
                </li>;
              })()
            ))}
          </ul>
        </SeccionCategoria>
      ))}
      <section className="resumen-card inventory-history">
        <div className="section-heading">
          <div><strong>Historial de conteos</strong><p className="muted">Cada conteo indica si fue apertura, cierre o ajuste. El operativo no cambia por sí solo el cierre semanal.</p></div>
        </div>
        {historial.length === 0 ? <p className="muted">Sin conteos registrados.</p> : (
          <ul className="conteo-list">
            {historial.slice(0, 12).map((s) => {
              const label = s.tipo === 'cierre' ? 'Cierre de semana' : s.tipo === 'apertura' ? 'Apertura de semana' : s.tipo === 'ajuste' ? 'Ajuste documentado' : 'Conteo operativo';
              return <li key={s.id} className="conteo-row">
                <div className="conteo-info"><strong>{label}{s.semana_id ? ` · Semana ${s.semana_id}` : ''}</strong><small className="muted">{new Date(s.creado_at).toLocaleString('es-MX')} · {s.lineas} líneas{s.motivo ? ` · ${s.motivo}` : ''}</small></div>
                <span className="chip">#{s.id}</span>
              </li>;
            })}
          </ul>
        )}
      </section>
    </>
  );
}

// ===========================================================================
//  LISTA DE COMPRAS
// ===========================================================================
function ListaDeCompras() {
  const [data, setData] = useState<ListaCompras | null>(null);
  useEffect(() => { api<ListaCompras>('/inventario/shopping-list').then(setData); }, []);
  if (!data) return <Cargando />;
  if (data.grupos.length === 0) return (
    <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <Icono name="checkCircle" size={16} /> No falta nada por comprar.
    </p>
  );

  return (
    <>
      <div className="resumen-card">
        <span className="muted">Total estimado de compra</span>
        <strong className="big-number">{mxn(data.total)}</strong>
        <small className="muted">Compara el mínimo físico contra lo que existe. Las conversiones internas sólo se usan para FIFO y costeo.</small>
      </div>
      {data.grupos.map((g) => (
        <div key={g.store} className="grupo-tienda">
          <div className="grupo-head">
            <strong>{g.store}</strong>
            <span className="muted">{mxn(g.subtotal)}</span>
          </div>
          <ul className="conteo-list">
            {g.items.map((it) => {
              const unidad = it.unidad_operativa ?? it.unidad_compra ?? 'unidad';
              const minimo = it.minimo_operativo ?? it.base_qty;
              const actual = it.existencia_actual_operativa ?? it.total_operativo ?? it.total_base;
              const faltante = it.existencia_actual_operativa != null
                ? Math.max(0, minimo - it.existencia_actual_operativa)
                : (it.faltante_operativo ?? it.faltante);
              return (
                <li key={it.product_id} className="conteo-row">
                  <div className="conteo-info">
                    <strong>{it.nombre}</strong>
                    <small className="muted">
                      Mínimo {formatoCantidad(minimo)} {pluralUnidad(unidad, minimo)}
                      {' · '}actual {formatoCantidad(actual)} {pluralUnidad(unidad, actual)}
                      {' · '}faltan {formatoCantidad(faltante)} {pluralUnidad(unidad, faltante)}
                    </small>
                    <small className="muted">
                      {it.costo_configurado && it.unit_cost != null
                        ? `Costo estimado ${mxn(it.unit_cost)} por ${pluralUnidad(unidad, 2).replace(/s$/, '')}`
                        : 'Costo pendiente de configurar'}
                    </small>
                  </div>
                  <span>{it.costo_configurado ? mxn(it.valor_faltante) : '—'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
