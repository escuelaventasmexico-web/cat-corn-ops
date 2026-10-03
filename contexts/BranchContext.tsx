import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from './AuthContext';

export interface Branch {
  id: string;
  code: string;
  name: string;
  sort_order: number;
}

interface BranchContextType {
  branches: Branch[];
  selectedBranch: Branch | null;
  loading: boolean;
  error: string | null;
  selectBranch: (branchId: string) => boolean;
  refreshBranches: () => Promise<void>;
}

const CHIPITLAN_BRANCH_ID = 'a4ce8e5f-6bfa-4f1a-8d96-8f1a7ce00101';
const BranchContext = createContext<BranchContextType | undefined>(undefined);

const storageKeyFor = (userId: string) => `catcorn_selected_branch:${userId}`;

export const BranchProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, profile, blockedReason } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshBranches = useCallback(async () => {
    if (!supabase || !user || !profile?.is_active || blockedReason) {
      setBranches([]);
      setSelectedBranchId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('branches')
      .select('id, code, name, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (queryError) {
      console.error('[BranchContext] Error completo de Supabase al cargar sucursales:', queryError);
      setBranches([]);
      setSelectedBranchId(null);
      setError('No se pudieron cargar las sucursales autorizadas.');
      setLoading(false);
      return;
    }

    const allowedBranches = (data || []) as Branch[];
    const storageKey = storageKeyFor(user.id);
    const savedId = localStorage.getItem(storageKey);
    const savedBranch = allowedBranches.find(branch => branch.id === savedId);
    const chipitlan = allowedBranches.find(branch => branch.id === CHIPITLAN_BRANCH_ID);
    const nextBranch = allowedBranches.length === 1
      ? allowedBranches[0]
      : savedBranch || chipitlan || null;

    setBranches(allowedBranches);
    setSelectedBranchId(nextBranch?.id || null);
    if (nextBranch) {
      localStorage.setItem(storageKey, nextBranch.id);
    } else {
      localStorage.removeItem(storageKey);
      setError('No tienes acceso a una sucursal activa. Contacta al administrador.');
    }
    setLoading(false);
  }, [blockedReason, profile?.is_active, user]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  const selectBranch = useCallback((branchId: string): boolean => {
    const branch = branches.find(item => item.id === branchId);
    if (!branch || !user) return false;

    setSelectedBranchId(branch.id);
    localStorage.setItem(storageKeyFor(user.id), branch.id);
    return true;
  }, [branches, user]);

  const value = useMemo<BranchContextType>(() => ({
    branches,
    selectedBranch: branches.find(branch => branch.id === selectedBranchId) || null,
    loading,
    error,
    selectBranch,
    refreshBranches,
  }), [branches, error, loading, refreshBranches, selectBranch, selectedBranchId]);

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
};

export const useBranch = (): BranchContextType => {
  const context = useContext(BranchContext);
  if (!context) throw new Error('useBranch must be used within BranchProvider');
  return context;
};
