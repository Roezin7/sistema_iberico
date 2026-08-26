import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import Login from './screens/Login';
import Home from './screens/Home';
import Inventario from './screens/inventario/Inventario';
import Finanzas from './screens/finanzas/Finanzas';
import Patrimonio from './screens/patrimonio/Patrimonio';
import Configuracion from './screens/config/Configuracion';
import Marketing from './screens/marketing/Marketing';
import Compras from './screens/compras/Compras';
import CostosMenu from './screens/costos-menu/CostosMenu';
import OfflineBanner from './OfflineBanner';
import SilviaBubble from './silvia/SilviaBubble';
import Shell from './Shell';
import SplashIntro from './brand/SplashIntro';
import { ConfirmProvider } from './ui/ConfirmProvider';
import { ToastProvider } from './ui/ToastProvider';
import { Cargando } from './ui/Cargando';
import { useState, type JSX } from 'react';

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
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Acceso legado: la operación diaria y el cierre viven ahora en un solo flujo. */}
        <Route path="/operacion" element={<Navigate to="/finanzas" replace />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/finanzas" element={<SoloAdmin rol="admin"><Finanzas /></SoloAdmin>} />
        <Route path="/patrimonio" element={<SoloAdmin rol="admin"><Patrimonio /></SoloAdmin>} />
        <Route path="/configuracion" element={<SoloAdmin rol="admin"><Configuracion /></SoloAdmin>} />
        <Route path="/marketing" element={<SoloAdmin rol="admin"><Marketing /></SoloAdmin>} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/costos-menu" element={<SoloAdmin rol="admin"><CostosMenu /></SoloAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* La captura operativa debe quedar libre de un asistente flotante. */}
      {!['/finanzas', '/inventario', '/compras', '/tareas'].includes(location.pathname) && <SilviaBubble />}
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
