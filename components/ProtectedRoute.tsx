import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getModuleFromPath } from '../contexts/AuthContext';
import { AlertCircle, LogOut, RotateCcw } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredModules?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredModules = [] }) => {
  const location = useLocation();
  const { loading, profileLoading, session, blockedReason, error, logout, canAccessModule } = useAuth();

  // Still loading session
  if (loading) {
    return <LoadingScreen message="Cargando sesión..." />;
  }

  // No session - redirect to login
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Still loading profile
  if (profileLoading) {
    return <LoadingScreen message="Cargando perfil..." />;
  }

  // User has an error (timeout, database error, etc.)
  if (error && (blockedReason === 'no_profile' || blockedReason === 'inactive')) {
    return (
      <ErrorScreen
        title={
          blockedReason === 'no_profile' ? 'Perfil no asignado' : 'Usuario inactivo'
        }
        message={error}
        onRetry={async () => {
          window.location.reload();
        }}
        onLogout={logout}
      />
    );
  }

  // User has an error but can continue (e.g., timeout error)
  if (error) {
    return (
      <ErrorScreenWithReset
        title="Error al cargar la sesión"
        message={error}
        onLogout={logout}
      />
    );
  }

  // Check module access if required
  if (requiredModules.length > 0) {
    const hasAccess = requiredModules.some(module => canAccessModule(module));
    if (!hasAccess) {
      // Get the module from path for better error message
      const detectedModule = getModuleFromPath(location.pathname);
      return <AccessDenied module={detectedModule} logout={logout} />;
    }
  }

  return <>{children}</>;
};

const LoadingScreen: React.FC<{ message?: string }> = ({ message = 'Cargando Cat Corn OPS...' }) => (
  <div className="min-h-screen bg-cc-bg flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin inline-block w-12 h-12 border-4 border-cc-primary border-t-transparent rounded-full mb-4" />
      <p className="text-cc-text-muted">{message}</p>
    </div>
  </div>
);

interface ErrorScreenProps {
  title: string;
  message: string;
  onRetry?: () => void;
  onLogout?: () => Promise<void>;
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ title, message, onRetry, onLogout }) => {
  const handleLogout = async () => {
    if (onLogout) {
      await onLogout();
    }
    // Clear localStorage and sessionStorage
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-cc-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-cc-surface p-8 rounded-2xl border border-white/5 text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-red-500/10 rounded-full">
            <AlertCircle size={32} className="text-red-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-cc-cream mb-2">{title}</h1>
        <p className="text-cc-text-muted mb-6">{message}</p>
        <div className="flex gap-3 flex-col">
          {onRetry && (
            <button
              onClick={onRetry}
              className="w-full bg-cc-primary hover:bg-cc-primary-dark text-cc-bg font-bold py-2 px-4 rounded-lg transition-colors"
            >
              Reintentar
            </button>
          )}
          <button
            onClick={handleLogout}
            className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-400 font-bold py-2 px-4 rounded-lg transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};

const ErrorScreenWithReset: React.FC<{ title: string; message: string; onLogout?: () => Promise<void> }> = ({ title, message, onLogout }) => {
  const handleReset = async () => {
    if (onLogout) {
      await onLogout();
    }
    // Clear localStorage and sessionStorage
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-cc-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-cc-surface p-8 rounded-2xl border border-white/5 text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-amber-500/10 rounded-full">
            <AlertCircle size={32} className="text-amber-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-cc-cream mb-2">{title}</h1>
        <p className="text-cc-text-muted mb-6">{message}</p>
        <button
          onClick={handleReset}
          className="w-full bg-cc-primary hover:bg-cc-primary-dark text-cc-bg font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <RotateCcw size={16} />
          Reiniciar sesión
        </button>
      </div>
    </div>
  );
};

interface AccessDeniedProps {
  module?: string;
  logout?: () => Promise<void>;
}

export const AccessDenied: React.FC<AccessDeniedProps> = ({ module, logout }) => {
  const handleLogout = async () => {
    if (logout) {
      await logout();
    }
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-cc-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-cc-surface p-8 rounded-2xl border border-white/5 text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-amber-500/10 rounded-full">
            <AlertCircle size={32} className="text-amber-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-cc-cream mb-2">Acceso denegado</h1>
        <p className="text-cc-text-muted mb-6">
          No tienes permiso para acceder a este módulo{module ? ` (${module})` : ''}.
        </p>
        <div className="flex gap-3">
          <a
            href="/socios-comerciales"
            className="flex-1 bg-cc-primary hover:bg-cc-primary-dark text-cc-bg font-bold py-2 px-4 rounded-lg transition-colors text-center"
          >
            Ir a Socios Comerciales
          </a>
          <button
            onClick={handleLogout}
            className="flex-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </div>
    </div>
  );
};
