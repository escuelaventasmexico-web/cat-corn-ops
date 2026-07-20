import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Cat, Loader } from 'lucide-react';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { session, profile, profileLoading, blockedReason } = useAuth();

  // Redirect if already logged in and has a valid profile (not blocked)
  useEffect(() => {
    // Only redirect if:
    // 1. There's a session
    // 2. Profile is loaded (profileLoading is false)
    // 3. There's no blockedReason (meaning profile is valid and active)
    if (session && !profileLoading && !blockedReason && profile) {
      // Redirect based on role
      if (profile.role === 'admin') {
        navigate('/', { replace: true });
      } else if (profile.role === 'socios_comerciales') {
        navigate('/socios-comerciales', { replace: true });
      }
    }
  }, [session, profile, profileLoading, blockedReason, navigate]);

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
    }
    // Navigation happens via useEffect when profile loads
  };

  // Show loading state if redirecting
  if (session && !profileLoading && !blockedReason && profile) {
    return (
      <div className="min-h-screen bg-cc-bg flex items-center justify-center">
        <div className="text-center">
          <Loader size={32} className="animate-spin text-cc-primary mx-auto mb-4" />
          <p className="text-cc-text-muted">Redirigiendo...</p>
        </div>
      </div>
    );
  }

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
              disabled={loading}
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
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cc-primary hover:bg-cc-primary-dark text-cc-bg font-bold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-cc-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader size={18} className="animate-spin" />
                Iniciando...
              </>
            ) : (
              'Acceder al Sistema'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};