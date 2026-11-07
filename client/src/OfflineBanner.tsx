import { useEffect, useState } from 'react';
import { suscribir, sincronizar, descartarFallos, type FalloSync } from './offline';

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [fallidos, setFallidos] = useState<FalloSync[]>([]);

  useEffect(() => suscribir((e) => { setOnline(e.online); setPendientes(e.pendientes); setFallidos(e.fallidos); }), []);

  // Nada que mostrar: en línea, sin cola y sin fallos.
  if (online && pendientes === 0 && fallidos.length === 0) return null;

  return (
    <>
      {(!online || pendientes > 0) && (
        <div className={`offline-banner ${online ? 'offline-banner--sync' : 'offline-banner--off'}`}>
          {!online && <span>Sin conexión. Puedes conservar borradores de compra; confirma inventario, pagos y cierres al reconectar.</span>}
          {online && pendientes > 0 && (
            <span onClick={() => void sincronizar()}>
              {fallidos.length ? '⚠️ Revisión pendiente: ' : '🔄 Por sincronizar: '}{pendientes} cambio{pendientes !== 1 ? 's' : ''}.
            </span>
          )}
          {pendientes > 0 && <strong className="offline-pill">{pendientes}</strong>}
        </div>
      )}
      {fallidos.length > 0 && (
        <div className="offline-banner offline-banner--error">
          <span>
            ⚠️ {fallidos.length} aviso{fallidos.length !== 1 ? 's' : ''}: {fallidos[fallidos.length - 1]!.error}. Revisa el estado antes de volver a capturar para evitar duplicados.
          </span>
          <button className="offline-pill" onClick={descartarFallos} style={{ border: 'none', cursor: 'pointer' }}>Entendido</button>
        </div>
      )}
    </>
  );
}
