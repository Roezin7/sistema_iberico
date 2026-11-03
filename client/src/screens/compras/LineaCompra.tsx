import { cantidadBaseCompra, formatoCantidad, type ProductoPresentacion } from './fifo-form';

export interface ProductoCompra extends ProductoPresentacion { id: number; nombre: string; active?: boolean }
export interface CamposLineaCompra {
  product_id: number | null;
  tipo_linea: 'inventario' | 'gasto' | 'pendiente';
  descripcion_fuente: string;
  cantidad_fuente: string | number | null;
  unidad_fuente: string | null;
  unidad_compra: string | null;
  contenido_compra: string | number | null;
  contenido_presentacion?: string | number | null;
  unidad_presentacion?: string | null;
  cantidad_base: string | number | null;
  importe: string | number;
}

/** La misma captura en el alta y en revisión: producto, cantidad, tamaño real
 * e importe. El operador sólo abre el detalle técnico si necesita corregirlo. */
export function LineaCompra({ linea, productos, numero, editar, quitar }: {
  linea: CamposLineaCompra; productos: ProductoCompra[]; numero: number;
  editar: (campo: keyof CamposLineaCompra, valor: string | number | null) => void;
  quitar?: () => void;
}) {
  const producto = productos.find((p) => p.id === linea.product_id);
  const calculada = cantidadBaseCompra(linea, producto);
  const variable = producto?.presentacion_modo === 'variable';
  const porLote = producto?.presentacion_modo === 'por_lote';
  const cantidad = calculada ?? (linea.cantidad_base ? Number(linea.cantidad_base) : null);
  const importe = Number(linea.importe);
  const costo = cantidad && importe >= 0 ? importe / cantidad : null;
  const etiqueta = variable ? `Cantidad recibida (${producto?.unidad_base ?? 'unidad base'})` : `Cantidad (${linea.unidad_fuente || producto?.unidad_compra || 'unidades'})`;
  const money = (v: number) => v.toLocaleString('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:4 });
  return <article className="purchase-item" aria-label={`Artículo ${numero}`}>
    <div className="purchase-item__head"><strong>Artículo {numero}</strong>{quitar && <button type="button" className="btn-ghost" onClick={quitar} aria-label={`Quitar artículo ${numero}`}>Quitar</button>}</div>
    <div className="purchase-item__identity">
      <label>Destino<select aria-label="Destino" value={linea.tipo_linea} onChange={(e) => editar('tipo_linea', e.target.value)}>
        <option value="inventario">Inventario · entra a bodega</option><option value="gasto">Gasto · sin inventario</option><option value="pendiente">Resolver durante revisión</option>
      </select></label>
      {linea.tipo_linea === 'inventario' ? <label>Producto<select aria-label="Producto" value={linea.product_id ?? ''} onChange={(e) => editar('product_id', e.target.value ? Number(e.target.value) : null)}>
        <option value="">Seleccionar producto…</option>{productos.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select></label> : <label>Descripción<input value={linea.descripcion_fuente} placeholder="Ej. Limpieza" onChange={(e) => editar('descripcion_fuente', e.target.value)} /></label>}
    </div>
    <div className="purchase-item__fields">
      {linea.tipo_linea === 'inventario' && <label>{etiqueta}<input aria-label={etiqueta} type="number" inputMode="decimal" min="0" step="any"
        value={variable ? linea.cantidad_base ?? '' : linea.cantidad_fuente ?? ''}
        placeholder={variable ? 'Peso medido o estimado' : 'Ej. 2'} onChange={(e) => editar(variable ? 'cantidad_base' : 'cantidad_fuente', e.target.value)} /></label>}
      {linea.tipo_linea === 'inventario' && porLote && <label>Contenido de cada unidad ({producto?.unidad_base})<input type="number" inputMode="decimal" min="0" step="any"
        value={linea.contenido_compra ?? ''} placeholder="Ej. 600, 1700 o 2000" onChange={(e) => editar('contenido_compra', e.target.value)} /></label>}
      <label>Importe de esta línea<input type="number" min="0" step="0.01" inputMode="decimal" value={linea.importe} placeholder="Total de las unidades" onChange={(e) => editar('importe', e.target.value)} /></label>
    </div>
    {producto && linea.tipo_linea === 'inventario' && <>
      {porLote && <small className="muted">Lee el tamaño en el envase. Si es un paquete, indica el contenido total del paquete.</small>}
      {variable && <small className="muted">{producto.presentacion_nota || 'Captura la cantidad observada o tu estimación. No se calcula desde el tamaño del catálogo.'}</small>}
      {cantidad != null && cantidad > 0 && <p className="purchase-item__result">Entran <strong>{formatoCantidad(cantidad)} {producto.unidad_base}</strong> a bodega{costo != null && ` · ${money(costo)} por ${producto.unidad_base}`}</p>}
      <details className="purchase-item__details"><summary>{porLote ? 'Unidad de compra y detalle del ticket' : 'Presentación y detalle del ticket'}</summary>
        <div className="purchase-item__fields">
          <label>Tamaño del envase individual (opcional)<input type="number" min="0" step="any" value={linea.contenido_presentacion ?? ''} placeholder="Ej. 600; no el total del paquete" onChange={e=>editar('contenido_presentacion', e.target.value)} /></label>
          <label>Unidad del envase individual<select value={linea.unidad_presentacion ?? ''} onChange={e=>editar('unidad_presentacion', e.target.value || null)}><option value="">Sin evidencia</option><option value="ml">ml</option><option value="g">g</option><option value="pieza">pieza</option></select></label>
          <small className="muted">Para servicios de tamaño exacto. No cambia la cantidad base recibida. Déjalo vacío si no conoces la presentación.</small>
          <label>Texto original del ticket<input value={linea.descripcion_fuente} onChange={(e) => editar('descripcion_fuente', e.target.value)} /></label>
          {!variable && <label>Unidad de compra<input value={linea.unidad_fuente || linea.unidad_compra || ''} placeholder="botella, paquete, kg…" onChange={(e) => { editar('unidad_fuente', e.target.value); editar('unidad_compra', e.target.value); }} /></label>}
          {!porLote && !variable && <label>Contenido por unidad ({producto.unidad_base})<input type="number" min="0" step="any" value={linea.contenido_compra ?? ''} onChange={(e) => editar('contenido_compra', e.target.value)} /></label>}
          {!variable && calculada == null && <label>Cantidad base recibida ({producto.unidad_base})<input type="number" min="0" step="any" value={linea.cantidad_base ?? ''} onChange={(e) => editar('cantidad_base', e.target.value)} /></label>}
        </div>
      </details>
    </>}
  </article>;
}
