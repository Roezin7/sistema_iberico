import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Icono } from '../../icons';
import { Cargando } from '../../ui/Cargando';

type Linea = {
  producto: string;
  cantidad: number;
  unidad: string;
  cantidad_base: number | null;
  unidad_base: string | null;
  costo_unitario_base: number | null;
  costo: number | null;
  falta_configuracion: string[];
  nota: string | null;
};

type ProductoCosto = {
  id: number;
  nombre: string;
  seccion: string;
  orden: number;
  precio_venta: number | null;
  costo_receta: number | null;
  margen_unitario: number | null;
  food_cost_pct: number | null;
  receta_id: number | null;
  version: number | null;
  estado: string;
  completa: boolean;
  lineas: Linea[];
};

type ResumenCostos = {
  productos: number;
  costeados: number;
  pendientes: number;
  food_cost_promedio: number | null;
  margen_promedio: number | null;
};

type RespuestaCostos = {
  fuente: string;
  moneda: string;
  generado_at: string;
  resumen: ResumenCostos;
  secciones: string[];
  productos: ProductoCosto[];
};

const money = (value: number | null) =>
  value == null ? '—' : value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const percent = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;

export default function CostosMenu() {
  const [data, setData] = useState<RespuestaCostos | null>(null);
  const [section, setSection] = useState('Todos');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      setData(await api<RespuestaCostos>('/recetas/resumen'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el costeo del menú');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    return section === 'Todos' ? data.productos : data.productos.filter((p) => p.seccion === section);
  }, [data, section]);

  const grouped = useMemo(() => filtered.reduce<Record<string, ProductoCosto[]>>((groups, product) => {
    (groups[product.seccion] ??= []).push(product);
    return groups;
  }, {}), [filtered]);

  if (cargando && !data) return <div className="page"><Cargando /></div>;

  return (
    <div className="page menu-costos-page">
      <header className="page-head menu-costos-head">
        <div>
          <div className="page-title">
            <Icono name="trending" size={24} className="ttl-icon" />
            <h1>Costos del menú</h1>
          </div>
          <p className="muted">Costo teórico por receta vigente, ordenado como la carta.</p>
        </div>
        <div className="menu-costos-actions">
          <button className="btn-secondary" onClick={() => window.print()}><Icono name="file" size={17} /> Imprimir / PDF</button>
          <button className="btn-ghost" onClick={() => void cargar()} disabled={cargando}><Icono name="refresh" size={17} /> Actualizar</button>
        </div>
      </header>

      {error && <div className="error-msg menu-costos-error">{error}</div>}
      {data && (
        <>
          <section className="menu-costos-hero">
            <div>
              <span className="eyebrow">Vista ejecutiva · {data.moneda}</span>
              <h2>Rentabilidad del menú</h2>
              <p>Una lectura rápida de precio, costo de receta, margen y food cost para cada producto. Las cifras se basan en la receta y el catálogo actuales; el FIFO histórico se consulta por separado en Compras.</p>
            </div>
            <div className="menu-costos-source"><Icono name="checkCircle" size={18} /> {data.fuente}</div>
          </section>

          <section className="menu-costos-kpis" aria-label="Resumen del costeo">
            <div className="menu-costos-kpi"><span>Productos de la carta</span><strong>{data.resumen.productos}</strong><small>activos en el catálogo</small></div>
            <div className="menu-costos-kpi"><span>Con costo calculado</span><strong>{data.resumen.costeados}</strong><small>{data.resumen.pendientes} pendientes de completar</small></div>
            <div className="menu-costos-kpi"><span>Food cost promedio</span><strong>{percent(data.resumen.food_cost_promedio)}</strong><small>promedio de productos con precio</small></div>
            <div className="menu-costos-kpi"><span>Margen promedio</span><strong>{money(data.resumen.margen_promedio)}</strong><small>por unidad vendida</small></div>
          </section>

          <div className="menu-costos-note"><Icono name="alertCircle" size={16} /> Una cifra pendiente no es cero: significa que falta configurar precio, presentación o rendimiento del insumo.</div>

          <nav className="menu-costos-filters" aria-label="Sección del menú">
            {['Todos', ...data.secciones].map((item) => (
              <button key={item} className={section === item ? 'menu-costos-filter menu-costos-filter--on' : 'menu-costos-filter'} onClick={() => setSection(item)}>{item}</button>
            ))}
          </nav>

          <div className="menu-costos-sections">
            {Object.entries(grouped).map(([name, products]) => (
              <section className="menu-costos-section" key={name}>
                <div className="menu-costos-section__head"><h2>{name}</h2><span>{products.length} productos</span></div>
                <div className="menu-costos-grid">
                  {products.map((product) => <ProductCard key={product.id} product={product} />)}
                </div>
              </section>
            ))}
          </div>

          {!filtered.length && <div className="empty-state">No hay productos en esta sección.</div>}
          <p className="menu-costos-footnote">Generado {new Date(data.generado_at).toLocaleString('es-MX')} · Documento de consulta para dirección e inversionistas; no modifica recetas ni inventario.</p>
        </>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: ProductoCosto }) {
  const status = product.receta_id == null ? 'Sin receta' : product.completa ? 'Completo' : 'Pendiente';
  const statusClass = product.receta_id == null ? 'is-missing' : product.completa ? 'is-ok' : 'is-pending';
  return (
    <article className="menu-costos-card">
      <div className="menu-costos-card__head">
        <div><h3>{product.nombre}</h3><span className={`menu-costos-status ${statusClass}`}>{status}{product.version ? ` · v${product.version}` : ''}</span></div>
        <strong className="menu-costos-card__price">{money(product.precio_venta)}</strong>
      </div>
      <div className="menu-costos-metrics">
        <div><span>Costo receta</span><strong>{money(product.costo_receta)}</strong></div>
        <div><span>Margen unitario</span><strong>{money(product.margen_unitario)}</strong></div>
        <div><span>Food cost</span><strong>{percent(product.food_cost_pct)}</strong></div>
      </div>
      <details className="menu-costos-detail">
        <summary>Ver desglose <Icono name="chevron" size={15} /></summary>
        {product.lineas.length ? (
          <div className="menu-costos-lines">
            {product.lineas.map((line, index) => (
              <div className="menu-costos-line" key={`${line.producto}-${index}`}>
                <span><strong>{line.producto}</strong><small>{line.cantidad} {line.unidad}{line.nota ? ` · ${line.nota}` : ''}</small></span>
                <strong>{money(line.costo)}</strong>
              </div>
            ))}
          </div>
        ) : <p className="muted">No hay receta vigente capturada.</p>}
        {!product.completa && <div className="menu-costos-warning"><Icono name="alertTriangle" size={15} /> Configuración pendiente: {product.lineas.flatMap((line) => line.falta_configuracion).filter((value, index, list) => list.indexOf(value) === index).join(', ') || 'receta o insumos'}</div>}
      </details>
    </article>
  );
}
