import ControlInventario from './ControlInventario';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Icono } from '../../icons';
import { Cargando } from '../../ui/Cargando';
import WeekSelector from '../../components/WeekSelector';
import Compras from '../compras/Compras';
import { inputHoraMexico, isoDesdeHoraMexico } from '../../operating';

// --- Tipos de la API ---
interface Zona { id: number; nombre: string; orden: number }
interface Categoria { id: number; nombre: string; orden: number; activo: boolean }
interface Unidad { zona_id: number; unidad_captura: string; factor: number }
interface SemanaRef { id: number; etiqueta: string; fecha_inicio: string; fecha_fin: string; estado: string }
interface Producto {
  id: number; nombre: string; store: string; base_qty: number | null;
  unit_cost: number | null; unidad_base: string | null; unidad_compra: string | null; contenido_compra: number | null;
  unidades: Unidad[]; categoria_id: number | null; categoria: string | null;
  presentacion_modo?: string;
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
  movimientos_no_cubiertos_base?: number;
  conteo_fisico_base?: number; entradas_posteriores_base?: number; consumos_posteriores_base?: number;
  existencia_fifo_base?: number | null; existencia_fifo_operativa?: number | null;
  diferencia_fifo_vs_fisico_base?: number | null;
  existencia_actual_base: number; existencia_actual_operativa: number;
  fuente_existencia_actual: 'fisico';
  costo_fifo_base: number | null; cantidad_con_lote: number; cantidad_sin_lote: number;
  fuente_valoracion: 'fifo' | 'catalogo' | 'mixta' | 'sin_costo';
  categoria_id: number | null; categoria: string | null;
  por_zona: { zona_id: number; zona: string; qty_captura: number; factor: number; unidad_captura?: string; contado_at?: string | null }[];
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
  recepciones_sin_hora?: number[];
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
  fuente_costo?: 'ultimo_fifo' | 'catalogo' | 'sin_costo';
  ultimo_costo_fifo_base?: number | null;
  ultimo_costo_fifo_fecha?: string | null;
  valor_faltante: number;
}
interface GrupoCompra { store: string; items: ItemCompra[]; subtotal: number }
interface ListaCompras { grupos: GrupoCompra[]; total: number }
interface SnapshotHistorial {
  oficial_para?: { tipo: string; semana_id: number }[];
  oficial?: boolean; zonas?: { zona_id: number; contado_at: string }[];
  id: number; tipo: 'apertura' | 'cierre' | 'ajuste' | 'conteo_operativo' | string;
  semana_id: number | null; motivo: string | null; nota: string | null; creado_at: string; lineas: number;
}
interface CierrePreviewLinea {
  product_id: number; producto: string; unidad_base: string | null; unidad_operativa: string;
  apertura_base: number; compras_base: number; ajustes_base: number; consumo_teorico_base: number;
  esperado_base: number; esperado_operativo: number; costo_unitario_base: number | null; valor_esperado: number | null;
}
interface CierrePreview {
  semana_id: number; apertura_snapshot_id: number; cierre_snapshot_id: number | null;
  formula: string; lineas: CierrePreviewLinea[]; productos: number; consumo_teorico_base: number; valor_esperado: number;
}

const mxn = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const formatoCantidad = (n: number | null | undefined) =>
  n == null ? '0' : n.toLocaleString('es-MX', { maximumFractionDigits: 2 });

function existenciaOperativaProducto(p: ProductoActual): number {
  return p.existencia_fisica_operativa ?? p.existencia_actual_operativa ?? p.total_operativo ?? p.total_base;
}

function minimoOperativoProducto(p: ProductoActual): number {
  return p.minimo_operativo ?? p.base_qty;
}

function pluralUnidad(unidad: string | null | undefined, cantidad?: number) {
  const u = (unidad ?? 'unidad').trim().toLowerCase();
  if (u.startsWith('equiv.')) return u;
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
  const directo = factorConteoDirecto(p);
  if (directo != null) return base / directo;
  if (!p || p.unidad_base === 'pieza') return base;
  const contenido = Number(p.contenido_compra);
  return Number.isFinite(contenido) && contenido > 0 ? base / contenido : Number(qtyCaptura);
}

function factorConteoDirecto(p?: Producto): number | null {
  if (p?.presentacion_modo === 'variable' && (p.unidad_base === 'g' || p.unidad_base === 'ml')) return 1;
  if (p?.presentacion_modo === 'por_lote' && (p.unidad_base === 'g' || p.unidad_base === 'ml')) return 1000;
  return null;
}

type Tab = 'conteo' | 'actual' | 'compras';
type TipoCaptura = 'apertura' | 'cierre' | 'ajuste';

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
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    return requested === 'actual' || requested === 'compras' ? requested : 'conteo';
  });
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    if (requested === 'actual' || requested === 'compras') setTab(requested);
    else if (!requested) setTab('conteo');
  }, [location.search]);
  function cambiarTab(value: Tab) {
    const params = new URLSearchParams(location.search);
    params.set('tab', value);
    navigate(`/inventario?${params.toString()}`);
  }
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="package" size={24} className="ttl-icon" />
          <h1>Abasto</h1>
        </div>
        <p className="muted">Inventario físico, compras y lotes FIFO en un solo flujo.</p>
      </header>
      <nav className="tabs">
        <button className={tab === 'conteo' ? 'tab tab--on' : 'tab'} onClick={() => cambiarTab('conteo')}>Conteo</button>
        <button className={tab === 'actual' ? 'tab tab--on' : 'tab'} onClick={() => cambiarTab('actual')}>Existencia actual</button>
        <button className={tab === 'compras' ? 'tab tab--on' : 'tab'} onClick={() => cambiarTab('compras')}>Compras</button>
      </nav>
      <div className="tab-body">
        {tab === 'conteo' && <Conteo onGuardado={() => cambiarTab('actual')} />}
        {tab === 'actual' && <InventarioActual />}
        {tab === 'compras' && (
          <>
            <details className="card shopping-fold" open={new URLSearchParams(location.search).get('comprasTab') === 'lista'}>
              <summary><strong>Lista de compras</strong><span className="muted">Consultar faltantes por proveedor</span></summary>
              <ListaDeCompras />
            </details>
            <Compras embebida />
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  CONTEO
// ===========================================================================
function Conteo({ onGuardado }: { onGuardado: () => void }) {
  const navigate = useNavigate();
  const parametros = new URLSearchParams(window.location.search);
  const cierreGuiado = parametros.get('tipo') === 'cierre';
  const regresarFinanzas = parametros.get('return') === 'finanzas';
  // Number(null) devuelve 0 (un valor finito), por lo que antes el formulario
  // quedaba sin semana seleccionada cuando se abría sin `?semana=`. Conserva
  // la ausencia del parámetro para poder elegir automáticamente la semana
  // abierta más reciente.
  const semanaParam = parametros.get('semana');
  const semanaSolicitada = semanaParam ? Number(semanaParam) : null;
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [zonaActiva, setZonaActiva] = useState<number | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({}); // `${pid}:${zid}` -> texto
  const [filtro, setFiltro] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  // Un conteo oficial puede capturarse por zonas. El servidor conserva cada
  // versión como snapshot inmutable y el siguiente guardado continúa el
  // snapshot anterior para que Bodega y Local queden asociados.
  const [continuarSnapshotId, setContinuarSnapshotId] = useState<number | null>(null);
  const [zonasGuardadas, setZonasGuardadas] = useState<number[]>([]);
  const [horasZona, setHorasZona] = useState<Record<number, string>>({});
  const [cargandoConteo, setCargandoConteo] = useState(false);
  // Durante la operación no se capturan conteos. El flujo válido es abrir,
  // cerrar o documentar un ajuste puntual.
  const [tipo, setTipo] = useState<TipoCaptura>(cierreGuiado ? 'cierre' : 'apertura');
  const [semanas, setSemanas] = useState<SemanaRef[]>([]);
  const [semanaId, setSemanaId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [cierrePreview, setCierrePreview] = useState<CierrePreview | null>(null);

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
      const semanaValida = semanaSolicitada != null && Number.isFinite(semanaSolicitada) && semanaSolicitada > 0
        ? ss.find((s) => s.id === semanaSolicitada)
        : null;
      if (semanaValida) setSemanaId(semanaValida.id);
      else if (abierta) setSemanaId(abierta.id);
      if (z[0]) setZonaActiva(z[0].id);
      // Pre-carga el último conteo de cada zona: así, para corregir una cantidad
      // basta editar ese campo y guardar, sin recapturar todo de nuevo.
      const previos: Record<string, string> = {};
      for (const prod of actual.productos) {
        const tieneMovimientos = (prod.entradas_posteriores_base ?? 0) > 0 || (prod.consumos_posteriores_base ?? 0) > 0;
        for (const pz of prod.por_zona) {
          const producto = p.find((item) => item.id === prod.product_id);
          const unidad = producto?.unidades.find((item) => item.zona_id === pz.zona_id)
            ?? { zona_id: pz.zona_id, unidad_captura: pz.unidad_captura ?? 'unidad', factor: pz.factor || 1 };
          // Si sólo hay una zona contada, la existencia física operativa se
          // puede prellenar sin ambigüedad después de aplicar entradas y
          // consumos. Con varias zonas se conserva el último conteo por zona
          // y el operador confirma la distribución real.
          previos[`${prod.product_id}:${pz.zona_id}`] = String(tieneMovimientos && prod.por_zona.length === 1
            ? (factorConteoDirecto(producto) != null ? (prod.existencia_fisica_base ?? prod.total_base) / factorConteoDirecto(producto)! : prod.existencia_fisica_operativa ?? capturaAOperativa(pz.qty_captura, producto, unidad))
            : capturaAOperativa(pz.qty_captura, producto, unidad));
        }
      }
      setValores(previos);
    });
  }, []);

  useEffect(() => {
    if (tipo === 'ajuste' || semanaId == null) { setHorasZona({}); setCargandoConteo(false); return; }
    let vigente = true;
    setCargandoConteo(true);
    api<SnapshotHistorial[]>('/inventario/snapshots?semana_id=' + semanaId).then(rows => {
      if (!vigente) return;
      const oficial = rows.find(row => row.oficial_para?.some(c => c.tipo === tipo && c.semana_id === semanaId) || (!row.oficial_para && row.tipo === tipo && row.oficial));
      setContinuarSnapshotId(oficial?.id ?? null);
      setZonasGuardadas(oficial?.zonas?.map(z => z.zona_id) ?? []);
      setHorasZona(Object.fromEntries((oficial?.zonas ?? []).map(z => [z.zona_id, inputHoraMexico(z.contado_at)])));
      if (oficial) setMsg('Conteo recuperado. Las zonas guardadas conservan su hora; completa las restantes o usa ajuste documentado para corregirlas.');
    }).catch(e => { if (vigente) setMsg(e instanceof Error ? e.message : 'No se pudo recuperar el conteo.'); })
      .finally(() => { if (vigente) setCargandoConteo(false); });
    return () => { vigente = false; };
  }, [tipo, semanaId]);

  useEffect(() => {
    setCierrePreview(null);
    if (!cierreGuiado || semanaId == null) return;
    api<CierrePreview>(`/inventario/cierre-preview?semana_id=${semanaId}`)
      .then(setCierrePreview)
      .catch((e) => setMsg(e instanceof Error ? e.message : 'No se pudo calcular el saldo esperado'));
  }, [cierreGuiado, semanaId]);

  const cierrePreviewPorProducto = useMemo(
    () => new Map((cierrePreview?.lineas ?? []).map((linea) => [linea.product_id, linea])),
    [cierrePreview],
  );

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
    if (zonaActiva == null) {
      setMsg('Selecciona una zona para guardar el inventario.');
      return;
    }
    const lineas = Object.entries(valores)
      .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
      .map(([k, v]) => {
        const [product_id, zona_id] = k.split(':').map(Number);
        const directo = factorConteoDirecto(productos.find((p) => p.id === product_id));
        return { product_id, zona_id, qty_captura: Number(v), ...(directo == null ? {} : { cantidad_base: Number(v) * directo }) };
      })
      .filter((linea) => linea.zona_id === zonaActiva);
    if (lineas.length === 0) {
      setMsg('Captura al menos un producto.');
      return;
    }
    setGuardando(true);
    setMsg('');
    try {
      // Si el navegador conservó la selección visual pero React aún no recibió
      // el evento (por ejemplo, justo después de una actualización), usa la
      // semana abierta más reciente como respaldo seguro.
      const semanaGuardar = semanaId ?? semanas.find((s) => s.estado === 'abierta')?.id ?? null;
      if ((tipo === 'apertura' || tipo === 'cierre') && semanaGuardar == null) {
        setMsg('Selecciona la semana que estás abriendo o cerrando.');
        return;
      }
      if (tipo === 'ajuste' && motivo.trim().length < 5) {
        setMsg('Describe el motivo del ajuste (mínimo 5 caracteres).');
        return;
      }
      const resultado = await api<{ snapshot_id: number; contado_at: string }>('/inventario/snapshots', {
        method: 'POST',
        body: {
          lineas,
          tipo,
          semana_id: semanaGuardar,
          motivo: motivo.trim() || null,
          unidad_conteo: 'operativa',
          continuar_snapshot_id: continuarSnapshotId,
          contado_at: isoDesdeHoraMexico(horasZona[zonaActiva] ?? ''),
        },
      });
      setContinuarSnapshotId(resultado.snapshot_id);
      setHorasZona(prev => ({ ...prev, [zonaActiva]: inputHoraMexico(resultado.contado_at) }));
      setZonasGuardadas((prev) => (prev.includes(zonaActiva) ? prev : [...prev, zonaActiva]));
      // Sólo limpia la zona que acaba de guardarse; así una segunda zona no
      // borra lo que el operador todavía estaba revisando en la primera.
      setValores((prev) => Object.fromEntries(
        Object.entries(prev).filter(([key]) => Number(key.split(':')[1]) !== zonaActiva),
      ));
      const todasGuardadas = zonas.length > 0 && zonas.every((zona) => zona.id === zonaActiva || zonasGuardadas.includes(zona.id));
      if (todasGuardadas) {
        if (cierreGuiado && regresarFinanzas && semanaGuardar != null) navigate(`/finanzas?semana=${semanaGuardar}&tab=cuadre`);
        else onGuardado();
      } else {
        const siguiente = zonas.find((zona) => zona.id !== zonaActiva && !zonasGuardadas.includes(zona.id));
        if (siguiente) setZonaActiva(siguiente.id);
        setMsg(`${zonas.find((zona) => zona.id === zonaActiva)?.nombre ?? 'Zona'} guardada. Captura ${siguiente?.nombre ?? 'la siguiente zona'} y vuelve a guardar.`);
      }
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
        {cargandoConteo && <Cargando etiqueta="Recuperando conteo guardado…" />}
        <div className="section-heading"><div><strong>¿Qué estás contando?</strong><p className="muted">Elige el tipo de conteo.</p></div></div>
        {cierreGuiado ? <div className="info-box info-box--compact">
          <strong style={{ display: 'block' }}>Confirmación de cierre · {semanas.find(s => s.id === semanaId)?.etiqueta ?? 'Semana actual'}</strong>
          <span>El sistema calcula apertura + compras + ajustes − consumo teórico. Revisa el físico y cambia sólo las cantidades que no coincidan; esas diferencias quedarán como alerta de merma o receta.</span>
          {cierrePreview && <span><b>{cierrePreview.productos} productos con movimiento</b> · consumo teórico {formatoCantidad(cierrePreview.consumo_teorico_base)} base · valor esperado {mxn(cierrePreview.valor_esperado)}</span>}
        </div> : <div className="pill-row">
          {([
            ['apertura', 'Apertura de semana'],
            ['cierre', 'Cierre de semana'],
            ['ajuste', 'Ajuste documentado'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={tipo === value ? 'pill pill--on' : 'pill'} onClick={() => { setTipo(value); setContinuarSnapshotId(null); setZonasGuardadas([]); setMsg(''); }}>{label}</button>
          ))}
        </div>}
        <div className="form-grid form-grid--two">
          {(tipo === 'apertura' || tipo === 'cierre') && <WeekSelector
            compact
            semanas={semanas}
            value={semanaId}
            onChange={(id) => { setSemanaId(id); setContinuarSnapshotId(null); setZonasGuardadas([]); setMsg(''); }}
            label="Semana del conteo"
            description="Apertura o cierre que vas a registrar."
            ariaLabel="Semana del conteo"
          />}
          {tipo === 'ajuste' && <label>Motivo del ajuste<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. conteo corregido de cajas" /></label>}
        </div>
        <p className="muted inventory-unit-help">Captura botellas, cajas, paquetes o piezas.</p>
      </section>
      <div className="zona-tabs">
        {zonas.map((z) => (
          <button key={z.id} className={z.id === zonaActiva ? 'pill pill--on' : 'pill'} onClick={() => setZonaActiva(z.id)}>
            {z.nombre}{zonasGuardadas.includes(z.id) ? ' ✓' : ''}
          </button>
        ))}
      </div>
      {zonaActiva != null && <label className="field-block inventory-time-field">Momento del conteo (México)<input type="datetime-local" value={horasZona[zonaActiva] ?? ''} disabled={zonasGuardadas.includes(zonaActiva) || guardando || cargandoConteo} onChange={e => setHorasZona(prev => ({ ...prev, [zonaActiva]: e.target.value }))} /><small className="muted">Si lo dejas vacío, se usa la hora de guardar esta zona. Las ventas anteriores ya están incluidas; las posteriores sí se descuentan.</small></label>}
      {zonaActiva != null && zonasGuardadas.includes(zonaActiva) && tipo !== 'ajuste' && <p className="info-box">Esta zona ya está guardada. Para corregirla, elige Ajuste documentado.</p>}
      <input className="buscador" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <p className="muted" style={{ fontSize: '0.82rem', margin: '0 0 0.4rem' }}>
        {cierreGuiado
          ? 'Los campos parten del último saldo físico disponible. Confirma que coincidan con el esperado y corrige sólo las diferencias reales.'
          : 'Se muestra el último conteo por zona. Cuando sólo hay una zona, se prellena con el saldo físico después de entradas y consumos; confirma la cantidad real antes de guardar.'}
      </p>

      {zonaActiva != null && grupos.map((g) => (
        <SeccionCategoria key={g.id ?? 'sin'} titulo={g.nombre} count={g.items.length}>
          <ul className="conteo-list">
            {g.items.map((p) => {
              const u = unidadDe(p, zonaActiva);
              const esperado = cierreGuiado ? cierrePreviewPorProducto.get(p.id) : undefined;
              const key = `${p.id}:${zonaActiva}`;
              const esBool = u.unidad_captura === 'boolean';
              const directo = factorConteoDirecto(p);
              const unidadOperativa = directo == null ? unidadOperativaProducto(p, u) : directo === 1000 ? (p.unidad_base === 'ml' ? 'litro' : 'kg') : p.unidad_base ?? 'unidad';
              return (
                <li key={p.id} className="conteo-row">
                  <div className="conteo-info">
                    <strong>{p.nombre}</strong>
                    <small className="muted">Se captura en {pluralUnidad(unidadOperativa, 2)} · {p.store}</small>
                    {directo != null && <small className="muted">Suma el contenido de todos los envases{p.unidad_base === 'ml' && directo === 1000 ? ': 2 de 600 ml = 1.2 L' : ''}.</small>}
                    {esperado && <small className="muted">Esperado al cierre: {formatoCantidad(esperado.esperado_operativo)} {pluralUnidad(esperado.unidad_operativa, esperado.esperado_operativo)}</small>}
                  </div>
                  {esBool ? (
                    <div className="bool-toggle">
                      <button className={valores[key] === '1' ? 'pill pill--on' : 'pill'} disabled={tipo !== 'ajuste' && zonasGuardadas.includes(zonaActiva)} onClick={() => setVal(p.id, zonaActiva, '1')}>Sí</button>
                      <button className={valores[key] === '0' ? 'pill pill--on' : 'pill'} disabled={tipo !== 'ajuste' && zonasGuardadas.includes(zonaActiva)} onClick={() => setVal(p.id, zonaActiva, '0')}>No</button>
                    </div>
                  ) : (
                    <input
                      disabled={tipo !== 'ajuste' && zonasGuardadas.includes(zonaActiva)}
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
        <button className="btn-primary" onClick={guardar} disabled={guardando || cargandoConteo || (tipo !== 'ajuste' && zonaActiva != null && zonasGuardadas.includes(zonaActiva))}>
          {guardando ? 'Guardando…' : cierreGuiado ? `Guardar ${zonas.find((zona) => zona.id === zonaActiva)?.nombre ?? 'zona'} y continuar` : `Guardar ${zonas.find((zona) => zona.id === zonaActiva)?.nombre ?? 'zona'}`}
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
        body: {
          lineas: validas.map((l) => ({ product_id: l.product_id, zona_id: zonaId, qty_captura: l.qty_captura })),
          tipo: 'ajuste',
          motivo: 'Borrador de conteo confirmado',
          // El borrador se revisa y captura en presentaciones físicas
          // (botellas, bolsas, frascos, etc.). Sin esta bandera el servidor
          // interpreta la cifra como unidad base y 600 g podrían terminar
          // convertidos en 600 frascos.
          unidad_conteo: 'operativa',
        },
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
        tú lo revisas y confirmas. Captura presentaciones físicas (frascos, bolsas, botellas o piezas), no gramos/ml.
        <b> Nada se guarda hasta que confirmes.</b>
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
    const recargar = () => { void api<Actual>('/inventario/current?vista=fisica').then(setData); };
    recargar();
    window.addEventListener('iberico-inventario-cambio', recargar);
    api<Categoria[]>('/catalogo/categorias-inventario').then(setCategorias).catch(() => {});
    api<SnapshotHistorial[]>('/inventario/snapshots').then(setHistorial).catch(() => {});
    return () => window.removeEventListener('iberico-inventario-cambio', recargar);
  }, []);
  if (!data) return <Cargando />;
  const grupos = agruparPorCategoria(data.productos, categorias);
  const diferenciasCantidad = data.productos.filter(p=>Math.abs((p.cantidad_fifo_base??0)-(p.existencia_fisica_base??p.total_base))>0.0001).length;
  const bajoMinimo = data.productos.filter((p) => existenciaOperativaProducto(p) < minimoOperativoProducto(p)).length;
  const sinExistencia = data.productos.filter((p) => existenciaOperativaProducto(p) <= 0).length;
  const entradasRegistradas = data.productos.filter((p) => (p.entradas_posteriores_base ?? 0) > 0).length;
  const cortesZona = [...new Map(data.productos.flatMap(p => p.por_zona).filter(z => z.contado_at).map(z => [z.zona_id, z])).values()];

  return (
    <>
      <div className="resumen-card inventory-overview">
        <div className="inventory-overview__head">
          <div><span className="eyebrow">Existencia actual</span><strong className="big-number">{mxn(data.valor_total)}</strong></div>
          <span className="chip chip--ok">Fuente: físico + movimientos</span>
          {!!data.recepciones_sin_hora?.length && <p role="status">Hay {data.recepciones_sin_hora.length} compra(s) del día del conteo sin hora real de llegada. Confírmala en Compras para distinguir si ya estaban contadas.</p>}
        </div>
        <div className="inventory-overview__values">
          <div><small>Productos</small><strong>{data.productos.length}</strong></div>
          <div className={bajoMinimo ? 'inventory-overview__warn' : ''}><small>Bajo mínimo</small><strong>{bajoMinimo}</strong></div>
          <div className={sinExistencia ? 'inventory-overview__danger' : ''}><small>Sin existencia</small><strong>{sinExistencia}</strong></div>
          <div className={entradasRegistradas ? 'inventory-overview__pending' : ''}><small>Entradas recientes</small><strong>{entradasRegistradas}</strong></div>
          <div><small>Diferencias de cantidad FIFO</small><strong className={diferenciasCantidad === 0 ? '' : 'inventory-overview__warn'}>{diferenciasCantidad}</strong></div>
        </div>
        <small className="muted">
          {data.fecha ? `Último registro: ${new Date(data.fecha).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})} · ${data.tipo === 'apertura_conciliada' ? 'apertura conciliada (saldo derivado)' : data.tipo === 'cierre' ? 'cierre' : data.tipo === 'apertura' ? 'apertura' : data.tipo === 'ajuste' ? 'ajuste' : 'histórico'}` : 'Sin registros aún'}
        </small>
        <details><summary>Cortes por zona (México)</summary>{cortesZona.map(z => <p key={z.zona_id}>{z.zona}: {inputHoraMexico(z.contado_at).replace('T', ' ')}</p>)}</details>
        <small className="muted">Cantidades: último físico + entradas − consumos posteriores. El importe es referencia de catálogo, no costo FIFO confirmado. La diferencia entre precios de catálogo y capas no es merma.</small>
      </div>
      <ControlInventario />
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
                const totalOperativo = existenciaOperativaProducto(p);
                const minimoOperativo = minimoOperativoProducto(p);
                const valorActual = p.valor;
                const cantidadFifo = p.cantidad_fifo_operativa ?? 0;
                const tieneEntrada = (p.entradas_posteriores_base ?? 0) > 0;
                const nivel = totalOperativo <= 0 ? 'empty' : totalOperativo < minimoOperativo ? 'low' : 'ok';
                const nivelTexto = nivel === 'empty' ? 'Sin existencia' : nivel === 'low' ? 'Bajo mínimo' : 'En rango';
                const avance = minimoOperativo > 0 ? Math.min(100, Math.max(0, (totalOperativo / minimoOperativo) * 100)) : 100;
                const tieneBrecha = p.diferencia_fifo_vs_fisico_base != null && Math.abs(p.diferencia_fifo_vs_fisico_base) > 0.0001;
                const tieneMovimiento = tieneEntrada || (p.consumos_posteriores_base ?? 0) > 0;
                return <li key={p.product_id} className={`stock-row stock-row--${nivel}`}>
                  <div className="stock-row__identity">
                    <strong>{p.nombre}</strong>
                    <small>{p.store}</small>
                  </div>
                  <div className="stock-row__quantity"><strong>{formatoCantidad(totalOperativo)}</strong><span>{pluralUnidad(p.unidad_operativa, totalOperativo)}</span></div>
                  <div className="stock-row__health">
                    <span className={`stock-state stock-state--${nivel}`}>{nivelTexto}</span>
                    <div className="stock-row__bar" aria-hidden="true"><span style={{ width: `${avance}%` }} /></div>
                    <small>mín. {formatoCantidad(minimoOperativo)} {pluralUnidad(p.unidad_operativa, minimoOperativo)}</small>
                  </div>
                  <div className="stock-row__value"><strong>{mxn(valorActual)}</strong><small>valor físico</small></div>
                  {(tieneMovimiento || tieneBrecha) && <div className="stock-row__audit">
                    {tieneMovimiento && <span>Desde el último conteo: {tieneEntrada ? `+${formatoCantidad(p.entradas_posteriores_base)} base en entradas` : ''}{tieneEntrada && (p.consumos_posteriores_base ?? 0) > 0 ? ' · ' : ''}{(p.consumos_posteriores_base ?? 0) > 0 ? `−${formatoCantidad(p.consumos_posteriores_base)} base en consumos` : ''}</span>}
                    {(p.movimientos_no_cubiertos_base ?? 0) > 0 && <span>Revisar movimientos: {formatoCantidad(p.movimientos_no_cubiertos_base)} {p.unidad_base} sin saldo físico suficiente en su momento.</span>}
                    {tieneBrecha && <><span>FIFO esperado: {formatoCantidad(cantidadFifo)} {pluralUnidad(p.unidad_operativa, cantidadFifo)}</span><span>Brecha: {formatoCantidad(p.diferencia_fifo_vs_fisico_base ?? 0)} base{p.cantidad_sin_lote > 0 ? ' · parte sin lote' : ''}</span></>}
                  </div>}
                </li>;
              })()
            ))}
          </ul>
        </SeccionCategoria>
      ))}
      <details className="resumen-card inventory-history">
        <summary><span><strong>Historial de inventario</strong><small>Cierres, aperturas y ajustes</small></span><span className="muted">Auditoría</span></summary>
        <div className="inventory-history__body"><p className="muted">Aperturas, cierres y ajustes documentados.</p>
        {historial.length === 0 ? <p className="muted">Sin conteos registrados.</p> : (
          <ul className="conteo-list">
            {historial.slice(0, 12).map((s) => {
              const label = s.tipo === 'cierre' ? 'Cierre de semana' : s.tipo === 'apertura' ? 'Apertura de semana' : s.tipo === 'ajuste' ? 'Ajuste documentado' : 'Conteo operativo (histórico)';
              return <li key={s.id} className="conteo-row">
                <div className="conteo-info"><strong>{label}{s.semana_id ? ` · Semana ${s.semana_id}` : ''}</strong><small className="muted">{new Date(s.creado_at).toLocaleString('es-MX')} · {s.lineas} líneas{s.motivo ? ` · ${s.motivo}` : ''}</small></div>
                <span className="chip">#{s.id}</span>
              </li>;
            })}
          </ul>
        )}
        </div>
      </details>
    </>
  );
}

// ===========================================================================
//  LISTA DE COMPRAS
// ===========================================================================
export function ListaDeCompras() {
  const [data, setData] = useState<ListaCompras | null>(null);
  useEffect(() => { api<ListaCompras>('/inventario/shopping-list').then(setData); }, []);
  if (!data) return <Cargando />;
  if (data.grupos.length === 0) return (
    <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <Icono name="checkCircle" size={16} /> No falta nada por comprar.
    </p>
  );

  const items = data.grupos.flatMap((g) => g.items);
  const sinExistencia = items.filter((it) => (it.existencia_actual_operativa ?? it.total_operativo ?? it.total_base) <= 0).length;
  const unidadesFaltantes = items.reduce((total, it) => {
    const presentaciones = it.presentaciones_faltantes;
    if (presentaciones != null) return total + Math.max(0, presentaciones);
    return total + Math.max(0, it.faltante_operativo ?? it.faltante ?? 0);
  }, 0);

  return (
    <>
      <div className="resumen-card inventory-overview">
        <div className="inventory-overview__head">
          <div><span className="eyebrow">Unidades faltantes</span><strong className="big-number">{formatoCantidad(unidadesFaltantes)}</strong></div>
          <span className="chip chip--ok">Fuente: físico actual</span>
        </div>
        <div className="inventory-overview__values">
          <div><small>Productos</small><strong>{items.length}</strong></div>
          <div className="inventory-overview__warn"><small>Compras sugeridas</small><strong>{formatoCantidad(unidadesFaltantes)}</strong></div>
          <div className={sinExistencia ? 'inventory-overview__danger' : ''}><small>Sin existencia</small><strong>{sinExistencia}</strong></div>
          <div><small>Costo estimado</small><strong>{mxn(data.total)}</strong></div>
        </div>
        <small className="muted">Muestra la existencia física operativa, el mínimo y la compra sugerida. FIFO sólo audita.</small>
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
              const faltante = Math.max(0, minimo - actual);
              const nivel = actual <= 0 ? 'empty' : 'low';
              const avance = minimo > 0 ? Math.min(100, Math.max(0, (actual / minimo) * 100)) : 0;
              return (
                <li key={it.product_id} className={`stock-row stock-row--${nivel}`}>
                  <div className="stock-row__identity">
                    <strong>{it.nombre}</strong>
                    <small>{g.store}</small>
                  </div>
                  <div className="stock-row__quantity" aria-label={`Faltan ${formatoCantidad(faltante)} ${pluralUnidad(unidad, faltante)}`}>
                    <strong>{formatoCantidad(faltante)}</strong><span>{pluralUnidad(unidad, faltante)} faltantes</span>
                  </div>
                  <div className="stock-row__health">
                    <span className={`stock-state stock-state--${nivel}`}>{nivel === 'empty' ? 'Sin existencia' : 'Bajo mínimo'}</span>
                    <div className="stock-row__bar" aria-hidden="true"><span style={{ width: `${avance}%` }} /></div>
                    <small>mín. {formatoCantidad(minimo)} {pluralUnidad(unidad, minimo)}</small>
                  </div>
                  <div className="stock-row__value"><strong>{it.costo_configurado ? mxn(it.valor_faltante) : '—'}</strong><small>compra sugerida</small></div>
                  <div className="stock-row__audit">
                    <span>Existencia actual: {formatoCantidad(actual)} {pluralUnidad(unidad, actual)}</span>
                    {it.costo_configurado && it.unit_cost != null && <span>{it.fuente_costo === 'ultimo_fifo' ? 'Último FIFO' : 'Catálogo'}: {mxn(it.unit_cost)} por {pluralUnidad(unidad, 2).replace(/s$/, '')}{it.ultimo_costo_fifo_fecha ? ` · ${it.ultimo_costo_fifo_fecha}` : ''}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
