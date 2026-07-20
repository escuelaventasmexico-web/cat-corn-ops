import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export type UserRole = 'admin' | 'socios_comerciales';

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AuthContextType {
  // Session and user data
  session: Session | null;
  user: Session['user'] | null;
  profile: UserProfile | null;
  role: UserRole | null;

  // Permission checks
  isAdmin: boolean;
  isCommercialPartnersUser: boolean;
  canAccessModule: (moduleName: string) => boolean;

  // State
  loading: boolean;
  profileLoading: boolean;
  error: string | null;
  blockedReason: 'no_profile' | 'inactive' | null;

  // Actions
  logout: () => Promise<void>;
}

// Helper to get module name from pathname
export const getModuleFromPath = (pathname: string): string => {
  if (pathname.includes('socios-comerciales')) return 'socios_comerciales';
  if (pathname.includes('dashboard') || pathname === '/') return 'dashboard';
  if (pathname.includes('punto-de-venta') || pathname.includes('pos')) return 'pos';
  if (pathname.includes('inventario')) return 'inventario';
  if (pathname.includes('produccion')) return 'produccion';
  if (pathname.includes('imprimir-etiquetas') || pathname.includes('print-labels')) return 'etiquetas';
  if (pathname.includes('merma') || pathname.includes('waste')) return 'merma';
  if (pathname.includes('logistica') || pathname.includes('ops')) return 'logistica';
  if (pathname.includes('historial') || pathname.includes('sales-history')) return 'historial';
  if (pathname.includes('corte-de-caja')) return 'corte_caja';
  if (pathname.includes('pedidos')) return 'pedidos';
  if (pathname.includes('finanzas')) return 'finanzas';
  return 'dashboard';
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState<'no_profile' | 'inactive' | null>(null);

  // Load user profile from user_profiles table
  const loadUserProfile = async (userId: string): Promise<UserProfile | null> => {
    if (!supabase) return null;

    try {
      setProfileLoading(true);
      setError(null);
      setBlockedReason(null);

      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, full_name, role, is_active, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.error('Error loading user profile:', profileError);
        
        // Detailed error handling for PGRST205 (table not found)
        if (profileError.code === 'PGRST205') {
          console.error('Table user_profiles not found in schema cache');
          setProfile(null);
          setBlockedReason(null);
          setError('No se encontró la tabla user_profiles en Supabase. Revisa que exista, que tenga permisos para authenticated y que el frontend esté conectado al proyecto correcto.');
          return null;
        }
        
        setProfile(null);
        setBlockedReason(null);
        setError('No se pudo cargar el perfil del usuario.');
        return null;
      }

      if (!profileData) {
        setBlockedReason('no_profile');
        setProfile(null);
        setError('Tu usuario no tiene perfil asignado. Contacta al administrador.');
        return null;
      }

      if (!profileData.is_active) {
        setBlockedReason('inactive');
        setProfile(profileData as UserProfile);
        setError('Tu usuario está inactivo. Contacta al administrador.');
        return profileData as UserProfile;
      }

      setProfile(profileData as UserProfile);
      setBlockedReason(null);
      setError(null);
      return profileData as UserProfile;
    } catch (err) {
      console.error('Unexpected profile error:', err);
      setProfile(null);
      setBlockedReason(null);
      setError('Error cargando permisos del usuario.');
      return null;
    } finally {
      setProfileLoading(false);
    }
  };

  // Initialize auth on mount and listen for auth changes
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isSubscribed = true;

    const initializeAuth = async () => {
      try {
        setLoading(true);
        setProfileLoading(true);
        setError(null);

        if (!supabase) {
          if (isSubscribed) {
            setLoading(false);
            setProfileLoading(false);
            setError('Supabase no está configurado.');
          }
          return;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (isSubscribed) {
            setSession(null);
            setProfile(null);
            setBlockedReason(null);
            setError('No se pudo cargar la sesión.');
          }
          return;
        }

        const initialSession = data.session;

        if (!isSubscribed) return;

        if (!initialSession?.user) {
          setSession(null);
          setProfile(null);
          setBlockedReason(null);
          return;
        }

        setSession(initialSession);

        await loadUserProfile(initialSession.user.id);
      } catch (err) {
        console.error('Error initializing auth:', err);
        if (isSubscribed) {
          setSession(null);
          setProfile(null);
          setBlockedReason(null);
          setError('Error cargando la sesión. Cierra otras pestañas, recarga e intenta de nuevo.');
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
          setProfileLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, newSession) => {
      if (!isSubscribed) return;

      setSession(newSession);
      setProfile(null);
      setBlockedReason(null);

      if (!newSession?.user) {
        setProfile(null);
        setBlockedReason(null);
        setLoading(false);
        setProfileLoading(false);
        return;
      }

      // Use setTimeout to avoid lock manager timeout
      setTimeout(() => {
        if (isSubscribed) {
          loadUserProfile(newSession.user.id)
            .finally(() => {
              if (isSubscribed) {
                setLoading(false);
                setProfileLoading(false);
              }
            });
        }
      }, 0);
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, []);

  // Timeout safety mechanism: force exit if loading takes too long
  useEffect(() => {
    if (!loading && !profileLoading) return;

    const timeout = setTimeout(() => {
      console.warn('Auth loading timeout reached after 12 seconds');
      setLoading(false);
      setProfileLoading(false);
      setError('La sesión tardó demasiado en cargar. Cierra otras pestañas, actualiza e intenta de nuevo.');
    }, 12000);

    return () => clearTimeout(timeout);
  }, [loading, profileLoading]);

  const logout = async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setBlockedReason(null);
    } catch (err) {
      console.error('Error logging out:', err);
    }
  };

  // Permission checks
  const isAdmin = profile?.role === 'admin';
  const isCommercialPartnersUser = profile?.role === 'socios_comerciales';

  // Module access rules
  const moduleAccessMap: Record<UserRole, string[]> = {
    admin: [
      'dashboard',
      'pos',
      'inventario',
      'produccion',
      'etiquetas',
      'merma',
      'logistica',
      'socios_comerciales',
      'historial',
      'corte_caja',
      'pedidos',
      'finanzas',
    ],
    socios_comerciales: [
      'socios_comerciales',
    ],
  };

  const canAccessModule = (moduleName: string): boolean => {
    if (!profile || !profile.role) return false;
    const allowedModules = moduleAccessMap[profile.role];
    return allowedModules.includes(moduleName);
  };

  const value: AuthContextType = {
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || null,
    isAdmin,
    isCommercialPartnersUser,
    canAccessModule,
    loading,
    profileLoading,
    error,
    blockedReason,
    logout,
  };

  // Debug logging (temporary)
  useEffect(() => {
    console.log('AUTH DEBUG', {
      userEmail: session?.user?.email,
      profile: profile?.id,
      role: profile?.role,
      loading,
      profileLoading,
      blockedReason,
      error,
      pathname: window.location.pathname,
    });
  }, [session, profile, loading, profileLoading, blockedReason, error]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
