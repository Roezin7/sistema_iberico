import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';

const mxn = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

type Tab = 'general' | 'inventario' | 'finanzas';

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
        <button className={tab === 'inventario' ? 'tab tab--on' : 'tab'} onClick={() => setTab('inventario')}>Inventario</button>
        <button className={tab === 'finanzas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('finanzas')}>Finanzas</button>
      </nav>
      <div className="tab-body">
        {tab === 'general' && <General />}
        {tab === 'inventario' && <InventarioCfg />}
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

  if (!negocio || !cfg) return <p className="muted">Cargando…</p>;

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
  const cargar = () => api<UsuarioAdmin[]>('/auth/admin/usuarios').then(setUsers);
  useEffect(() => { void cargar(); }, []);

  const patch = (u: UsuarioAdmin, data: Record<string, unknown>) =>
    api(`/auth/admin/usuarios/${u.id}`, { method: 'PATCH', body: data })
      .then(cargar)
      .catch((e) => alert(e instanceof Error ? e.message : 'Error'));

  async function crear() {
    setErr('');
    if (!nombre.trim() || pin.length < 4) { setErr('Nombre y PIN (mínimo 4 dígitos) son obligatorios.'); return; }
    try {
      await api('/auth/admin/usuarios', { method: 'POST', body: { nombre: nombre.trim(), rol: urol, pin } });
      setNombre(''); setPin(''); setURol('empleado'); cargar();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
  }

  async function resetPin(u: UsuarioAdmin) {
    const p = prompt(`Nuevo PIN para ${u.nombre} (mínimo 4 dígitos):`);
    if (!p) return;
    if (p.length < 4) { alert('El PIN debe tener al menos 4 dígitos.'); return; }
    try { await api(`/auth/admin/usuarios/${u.id}/reset-pin`, { method: 'POST', body: { pin_nuevo: p } }); alert('PIN actualizado ✓'); }
    catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Usuarios y PINs</strong>
      <ul className="conteo-list" style={{ boxShadow: 'none' }}>
        {users.map((u) => (
          <li key={u.id} className="conteo-row" style={{ opacity: u.activo ? 1 : 0.5, flexWrap: 'wrap' }}>
            <input defaultValue={u.nombre} style={{ flex: 1, minWidth: 120, minHeight: 40 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== u.nombre) void patch(u, { nombre: v }); }} />
            <select value={u.rol} onChange={(e) => void patch(u, { rol: e.target.value })} style={{ minHeight: 40 }}>
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
      <ul className="conteo-list" style={{ boxShadow: 'none' }}>
        {items.length === 0 && <li className="conteo-row"><span className="muted">Aún no hay.</span></li>}
        {items.map((it) => (
          <li key={it.id} className="conteo-row" style={{ opacity: it.activo ? 1 : 0.5 }}>
            <input
              defaultValue={it.nombre}
              style={{ flex: 1, minHeight: 40 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.nombre) void onRenombrar(it.id, v); }}
            />
            <button className="pill" onClick={() => void onToggle(it.id, !it.activo)}>
              {it.activo ? 'Desactivar' : 'Activar'}
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input style={{ flex: 1 }} placeholder={placeholder} value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nuevo.trim()) return; await onCrear(nuevo.trim()); setNuevo(''); }}>+ Agregar</button>
      </div>
    </div>
  );
}

// ===========================================================================
//  INVENTARIO: productos (agregar/editar/mínimo/costo/quitar) + tiendas
// ===========================================================================
interface Store { id: number; nombre: string }
interface Zona { id: number; nombre: string; orden: number }
interface UnidadZona { id: number; zona_id: number; unidad_captura: string; factor: number }
interface Producto {
  id: number; nombre: string; store_id: number; store: string;
  base_qty: number; unit_cost: number | null; active: boolean; unidades: UnidadZona[];
}

function InventarioCfg() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [filtro, setFiltro] = useState('');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  const cargar = () => Promise.all([
    api<Producto[]>('/catalogo/products'),
    api<Store[]>('/catalogo/stores'),
    api<Zona[]>('/catalogo/zonas'),
  ]).then(([p, s, z]) => { setProductos(p); setStores(s); setZonas(z); });
  useEffect(() => { void cargar(); }, []);

  const filtrados = useMemo(
    () => productos
      .filter((p) => mostrarInactivos || p.active)
      .filter((p) => p.nombre.toLowerCase().includes(filtro.toLowerCase())),
    [productos, filtro, mostrarInactivos],
  );

  return (
    <>
      <ZonasCfg zonas={zonas} onChange={cargar} />

      <button className="btn-primary" style={{ marginBottom: '0.75rem' }} onClick={() => setNuevoAbierto((v) => !v)}>
        {nuevoAbierto ? 'Cerrar' : '+ Nuevo producto'}
      </button>
      {nuevoAbierto && <NuevoProducto stores={stores} onCreado={() => { setNuevoAbierto(false); cargar(); }} onNuevaTienda={cargar} />}

      <input className="buscador" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      <label className="kv" style={{ borderBottom: 'none', cursor: 'pointer' }}>
        <span className="muted">Mostrar productos desactivados</span>
        <input type="checkbox" style={{ minHeight: 'auto', width: 18, height: 18 }} checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} />
      </label>

      {filtrados.map((p) => <ProductoRow key={p.id} p={p} stores={stores} zonas={zonas} onChange={cargar} />)}
      {filtrados.length === 0 && <p className="muted">Sin resultados.</p>}
    </>
  );
}

// --- Zonas de inventario ---
function ZonasCfg({ zonas, onChange }: { zonas: Zona[]; onChange: () => void }) {
  const [nombre, setNombre] = useState('');
  return (
    <div className="resumen-card" style={{ gap: '0.5rem' }}>
      <strong>Zonas de inventario</strong>
      <ul className="conteo-list" style={{ boxShadow: 'none' }}>
        {zonas.map((z) => (
          <li key={z.id} className="conteo-row">
            <input defaultValue={z.nombre} style={{ flex: 1, minHeight: 40 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== z.nombre) void api(`/catalogo/zonas/${z.id}`, { method: 'PATCH', body: { nombre: v } }).then(onChange); }} />
            <span className="muted">orden {z.orden}</span>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input style={{ flex: 1 }} placeholder="Nueva zona (ej. Barra)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nombre.trim()) return; await api('/catalogo/zonas', { method: 'POST', body: { nombre: nombre.trim(), orden: zonas.length + 1 } }); setNombre(''); onChange(); }}>+ Zona</button>
      </div>
    </div>
  );
}

function NuevoProducto({ stores, onCreado, onNuevaTienda }: { stores: Store[]; onCreado: () => void; onNuevaTienda: () => void }) {
  const [nombre, setNombre] = useState('');
  const [storeId, setStoreId] = useState<number | ''>(stores[0]?.id ?? '');
  const [baseQty, setBaseQty] = useState('');
  const [costo, setCosto] = useState('');
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
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input style={{ flex: 1 }} placeholder="Nueva tienda…" value={nuevaTienda} onChange={(e) => setNuevaTienda(e.target.value)} />
        <button className="btn-secondary" onClick={async () => { if (!nuevaTienda.trim()) return; await api('/catalogo/stores', { method: 'POST', body: { nombre: nuevaTienda.trim() } }); setNuevaTienda(''); onNuevaTienda(); }}>+ Tienda</button>
      </div>
      <label className="muted">Cantidad mínima (en unidades base)
        <input type="number" inputMode="decimal" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} placeholder="0" />
      </label>
      <label className="muted">Costo por unidad (opcional)
        <input type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="—" />
      </label>
      {error && <p className="error-msg">{error}</p>}
      <button className="btn-primary" onClick={async () => {
        if (!nombre.trim() || storeId === '') { setError('Nombre y tienda son obligatorios.'); return; }
        try {
          await api('/catalogo/products', { method: 'POST', body: {
            nombre: nombre.trim(), store_id: storeId, base_qty: Number(baseQty) || 0,
            unit_cost: costo === '' ? null : Number(costo),
          } });
          onCreado();
        } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
      }}>Crear producto</button>
    </div>
  );
}

function ProductoRow({ p, stores, zonas, onChange }: { p: Producto; stores: Store[]; zonas: Zona[]; onChange: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(p.nombre);
  const [storeId, setStoreId] = useState(p.store_id);
  const [baseQty, setBaseQty] = useState(String(p.base_qty));
  const [costo, setCosto] = useState(p.unit_cost == null ? '' : String(p.unit_cost));
  const [ok, setOk] = useState(false);

  async function guardar() {
    await api(`/catalogo/products/${p.id}`, { method: 'PATCH', body: {
      nombre: nombre.trim(), store_id: storeId, base_qty: Number(baseQty) || 0,
      unit_cost: costo === '' ? null : Number(costo),
    } });
    setOk(true); setTimeout(() => setOk(false), 1200); onChange();
  }

  return (
    <div className="resumen-card" style={{ gap: '0.4rem', opacity: p.active ? 1 : 0.55 }}>
      <div className="kv" style={{ borderBottom: 'none', cursor: 'pointer' }} onClick={() => setAbierto((v) => !v)}>
        <strong>{p.nombre} {!p.active && <span className="chip chip--warn">inactivo</span>}</strong>
        <span className="muted">mín {p.base_qty} · {mxn(p.unit_cost)} · {p.store}</span>
      </div>
      {abierto && (
        <>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <label className="muted">Cantidad mínima (unidades base)
            <input type="number" inputMode="decimal" value={baseQty} onChange={(e) => setBaseQty(e.target.value)} />
          </label>
          <label className="muted">Costo por unidad
            <input type="number" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="—" />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={guardar}>{ok ? 'Guardado ✓' : 'Guardar'}</button>
            <button className="btn-secondary" onClick={async () => { await api(`/catalogo/products/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); onChange(); }}>
              {p.active ? 'Quitar' : 'Reactivar'}
            </button>
          </div>

          <div className="dia-section">Cómo se cuenta en cada zona</div>
          {zonas.map((z) => {
            const u = p.unidades.find((x) => x.zona_id === z.id);
            return <UnidadZonaRow key={z.id} productId={p.id} zona={z} unidad={u} onChange={onChange} />;
          })}
        </>
      )}
    </div>
  );
}

function UnidadZonaRow({ productId, zona, unidad, onChange }: { productId: number; zona: Zona; unidad?: UnidadZona; onChange: () => void }) {
  const [tipo, setTipo] = useState(unidad?.unidad_captura ?? 'unidad');
  const [factor, setFactor] = useState(String(unidad?.factor ?? 1));
  return (
    <div className="kv" style={{ borderBottom: 'none', gap: '0.4rem', flexWrap: 'wrap' }}>
      <span style={{ minWidth: 60 }}>{zona.nombre}</span>
      <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="unidad" style={{ flex: 1, minWidth: 90, minHeight: 38 }} />
      <span className="muted">×</span>
      <input type="number" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} style={{ width: 70, minHeight: 38, textAlign: 'right' }} />
      <button className="pill" onClick={async () => {
        await api('/catalogo/product-zone-units', { method: 'PUT', body: { product_id: productId, zona_id: zona.id, unidad_captura: tipo.trim() || 'unidad', factor: Number(factor) || 1 } });
        onChange();
      }}>Guardar</button>
      {unidad && (
        <button className="link-btn" title="Quitar de esta zona" onClick={async () => { await api(`/catalogo/product-zone-units/${unidad.id}`, { method: 'DELETE' }); onChange(); }}>✕</button>
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
  if (!cfg) return <p className="muted">Cargando…</p>;
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
      <ul className="conteo-list" style={{ boxShadow: 'none' }}>
        {cfg.ubicaciones.map((u) => (
          <li key={u.id} className="conteo-row" style={{ opacity: u.activo ? 1 : 0.5 }}>
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
