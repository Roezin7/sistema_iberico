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
  costo_fifo: number | null;
  costo_fifo_aplicado: number | null;
  costo_fifo_referencia: number | null;
  estado_fifo: 'disponible' | 'aplicado' | 'insuficiente' | 'sin_datos';
  ultimo_costo_fifo_unitario: number | null;
  ultimo_costo_fifo_fecha: string | null;
  falta_fifo: string | null;
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
  costo_fifo_actual: number | null;
  margen_fifo_actual: number | null;
  food_cost_fifo_pct: number | null;
  costo_fifo_referencia: number | null;
  margen_fifo_referencia: number | null;
  food_cost_fifo_referencia_pct: number | null;
  fifo_referencia_disponible: boolean;
  fifo_disponible: boolean;
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

type FilaResultado = {
  mes: string; parcial: boolean; ventas: { total: number }; ventas_netas: number;
  compras_inventario: number; costo_ventas: number; costo_ventas_metodo: 'fifo' | 'inventario' | 'compras';
  utilidad_operativa: number; margen_operativo: number; sueldos: number; gastos_totales: number;
  variacion_inventario: number | null; sin_movimientos: boolean;
};
type RespuestaResultado = { meses: FilaResultado[]; total: Omit<FilaResultado, 'mes' | 'parcial' | 'sin_movimientos'> & { meses: number } };

const money = (value: number | null) =>
  value == null ? '—' : value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const percent = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;

export default function CostosMenu() {
  const [data, setData] = useState<RespuestaCostos | null>(null);
  const [resultado, setResultado] = useState<RespuestaResultado | null>(null);
  const [section, setSection] = useState('Todos');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      const [costos, pnl] = await Promise.all([
        api<RespuestaCostos>('/recetas/resumen'),
        api<RespuestaResultado>('/finanzas/estado-resultados?meses=6').catch(() => null),
      ]);
      setData(costos); setResultado(pnl);
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
          <p className="muted">Costo FIFO por receta.</p>
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
              <p>Una lectura rápida de precio, costo FIFO disponible, margen y food cost. El costo base de receta queda como referencia; el costo operativo usa los lotes FIFO abiertos y se actualiza al recibir nuevas compras.</p>
            </div>
            <div className="menu-costos-source"><Icono name="checkCircle" size={18} /> {data.fuente}</div>
          </section>

          <section className="menu-costos-kpis" aria-label="Resumen del costeo">
            <div className="menu-costos-kpi"><span>Productos de la carta</span><strong>{data.resumen.productos}</strong><small>activos en el catálogo</small></div>
            <div className="menu-costos-kpi"><span>Con costo calculado</span><strong>{data.resumen.costeados}</strong><small>{data.resumen.pendientes} pendientes de completar</small></div>
            <div className="menu-costos-kpi"><span>Food cost promedio</span><strong>{percent(data.resumen.food_cost_promedio)}</strong><small>promedio de productos con precio</small></div>
            <div className="menu-costos-kpi"><span>Margen promedio</span><strong>{money(data.resumen.margen_promedio)}</strong><small>por unidad vendida</small></div>
          </section>

          {resultado && <ResultadoMensual data={resultado} />}

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

function ResultadoMensual({ data }: { data: RespuestaResultado }) {
  const total = data.total;
  return <section className="resultados-mensuales" aria-labelledby="resultados-mensuales-titulo">
    <div className="section-heading"><div><span className="eyebrow">P&amp;L mensual</span><h2 id="resultados-mensuales-titulo">Rentabilidad histórica</h2><p className="muted">Últimos seis meses.</p></div><span className="chip chip--info">Costo: FIFO</span></div>
    <div className="resultados-mensuales__total"><div><small>Ventas acumuladas</small><strong>{money(total.ventas.total)}</strong></div><div><small>Utilidad operativa</small><strong>{money(total.utilidad_operativa)}</strong></div><div><small>Margen operativo</small><strong>{percent(total.margen_operativo * 100)}</strong></div></div>
    <div className="table-wrap"><table><thead><tr><th>Mes</th><th>Ventas</th><th>Costo ventas</th><th>Sueldos + gastos</th><th>Utilidad operativa</th><th>Margen</th></tr></thead><tbody>{data.meses.map((fila) => <tr key={fila.mes}><td><strong>{fila.mes}</strong>{fila.parcial && <small className="muted"> · parcial</small>}</td><td>{fila.sin_movimientos ? '—' : money(fila.ventas.total)}</td><td>{fila.sin_movimientos ? '—' : <>{money(fila.costo_ventas)} <small className="muted">· {fila.costo_ventas_metodo.toUpperCase()}</small></>}</td><td>{fila.sin_movimientos ? '—' : money(fila.sueldos + fila.gastos_totales)}</td><td className={fila.utilidad_operativa < 0 ? 'text-danger' : ''}>{fila.sin_movimientos ? '—' : money(fila.utilidad_operativa)}</td><td>{fila.sin_movimientos ? '—' : percent(fila.margen_operativo * 100)}</td></tr>)}</tbody></table></div>
  </section>;
}

function ProductCard({ product }: { product: ProductoCosto }) {
  const status = product.receta_id == null ? 'Sin receta' : product.completa ? 'Completo' : 'Pendiente';
  const statusClass = product.receta_id == null ? 'is-missing' : product.completa ? 'is-ok' : 'is-pending';
  const costoVisible = product.costo_fifo_actual ?? product.costo_fifo_referencia ?? product.costo_receta;
  const margenVisible = product.margen_fifo_actual ?? product.margen_fifo_referencia ?? product.margen_unitario;
  const foodCostVisible = product.food_cost_fifo_pct ?? product.food_cost_fifo_referencia_pct ?? product.food_cost_pct;
  const etiquetaCosto = product.costo_fifo_actual != null
    ? 'Costo FIFO disponible'
    : product.costo_fifo_referencia != null
      ? 'Último costo FIFO aplicado'
      : 'Costo base de receta';
  const notaCosto = product.costo_fifo_actual != null
    ? 'saldo actual en lotes'
    : product.costo_fifo_referencia != null
      ? `último consumo${product.lineas.find((line) => line.ultimo_costo_fifo_fecha)?.ultimo_costo_fifo_fecha ? ` · ${product.lineas.find((line) => line.ultimo_costo_fifo_fecha)?.ultimo_costo_fifo_fecha}` : ''}`
      : 'referencia estática';
  return (
    <article className="menu-costos-card">
      <div className="menu-costos-card__head">
        <div><h3>{product.nombre}</h3><span className={`menu-costos-status ${statusClass}`}>{status}{product.version ? ` · v${product.version}` : ''}</span></div>
        <strong className="menu-costos-card__price">{money(product.precio_venta)}</strong>
      </div>
      <div className="menu-costos-metrics">
        <div className="menu-costos-metric"><span>{etiquetaCosto}</span><strong>{money(costoVisible)}</strong><small>{notaCosto}</small></div>
        <div className="menu-costos-metric"><span>Margen unitario</span><strong>{money(margenVisible)}</strong><small>{product.costo_fifo_actual != null || product.costo_fifo_referencia != null ? 'calculado con FIFO' : 'costo base'}</small></div>
        <div className="menu-costos-metric"><span>Food cost</span><strong>{percent(foodCostVisible)}</strong><small>{product.costo_fifo_actual != null || product.costo_fifo_referencia != null ? 'costo FIFO' : 'costo base'}</small></div>
      </div>
      <details className="menu-costos-detail">
        <summary>Ver desglose <Icono name="chevron" size={15} /></summary>
        {product.lineas.length ? (
          <div className="menu-costos-lines">
            {product.lineas.map((line, index) => (
              <div className="menu-costos-line" key={`${line.producto}-${index}`}>
                <span><strong>{line.producto}</strong><small>{line.cantidad} {line.unidad}{line.nota ? ` · ${line.nota}` : ''}</small></span>
                <strong>{money(line.costo_fifo ?? line.costo_fifo_aplicado ?? line.costo)}</strong>
              </div>
            ))}
          </div>
        ) : <p className="muted">No hay receta vigente capturada.</p>}
        {product.costo_fifo_actual == null && product.costo_fifo_referencia != null && product.completa && <div className="menu-costos-warning"><Icono name="alertCircle" size={15} /> No hay lote suficiente abierto para todos los ingredientes; se muestra el último costo FIFO aplicado.</div>}
        {product.costo_fifo_actual == null && product.costo_fifo_referencia == null && product.completa && <div className="menu-costos-warning"><Icono name="alertTriangle" size={15} /> El costo FIFO no está disponible para todos los ingredientes; se muestra el costo base de receta.</div>}
        {!product.completa && <div className="menu-costos-warning"><Icono name="alertTriangle" size={15} /> Configuración pendiente: {product.lineas.flatMap((line) => line.falta_configuracion).filter((value, index, list) => list.indexOf(value) === index).join(', ') || 'receta o insumos'}</div>}
      </details>
    </article>
  );
}
