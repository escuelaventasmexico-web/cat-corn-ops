import React, { useState } from 'react';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import { Cat } from 'lucide-react';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase!.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-cc-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-cc-surface p-8 rounded-2xl shadow-2xl border border-white/5">
        <div className="flex flex-col items-center mb-8">
            <div className="p-4 bg-cc-primary/10 rounded-full mb-4">
                <Cat size={48} className="text-cc-primary" />
            </div>
            <h1 className="text-2xl font-bold text-cc-cream tracking-wider">CAT CORN OPS</h1>
            <p className="text-cc-text-muted text-sm mt-2">Sistema Operativo Interno</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded text-sm text-center">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">Correo Corporativo</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-cc-text-main focus:outline-none focus:border-cc-primary focus:ring-1 focus:ring-cc-primary transition-colors"
              placeholder="usuario@catcorn.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-cc-text-muted mb-2">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-cc-text-main focus:outline-none focus:border-cc-primary focus:ring-1 focus:ring-cc-primary transition-colors"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cc-primary hover:bg-cc-primary-dark text-cc-bg font-bold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-cc-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Iniciando...' : 'Acceder al Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
};