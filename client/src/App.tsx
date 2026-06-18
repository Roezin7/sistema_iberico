import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import Login from './screens/Login';
import Home from './screens/Home';
import Inventario from './screens/inventario/Inventario';
import Finanzas from './screens/finanzas/Finanzas';
import Patrimonio from './screens/patrimonio/Patrimonio';
import Tareas from './screens/tareas/Tareas';
import Configuracion from './screens/config/Configuracion';
import OfflineBanner from './OfflineBanner';
import SilviaBubble from './silvia/SilviaBubble';
import Shell from './Shell';
import type { JSX } from 'react';

function SoloAdmin({ children, rol }: { children: JSX.Element; rol: Rol }) {
  const { usuario } = useAuth();
  if (usuario && usuario.rol !== rol) return <Navigate to="/" replace />;
  return children;
}

function AppBody() {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="app-shell">
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  if (!usuario) return <Login />;

  return (
    <Shell>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/tareas" element={<Tareas />} />
        <Route path="/finanzas" element={<SoloAdmin rol="admin"><Finanzas /></SoloAdmin>} />
        <Route path="/patrimonio" element={<SoloAdmin rol="admin"><Patrimonio /></SoloAdmin>} />
        <Route path="/configuracion" element={<SoloAdmin rol="admin"><Configuracion /></SoloAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SilviaBubble />
    </Shell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppBody />
      </BrowserRouter>
    </AuthProvider>
  );
}
