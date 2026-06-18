import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Icono } from '../icons';

interface Msg { id?: number; rol: 'user' | 'assistant'; contenido: string }

export default function SilviaBubble() {
  const { usuario } = useAuth();
  const [disponible, setDisponible] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!esAdmin) return;
    api<{ disponible: boolean }>('/silvia/estado').then((e) => setDisponible(e.disponible)).catch(() => setDisponible(false));
  }, [esAdmin]);

  useEffect(() => {
    if (abierto && msgs.length === 0) {
      api<Msg[]>('/silvia/historial').then(setMsgs).catch(() => {});
    }
  }, [abierto]);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, pensando]);

  if (!esAdmin || !disponible) return null;

  async function enviar() {
    const t = texto.trim();
    if (!t || pensando) return;
    setTexto('');
    setMsgs((m) => [...m, { rol: 'user', contenido: t }]);
    setPensando(true);
    try {
      const r = await api<{ texto: string; aprendizajes: string[] }>('/silvia/chat', { method: 'POST', body: { mensaje: t } });
      setMsgs((m) => [...m, { rol: 'assistant', contenido: r.texto }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'No pude responder ahora.';
      setMsgs((m) => [...m, { rol: 'assistant', contenido: `⚠️ ${msg}` }]);
    } finally {
      setPensando(false);
    }
  }

  async function registrarEvento() {
    const contenido = prompt('¿Qué cambió en el negocio? (ej. "Subimos el precio de la cerveza", "Nuevo mesero el lunes")');
    if (!contenido?.trim()) return;
    await api('/silvia/eventos', { method: 'POST', body: { contenido: contenido.trim() } });
    setMsgs((m) => [...m, { rol: 'assistant', contenido: `📌 Anoté el evento: "${contenido.trim()}". Lo tomaré en cuenta.` }]);
  }

  return (
    <>
      {!abierto && (
        <button className="silvia-fab" onClick={() => setAbierto(true)} aria-label="Abrir Silvia">
          <span className="silvia-avatar">S</span>
          <span>Silvia</span>
        </button>
      )}
      {abierto && (
        <div className="silvia-panel">
          <header className="silvia-head">
            <div>
              <strong>Silvia</strong>
              <small className="muted"> · tu coach de negocio</small>
            </div>
            <button className="link-btn" onClick={() => setAbierto(false)} aria-label="Cerrar">
              <Icono name="x" size={18} />
            </button>
          </header>

          <div className="silvia-msgs">
            {msgs.length === 0 && (
              <div className="silvia-bubble silvia-bubble--bot">
                ¡Hola! Soy Silvia. Veo tus números en tiempo real. Pregúntame cómo va el negocio,
                qué conviene mejorar o cuéntame un cambio que hiciste para evaluarlo.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={m.id ?? i} className={`silvia-bubble ${m.rol === 'user' ? 'silvia-bubble--user' : 'silvia-bubble--bot'}`}>
                {m.contenido}
              </div>
            ))}
            {pensando && <div className="silvia-bubble silvia-bubble--bot silvia-typing">Silvia está analizando…</div>}
            <div ref={finRef} />
          </div>

          <div className="silvia-input">
            <button className="silvia-evento" title="Registrar un cambio/evento" onClick={registrarEvento} aria-label="Registrar evento">
              <Icono name="pin" size={18} />
            </button>
            <textarea
              rows={1}
              placeholder="Pregúntale a Silvia…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            />
            <button className="btn-primary" onClick={enviar} disabled={pensando} aria-label="Enviar">
              <Icono name="send" size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
