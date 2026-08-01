import { RefreshCw, LogOut, Menu } from 'lucide-react';
import { useState } from 'react';

interface SellerMobileHeaderProps {
  userName: string;
  onRefresh: () => void;
  onLogout: () => void;
  loading?: boolean;
}

export const SellerMobileHeader = ({ userName, onRefresh, onLogout, loading = false }: SellerMobileHeaderProps) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-cc-bg/95 backdrop-blur-md border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-cc-text-muted">Bienvenido/a</p>
            <p className="text-sm font-semibold text-cc-text-main truncate">
              {userName || 'Usuario'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
              title="Recargar"
            >
              <RefreshCw
                size={16}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              title="Menú"
            >
              <Menu size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Dropdown Menu */}
      {showMenu && (
        <div className="fixed top-16 right-4 w-32 bg-cc-surface border border-white/10 rounded-lg shadow-lg z-40">
          <button
            onClick={() => {
              setShowMenu(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors border-t border-white/5 first:border-t-0 rounded-lg"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      )}
    </>
  );
};
