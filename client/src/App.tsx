import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import Login from './screens/Login';
const Inventario = lazy(() => import('./screens/inventario/Inventario'));
const Operacion = lazy(() => import('./screens/Operacion'));
const Finanzas = lazy(() => import('./screens/finanzas/Finanzas'));
const Configuracion = lazy(() => import('./screens/config/Configuracion'));
import OfflineBanner from './OfflineBanner';
import SilviaBubble from './silvia/SilviaBubble';
import Shell from './Shell';
import SplashIntro from './brand/SplashIntro';
import { ConfirmProvider } from './ui/ConfirmProvider';
import { ToastProvider } from './ui/ToastProvider';
import { Cargando } from './ui/Cargando';
import { lazy, Suspense, useState, type JSX } from 'react';

function SoloAdmin({ children, rol }: { children: JSX.Element; rol: Rol }) {
  const { usuario } = useAuth();
  if (usuario && usuario.rol !== rol) return <Navigate to="/" replace />;
  return children;
}

function LegacyComprasRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = new URLSearchParams({ tab: 'compras' });
  const comprasTab = params.get('tab');
  if (comprasTab === 'epos' || comprasTab === 'lotes' || comprasTab === 'pendientes') next.set('comprasTab', comprasTab);
  for (const key of ['semana', 'fecha', 'focus', 'return']) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return <Navigate to={`/inventario?${next.toString()}`} replace />;
}

function LegacyAdminRedirect({ tab }: { tab: string }) {
  return <Navigate to={`/configuracion?tab=${tab}`} replace />;
}

function AppBody() {
  const { usuario, cargando } = useAuth();
  const location = useLocation();

  if (cargando) {
    return (
      <div className="app-shell">
        <Cargando />
      </div>
    );
  }
  if (!usuario) return <Login />;

  return (
    <Shell>
      <OfflineBanner />
      <Suspense fallback={<div className="page"><Cargando etiqueta="Cargando vista…" /></div>}>
      <Routes>
        {/* Inicio y Operación son el mismo espacio operativo. La raíz es la
            URL canónica y conservamos /operacion como alias compatible. */}
        <Route path="/" element={<Operacion />} />
        <Route path="/operacion" element={<Navigate to="/" replace />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/finanzas" element={<SoloAdmin rol="admin"><Finanzas /></SoloAdmin>} />
        <Route path="/reportes" element={<Navigate to="/finanzas" replace />} />
        <Route path="/patrimonio" element={<Navigate to="/finanzas?tab=resumen" replace />} />
        <Route path="/configuracion" element={<SoloAdmin rol="admin"><Configuracion /></SoloAdmin>} />
        <Route path="/compras" element={<LegacyComprasRedirect />} />
        <Route path="/tareas" element={<Navigate to="/" replace />} />
        <Route path="/decisiones" element={<Navigate to="/" replace />} />
        <Route path="/auditoria" element={<Navigate to="/finanzas?tab=movs" replace />} />
        <Route path="/costos-menu" element={<SoloAdmin rol="admin"><LegacyAdminRedirect tab="menu" /></SoloAdmin>} />
        <Route path="/facturacion" element={<SoloAdmin rol="admin"><LegacyAdminRedirect tab="facturacion" /></SoloAdmin>} />
        <Route path="/marketing" element={<SoloAdmin rol="admin"><LegacyAdminRedirect tab="marketing" /></SoloAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      {/* La captura operativa debe quedar libre de un asistente flotante. */}
      {!['/finanzas', '/inventario'].includes(location.pathname) && <SilviaBubble />}
    </Shell>
  );
}

export default function App() {
  const [splash, setSplash] = useState(() => !sessionStorage.getItem('nodo-splash'));
  return (
    <>
      {splash && (
        <SplashIntro
          onDone={() => {
            sessionStorage.setItem('nodo-splash', '1');
            setSplash(false);
          }}
        />
      )}
      <ConfirmProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppBody />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ConfirmProvider>
    </>
  );
}
