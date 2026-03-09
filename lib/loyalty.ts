import { supabase } from '../supabase';
import type { Customer } from '../supabase';

/** Keep only digits; drop leading country code 52 if present; keep last 10 digits */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  let norm = digits;
  if (norm.startsWith('52') && norm.length > 10) {
    norm = norm.slice(2);
  }
  if (norm.length > 10) {
    norm = norm.slice(norm.length - 10);
  }
  return norm;
}

export async function fetchCustomerByPhoneNorm(phoneNorm: string): Promise<Customer | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('phone_norm', phoneNorm)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as Customer;
}

export async function fetchCustomerById(id: string): Promise<Customer | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Customer;
}

export async function fetchCustomersList(): Promise<{ data: Customer[]; error: string | null }> {
  if (!supabase) return { data: [], error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as Customer[], error: null };
}

export async function createCustomerRecord(
  first_name: string,
  last_name: string,
  phone: string,
): Promise<Customer> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('customers')
    .insert({ first_name, last_name, phone })
    .select()
    .single();
  if (error) throw error;
  return data as Customer;
}
