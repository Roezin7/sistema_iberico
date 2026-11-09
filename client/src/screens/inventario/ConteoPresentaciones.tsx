import { useState } from 'react';
import { formatosConteo, textoContenido, type ProductoMedida } from './conteo-unidades';
export interface PresentacionContada { unidades: number; contenido_base: number; unidad_base: string; etiqueta: string }
interface Fila { formato: string; cantidad: string; contenido?: string }
export default function ConteoPresentaciones({ nombre, producto, base, guardado, detalle, disabled, onChange, onKeyDown }: {
  nombre: string; producto: ProductoMedida; base: string; guardado: boolean; detalle?: PresentacionContada[] | null; disabled: boolean;
  onChange: (base: string, detalle?: PresentacionContada[], error?: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const formatos = formatosConteo(producto);
  const [filas, setFilas] = useState<Fila[]>(() => detalle?.length ? detalle.map(d => ({
    formato: formatos.find(f => f.factor === d.contenido_base && f.etiqueta === d.etiqueta)?.id || 'otro',
    contenido: String(d.contenido_base), cantidad: String(d.unidades),
  })) : [{ formato: formatos[0].id, cantidad: base === '' ? '' : String(Number((Number(base) / formatos[0].factor).toPrecision(15))) }]);
  const contenido = (f: Fila) => f.formato === 'otro' ? Number(f.contenido) : formatos.find(o => o.id === f.formato)?.factor || 0;
  function editar(nuevas: Fila[]) {
    setFilas(nuevas);
    if (nuevas.every(f => f.cantidad === '')) { onChange(''); return; }
    const validas = nuevas.every(f => f.cantidad !== '' && Number.isFinite(Number(f.cantidad)) && Number(f.cantidad) >= 0 && Number.isFinite(contenido(f)) && contenido(f) > 0);
    if (!validas) { onChange('',undefined,`Completa las cantidades y tamaños de ${nombre} antes de guardar.`); return; }
    const detalles = nuevas.map(f => ({ unidades: Number(f.cantidad), contenido_base: contenido(f), unidad_base: producto.unidad_base || 'unidad', etiqueta: f.formato === 'otro' ? 'Unidad definida · ' + textoContenido(contenido(f), producto.unidad_base) : formatos.find(o => o.id === f.formato)!.etiqueta }));
    const total = detalles.reduce((s,d) => s + d.unidades*d.contenido_base, 0);
    onChange(String(Math.round((total + Number.EPSILON)*10000)/10000), detalles);
  }
  function cambiarFormato(index: number, value: string) {
    const anterior = filas[index], siguiente = formatos.find(f => f.id === value);
    // Cambiar la unidad de visualización no cambia el saldo base histórico.
    // Sólo editar cantidades o un tamaño manual implica un nuevo conteo.
    const nuevas = filas.map((f,i) => i !== index ? f : { ...f, formato: value, contenido: value === 'otro' ? String(contenido(anterior)) : undefined, cantidad: f.cantidad === '' ? '' : String(Number((Number(f.cantidad)*contenido(f)/(siguiente?.factor || contenido(f))).toPrecision(15))) });
    if (disabled) setFilas(nuevas); else editar(nuevas);
  }
  return <div className="conteo-unidades">
    {filas.map((fila,i) => <div className="conteo-unidades__fila" key={i}>
      <label><span className="sr-only">Presentación de {nombre} {i+1}</span><select aria-label={`Presentación de ${nombre} ${i+1}`} value={fila.formato} disabled={disabled && !guardado} onChange={e => cambiarFormato(i,e.target.value)}>
        {formatos.map(f => <option key={f.id} value={f.id}>{f.etiqueta}</option>)}{(!disabled || fila.formato==='otro') && <option value="otro">Otro tamaño…</option>}
      </select></label>
      {fila.formato === 'otro' && <label>Tamaño de una unidad ({producto.unidad_base})<input aria-label={`Tamaño de ${nombre} ${i+1}`} type="number" min="0" step="any" value={fila.contenido || ''} disabled={disabled} onChange={e => editar(filas.map((f,j) => i===j?{...f,contenido:e.target.value}:f))} /></label>}
      <label>Unidades<input className="conteo-input" data-conteo-input="true" aria-label={`Unidades de ${nombre} ${i+1}`} type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={fila.cantidad} disabled={disabled} onKeyDown={onKeyDown} onChange={e => editar(filas.map((f,j) => i===j?{...f,cantidad:e.target.value}:f))} /></label>
      {!disabled && filas.length > 1 && <button type="button" className="link-btn" aria-label={`Quitar presentación ${i+1} de ${nombre}`} onClick={() => editar(filas.filter((_,j) => j!==i))}>Quitar</button>}
    </div>)}
    {filas.some(f => formatos.find(o => o.id===f.formato)?.referencia) && <small className="muted">Referencia de tamaño, no peso uniforme garantizado. Puedes definir el tamaño real.</small>}
    {!disabled && filas.length < 10 && <button type="button" className="link-btn" onClick={() => {setFilas([...filas,{formato:formatos[0].id,cantidad:''}]);onChange('',undefined,`Completa la nueva presentación de ${nombre} antes de guardar.`);}}>+ Otro tamaño</button>}
  </div>;
}
