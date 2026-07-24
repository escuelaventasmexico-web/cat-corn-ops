/* ── Piece Sales RPC Functions ──────────────────────────────── */

import { supabase } from '../supabase';
import { PieceSaleRequest, PieceSaleResponse, PieceSalePaymentRequest } from '../types/pieceSales';

export const createPieceSaleWithPaymentRequest = async (
  request: PieceSaleRequest
): Promise<PieceSaleResponse> => {
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase.rpc(
    'create_piece_sale_with_payment_request',
    {
      p_sale_date: request.p_sale_date,
      p_payment_method: request.p_payment_method,
      p_items: request.p_items,
      p_payment_reference: request.p_payment_reference || null,
      p_notes: request.p_notes || null,
    }
  );

  if (error) {
    console.error('RPC error creating piece sale:', error);
    throw new Error(error.message || 'Error al crear venta por pieza');
  }

  // RETURNS TABLE devuelve un arreglo
  const createdSale = Array.isArray(data) ? data[0] : data;

  console.log('create_piece_sale_with_payment_request response:', {
    raw: data,
    extracted: createdSale,
  });

  if (!createdSale || !createdSale.request_id) {
    console.error('No request_id in response:', createdSale);
    throw new Error('La venta fue creada, pero no se recibió el identificador del reporte de cobro.');
  }

  return createdSale;
};

export const createPieceSalePaymentRequest = async (
  request: PieceSalePaymentRequest
): Promise<any> => {
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase.rpc(
    'create_piece_sale_payment_request',
    {
      p_sale_id: request.p_sale_id,
      p_payment_date: request.p_payment_date,
      p_payment_method: request.p_payment_method,
      p_payment_reference: request.p_payment_reference || null,
      p_notes: request.p_notes || null,
    }
  );

  if (error) {
    console.error('RPC error creating payment request:', error);
    throw new Error(error.message || 'Error al crear solicitud de pago');
  }

  // RETURNS TABLE devuelve un arreglo
  const createdRequest = Array.isArray(data) ? data[0] : data;

  console.log('create_piece_sale_payment_request response:', {
    raw: data,
    extracted: createdRequest,
  });

  if (!createdRequest || !createdRequest.request_id) {
    console.error('No request_id in payment request response:', createdRequest);
    throw new Error('No se recibió el identificador de la solicitud de pago.');
  }

  return createdRequest;
};

export const recordSellerPieceStockMovement = async (
  sellerId: string,
  productId: string,
  movementType: 'delivery' | 'return' | 'adjustment',
  quantity: number,
  movementDate: string,
  notes?: string
): Promise<any> => {
  if (!supabase) {
    throw new Error('Supabase no está configurado');
  }

  const { data, error } = await supabase.rpc(
    'record_seller_piece_stock_movement',
    {
      p_seller_id: sellerId,
      p_product_id: productId,
      p_movement_type: movementType,
      p_quantity: quantity,
      p_movement_date: movementDate,
      p_notes: notes || null,
    }
  );

  if (error) {
    console.error('RPC error recording stock movement:', error);
    throw new Error(error.message || 'Error al registrar movimiento de stock');
  }

  return data;
};
