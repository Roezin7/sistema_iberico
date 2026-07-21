import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Icono } from '../icons';

type Tono = 'success' | 'error' | 'info';
interface ToastItem { id: number; tono: Tono; mensaje: string }
interface Ctx { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

const ToastCtx = createContext<Ctx | null>(null);

const ICONO_DE: Record<Tono, Parameters<typeof Icono>[0]['name']> = {
  success: 'checkCircle',
  error: 'alertCircle',
  info: 'alertCircle',
};

/** Reemplaza window.alert() para feedback de una acción (no de un campo de formulario:
 * esos siguen usando .error-msg inline, que da contexto posicional). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const descartar = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const mostrar = useCallback((tono: Tono, mensaje: string) => {
    const id = ++idRef.current;
    setItems((xs) => [...xs, { id, tono, mensaje }]);
    setTimeout(() => descartar(id), tono === 'error' ? 6000 : 4000);
  }, [descartar]);

  const ctx: Ctx = {
    success: (m) => mostrar('success', m),
    error: (m) => mostrar('error', m),
    info: (m) => mostrar('info', m),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tono}`} onClick={() => descartar(t.id)}>
            <Icono name={ICONO_DE[t.tono]} size={18} />
            <span>{t.mensaje}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
