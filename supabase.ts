import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIGURED = !!(supabaseUrl && supabaseAnonKey);

export const supabase = SUPABASE_CONFIGURED
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Database Types Interfaces
export interface Product {
  id: string;
  name: string; // Old field - fallback
  product_name?: string; // New field
  size: string;
  price: number;
  image_url?: string;
  flavor?: string; // Old field - fallback
  category?: string; // New field
  sku_code?: string;
  weight_grams?: number;
  grams?: number;
  bag_sku?: string;
  is_active?: boolean;
  barcode_prefix?: string;
  unit_cost?: number;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  min_stock: number;
  current_stock?: number; // From View
}

export interface CartItem extends Product {
  quantity: number;
  discount_amount?: number;
  discount_reason?: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  phone_norm: string;
  stamps: number;
  reward_available: boolean;
  created_at: string;
  updated_at: string;
  last_purchase_at: string | null;
}