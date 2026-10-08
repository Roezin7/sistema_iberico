import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import Login from './screens/Login';
import Home from './screens/Home';
const Inventario = lazy(() => import('./screens/inventario/Inventario'));
const Operacion = lazy(() => import('./screens/Operacion'));
const Finanzas = lazy(() => import('./screens/finanzas/Finanzas'));
const Patrimonio = lazy(() => import('./screens/patrimonio/Patrimonio'));
const Configuracion = lazy(() => import('./screens/config/Configuracion'));
const Marketing = lazy(() => import('./screens/marketing/Marketing'));
const Compras = lazy(() => import('./screens/compras/Compras'));
const CostosMenu = lazy(() => import('./screens/costos-menu/CostosMenu'));
const Facturacion = lazy(() => import('./screens/facturacion/Facturacion'));
const Tareas = lazy(() => import('./screens/tareas/Tareas'));
const Decisiones = lazy(() => import('./screens/decisiones/Decisiones'));
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
        <Route path="/" element={<Home />} />
        <Route path="/operacion" element={<Operacion />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/finanzas" element={<SoloAdmin rol="admin"><Finanzas /></SoloAdmin>} />
        <Route path="/reportes" element={<Navigate to="/finanzas" replace />} />
        <Route path="/patrimonio" element={<SoloAdmin rol="admin"><Patrimonio /></SoloAdmin>} />
        <Route path="/configuracion" element={<SoloAdmin rol="admin"><Configuracion /></SoloAdmin>} />
        <Route path="/marketing" element={<SoloAdmin rol="admin"><Marketing /></SoloAdmin>} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/tareas" element={<Tareas />} />
        <Route path="/decisiones" element={<SoloAdmin rol="admin"><Decisiones /></SoloAdmin>} />
        <Route path="/costos-menu" element={<SoloAdmin rol="admin"><CostosMenu /></SoloAdmin>} />
        <Route path="/facturacion" element={<SoloAdmin rol="admin"><Facturacion /></SoloAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      {/* La captura operativa debe quedar libre de un asistente flotante. */}
      {!['/finanzas', '/inventario', '/compras', '/facturacion', '/tareas'].includes(location.pathname) && <SilviaBubble />}
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
