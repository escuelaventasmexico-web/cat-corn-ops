import React from 'react';
import { AlertTriangle, FileText } from 'lucide-react';

export const SupabaseNotConfigured = () => {
  return (
    <div className="min-h-screen bg-cc-bg flex flex-col items-center justify-center p-6 text-center text-cc-text-main">
      <div className="bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
        <AlertTriangle size={64} className="text-red-400" />
      </div>
      <h1 className="text-3xl font-bold mb-4 text-cc-cream tracking-wider">Configuración Requerida</h1>
      <p className="text-cc-text-muted max-w-lg mb-8 text-lg">
        La conexión con Supabase no ha sido configurada. 
        El sistema Cat Corn OPS requiere las variables de entorno para funcionar.
      </p>
      
      <div className="bg-cc-surface p-8 rounded-xl border border-white/5 max-w-2xl w-full text-left shadow-2xl">
        <h3 className="text-cc-primary font-bold mb-6 flex items-center gap-2 text-xl">
            <FileText size={24} />
            Variables de Entorno (.env)
        </h3>
        
        <div className="space-y-6">
          <div className="group">
            <label className="block text-xs font-bold text-cc-text-muted uppercase mb-2 tracking-widest">Project URL</label>
            <div className="relative">
                <code className="block bg-black/40 border border-white/10 p-4 rounded-lg text-green-400 font-mono text-sm break-all">
                VITE_SUPABASE_URL=https://your-project.supabase.co
                </code>
            </div>
          </div>
          
          <div className="group">
            <label className="block text-xs font-bold text-cc-text-muted uppercase mb-2 tracking-widest">Anon Key</label>
            <div className="relative">
                <code className="block bg-black/40 border border-white/10 p-4 rounded-lg text-green-400 font-mono text-sm break-all">
                VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
                </code>
            </div>
          </div>
        </div>

        <div className="mt-8 p-4 bg-cc-primary/10 border border-cc-primary/20 rounded-lg text-sm text-cc-cream/80">
            <strong className="text-cc-primary">Nota:</strong> Crea un archivo <code className="bg-black/30 px-1.5 py-0.5 rounded text-white">.env</code> en la raíz del proyecto y reinicia el servidor de desarrollo.
        </div>
      </div>
    </div>
  );
};