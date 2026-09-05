import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { iniciarOffline } from './offline';

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de renderizado en Ibérico', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <strong>No se pudo cargar esta vista</strong>
        <span>La sesión y los datos siguen protegidos. Recarga para intentarlo de nuevo.</span>
        <button type="button" onClick={() => window.location.reload()}>Recargar aplicación</button>
      </div>
    );
  }
}

iniciarOffline();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
