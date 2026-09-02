import { useId, type ReactNode } from 'react';
import { weekLabel, weekStateLabel } from '../operating';

export interface WeekSelectorWeek {
  id: number;
  etiqueta?: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado?: string;
}

interface WeekSelectorProps {
  semanas: WeekSelectorWeek[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  label?: string;
  description?: string;
  ariaLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  actions?: ReactNode;
}

/** Selector de periodo compartido para que cada pantalla hable el mismo idioma operativo. */
export function WeekSelector({
  semanas,
  value,
  onChange,
  label = 'Periodo operativo',
  description = 'Consulta una semana para continuar.',
  ariaLabel,
  loading = false,
  disabled = false,
  compact = false,
  actions,
}: WeekSelectorProps) {
  const id = useId();
  const semana = semanas.find((item) => item.id === value) ?? null;
  const numero = semana?.etiqueta?.match(/\d+/)?.[0];
  const titulo = semana ? (numero ? `Semana ${numero}` : weekLabel(semana)) : loading ? 'Cargando semanas' : 'Selecciona una semana';
  const estado = semana ? weekStateLabel(semana) : null;

  return (
    <section className={`week-selector${compact ? ' week-selector--compact' : ''}`} aria-label={label}>
      <div className="week-selector__identity">
        <span className="week-selector__glyph" aria-hidden="true">◷</span>
        <div className="week-selector__copy">
          <div className="week-selector__meta">
            <span className="week-selector__eyebrow">{label}</span>
            {estado && <span className={`week-selector__status week-selector__status--${semana?.estado === 'abierta' ? 'open' : 'closed'}`}>{estado}</span>}
          </div>
          <strong>{titulo}</strong>
          <small>{semana ? `${semana.fecha_inicio} → ${semana.fecha_fin}` : description}</small>
        </div>
      </div>
      <div className="week-selector__controls">
        <div className="week-selector__field">
          <label className="sr-only" htmlFor={id}>{ariaLabel ?? label}</label>
          <select
            id={id}
            aria-label={ariaLabel ?? label}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
            disabled={disabled || loading || !semanas.length}
          >
            {!semanas.length && <option value="">{loading ? 'Cargando…' : 'No hay semanas'}</option>}
            {semanas.map((item) => (
              <option key={item.id} value={item.id}>{weekLabel(item)} · {weekStateLabel(item)}</option>
            ))}
          </select>
          <span className="week-selector__chevron" aria-hidden="true">⌄</span>
        </div>
        {actions && <div className="week-selector__actions">{actions}</div>}
      </div>
    </section>
  );
}

export default WeekSelector;
