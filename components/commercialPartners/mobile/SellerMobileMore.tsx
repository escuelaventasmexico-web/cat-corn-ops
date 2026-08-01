import { Settings, HelpCircle, LogOut, FileText } from 'lucide-react';

interface SellerMobileMoreProps {
  onLogout: () => void;
}

export const SellerMobileMore = ({ onLogout }: SellerMobileMoreProps) => {
  return (
    <div className="pb-24 px-4 pt-4 space-y-3">
      <h2 className="text-base font-bold text-cc-text-main mb-4">Más opciones</h2>

      <div className="space-y-2">
        {/* Settings */}
        <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-colors active:scale-95 text-left">
          <Settings size={18} className="text-cc-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-cc-text-main">Configuración</p>
            <p className="text-xs text-cc-text-muted">Perfil y preferencias</p>
          </div>
          <span className="text-cc-text-muted text-lg">→</span>
        </button>

        {/* Reports */}
        <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-colors active:scale-95 text-left">
          <FileText size={18} className="text-cc-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-cc-text-main">Reportes</p>
            <p className="text-xs text-cc-text-muted">Historial y descargas</p>
          </div>
          <span className="text-cc-text-muted text-lg">→</span>
        </button>

        {/* Help */}
        <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:bg-white/5 transition-colors active:scale-95 text-left">
          <HelpCircle size={18} className="text-cc-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-cc-text-main">Ayuda</p>
            <p className="text-xs text-cc-text-muted">Preguntas frecuentes</p>
          </div>
          <span className="text-cc-text-muted text-lg">→</span>
        </button>
      </div>

      {/* Logout */}
      <div className="pt-4 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors active:scale-95 text-left"
        >
          <LogOut size={18} className="text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-400">Cerrar sesión</p>
            <p className="text-xs text-red-300/70">Desconectar de tu cuenta</p>
          </div>
          <span className="text-red-400 text-lg">→</span>
        </button>
      </div>

      {/* Footer info */}
      <div className="pt-8 border-t border-white/10 text-center space-y-2">
        <p className="text-xs text-cc-text-muted">Cat Corn Ops v1.0</p>
        <div className="flex justify-center gap-3 text-xs text-cc-text-muted">
          <button className="hover:text-cc-text-main transition-colors">Privacidad</button>
          <span>•</span>
          <button className="hover:text-cc-text-main transition-colors">Términos</button>
          <span>•</span>
          <button className="hover:text-cc-text-main transition-colors">Contacto</button>
        </div>
      </div>
    </div>
  );
};
