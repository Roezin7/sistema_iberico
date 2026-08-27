import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';
import { useConfirm, usePrompt } from '../../ui/ConfirmProvider';
import { useToast } from '../../ui/ToastProvider';
import { Cargando } from '../../ui/Cargando';

const mxn = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

type Tab = 'general' | 'inventario' | 'recetas' | 'finanzas';

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <Icono name="settings" size={24} className="ttl-icon" />
          <h1>Configuración</h1>
        </div>
      </header>
      <nav className="tabs">
        <button className={tab === 'general' ? 'tab tab--on' : 'tab'} onClick={() => setTab('general')}>General</button>
        <button className={tab === 'inventario' ? 'tab tab--on' : 'tab'} onClick={() => setTab('inventario')}>Productos</button>
        <button className={tab === 'recetas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('recetas')}>Recetas y costeo</button>
        <button className={tab === 'finanzas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('finanzas')}>Finanzas</button>
      </nav>
      <div className="tab-body">
        {tab === 'general' && <General />}
        {tab === 'inventario' && <InventarioCfg />}
        {tab === 'recetas' && <RecetasCfg />}
        {tab === 'finanzas' && <FinanzasCfg />}
      </div>
    </div>
  );
}

// ===========================================================================
//  GENERAL: nombre del negocio, socios, categorías de gasto
// ===========================================================================
interface Negocio { id: number; nombre: string; tipo: string | null; zona_horaria: string }
interface Socio { id: number; nombre: string; activo: boolean }
interface Categoria { id: number; nombre: string; activo: boolean }
interface Ubicacion { id: number; nombre: string; tipo: 'banco' | 'efectivo'; socio_id: number | null; activo: boolean }
interface AdminConfig { ubicaciones: Ubicacion[]; categorias: Categoria[]; socios: Socio[]; saldos_iniciales: { ubicacion_id: number; monto: number }[] }
interface UsuarioAdmin { id: number; nombre: string; rol: 'admin' | 'empleado'; activo: boolean }

function General() {
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [nombre, setNombre] = useState('');
  const [msg, setMsg] = useState('');
  const [cfg, setCfg] = useState<AdminConfig | null>(null);

  const cargarCfg = () => api<AdminConfig>('/finanzas/config').then(setCfg);
  useEffect(() => {
    api<Negocio>('/catalogo/negocio').then((n) => { setNegocio(n); setNombre(n.nombre); });
    void cargarCfg();
  }, []);

  async function guardarNombre() {
    setMsg('');
    await api('/catalogo/negocio', { method: 'PATCH', body: { nombre } });
    setMsg('Guardado ✓');
    setTimeout(() => setMsg(''), 1500);
  }

  if (!negocio || !cfg) return <Cargando />;

  return (
    <>
      <div className="form-mov">
        <strong>Nombre del negocio</strong>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <button className="btn-primary" onClick={guardarNombre} disabled={!nombre.trim() || nombre === negocio.nombre}>
          {msg || 'Guardar'}
        </button>
        <small className="muted">Zona horaria: {negocio.zona_horaria} (fija)</small>
      </div>

      <ListaEditable
        titulo="Socios"
        items={cfg.socios}
        onCrear={(nombre) => api('/finanzas/socios', { method: 'POST', body: { nombre } }).then(cargarCfg)}
        onRenombrar={(id, nombre) => api(`/finanzas/socios/${id}`, { method: 'PATCH', body: { nombre } }).then(cargarCfg)}
        onToggle={(id, activo) => api(`/finanzas/socios/${id}`, { method: 'PATCH', body: { activo } }).then(cargarCfg)}
        placeholder="Nombre del socio"
      />

      <ListaEditable
        titulo="Categorías de gasto"
        items={cfg.categorias}
        onCrear={(nombre) => api('/finanzas/categorias', { method: 'POST', body: { nombre } }).then(cargarCfg)}
        onRenombrar={(id, nombre) => api(`/finanzas/categorias/${id}`, { method: 'PATCH', body: { nombre } }).then(cargarCfg)}
        onToggle={(id, activo) => api(`/finanzas/categorias/${id}`, { method: 'PATCH', body: { activo } }).then(cargarCfg)}
        placeholder="Nombre de la categoría"
      />

      <Usuarios />
    </>
  );
}

// --- Usuarios y PINs ---
function Usuarios() {
  const [users, setUsers] = useState<UsuarioAdmin[]>([]);
  const [nombre, setNombre] = useState('');
  const [urol, setURol] = useState<'admin' | 'empleado'>('empleado');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const pedir = usePrompt();
  const { success, error } = useToast();
  const cargar = () => api<UsuarioAdmin[]>('/auth/admin/usuarios').then(setUsers);
  useEffect(() => { void cargar(); }, []);

  const patch = (u: UsuarioAdmin, data: Record<string, unknown>) =>
    api(`/auth/admin/usuarios/${u.id}`, { method: 'PATCH', body: data })
      .then(cargar)
      .catch((e) => error(e instanceof Error ? e.message : 'Error'));

  async function crear() {
    setErr('');
    if (!nombre.trim() || pin.length < 4) { setErr('Nombre y PIN (mínimo 4 dígitos) son obligatorios.'); return; }
    try {
      await api('/auth/admin/usuarios', { method: 'POST', body: { nombre: nombre.trim(), rol: urol, pin } });
      setNombre(''); setPin(''); setURol('empleado'); cargar();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
  }

  async function resetPin(u: UsuarioAdmin) {
    const p = await pedir({ title: 'Restablecer PIN', message: `Nuevo PIN para ${u.nombre}`, placeholder: 'Mínimo 4 dígitos', minLength: 4 });
    if (!p) return;
    try { await api(`/auth/admin/usuarios/${u.id}/reset-pin`, { method: 'POST', body: { pin_nuevo: p } }); success('PIN actualizado'); }
    catch (e) { error(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Usuarios y PINs</strong>
      <ul className="conteo-list list-flat">
        {users.map((u) => (
          <li key={u.id} className={`conteo-row ${u.activo ? '' : 'is-inactive'}`} style={{ flexWrap: 'wrap' }}>
            <input defaultValue={u.nombre} className="field-md" style={{ flex: 1, minWidth: 120 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.nombre) void patch(u, { nombre: v }); }} />
            <select value={u.rol} onChange={(e) => void patch(u, { rol: e.target.value })} className="field-md">
              <option value="empleado">empleado</option>
              <option value="admin">admin</option>
            </select>
            <button className="pill" onClick={() => void resetPin(u)}>PIN</button>
            <button className="pill" onClick={() => void patch(u, { activo: !u.activo })}>{u.activo ? 'Desactivar' : 'Activar'}</button>
          </li>
        ))}
      </ul>
      <strong style={{ marginTop: '0.5rem' }}>Nuevo usuario</strong>
      <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <select value={urol} onChange={(e) => setURol(e.target.value as 'admin' | 'empleado')}>
        <option value="empleado">Empleado (solo Inventario y Tareas)</option>
        <option value="admin">Admin (acceso total)</option>
      </select>
      <input placeholder="PIN (mín. 4 dígitos)" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} />
      {err && <p className="error-msg">{err}</p>}
      <button className="btn-secondary" onClick={crear}>+ Crear usuario</button>
    </div>
  );
}

/** Lista genérica de elementos con nombre + activar/desactivar + agregar. */
function ListaEditable({
  titulo, items, onCrear, onRenombrar, onToggle, placeholder,
}: {
  titulo: string;
  items: { id: number; nombre: string; activo: boolean }[];
  onCrear: (nombre: string) => Promise<unknown>;
  onRenombrar: (id: number, nombre: string) => Promise<unknown>;
  onToggle: (id: number, activo: boolean) => Promise<unknown>;
  placeholder: string;
}) {
  const [nuevo, setNuevo] = useState('');
  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>{titulo}</strong>
      <ul className="conteo-list list-flat">
        {items.length === 0 && <li className="conteo-row"><span className="muted">Aún no hay.</span></li>}
        {items.map((it) => (
          <li key={it.id} className={`conteo-row ${it.activo ? '' : 'is-inactive'}`}>
            <input
              defaultValue={it.nombre}
              className="field-md"
              style={{ flex: 1 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.nombre) void onRenombrar(it.id, v); }}
            />
            <button className="pill" onClick={() => void onToggle(it.id, !it.activo)}>
              {it.activo ? 'Desactivar' : 'Activar'}
            </button>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <input style={{ flex: 1 }} placeholder={placeholder} value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nuevo.trim()) return; await onCrear(nuevo.trim()); setNuevo(''); }}>+ Agregar</button>
      </div>
    </div>
  );
}

// ===========================================================================
//  RECETAS Y COSTEO: cantidades editables, versionadas y separadas de ventas
// ===========================================================================
interface RecetaLinea {
  product_id: number;
  producto: string | null;
  cantidad: number;
  unidad: string;
  nota: string | null;
  costo_unitario: number | null;
  costo_estimado: number | null;
  cantidad_base: number | null;
  unidad_base: string | null;
  falta_configuracion: string[];
}
interface MenuReceta {
  id: number;
  nombre: string;
  epos_product_id: number | null;
  precio_venta: number | null;
  activo: boolean;
  recetas: { id: number; version: number; estado: string; fuente: string | null; notas: string | null; lineas: RecetaLinea[] }[];
}
interface InsumoReceta {
  id: number;
  nombre: string;
  costo_unitario: number | null;
  unidad_base: string | null;
  contenido_compra: number | null;
  unidad_compra: string | null;
  rendimiento_util: number | null;
}
interface DraftLinea { product_id: string; cantidad: string; unidad: string; nota: string }

function RecetasCfg() {
  const [menu, setMenu] = useState<MenuReceta[]>([]);
  const [insumos, setInsumos] = useState<InsumoReceta[]>([]);
  const [nombre, setNombre] = useState('');
  const [eposId, setEposId] = useState('');
  const [precio, setPrecio] = useState('');
  const [fuente, setFuente] = useState('Screenshots de costeo 2026-08-12');
  const [estado, setEstado] = useState<'borrador' | 'validada'>('borrador');
  const [lineas, setLineas] = useState<DraftLinea[]>([]);
  const [filtroMenu, setFiltroMenu] = useState('');
  const [draft, setDraft] = useState<DraftLinea>({ product_id: '', cantidad: '', unidad: 'ml', nota: '' });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const { success, error } = useToast();

  const cargar = () => Promise.all([
    api<MenuReceta[]>('/recetas'),
    api<InsumoReceta[]>('/recetas/insumos'),
  ]).then(([m, i]) => { setMenu(m); setInsumos(i); }).finally(() => setCargando(false));
  useEffect(() => { void cargar(); }, []);

  function agregarLinea() {
    if (!draft.product_id || Number(draft.cantidad) <= 0 || !draft.unidad.trim()) return;
    if (lineas.some((l) => l.product_id === draft.product_id)) { error('Ese ingrediente ya está en la receta.'); return; }
    setLineas((v) => [...v, draft]);
    setDraft({ product_id: '', cantidad: '', unidad: 'ml', nota: '' });
  }

  async function guardar() {
    if (!nombre.trim() || lineas.length === 0) { error('Indica el nombre y agrega al menos un ingrediente.'); return; }
    setGuardando(true);
    try {
      await api('/recetas', { method: 'POST', body: {
        nombre: nombre.trim(),
        epos_product_id: eposId ? Number(eposId) : null,
        precio_venta: precio ? Number(precio) : null,
        estado,
        fuente: fuente.trim() || null,
        lineas: lineas.map((l) => ({ product_id: Number(l.product_id), cantidad: Number(l.cantidad), unidad: l.unidad.trim(), nota: l.nota.trim() || null })),
      } });
      setNombre(''); setEposId(''); setPrecio(''); setLineas([]); setEstado('borrador');
      await cargar();
      success('Receta guardada como nueva versión');
    } catch (e) { error(e instanceof Error ? e.message : 'No se pudo guardar la receta'); }
    finally { setGuardando(false); }
  }

  function copiarVersion(p: MenuReceta) {
    const r = p.recetas[0];
    if (!r) return;
    setNombre(p.nombre); setEposId(p.epos_product_id?.toString() ?? ''); setPrecio(p.precio_venta?.toString() ?? '');
    setFuente(r.fuente ?? ''); setEstado('borrador');
    setLineas(r.lineas.map((l) => ({ product_id: String(l.product_id), cantidad: String(l.cantidad), unidad: l.unidad, nota: l.nota ?? '' })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (cargando) return <Cargando />;
  return (
    <>
      <div className="resumen-card" style={{ gap: '0.65rem' }}>
        <div className="card-head"><div><strong>Editor de recetas</strong><p className="muted">Crea una nueva versión sin borrar el historial. Las cantidades se costean con el catálogo y FIFO vigente.</p></div>{nombre && <span className="chip chip--info">editando {nombre}</span>}</div>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Producto de menú" value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
          <input placeholder="ID Epos (opcional)" inputMode="numeric" value={eposId} onChange={(e) => setEposId(e.target.value.replace(/\D/g, ''))} style={{ flex: 1, minWidth: 130 }} />
          <input placeholder="Precio venta MXN (opcional)" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} style={{ flex: 1, minWidth: 170 }} />
        </div>
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <select value={draft.product_id} onChange={(e) => { const value = e.target.value; const insumo = insumos.find((i) => String(i.id) === value); setDraft({ ...draft, product_id: value, unidad: insumo?.unidad_base ?? draft.unidad }); }} style={{ flex: 2, minWidth: 180 }}>
            <option value="">Ingrediente del inventario…</option>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}{i.costo_unitario == null ? '' : ` · ${mxn(i.costo_unitario)}`}</option>)}
          </select>
          <input placeholder="Cantidad" inputMode="decimal" value={draft.cantidad} onChange={(e) => setDraft({ ...draft, cantidad: e.target.value })} style={{ width: 100 }} />
          <select value={draft.unidad} onChange={(e) => setDraft({ ...draft, unidad: e.target.value })} style={{ width: 100 }}>
            <option value="ml">ml</option><option value="g">g</option><option value="pieza">pieza</option><option value="oz">oz</option><option value="unidad">unidad</option>
          </select>
          <button className="btn-secondary" onClick={agregarLinea}>+ Ingrediente</button>
        </div>
        {lineas.length > 0 && <ul className="conteo-list list-flat">
          {lineas.map((l, idx) => <li key={`${l.product_id}-${idx}`} className="conteo-row">
            <span style={{ flex: 1 }}>{insumos.find((i) => String(i.id) === l.product_id)?.nombre ?? 'Ingrediente'}</span>
            <span>{l.cantidad} {l.unidad}</span>
            <button className="link-btn" onClick={() => setLineas((v) => v.filter((_, i) => i !== idx))}>Quitar</button>
          </li>)}
        </ul>}
        <div className="row-actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Fuente o nota de validación" value={fuente} onChange={(e) => setFuente(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
          <select value={estado} onChange={(e) => setEstado(e.target.value as 'borrador' | 'validada')}><option value="borrador">Borrador</option><option value="validada">Validada</option></select>
          <button className="btn-primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar receta'}</button>
        </div>
      </div>

      <div className="resumen-card" style={{ gap: '0.5rem' }}>
        <div className="card-head"><div><strong>Catálogo de recetas</strong><p className="muted">Selecciona un producto para preparar una nueva versión. La versión anterior permanece intacta.</p></div><span className="badge-neutral">{menu.length} productos</span></div>
        <input className="buscador" placeholder="Buscar en el menú…" value={filtroMenu} onChange={(e) => setFiltroMenu(e.target.value)} />
        {menu.length === 0 && <p className="muted">Aún no hay recetas cargadas.</p>}
        {menu.filter((p) => p.nombre.toLowerCase().includes(filtroMenu.toLowerCase())).map((p) => {
          const r = p.recetas[0];
          const total = r?.lineas.reduce((s, l) => s + (l.costo_estimado ?? 0), 0) ?? null;
          return <div key={p.id} className="conteo-row" style={{ flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ flex: 1, minWidth: 220 }}><strong>{p.nombre}</strong><div className="muted">v{r?.version ?? '—'} · {r?.estado ?? 'sin receta'} · costo {mxn(total)}{r?.lineas.some((l) => l.falta_configuracion.length) ? ' · falta configuración de insumos' : ''}</div></div>
            <span className="muted">venta {mxn(p.precio_venta)}</span>
            <button className="pill" onClick={() => copiarVersion(p)}>Editar receta</button>
          </div>;
        })}
      </div>
    </>
  );
}

// ===========================================================================
//  INVENTARIO: productos (agregar/editar/mínimo/costo/quitar) + tiendas
// ===========================================================================
interface Store { id: number; nombre: string }
interface Zona { id: number; nombre: string; orden: number }
interface CategoriaInv { id: number; nombre: string; orden: number; activo: boolean }
interface UnidadZona { id: number; zona_id: number; unidad_captura: string; factor: number }
interface Producto {
  id: number; nombre: string; store_id: number; store: string;
  base_qty: number; unit_cost: number | null; active: boolean; categoria_id: number | null; unidades: UnidadZona[];
  categoria: string | null;
  unidad_base: string | null; contenido_compra: number | null; unidad_compra: string | null; rendimiento_util: number | null;
}

function InventarioCfg() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [categorias, setCategorias] = useState<CategoriaInv[]>([]);
  const [filtro, setFiltro] = useState('');
  const [storeFilter, setStoreFilter] = useState<number | ''>('');
  const [categoriaFilter, setCategoriaFilter] = useState<number | ''>('');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [seleccionado, setSeleccionado] = useState<number | null>(null);

  const cargar = () => Promise.all([
    api<Producto[]>('/catalogo/products'),
    api<Store[]>('/catalogo/stores'),
    api<Zona[]>('/catalogo/zonas'),
    api<CategoriaInv[]>('/catalogo/categorias-inventario'),
  ]).then(([p, s, z, c]) => { setProductos(p); setStores(s); setZonas(z); setCategorias(c); });
  useEffect(() => { void cargar(); }, []);

  const filtrados = useMemo(
    () => productos
      .filter((p) => mostrarInactivos || p.active)
      .filter((p) => storeFilter === '' || p.store_id === storeFilter)
      .filter((p) => categoriaFilter === '' || p.categoria_id === categoriaFilter)
      .filter((p) => `${p.nombre} ${p.store} ${p.categoria ?? ''}`.toLowerCase().includes(filtro.toLowerCase())),
    [productos, filtro, mostrarInactivos, storeFilter, categoriaFilter],
  );

  useEffect(() => {
    if (filtrados.length === 0) setSeleccionado(null);
    else if (seleccionado == null || !filtrados.some((p) => p.id === seleccionado)) setSeleccionado(filtrados[0].id);
  }, [filtrados, seleccionado]);

  const productoSeleccionado = filtrados.find((p) => p.id === seleccionado) ?? null;
  const recargar = () => { void cargar(); };

  return (
    <>
      <div className="config-intro resumen-card">
        <div>
          <strong>Productos e inventario</strong>
          <p className="muted">Un solo lugar para cambiar nombre, tienda, mínimo y presentación. El sistema usa esos datos para convertir compras a la unidad FIFO y para mostrar el inventario en piezas.</p>
        </div>
        <div className="config-stats">
          <span><b>{productos.filter((p) => p.active).length}</b> activos</span>
          <span><b>{productos.filter((p) => p.unidad_base && p.contenido_compra).length}</b> con conversión</span>
          <span><b>{productos.filter((p) => !p.unidad_base || !p.contenido_compra).length}</b> por configurar</span>
        </div>
      </div>
      <details className="config-advanced">
        <summary><strong>Catálogos auxiliares</strong><span className="muted">categorías, tiendas y zonas</span></summary>
        <CategoriasInvCfg categorias={categorias} onChange={cargar} />
        <ZonasCfg zonas={zonas} onChange={cargar} />
      </details>

      <button className="btn-primary" style={{ marginBottom: '0.75rem' }} onClick={() => setNuevoAbierto((v) => !v)}>
        {nuevoAbierto ? 'Cerrar' : '+ Nuevo producto'}
      </button>
      {nuevoAbierto && <NuevoProducto stores={stores} categorias={categorias} onCreado={() => { setNuevoAbierto(false); cargar(); }} onNuevaTienda={cargar} />}

      <div className="product-filters">
        <input className="buscador" placeholder="Buscar por producto, tienda o categoría…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Filtrar por tienda">
          <option value="">Todas las tiendas</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={categoriaFilter} onChange={(e) => setCategoriaFilter(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categorias.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <label className="config-check"><input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} /> <span>Incluir inactivos</span></label>
      </div>

      <div className="product-editor">
        <aside className="product-list" aria-label="Productos del catálogo">
          <div className="product-list__head"><strong>Catálogo</strong><span className="muted">{filtrados.length} productos</span></div>
          {filtrados.map((p) => <button type="button" key={p.id} className={`product-list__item ${p.id === seleccionado ? 'product-list__item--on' : ''}`} onClick={() => setSeleccionado(p.id)}>
            <span className="product-list__name">{p.nombre} {!p.active && <span className="chip chip--warn">inactivo</span>}</span>
            <span className="product-list__meta">{p.store}{p.categoria ? ` · ${p.categoria}` : ''}</span>
            <span className="product-list__meta">mín. {p.base_qty} {p.unidad_compra ?? 'unidades'}</span>
          </button>)}
          {filtrados.length === 0 && <p className="muted product-list__empty">Sin resultados.</p>}
        </aside>
        <main className="product-detail">
          {productoSeleccionado ? <ProductoEditorPanel key={productoSeleccionado.id} p={productoSeleccionado} stores={stores} zonas={zonas} categorias={categorias} onChange={recargar} /> : <div className="empty-state"><strong>Selecciona un producto</strong><p>Elige un producto del catálogo para editarlo.</p></div>}
        </main>
      </div>
    </>
  );
}

// --- Categorías de inventario (alcohol, cocina, congelado, …) ---
function CategoriasInvCfg({ categorias, onChange }: { categorias: CategoriaInv[]; onChange: () => void }) {
  const [nombre, setNombre] = useState('');
  const confirmar = useConfirm();
  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Categorías de inventario</strong>
      <p className="muted">Sirven para agrupar el conteo y el inventario (alcohol, cocina, congelado…).</p>
      <ul className="conteo-list list-flat">
        {categorias.length === 0 && <li className="conteo-row"><span className="muted">Aún no hay categorías.</span></li>}
        {categorias.map((c) => (
          <li key={c.id} className={`conteo-row ${c.activo ? '' : 'is-inactive'}`} style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <input defaultValue={c.nombre} className="field-md" style={{ flex: 1, minWidth: 110 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.nombre) void api(`/catalogo/categorias-inventario/${c.id}`, { method: 'PATCH', body: { nombre: v } }).then(onChange); }} />
            <input type="number" defaultValue={c.orden} title="Orden" className="field-md" style={{ width: 64, textAlign: 'right' }}
              onBlur={(e) => { const v = Number(e.target.value); if (v !== c.orden) void api(`/catalogo/categorias-inventario/${c.id}`, { method: 'PATCH', body: { orden: v } }).then(onChange); }} />
            <button className="link-btn" title="Eliminar categoría" aria-label={`Eliminar categoría ${c.nombre}`} onClick={async () => {
              const ok = await confirmar({ message: `¿Eliminar la categoría "${c.nombre}"? Los productos quedarán sin categoría.`, tone: 'danger', confirmText: 'Eliminar' });
              if (!ok) return;
              await api(`/catalogo/categorias-inventario/${c.id}`, { method: 'DELETE' }); onChange();
            }}>✕</button>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <input style={{ flex: 1 }} placeholder="Nueva categoría (ej. Alcohol)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nombre.trim()) return; await api('/catalogo/categorias-inventario', { method: 'POST', body: { nombre: nombre.trim(), orden: categorias.length + 1 } }); setNombre(''); onChange(); }}>+ Categoría</button>
      </div>
    </div>
  );
}

// --- Zonas de inventario ---
function ZonasCfg({ zonas, onChange }: { zonas: Zona[]; onChange: () => void }) {
  const [nombre, setNombre] = useState('');
  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Zonas de inventario</strong>
      <ul className="conteo-list list-flat">
        {zonas.map((z) => (
          <li key={z.id} className="conteo-row">
            <input defaultValue={z.nombre} className="field-md" style={{ flex: 1 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== z.nombre) void api(`/catalogo/zonas/${z.id}`, { method: 'PATCH', body: { nombre: v } }).then(onChange); }} />
            <span className="muted">orden {z.orden}</span>
          </li>
        ))}
      </ul>
      <div className="row-actions">
        <input style={{ flex: 1 }} placeholder="Nueva zona (ej. Barra)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nombre.trim()) return; await api('/catalogo/zonas', { method: 'POST', body: { nombre: nombre.trim(), orden: zonas.length + 1 } }); setNombre(''); onChange(); }}>+ Zona</button>
      </div>
    </div>
  );
}

function NuevoProducto({ stores, categorias, onCreado, onNuevaTienda }: { stores: Store[]; categorias: CategoriaInv[]; onCreado: () => void; onNuevaTienda: () => void }) {
  const [nombre, setNombre] = useState('');
  const [storeId, setStoreId] = useState<number | ''>(stores[0]?.id ?? '');
  const [categoriaId, setCategoriaId] = useState<number | ''>('');
  const [baseQty, setBaseQty] = useState('');
  const [costo, setCosto] = useState('');
  const [unidadBase, setUnidadBase] = useState('');
  const [contenidoCompra, setContenidoCompra] = useState('');
  const [unidadCompra, setUnidadCompra] = useState('');
  const [error, setError] = useState('');
  const [nuevaTienda, setNuevaTienda] = useState('');

  return (
    <div className="form-mov">
      <strong>Nuevo producto</strong>
      <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))}>
        <option value="">— Tienda —</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">— Categoría (opcional) —</option>
        {categorias.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <div className="row-actions">
        <input style={{ flex: 1 }} placeholder="Nueva tienda…" value={nuevaTienda} onChange={(e) => setNuevaTienda(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nuevaTienda.trim()) return; await api('/catalogo/stores', { method: 'POST', body: { nombre: nuevaTienda.trim() } }); setNuevaTienda(''); onNuevaTienda(); }}>+ Tienda</button>
      </div>
      <div className="form-grid form-grid--three">
      <label>Mínimo de compra (presentaciones)
        <input type="number" inputMode="decimal" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} placeholder="0" />
      </label>
      <label>Costo de la presentación (opcional)
        <input type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="—" />
      </label>
      <label>Presentación de compra
        <select value={unidadCompra} onChange={(e) => setUnidadCompra(e.target.value)}><option value="">Selecciona…</option>{PRESENTACIONES.map((u) => <option key={u} value={u}>{u}</option>)}</select>
      </label>
      <label>Unidad FIFO
        <select value={unidadBase} onChange={(e) => setUnidadBase(e.target.value)}><option value="">Selecciona…</option>{UNIDADES_BASE.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
      </label>
      <label>Contenido por presentación
        <input type="number" inputMode="decimal" value={contenidoCompra} onChange={(e) => setContenidoCompra(e.target.value)} placeholder="Ej. 700" />
      </label>
      </div>
      {error && <p className="error-msg">{error}</p>}
      <button className="btn-primary" onClick={async () => {
        if (!nombre.trim() || storeId === '') { setError('Nombre y tienda son obligatorios.'); return; }
        try {
          await api('/catalogo/products', { method: 'POST', body: {
            nombre: nombre.trim(), store_id: storeId, base_qty: Number(baseQty) || 0,
            unit_cost: costo === '' ? null : Number(costo),
            unidad_base: unidadBase || null,
            contenido_compra: contenidoCompra === '' ? null : Number(contenidoCompra),
            unidad_compra: unidadCompra || null,
            categoria_id: categoriaId === '' ? null : categoriaId,
          } });
          onCreado();
        } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
      }}>Crear producto</button>
    </div>
  );
}

const UNIDADES_BASE = [
  { value: 'g', label: 'gramos (g)' },
  { value: 'ml', label: 'mililitros (ml)' },
  { value: 'pieza', label: 'piezas' },
  { value: 'unidad', label: 'unidades' },
];
const PRESENTACIONES = ['botella', 'caja', 'paquete', 'bolsa', 'pieza', 'rollo', 'bote', 'litro', 'kilogramo', 'unidad'];
const UNIDADES_CAPTURA = ['botellas', 'cajas', 'paquetes', 'bolsas', 'piezas', 'rollos', 'botes', 'unidades'];

function ProductoEditorPanel({ p, stores, zonas, categorias, onChange }: { p: Producto; stores: Store[]; zonas: Zona[]; categorias: CategoriaInv[]; onChange: () => void }) {
  const [nombre, setNombre] = useState(p.nombre);
  const [storeId, setStoreId] = useState(p.store_id);
  const [categoriaId, setCategoriaId] = useState<number | ''>(p.categoria_id ?? '');
  const [baseQty, setBaseQty] = useState(String(p.base_qty));
  const [costo, setCosto] = useState(p.unit_cost == null ? '' : String(p.unit_cost));
  const [unidadBase, setUnidadBase] = useState(p.unidad_base ?? '');
  const [contenidoCompra, setContenidoCompra] = useState(p.contenido_compra == null ? '' : String(p.contenido_compra));
  const [unidadCompra, setUnidadCompra] = useState(p.unidad_compra ?? '');
  const [rendimiento, setRendimiento] = useState(String(p.rendimiento_util ?? 1));
  const [ok, setOk] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    if (!nombre.trim() || storeId <= 0) { setError('Nombre y tienda son obligatorios.'); return; }
    if (unidadBase && (!contenidoCompra || Number(contenidoCompra) <= 0)) { setError('Indica el contenido por presentación para convertir compras a FIFO.'); return; }
    try {
      await api(`/catalogo/products/${p.id}`, { method: 'PATCH', body: {
        nombre: nombre.trim(), store_id: storeId, base_qty: Number(baseQty) || 0,
        unit_cost: costo === '' ? null : Number(costo),
        unidad_base: unidadBase === '' ? null : unidadBase,
        contenido_compra: contenidoCompra === '' ? null : Number(contenidoCompra),
        unidad_compra: unidadCompra.trim() || null,
        rendimiento_util: Number(rendimiento) || 1,
        categoria_id: categoriaId === '' ? null : categoriaId,
      } });
      setOk(true); setTimeout(() => setOk(false), 1500); onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
  }

  return (
    <div className={`product-editor__panel ${p.active ? '' : 'is-inactive'}`}>
      <div className="product-editor__title"><div><span className="eyebrow">Producto #{p.id}</span><h2>{p.nombre}</h2></div><span className={`chip ${p.active ? 'chip--ok' : 'chip--warn'}`}>{p.active ? 'Activo' : 'Inactivo'}</span></div>
      <section className="product-editor__section"><h3>Identidad</h3><div className="form-grid form-grid--three">
          <label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
          <label>Tienda de compra<select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
          <label>Categoría
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">— Sin categoría —</option>
              {categorias.filter((c) => c.activo || c.id === p.categoria_id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
      </div></section>
      <section className="product-editor__section"><h3>Compra y FIFO</h3><p className="muted">El mínimo se expresa en presentaciones. FIFO convierte cada presentación a la unidad base automáticamente.</p><div className="form-grid form-grid--four">
        <label>Mínimo de compra<input type="number" min="0" inputMode="decimal" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} /></label>
        <label>Presentación<select value={unidadCompra} onChange={(e) => setUnidadCompra(e.target.value)}><option value="">Selecciona…</option>{PRESENTACIONES.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        <label>Contenido por presentación<input type="number" min="0" inputMode="decimal" value={contenidoCompra} onChange={(e) => setContenidoCompra(e.target.value)} placeholder="Ej. 700" /></label>
        <label>Costo presentación<input type="number" min="0" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="—" /></label>
      </div><div className="form-grid form-grid--three">
        <label>Unidad base FIFO<select value={unidadBase} onChange={(e) => setUnidadBase(e.target.value)}><option value="">Pendiente</option>{UNIDADES_BASE.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
        <label>Rendimiento útil<input type="number" min="0.01" max="1" step="0.01" value={rendimiento} onChange={(e) => setRendimiento(e.target.value)} /><small className="field-help">1 = 100% aprovechable</small></label>
        <div className="conversion-preview"><span>Conversión</span><strong>{contenidoCompra && unidadBase ? `1 ${unidadCompra || 'presentación'} = ${contenidoCompra} ${unidadBase}` : 'Falta configurar'}</strong><small>{costo && contenidoCompra ? `${mxn(Number(costo) / Number(contenidoCompra))} por ${unidadBase || 'unidad base'}` : 'Agrega costo y contenido'}</small></div>
      </div></section>
      <section className="product-editor__section"><h3>Cómo se cuenta</h3><p className="muted">Selecciona la unidad que verá el equipo en cada zona. El factor indica cuántas unidades base representa una captura.</p><div className="zone-editor">{zonas.map((z) => { const u = p.unidades.find((x) => x.zona_id === z.id); return <UnidadZonaRow key={z.id} productId={p.id} zona={z} unidad={u} onChange={onChange} />; })}</div></section>
      {error && <p className="error-msg">{error}</p>}
      <div className="product-editor__actions"><button className="btn-primary" onClick={guardar}>{ok ? 'Guardado ✓' : 'Guardar cambios'}</button><button className="btn-secondary" onClick={async () => { await api(`/catalogo/products/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); onChange(); }}>{p.active ? 'Desactivar producto' : 'Reactivar producto'}</button></div>
    </div>
  );
}

function UnidadZonaRow({ productId, zona, unidad, onChange }: { productId: number; zona: Zona; unidad?: UnidadZona; onChange: () => void }) {
  const [tipo, setTipo] = useState(unidad?.unidad_captura ?? 'unidades');
  const [factor, setFactor] = useState(String(unidad?.factor ?? 1));
  return (
    <div className="kv" style={{ borderBottom: 'none', gap: '0.4rem', flexWrap: 'wrap' }}>
      <span style={{ minWidth: 60 }}>{zona.nombre}</span>
      <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="field-sm" style={{ flex: 1, minWidth: 110 }}>{!UNIDADES_CAPTURA.includes(tipo) && <option value={tipo}>{tipo}</option>}{UNIDADES_CAPTURA.map((u) => <option key={u} value={u}>{u}</option>)}</select>
      <span className="muted">×</span>
      <input type="number" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} className="field-sm" style={{ width: 70, textAlign: 'right' }} />
      <button className="pill" onClick={async () => {
        await api('/catalogo/product-zone-units', { method: 'PUT', body: { product_id: productId, zona_id: zona.id, unidad_captura: tipo.trim() || 'unidad', factor: Number(factor) || 1 } });
        onChange();
      }}>Guardar</button>
      {unidad && (
        <button className="link-btn" title="Quitar de esta zona" aria-label={`Quitar ${zona.nombre} de esta zona`} onClick={async () => { await api(`/catalogo/product-zone-units/${unidad.id}`, { method: 'DELETE' }); onChange(); }}>✕</button>
      )}
    </div>
  );
}

// ===========================================================================
//  FINANZAS: saldos iniciales + ubicaciones de fondos
// ===========================================================================
function FinanzasCfg() {
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const cargar = () => api<AdminConfig>('/finanzas/config').then(setCfg);
  useEffect(() => { void cargar(); }, []);
  if (!cfg) return <Cargando />;
  return (
    <>
      <SaldosIniciales cfg={cfg} onChange={cargar} />
      <Ubicaciones cfg={cfg} onChange={cargar} />
    </>
  );
}

function SaldosIniciales({ cfg, onChange }: { cfg: AdminConfig; onChange: () => void }) {
  const saldoDe = (uid: number) => cfg.saldos_iniciales.find((s) => s.ubicacion_id === uid)?.monto ?? 0;
  const [montos, setMontos] = useState<Record<number, string>>(() =>
    Object.fromEntries(cfg.ubicaciones.map((u) => [u.id, String(saldoDe(u.id))])));
  const [msg, setMsg] = useState('');
  const activas = cfg.ubicaciones.filter((u) => u.activo);

  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Saldos iniciales (base de finanzas)</strong>
      <p className="aviso">⚠️ Es el saldo base del que parte el encadenado semanal. Las semanas ya cerradas guardan su cierre congelado y no cambian.</p>
      {activas.map((u) => (
        <div key={u.id} className="kv" style={{ borderBottom: 'none' }}>
          <span>{u.nombre} <small className="muted">{u.tipo}</small></span>
          <input
            className="conteo-input" type="number" inputMode="decimal"
            value={montos[u.id] ?? ''}
            onChange={(e) => setMontos({ ...montos, [u.id]: e.target.value })}
          />
        </div>
      ))}
      <button className="btn-primary" onClick={async () => {
        setMsg('');
        await api('/finanzas/saldos-iniciales', { method: 'PUT', body: {
          saldos: activas.map((u) => ({ ubicacion_id: u.id, monto: Number(montos[u.id]) || 0 })),
        } });
        setMsg('Guardado ✓'); setTimeout(() => setMsg(''), 1500); onChange();
      }}>{msg || 'Guardar saldos'}</button>
    </div>
  );
}

function Ubicaciones({ cfg, onChange }: { cfg: AdminConfig; onChange: () => void }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'banco' | 'efectivo'>('efectivo');
  const [socioId, setSocioId] = useState<number | ''>('');
  const nombreSocio = (id: number | null) => cfg.socios.find((s) => s.id === id)?.nombre;

  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Ubicaciones de fondos</strong>
      <ul className="conteo-list list-flat">
        {cfg.ubicaciones.map((u) => (
          <li key={u.id} className={`conteo-row ${u.activo ? '' : 'is-inactive'}`}>
            <div className="conteo-info">
              <strong>{u.nombre}</strong>
              <small className="muted">{u.tipo}{u.socio_id ? ` · ${nombreSocio(u.socio_id) ?? 'socio'}` : ''}</small>
            </div>
            <button className="pill" onClick={() => void api(`/finanzas/ubicaciones/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } }).then(onChange)}>
              {u.activo ? 'Desactivar' : 'Activar'}
            </button>
          </li>
        ))}
      </ul>
      <strong style={{ marginTop: '0.5rem' }}>Agregar ubicación</strong>
      <input placeholder="Nombre (ej. Caja Fuerte 2)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <select value={tipo} onChange={(e) => setTipo(e.target.value as 'banco' | 'efectivo')}>
        <option value="efectivo">Efectivo</option>
        <option value="banco">Banco</option>
      </select>
      <select value={socioId} onChange={(e) => setSocioId(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">— Sin socio —</option>
        {cfg.socios.filter((s) => s.activo).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <button className="btn-secondary" onClick={async () => {
        if (!nombre.trim()) return;
        await api('/finanzas/ubicaciones', { method: 'POST', body: { nombre: nombre.trim(), tipo, socio_id: socioId === '' ? null : socioId } });
        setNombre(''); setSocioId(''); onChange();
      }}>+ Agregar ubicación</button>
    </div>
  );
}
