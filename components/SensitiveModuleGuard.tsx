import React, { useEffect, useState, ReactNode } from 'react';
import { Lock, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

interface SensitiveModuleGuardProps {
  children: ReactNode;
}

export const SensitiveModuleGuard: React.FC<SensitiveModuleGuardProps> = ({ children }) => {
  const { financialAccessUnlockedUntil, unlockFinancialAccess, lockFinancialAccess } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expirationWarning, setExpirationWarning] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);

  // Check if access is currently unlocked
  useEffect(() => {
    if (financialAccessUnlockedUntil && Date.now() < financialAccessUnlockedUntil) {
      setIsUnlocked(true);
      setError(null);
      setPassword('');
    } else {
      setIsUnlocked(false);
      setExpirationWarning(false);
    }
  }, [financialAccessUnlockedUntil]);

  // Monitor for expiration while component is mounted
  useEffect(() => {
    if (!isUnlocked || !financialAccessUnlockedUntil) return;

    const now = Date.now();
    const remainingTime = financialAccessUnlockedUntil - now;

    // If already expired, lock immediately
    if (remainingTime <= 0) {
      lockFinancialAccess();
      setIsUnlocked(false);
      return;
    }

    // Check if less than 1 minute remaining
    if (remainingTime < 60000) {
      setExpirationWarning(true);
    }

    // Set timer to lock when expires
    const lockTimer = setTimeout(() => {
      lockFinancialAccess();
      setIsUnlocked(false);
      setPassword('');
    }, remainingTime);

    // Also set a check interval for safety (every 5 seconds)
    const checkInterval = setInterval(() => {
      if (Date.now() >= financialAccessUnlockedUntil) {
        lockFinancialAccess();
        setIsUnlocked(false);
        setPassword('');
      }
    }, 5000);

    return () => {
      clearTimeout(lockTimer);
      clearInterval(checkInterval);
    };
  }, [isUnlocked, financialAccessUnlockedUntil, lockFinancialAccess]);

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      setError('Ingresa la clave financiera.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!supabase) {
        setError('No se pudo verificar la clave financiera. Intenta nuevamente.');
        setLoading(false);
        return;
      }

      const { data, error: rpcError } = await supabase.rpc(
        'verify_financial_access_password',
        {
          p_password: password,
        }
      );

      if (rpcError) {
        console.error('[FINANCIAL_ACCESS] RPC error:', rpcError);
        setError('No se pudo verificar la clave financiera. Intenta nuevamente.');
        setLoading(false);
        return;
      }

      // Handle array response from RETURNS TABLE RPC
      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        console.error('[FINANCIAL_ACCESS] No result from RPC');
        setError('No se pudo verificar la clave financiera. Intenta nuevamente.');
        setLoading(false);
        return;
      }

      console.log('[FINANCIAL_ACCESS] RPC Result:', { success: result.success });

      if (result.success === true) {
        console.log('[FINANCIAL_ACCESS] Password verified successfully');
        // Clear password immediately after verification
        setPassword('');
        setError(null);
        setExpirationWarning(false);

        // Unlock for 15 minutes
        unlockFinancialAccess();
        setIsUnlocked(true);
      } else {
        // Incorrect password
        const errorMsg = result.error_message || 'Clave financiera incorrecta.';
        console.log('[FINANCIAL_ACCESS] Password incorrect:', errorMsg);
        setError(errorMsg);
        // Focus input for retry
        const inputElement = document.getElementById('financial-password-input') as HTMLInputElement;
        if (inputElement) {
          inputElement.focus();
          inputElement.select();
        }
      }
    } catch (err) {
      console.error('[FINANCIAL_ACCESS] Unexpected error:', err);
      setError('No se pudo verificar la clave financiera. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setError(null);
    navigate('/dashboard');
  };

  // If unlocked, render children
  if (isUnlocked) {
    return <>{children}</>;
  }

  // If locked, render password prompt
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#111111] rounded-lg p-8 w-full max-w-md shadow-xl border border-white/10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Lock className="w-6 h-6 text-[#F4C542]" />
          <h1 className="text-2xl font-bold text-cc-cream">Acceso protegido</h1>
        </div>

        {/* Description */}
        <p className="text-cc-text-muted mb-6">
          Ingresa la clave financiera para acceder a esta información.
        </p>

        {/* Error message */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Expiration warning */}
        {expirationWarning && (
          <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-yellow-400 text-sm">La sesión está a punto de expirar. Introduce la clave de nuevo.</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleVerifyPassword} className="space-y-6">
          <div>
            <input
              id="financial-password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Clave financiera"
              disabled={loading}
              autoComplete="off"
              className="w-full px-4 py-3 bg-white text-black placeholder:text-gray-400 caret-black border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed transition"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading && password.trim()) {
                  handleVerifyPassword(e);
                }
              }}
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="flex-1 px-4 py-3 bg-[#F4C542] hover:bg-[#E8B937] disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-medium rounded-lg transition flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Verificando...' : 'Desbloquear'}
            </button>
          </div>
        </form>

        {/* Footer info */}
        <p className="text-xs text-cc-text-muted mt-6 text-center">
          Acceso válido por 15 minutos después de verificación.
        </p>
      </div>
    </div>
  );
};
