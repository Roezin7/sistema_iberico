import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
}

export interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  minLength?: number;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

interface Ctx {
  confirmar: (opts: ConfirmOptions | string) => Promise<boolean>;
  pedir: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmCtx = createContext<Ctx | null>(null);

/** Reemplaza window.confirm()/window.prompt() por un diálogo propio, con la misma forma
 * async (una promesa que resuelve al elegir), para que las llamadas existentes solo
 * cambien la guarda síncrona por un await. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirmar = useCallback((opts: ConfirmOptions | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts: o, resolve }));
  }, []);

  const pedir = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => setPending({ kind: 'prompt', opts, resolve }));
  }, []);

  function cerrar(valor: boolean | string | null) {
    setPending((p) => {
      if (!p) return null;
      if (p.kind === 'confirm') p.resolve(valor === true);
      else p.resolve(typeof valor === 'string' ? valor : null);
      return null;
    });
  }

  return (
    <ConfirmCtx.Provider value={{ confirmar, pedir }}>
      {children}
      {pending && <DialogHost pending={pending} onClose={cerrar} />}
    </ConfirmCtx.Provider>
  );
}

function DialogHost({ pending, onClose }: { pending: Pending; onClose: (v: boolean | string | null) => void }) {
  const esPrompt = pending.kind === 'prompt';
  const [valor, setValor] = useState(esPrompt ? pending.opts.defaultValue ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelar = () => onClose(pending.kind === 'confirm' ? false : null);

  useEffect(() => {
    if (esPrompt) inputRef.current?.focus();
    else confirmRef.current?.focus();
  }, [esPrompt]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelar();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tone = pending.kind === 'confirm' ? pending.opts.tone ?? 'default' : 'default';
  const minLen = esPrompt ? pending.opts.minLength ?? 0 : 0;
  const invalido = esPrompt && valor.trim().length < minLen;

  function aceptar() {
    if (esPrompt) {
      if (invalido) return;
      onClose(valor.trim());
    } else {
      onClose(true);
    }
  }

  return (
    <div className="dialog-overlay" onClick={cancelar}>
      <div className="dialog-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {pending.opts.title && <h2>{pending.opts.title}</h2>}
        <p className="dialog-message">{pending.opts.message}</p>
        {esPrompt && (
          <input
            ref={inputRef}
            className="field-lg"
            placeholder={pending.opts.placeholder}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !invalido) aceptar(); }}
          />
        )}
        <div className="dialog-actions">
          <button className="btn-secondary" onClick={cancelar}>
            {pending.kind === 'confirm' ? pending.opts.cancelText ?? 'Cancelar' : 'Cancelar'}
          </button>
          <button
            ref={confirmRef}
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            disabled={invalido}
            onClick={aceptar}
          >
            {pending.kind === 'confirm' ? pending.opts.confirmText ?? 'Confirmar' : 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx.confirmar;
}

export function usePrompt() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('usePrompt debe usarse dentro de <ConfirmProvider>');
  return ctx.pedir;
}
