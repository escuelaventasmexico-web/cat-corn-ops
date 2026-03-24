import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase, Product, CartItem } from '../supabase';
import type { Customer } from '../supabase';
import { normalizePhone, fetchCustomerByPhoneNorm, fetchCustomerById, createCustomerRecord, fetchCustomersList } from '../lib/loyalty';
import { PROMOTIONS, clearPromoDiscounts, countEligible, getPromoEmoji, getPromotion } from '../lib/promotions';
import type { PromotionCode } from '../lib/promotions';
import { Search, Plus, Minus, CreditCard, Banknote, User, ShoppingBag, ScanBarcode, X, Gift, Phone, UserPlus, Tag, Sparkles, Users } from 'lucide-react';
import { fetchCashStatus, getOpenSessionId, EMPTY_CASH_STATUS } from '../lib/cashRegister';
import type { CashRegisterStatus } from '../lib/cashRegister';
import { CashRegisterStatusPanel } from '../components/CashRegisterStatus';
import { OpenCashRegisterModal } from '../components/OpenCashRegisterModal';
import { WithdrawalModal } from '../components/WithdrawalModal';
import { CloseCashRegisterModal } from '../components/CloseCashRegisterModal';

export const POS = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [processing, setProcessing] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Loyalty state
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltySearching, setLoyaltySearching] = useState(false);
  const [loyaltyMsg, setLoyaltyMsg] = useState<string | null>(null);
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustForm, setNewCustForm] = useState({ first_name: '', last_name: '', phone: '' });
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [rewardSelectedItem, setRewardSelectedItem] = useState<string | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Promotion state
  const [activePromoCode, setActivePromoCode] = useState<PromotionCode | null>(null);

  // Customers list state
  const [showCustomersList, setShowCustomersList] = useState(false);
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [customersListLoading, setCustomersListLoading] = useState(false);
  const [customersListError, setCustomersListError] = useState<string | null>(null);
  const [customersListFilter, setCustomersListFilter] = useState('');

  // Payment input state
  const [cashInput, setCashInput] = useState<number>(0);
  const [cardInput, setCardInput] = useState<number>(0);

  // Instagram promo state
  const [instagramPromoActive, setInstagramPromoActive] = useState(false);

  // Cash register state
  const [cashStatus, setCashStatus] = useState<CashRegisterStatus>(EMPTY_CASH_STATUS);
  const [cashLoading, setCashLoading] = useState(true);
  const [showOpenCashModal, setShowOpenCashModal] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [showCloseCashModal, setShowCloseCashModal] = useState(false);
  const cashRegisterOpen = !!cashStatus.session_id;

  useEffect(() => {
    fetchProducts();
    loadCashStatus();
  }, []);

  const loadCashStatus = async () => {
    setCashLoading(true);
    try {
      const status = await fetchCashStatus();
      setCashStatus(status);
    } catch (err) {
      console.error('[CASH] Failed to load status:', err);
    } finally {
      setCashLoading(false);
    }
  };

  // Keep barcode input focused
  useEffect(() => {
    const timer = setInterval(() => {
      if (barcodeRef.current && document.activeElement !== barcodeRef.current) {
        // Only refocus if user isn't typing in another input
        const active = document.activeElement;
        const isOtherInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
        if (!isOtherInput) barcodeRef.current.focus();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleBarcodeScan = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || !supabase) return;
    setScanMsg(null);

    try {
      // 1) Search in product_lots by barcode_value
      const { data: lotData, error: lotErr } = await supabase
        .from('product_lots')
        .select('product_id')
        .eq('barcode_value', trimmed)
        .limit(1)
        .single();

      if (!lotErr && lotData?.product_id) {
        // Found a lot — fetch the product
        const { data: prod } = await supabase
          .from('products')
          .select('*')
          .eq('id', lotData.product_id)
          .single();
        if (prod) { addToCart(prod as Product); return; }
      }

      // 2) Fallback: search by sku_code in products
      const { data: skuData } = await supabase
        .from('products')
        .select('*')
        .eq('sku_code', trimmed)
        .limit(1)
        .single();

      if (skuData) { addToCart(skuData as Product); return; }

      // 3) Not found
      setScanMsg('Código no encontrado: ' + trimmed);
      setTimeout(() => setScanMsg(null), 3000);
    } catch (err) {
      console.error('Barcode scan error:', err);
      setScanMsg('Error al buscar código');
      setTimeout(() => setScanMsg(null), 3000);
    }
  }, [products]);

  const fetchProducts = async () => {
    try {
      if (!supabase) { setLoading(false); return; }

      // Try is_active column first, fallback to active
      let result = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('flavor', { ascending: true })
        .order('grams', { ascending: true });

      if (result.error) {
        console.error('is_active not found, trying active column:', result.error.message);
        result = await supabase
          .from('products')
          .select('*')
          .eq('active', true)
          .order('flavor', { ascending: true })
          .order('grams', { ascending: true });
      }

      if (result.error) console.error('Error loading products:', result.error);
      if (result.data) setProducts(result.data);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper: reapply Instagram 15% discount to most expensive item
  const reapplyInstagramDiscount = (items: CartItem[]): CartItem[] => {
    // Clear existing instagram discounts
    const cleaned = items.map(item =>
      item.discount_reason === 'PROMOCION_INSTAGRAM_15'
        ? { ...item, discount_amount: undefined, discount_reason: undefined }
        : item
    );
    if (cleaned.length === 0) return cleaned;
    let mostExpensiveIdx = 0;
    let maxPrice = 0;
    cleaned.forEach((item, idx) => {
      if (item.price > maxPrice) {
        maxPrice = item.price;
        mostExpensiveIdx = idx;
      }
    });
    const discountAmount = Math.round(maxPrice * 0.15 * 100) / 100;
    return cleaned.map((item, idx) =>
      idx === mostExpensiveIdx
        ? { ...item, discount_amount: discountAmount, discount_reason: 'PROMOCION_INSTAGRAM_15' as const }
        : item
    );
  };

  const addToCart = (product: Product) => {
    setCart(prev => {
      let next: CartItem[];
      const exists = prev.find(item => item.id === product.id);
      if (exists) {
        next = prev.map(item => {
          if (item.id !== product.id) return item;
          const updated = { ...item, quantity: item.quantity + 1 };
          if (updated.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM') {
            updated.discount_amount = updated.price * updated.quantity * 0.5;
          }
          return updated;
        });
      } else {
        next = [...prev, { ...product, quantity: 1 }];
      }
      // Reapply active promotion
      if (activePromoCode) {
        const promo = getPromotion(activePromoCode);
        if (promo) return promo.apply(next);
      }
      // Reapply Instagram promo
      if (instagramPromoActive) {
        return reapplyInstagramDiscount(next);
      }
      return next;
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => {
      let next = prev.map(item => {
        if (item.id === id) {
          const newQ = Math.max(0, item.quantity + delta);
          const updated: CartItem = { ...item, quantity: newQ };
          if (updated.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM') {
            updated.discount_amount = updated.price * updated.quantity * 0.5;
          }
          return updated;
        }
        return item;
      }).filter(item => item.quantity > 0);
      // Reapply active promotion
      if (activePromoCode) {
        const promo = getPromotion(activePromoCode);
        if (promo) return promo.apply(next);
      }
      // Reapply Instagram promo
      if (instagramPromoActive) {
        if (next.length === 0) {
          setInstagramPromoActive(false);
          return next;
        }
        return reapplyInstagramDiscount(next);
      }
      return next;
    });
  };

  const totalDiscount = cart.reduce((sum, item) => sum + (item.discount_amount || 0), 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartTotal = cartSubtotal - totalDiscount;
  const hasRewardApplied = cart.some(item => item.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM');
  const hasPromoApplied = cart.some(item => item.discount_reason?.startsWith('PROMO_'));
  const hasInstagramApplied = cart.some(item => item.discount_reason === 'PROMOCION_INSTAGRAM_15');

  // Instagram promo derived values
  const instagramDiscountInfo = useMemo(() => {
    if (!instagramPromoActive || cart.length === 0) return null;
    let mostExpensiveIdx = 0;
    let maxPrice = 0;
    cart.forEach((item, idx) => {
      if (item.price > maxPrice) {
        maxPrice = item.price;
        mostExpensiveIdx = idx;
      }
    });
    const discountAmount = Math.round(maxPrice * 0.15 * 100) / 100;
    return {
      itemIndex: mostExpensiveIdx,
      itemId: cart[mostExpensiveIdx]?.id,
      itemName: cart[mostExpensiveIdx]?.product_name || cart[mostExpensiveIdx]?.name || '',
      discountAmount,
    };
  }, [instagramPromoActive, cart]);

  // Split-payment derived values
  const paymentTotal = cashInput + cardInput;
  const paymentRemaining = cartTotal - paymentTotal;
  const changeAmount = paymentTotal > cartTotal ? paymentTotal - cartTotal : 0;
  const isPaymentSufficient = paymentTotal >= cartTotal && cartTotal > 0;

  // Promo/loyalty mutual exclusion
  const loyaltyBlocked = !!activePromoCode || hasPromoApplied || instagramPromoActive;
  const promoBlocked = hasRewardApplied || instagramPromoActive;
  const instagramBlocked = hasRewardApplied || !!activePromoCode || hasPromoApplied;

  const handleCheckout = async () => {
    if (cart.length === 0 || !supabase) return;
    if (!isPaymentSufficient) return;

    // Block if no cash register is open
    if (!cashRegisterOpen) {
      alert('Debes abrir una caja antes de registrar ventas.');
      return;
    }

    // Determine actual amounts (change only applies to cash)
    const effectiveCash = Math.min(cashInput, cartTotal - cardInput);
    const effectiveCard = cardInput;
    const method = effectiveCash > 0 && effectiveCard > 0 ? 'MIXED'
      : effectiveCard > 0 ? 'CARD' : 'CASH';

    setProcessing(true);

    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No auth user');

        // Fetch the current open session id to link the sale
        const cashSessionId = await getOpenSessionId();
        console.log('[CASH] sale linked to session', cashSessionId);

        const rewardApplied = cart.some(i => i.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM');
        const discountTotal = cart.reduce((s, i) => s + (i.discount_amount || 0), 0);

        // 1. Insert sale (linked to cash session)
        const salePayload: Record<string, unknown> = {
            total: cartTotal,
            payment_method: method,
            cash_amount: effectiveCash,
            card_amount: effectiveCard,
            cashier_id: user.id,
            customer_id: customer?.id || null,
            loyalty_reward_applied: rewardApplied,
            loyalty_discount_amount: discountTotal,
            promotion_code: activePromoCode || (instagramPromoActive ? 'PROMO_INSTAGRAM_15' : null),
        };
        if (cashSessionId) {
          salePayload.cash_session_id = cashSessionId;
        }

        const { data: sale, error: saleErr } = await supabase
          .from('sales')
          .insert(salePayload)
          .select('id')
          .single();

        if (saleErr) throw saleErr;

        // 2. Insert sale_items
        // Store the FINAL price after any discount so DB totals match cash collected
        const saleItems = cart.map(item => {
          const disc = item.discount_amount || 0;
          const effectivePrice = item.quantity > 0
            ? Math.round(((item.price * item.quantity) - disc) / item.quantity * 100) / 100
            : item.price;
          return {
            sale_id: sale.id,
            product_id: item.id,
            quantity: item.quantity,
            price: effectivePrice,
            discount_amount: disc,
            discount_reason: item.discount_reason || null,
          };
        });

        const { error: itemsErr } = await supabase
          .from('sale_items')
          .insert(saleItems);

        if (itemsErr) throw itemsErr;

        // 3. Refetch customer to show updated stamps
        if (customer) {
          const updated = await fetchCustomerById(customer.id);
          if (updated) setCustomer(updated);
        }

        // Refresh cash register status after sale
        loadCashStatus();

        // Success
        setCart([]);
        setActivePromoCode(null);
        setInstagramPromoActive(false);
        setCashInput(0);
        setCardInput(0);
        alert('¡Venta realizada con éxito! Ticket #' + sale.id.slice(0, 8));

    } catch (err: any) {
        console.error(err);
        alert('Error procesando venta: ' + err.message);
    } finally {
        setProcessing(false);
    }
  };

  // --- Loyalty helpers ---

  const handleLoyaltySearch = async () => {
    if (!loyaltyPhone.trim()) return;
    setLoyaltySearching(true);
    setLoyaltyMsg(null);
    try {
      const norm = normalizePhone(loyaltyPhone);
      if (norm.length < 10) { setLoyaltyMsg('Teléfono inválido'); setLoyaltySearching(false); return; }
      const found = await fetchCustomerByPhoneNorm(norm);
      if (found) {
        setCustomer(found);
        setLoyaltyPhone('');
        setLoyaltyMsg(null);
      } else {
        setLoyaltyMsg('No encontrado');
        setNewCustForm({ first_name: '', last_name: '', phone: loyaltyPhone });
        setShowNewCustomerModal(true);
      }
    } catch { setLoyaltyMsg('Error buscando'); }
    finally { setLoyaltySearching(false); }
  };

  const handleCreateCustomer = async () => {
    if (!newCustForm.first_name.trim() || !newCustForm.phone.trim()) return;
    setSavingCustomer(true);
    try {
      const created = await createCustomerRecord(newCustForm.first_name.trim(), newCustForm.last_name.trim(), newCustForm.phone.trim());
      setCustomer(created);
      setShowNewCustomerModal(false);
      setLoyaltyPhone('');
      setLoyaltyMsg(null);
      setNewCustForm({ first_name: '', last_name: '', phone: '' });
    } catch (err: any) {
      alert('Error creando cliente: ' + err.message);
    } finally { setSavingCustomer(false); }
  };

  const applyReward = () => {
    if (!rewardSelectedItem) return;
    // Clear any promo first (mutual exclusion)
    setActivePromoCode(null);
    setCart(prev => {
      const cleaned = clearPromoDiscounts(prev);
      return cleaned.map(item => {
        if (item.id === rewardSelectedItem) {
          return {
            ...item,
            discount_amount: item.price * item.quantity * 0.5,
            discount_reason: 'LOYALTY_50_OFF_ONE_ITEM',
          };
        }
        if (item.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM') {
          return { ...item, discount_amount: undefined, discount_reason: undefined };
        }
        return item;
      });
    });
    setShowRewardModal(false);
    setRewardSelectedItem(null);
  };

  // Instagram promo toggle
  const toggleInstagramPromo = () => {
    if (instagramPromoActive) {
      // Deactivate: clear instagram discount from cart
      setInstagramPromoActive(false);
      setCart(prev => prev.map(item => {
        if (item.discount_reason === 'PROMOCION_INSTAGRAM_15') {
          return { ...item, discount_amount: undefined, discount_reason: undefined };
        }
        return item;
      }));
      return;
    }

    // Check mutual exclusion
    if (instagramBlocked) return;
    if (cart.length === 0) return;

    // Activate: find most expensive item and apply 15% discount
    setInstagramPromoActive(true);
    setCart(prev => {
      let mostExpensiveIdx = 0;
      let maxPrice = 0;
      prev.forEach((item, idx) => {
        if (item.price > maxPrice) {
          maxPrice = item.price;
          mostExpensiveIdx = idx;
        }
      });
      const discountAmount = Math.round(maxPrice * 0.15 * 100) / 100;
      return prev.map((item, idx) => {
        if (idx === mostExpensiveIdx) {
          return {
            ...item,
            discount_amount: discountAmount,
            discount_reason: 'PROMOCION_INSTAGRAM_15',
          };
        }
        return item;
      });
    });
  };

  const clearReward = () => {
    setCart(prev => prev.map(item =>
      item.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM'
        ? { ...item, discount_amount: undefined, discount_reason: undefined }
        : item
    ));
  };

  const clearCustomer = () => {
    setCustomer(null);
    clearReward();
    setLoyaltyPhone('');
    setLoyaltyMsg(null);
  };

  // --- Customers list helpers ---

  const handleOpenCustomersList = async () => {
    setShowCustomersList(true);
    setCustomersListFilter('');
    setCustomersListLoading(true);
    setCustomersListError(null);
    const result = await fetchCustomersList();
    setCustomersList(result.data);
    setCustomersListError(result.error);
    setCustomersListLoading(false);
  };

  const handleSelectFromList = (c: Customer) => {
    setCustomer(c);
    setShowCustomersList(false);
    setLoyaltyPhone('');
    setLoyaltyMsg(null);
  };

  const filteredCustomersList = customersList.filter(c => {
    if (!customersListFilter.trim()) return true;
    const q = customersListFilter.toLowerCase();
    const name = `${c.first_name} ${c.last_name}`.toLowerCase();
    return name.includes(q) || c.phone.includes(q) || (c.phone_norm || '').includes(q);
  });

  // --- Promotion helpers ---

  const activatePromo = (code: PromotionCode) => {
    if (promoBlocked) return;
    if (activePromoCode === code) {
      // Deactivate
      deactivatePromo();
      return;
    }
    const promo = getPromotion(code);
    if (!promo) return;
    setActivePromoCode(code);
    setCart(prev => promo.apply(prev));
  };

  const deactivatePromo = () => {
    setActivePromoCode(null);
    setCart(prev => clearPromoDiscounts(prev));
  };

  // Eligible counts for promo buttons (memoized)
  const promoEligibleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of PROMOTIONS) {
      map[p.code] = countEligible(cart, p.code);
    }
    return map;
  }, [cart]);

  const filteredProducts = products.filter(p => {
    const displayName = p.product_name || p.name;
    const sku = p.sku_code || '';
    const search = searchTerm.toLowerCase();
    return displayName.toLowerCase().includes(search) || sku.toLowerCase().includes(search);
  });

  // Group products dynamically by flavor (loaded from DB)
  const productsByFlavor = filteredProducts.reduce((acc, product) => {
    const flavor = (product.flavor || product.category || 'Otros').trim();
    if (!acc[flavor]) acc[flavor] = [];
    acc[flavor].push(product);
    return acc;
  }, {} as Record<string, Product[]>);

  // Sort each group by grams ascending
  Object.values(productsByFlavor).forEach(group => {
    group.sort((a, b) => (a.grams || a.weight_grams || 0) - (b.grams || b.weight_grams || 0));
  });

  const getFlavorEmoji = (flavor: string): string => {
    const f = flavor.toLowerCase();
    if (f.includes('salad')) return '🧂';
    if (f.includes('caramel')) return '🍯';
    if (f.includes('cheddar') || f.includes('queso')) return '🧀';
    if (f.includes('flam') || f.includes('hot')) return '🔥';
    return '🍿';
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      {/* Product Grid */}
      <div className="flex-1 flex flex-col">
        {/* Barcode Scanner + Search */}
        <div className="mb-4 space-y-2">
          {/* Barcode input */}
          <div className="relative">
            <input
              ref={barcodeRef}
              type="text"
              placeholder="Escanear código de barras..."
              className="w-full bg-cc-primary/10 border-2 border-cc-primary/40 rounded-xl py-3 pl-11 pr-4 text-black placeholder-gray-400 caret-black focus:ring-2 focus:ring-cc-primary focus:border-cc-primary outline-none font-mono text-lg"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleBarcodeScan(barcodeInput);
                  setBarcodeInput('');
                }
              }}
              autoFocus
            />
            <ScanBarcode className="absolute left-3 top-3.5 text-cc-primary" size={20} />
          </div>
          {scanMsg && (
            <div className="bg-red-500/15 border border-red-500/40 text-red-400 text-sm rounded-lg px-3 py-2">
              {scanMsg}
            </div>
          )}
          {/* Text search */}
          <div className="relative">
            <input 
                type="text"
                placeholder="Buscar producto por nombre..."
                className="w-full bg-cc-surface border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-black placeholder-gray-400 caret-black focus:ring-2 focus:ring-cc-primary outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search className="absolute left-3 top-2.5 text-cc-text-muted" size={18} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
            {/* Dynamic Flavor Sections */}
            {Object.entries(productsByFlavor).map(([flavor, flavorProducts]) => (
              <div key={flavor} className="mb-4">
                <h2 className="text-sm font-bold text-cc-cream mb-2 flex items-center gap-2 uppercase tracking-wide">
                  <span>{getFlavorEmoji(flavor)}</span>
                  <span>{flavor}</span>
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {flavorProducts.map(product => (
                    <button 
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="bg-cc-surface hover:bg-white/5 border border-white/5 px-3 py-3 rounded-lg transition-all text-left group flex flex-col h-[5.5rem] relative"
                    >
                      <h3 className="font-semibold text-sm text-cc-cream leading-tight line-clamp-2">{product.product_name || product.name}</h3>
                      <div className="mt-auto flex items-end justify-between w-full">
                        <span className="text-xs text-cc-text-muted">{product.grams || product.weight_grams || ''}g</span>
                        <span className="text-lg font-bold text-cc-primary leading-none">${product.price}</span>
                      </div>
                      <div className="absolute top-2 right-2 bg-cc-primary text-cc-bg p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus size={12} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Promociones disponibles */}
            <div className="mt-6 mb-4">
              <h2 className="text-sm font-bold text-cc-cream mb-3 flex items-center gap-2 uppercase tracking-wide">
                <span>🎉</span>
                <span>Promociones del día</span>
                {activePromoCode && (
                  <span className="ml-auto normal-case tracking-normal text-[10px] font-medium text-cc-accent bg-cc-accent/10 px-2 py-0.5 rounded-full">
                    {PROMOTIONS.find(p => p.code === activePromoCode)?.shortLabel} activa
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {PROMOTIONS.map(p => {
                  const isActive = activePromoCode === p.code;
                  const eligible = promoEligibleCounts[p.code] || 0;
                  const blocked = promoBlocked;
                  return (
                    <button
                      key={p.code}
                      onClick={() => activatePromo(p.code)}
                      disabled={blocked && !isActive}
                      className={`relative text-left p-4 rounded-xl border transition-all group ${
                        isActive
                          ? 'bg-cc-accent/10 border-cc-accent/40 ring-1 ring-cc-accent/30'
                          : blocked
                            ? 'bg-cc-surface border-white/5 opacity-40 cursor-not-allowed'
                            : 'bg-cc-surface border-white/5 hover:border-cc-accent/30 hover:bg-cc-accent/5'
                      }`}
                    >
                      {/* Active badge */}
                      {isActive && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-cc-accent/20 text-cc-accent text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          <Sparkles size={10} /> Activa
                        </div>
                      )}

                      {/* Day + Emoji */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{getPromoEmoji(p.code)}</span>
                        <div>
                          <div className="text-xs font-bold text-cc-accent uppercase tracking-wide">{p.day}</div>
                          <div className="text-sm font-semibold text-cc-cream leading-tight">{p.label.split(': ')[1] || p.shortLabel}</div>
                        </div>
                      </div>

                      {/* Includes */}
                      <p className="text-xs text-cc-text-muted leading-relaxed mb-2">
                        {p.includes}
                      </p>

                      {/* Promo price */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-cc-primary">{p.promoPrice}</span>
                        {!isActive && eligible > 0 && (
                          <span className="text-[10px] font-bold text-cc-accent bg-cc-accent/10 px-1.5 py-0.5 rounded-full">
                            {eligible} en carrito
                          </span>
                        )}
                      </div>

                      {/* Note */}
                      {p.note && (
                        <p className="text-[10px] text-cc-text-muted/70 mt-1.5 italic">{p.note}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
        </div>
      </div>

      {/* Cart Sidebar */}
      <div className="w-80 bg-cc-surface rounded-xl border border-white/5 flex flex-col shadow-2xl">
        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5 rounded-t-xl">
            <h2 className="font-bold text-lg text-cc-cream">Orden Actual</h2>
            <div className="text-xs text-cc-text-muted">{cart.length} items</div>
        </div>

        {/* Cash Register Status */}
        <CashRegisterStatusPanel
          status={cashStatus}
          loading={cashLoading}
          onOpenRegister={() => setShowOpenCashModal(true)}
          onWithdrawal={cashRegisterOpen ? () => setShowWithdrawalModal(true) : undefined}
          onCloseRegister={cashRegisterOpen ? () => setShowCloseCashModal(true) : undefined}
        />

        {/* Loyalty Card */}
        <div className="p-3 bg-black/20 border-b border-white/5">
          {!customer ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="tel"
                    placeholder="Teléfono (Fidelidad)"
                    className="w-full bg-cc-bg border border-white/10 rounded-lg py-1.5 pl-8 pr-2 text-sm text-black placeholder-gray-400 caret-black focus:ring-1 focus:ring-cc-primary outline-none"
                    value={loyaltyPhone}
                    onChange={(e) => setLoyaltyPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLoyaltySearch(); }}
                  />
                  <Phone size={14} className="absolute left-2.5 top-2 text-cc-text-muted" />
                </div>
                <button
                  onClick={handleLoyaltySearch}
                  disabled={loyaltySearching}
                  className="px-3 py-1.5 bg-cc-primary/20 text-cc-primary text-xs font-bold rounded-lg hover:bg-cc-primary/30 transition-colors"
                >
                  Buscar
                </button>
                <button
                  onClick={() => { setNewCustForm({ first_name: '', last_name: '', phone: loyaltyPhone }); setShowNewCustomerModal(true); }}
                  className="px-2 py-1.5 bg-white/5 text-cc-text-muted text-xs rounded-lg hover:bg-white/10 transition-colors"
                  title="Nuevo cliente"
                >
                  <UserPlus size={14} />
                </button>
                <button
                  onClick={handleOpenCustomersList}
                  className="px-2 py-1.5 bg-white/5 text-cc-text-muted text-xs rounded-lg hover:bg-white/10 transition-colors"
                  title="Ver clientes"
                >
                  <Users size={14} />
                </button>
              </div>
              {loyaltyMsg && <p className="text-xs text-red-400">{loyaltyMsg}</p>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <User size={13} className="text-cc-primary flex-shrink-0" />
                  <span className="text-sm font-medium text-cc-cream truncate">{customer.first_name} {customer.last_name}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-cc-text-muted">{customer.phone}</span>
                  {customer.reward_available
                    ? <span className="flex items-center gap-1 text-[10px] font-bold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">
                        <Gift size={10} /> Reward lista
                      </span>
                    : <span className="text-xs text-cc-text-muted">Compras: <span className="font-bold text-cc-primary">{customer.stamps}</span>/3</span>
                  }
                </div>
              </div>
              <button onClick={clearCustomer} className="text-xs text-cc-text-muted hover:text-red-400 transition-colors p-1">
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Apply Reward Button */}
        {customer?.reward_available && cart.length > 0 && !hasRewardApplied && (
          <button
            onClick={() => { if (loyaltyBlocked) return; setRewardSelectedItem(null); setShowRewardModal(true); }}
            disabled={loyaltyBlocked}
            className={`mx-3 mt-2 flex items-center justify-center gap-2 py-2 border text-xs font-bold rounded-lg transition-colors w-[calc(100%-1.5rem)] ${
              loyaltyBlocked
                ? 'bg-white/5 border-white/10 text-cc-text-muted cursor-not-allowed'
                : 'bg-green-500/15 hover:bg-green-500/25 border-green-500/30 text-green-400'
            }`}
            title={loyaltyBlocked ? 'No combinable con promoción' : undefined}
          >
            <Gift size={14} /> {loyaltyBlocked ? 'No combinable con promo' : 'Aplicar 50% (1 producto)'}
          </button>
        )}
        {hasRewardApplied && (
          <div className="mx-3 mt-2 flex items-center justify-between py-2 px-3 bg-green-500/10 border border-green-500/20 text-green-400 text-xs rounded-lg">
            <span className="flex items-center gap-1"><Gift size={12} /> Descuento fidelidad aplicado</span>
            <button onClick={clearReward} className="text-red-400 hover:text-red-300 text-[10px] font-bold">Quitar</button>
          </div>
        )}

        {/* Active promo indicator (compact) */}
        {activePromoCode && (
          <div className="mx-3 mt-2 flex items-center justify-between py-1.5 px-3 bg-cc-accent/10 border border-cc-accent/20 text-cc-accent text-xs rounded-lg">
            <span className="flex items-center gap-1"><Sparkles size={12} /> {PROMOTIONS.find(p => p.code === activePromoCode)?.label || 'Promo activa'}</span>
            <button onClick={deactivatePromo} className="text-red-400 hover:text-red-300 text-[10px] font-bold">Quitar</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.map(item => {
                const lineTotal = item.price * item.quantity;
                const disc = item.discount_amount || 0;
                return (
                <div key={item.id} className={`flex justify-between items-center p-3 rounded-lg border ${
                  item.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM' ? 'bg-green-500/5 border-green-500/20'
                  : item.discount_reason === 'PROMOCION_INSTAGRAM_15' ? 'bg-pink-500/5 border-pink-500/20'
                  : item.discount_reason?.startsWith('PROMO_') ? 'bg-cc-accent/5 border-cc-accent/20'
                  : 'bg-black/20 border-white/5'
                }`}>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-cc-text-main truncate">{item.product_name || item.name}</div>
                        <div className="text-xs text-cc-text-muted">{item.size}</div>
                        {item.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM' && (
                          <div className="text-[10px] text-green-400 mt-0.5 flex items-center gap-1"><Gift size={10} /> -50%</div>
                        )}
                        {item.discount_reason === 'PROMOCION_INSTAGRAM_15' && (
                          <div className="text-[10px] text-pink-300 mt-0.5 flex items-center gap-1"><Sparkles size={10} /> -15% Instagram</div>
                        )}
                        {item.discount_reason?.startsWith('PROMO_') && item.discount_reason !== 'PROMOCION_INSTAGRAM_15' && (
                          <div className="text-[10px] text-cc-accent mt-0.5 flex items-center gap-1"><Tag size={10} /> Promo</div>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-cc-text-main">
                            <Minus size={14} />
                        </button>
                        <span className="font-bold w-4 text-center">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 rounded-full bg-cc-primary/20 hover:bg-cc-primary/30 flex items-center justify-center text-cc-primary">
                            <Plus size={14} />
                        </button>
                    </div>
                    <div className="ml-4 w-16 text-right">
                        {disc > 0 ? (
                          <>
                            <div className="text-xs text-cc-text-muted line-through">${lineTotal.toFixed(0)}</div>
                            <div className={`font-bold ${item.discount_reason?.startsWith('PROMO_') ? 'text-cc-accent' : 'text-green-400'}`}>${(lineTotal - disc).toFixed(0)}</div>
                          </>
                        ) : (
                          <span className="font-bold text-cc-text-main">${lineTotal}</span>
                        )}
                    </div>
                </div>
                );
            })}
            {cart.length === 0 && (
                <div className="text-center text-cc-text-muted mt-20 opacity-50">
                    <div className="flex justify-center mb-2"><ShoppingBag size={48} /></div>
                    <p>Carrito vacío</p>
                </div>
            )}
        </div>

        <div className="p-6 bg-black/20 border-t border-white/10 rounded-b-xl">
            {totalDiscount > 0 && (
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-cc-text-muted">Subtotal</span>
                <span className="text-cc-text-muted">${cartSubtotal.toFixed(2)}</span>
              </div>
            )}
            {hasRewardApplied && (
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-green-400">Desc. Fidelidad</span>
                <span className="text-green-400">-${cart.filter(i => i.discount_reason === 'LOYALTY_50_OFF_ONE_ITEM').reduce((s, i) => s + (i.discount_amount || 0), 0).toFixed(2)}</span>
              </div>
            )}
            {hasPromoApplied && !hasInstagramApplied && (
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-cc-accent">Desc. Promoción</span>
                <span className="text-cc-accent">-${cart.filter(i => i.discount_reason?.startsWith('PROMO_') && i.discount_reason !== 'PROMOCION_INSTAGRAM_15').reduce((s, i) => s + (i.discount_amount || 0), 0).toFixed(2)}</span>
              </div>
            )}
            {hasInstagramApplied && (
              <div className="flex justify-between items-center mb-1 text-xs">
                <span className="text-pink-300">Desc. Instagram 15%</span>
                <span className="text-pink-300">-${cart.filter(i => i.discount_reason === 'PROMOCION_INSTAGRAM_15').reduce((s, i) => s + (i.discount_amount || 0), 0).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center mb-3">
                <span className="text-cc-text-muted">Total a Pagar</span>
                <span className="text-3xl font-bold text-cc-primary">${cartTotal.toFixed(2)}</span>
            </div>

            {/* Instagram Promo Button */}
            <div className="mb-4">
              <button
                onClick={toggleInstagramPromo}
                disabled={cart.length === 0 || (!instagramPromoActive && instagramBlocked)}
                className={`w-full py-2.5 px-4 rounded-lg border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  instagramPromoActive
                    ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-pink-500/50 text-pink-300 shadow-lg shadow-pink-500/10'
                    : cart.length === 0 || instagramBlocked
                      ? 'bg-white/5 border-white/5 text-cc-text-muted/50 cursor-not-allowed opacity-50'
                      : 'bg-white/5 border-white/10 text-cc-text-main hover:bg-pink-500/10 hover:border-pink-500/30 hover:text-pink-300'
                }`}
              >
                <Sparkles size={16} />
                {instagramPromoActive ? '✓ Promoción Instagram activa' : 'Promoción Instagram'}
              </button>
              {instagramPromoActive && instagramDiscountInfo && (
                <div className="mt-1.5 flex justify-between items-center text-xs px-1">
                  <span className="text-pink-300/80">15% en {instagramDiscountInfo.itemName}</span>
                  <span className="text-pink-300 font-semibold">-${instagramDiscountInfo.discountAmount.toFixed(2)}</span>
                </div>
              )}
              {!instagramPromoActive && instagramBlocked && cart.length > 0 && (
                <p className="text-xs text-cc-text-muted mt-1 px-1">No combinable con otras promos/fidelidad</p>
              )}
            </div>

            {/* Payment inputs */}
            {!cashRegisterOpen && !cashLoading && (
              <div className="text-center py-2 mb-2">
                <p className="text-xs text-red-400 font-medium">Abre una caja para cobrar</p>
              </div>
            )}
            <div className="space-y-3">
              {/* Cash + Card inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-cc-text-muted mb-1.5">
                    <Banknote size={12} className="text-cc-primary" /> Efectivo
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted font-semibold">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashInput || ''}
                      onChange={(e) => setCashInput(parseFloat(e.target.value) || 0)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-lg font-bold text-cc-cream focus:ring-2 focus:ring-cc-primary outline-none text-right"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-cc-text-muted mb-1.5">
                    <CreditCard size={12} className="text-cc-accent" /> Tarjeta
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-text-muted font-semibold">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cardInput || ''}
                      onChange={(e) => setCardInput(parseFloat(e.target.value) || 0)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg pl-7 pr-3 py-2.5 text-lg font-bold text-cc-cream focus:ring-2 focus:ring-cc-accent outline-none text-right"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              {/* Quick amount buttons (apply to cash) */}
              <div className="grid grid-cols-5 gap-1.5">
                {[50, 100, 200, 500, 1000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setCashInput(amount)}
                    className={`py-1.5 px-1 text-xs font-bold rounded-md border transition-all ${
                      cashInput === amount
                        ? 'bg-cc-primary/20 border-cc-primary text-cc-primary'
                        : 'bg-white/5 border-white/10 text-cc-text-muted hover:bg-white/10 hover:text-cc-text-main'
                    }`}
                  >
                    ${amount}
                  </button>
                ))}
              </div>

              {/* Quick: pay full with one method */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setCashInput(cartTotal); setCardInput(0); }}
                  disabled={cart.length === 0}
                  className="py-1.5 text-[10px] font-bold rounded-md border bg-white/5 border-white/10 text-cc-text-muted hover:bg-cc-primary/15 hover:text-cc-primary hover:border-cc-primary/30 transition-all disabled:opacity-30"
                >
                  Todo efectivo
                </button>
                <button
                  onClick={() => { setCardInput(cartTotal); setCashInput(0); }}
                  disabled={cart.length === 0}
                  className="py-1.5 text-[10px] font-bold rounded-md border bg-white/5 border-white/10 text-cc-text-muted hover:bg-cc-accent/15 hover:text-cc-accent hover:border-cc-accent/30 transition-all disabled:opacity-30"
                >
                  Todo tarjeta
                </button>
              </div>

              {/* Payment summary */}
              {(cashInput > 0 || cardInput > 0) && (
                <div className="space-y-1.5 px-3 py-2.5 bg-black/30 rounded-lg border border-white/10">
                  <div className="flex justify-between text-xs">
                    <span className="text-cc-text-muted">Capturado</span>
                    <span className="text-cc-cream font-semibold">${paymentTotal.toFixed(2)}</span>
                  </div>
                  {paymentRemaining > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-red-400 font-medium">Faltan</span>
                      <span className="text-red-400 font-bold">${paymentRemaining.toFixed(2)}</span>
                    </div>
                  )}
                  {changeAmount > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-green-400 font-medium">Cambio</span>
                      <span className="text-green-400 font-bold">${changeAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {cashInput > 0 && cardInput > 0 && (
                    <div className="flex justify-between text-xs pt-1 border-t border-white/5">
                      <span className="text-cc-text-muted">Método</span>
                      <span className="text-cc-accent font-semibold">Mixto</span>
                    </div>
                  )}
                </div>
              )}

              {/* Confirm button */}
              <button
                onClick={() => handleCheckout()}
                disabled={processing || !isPaymentSufficient || cart.length === 0 || !cashRegisterOpen}
                className="w-full py-3 bg-cc-primary hover:bg-cc-primary/90 text-cc-bg rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {processing ? (
                  <><span className="animate-spin">⏳</span> Procesando…</>
                ) : (
                  <><ShoppingBag size={16} /> Cobrar ${cartTotal.toFixed(2)}</>
                )}
              </button>
            </div>
        </div>
      </div>

      {/* New Customer Modal */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowNewCustomerModal(false)}>
          <div className="bg-cc-surface border border-white/10 rounded-xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-cc-cream">Nuevo Cliente</h3>
              <button onClick={() => setShowNewCustomerModal(false)} className="text-cc-text-muted hover:text-cc-text-main"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <input
                placeholder="Nombre *"
                className="w-full bg-cc-bg border border-white/10 rounded-lg py-2 px-3 text-sm text-black placeholder-gray-400 caret-black focus:ring-1 focus:ring-cc-primary outline-none"
                value={newCustForm.first_name}
                onChange={(e) => setNewCustForm(p => ({ ...p, first_name: e.target.value }))}
                autoFocus
              />
              <input
                placeholder="Apellido"
                className="w-full bg-cc-bg border border-white/10 rounded-lg py-2 px-3 text-sm text-black placeholder-gray-400 caret-black focus:ring-1 focus:ring-cc-primary outline-none"
                value={newCustForm.last_name}
                onChange={(e) => setNewCustForm(p => ({ ...p, last_name: e.target.value }))}
              />
              <input
                placeholder="Teléfono *"
                type="tel"
                className="w-full bg-cc-bg border border-white/10 rounded-lg py-2 px-3 text-sm text-black placeholder-gray-400 caret-black focus:ring-1 focus:ring-cc-primary outline-none"
                value={newCustForm.phone}
                onChange={(e) => setNewCustForm(p => ({ ...p, phone: e.target.value }))}
              />
              <button
                onClick={handleCreateCustomer}
                disabled={savingCustomer || !newCustForm.first_name.trim() || !newCustForm.phone.trim()}
                className="w-full py-2 bg-cc-primary text-cc-bg font-bold text-sm rounded-lg hover:bg-cc-primary/90 disabled:opacity-40 transition-colors"
              >
                {savingCustomer ? 'Guardando...' : 'Crear Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reward Selection Modal */}
      {showRewardModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowRewardModal(false)}>
          <div className="bg-cc-surface border border-white/10 rounded-xl p-6 w-96 shadow-2xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-cc-cream flex items-center gap-2"><Gift size={16} className="text-green-400" /> Aplicar 50% OFF</h3>
              <button onClick={() => setShowRewardModal(false)} className="text-cc-text-muted hover:text-cc-text-main"><X size={16} /></button>
            </div>
            <p className="text-xs text-cc-text-muted mb-3">Selecciona el producto que recibirá el descuento:</p>
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {cart.map(item => (
                <label
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    rewardSelectedItem === item.id ? 'bg-green-500/10 border-green-500/30' : 'bg-black/20 border-white/5 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="reward-item"
                    checked={rewardSelectedItem === item.id}
                    onChange={() => setRewardSelectedItem(item.id)}
                    className="accent-green-400"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-cc-text-main line-clamp-2">{item.product_name || item.name}</div>
                    <div className="text-xs text-cc-text-muted">{item.size} × {item.quantity}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-cc-text-muted line-through">${(item.price * item.quantity).toFixed(0)}</div>
                    <div className="text-sm font-bold text-green-400">${(item.price * item.quantity * 0.5).toFixed(0)}</div>
                  </div>
                </label>
              ))}
            </div>
            <button
              onClick={applyReward}
              disabled={!rewardSelectedItem}
              className="w-full py-2.5 bg-green-500/20 text-green-400 font-bold text-sm rounded-lg hover:bg-green-500/30 disabled:opacity-40 border border-green-500/30 transition-colors"
            >
              Confirmar Descuento
            </button>
          </div>
        </div>
      )}

      {/* Open Cash Register Modal */}
      {showOpenCashModal && (
        <OpenCashRegisterModal
          onClose={() => setShowOpenCashModal(false)}
          onSuccess={() => {
            setShowOpenCashModal(false);
            loadCashStatus();
          }}
        />
      )}

      {/* Withdrawal Modal */}
      {showWithdrawalModal && cashStatus.session_id && (
        <WithdrawalModal
          sessionId={cashStatus.session_id}
          currentCash={cashStatus.current_cash}
          onClose={() => setShowWithdrawalModal(false)}
          onSuccess={() => {
            setShowWithdrawalModal(false);
            loadCashStatus();
          }}
        />
      )}

      {/* Close Cash Register Modal */}
      {showCloseCashModal && cashStatus.session_id && (
        <CloseCashRegisterModal
          status={cashStatus}
          onClose={() => setShowCloseCashModal(false)}
          onSuccess={() => {
            setShowCloseCashModal(false);
            loadCashStatus();
          }}
        />
      )}

      {/* Customers List Modal */}
      {showCustomersList && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowCustomersList(false)}>
          <div className="bg-cc-surface border border-white/10 rounded-xl p-5 w-[28rem] shadow-2xl max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-cc-cream flex items-center gap-2"><Users size={16} className="text-cc-primary" /> Clientes</h3>
              <button onClick={() => setShowCustomersList(false)} className="text-cc-text-muted hover:text-cc-text-main"><X size={16} /></button>
            </div>
            <div className="relative mb-3">
              <input
                type="text"
                placeholder="Buscar por nombre o tel\u00e9fono..."
                className="w-full bg-cc-bg border border-white/10 rounded-lg py-1.5 pl-8 pr-3 text-sm text-black placeholder-gray-400 caret-black focus:ring-1 focus:ring-cc-primary outline-none"
                value={customersListFilter}
                onChange={(e) => setCustomersListFilter(e.target.value)}
                autoFocus
              />
              <Search size={13} className="absolute left-2.5 top-2 text-cc-text-muted" />
            </div>
            {customersListError && (
              <div className="bg-red-500/15 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2 mb-3">
                No se pudieron cargar clientes: {customersListError}
              </div>
            )}
            <div className="flex-1 overflow-y-auto min-h-0">
              {customersListLoading ? (
                <div className="text-center text-cc-text-muted text-sm py-10">Cargando...</div>
              ) : filteredCustomersList.length === 0 ? (
                <div className="text-center text-cc-text-muted text-sm py-10">Sin resultados</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-cc-text-muted border-b border-white/10">
                      <th className="text-left py-1.5 font-medium">Nombre</th>
                      <th className="text-left py-1.5 font-medium">Teléfono</th>
                      <th className="text-center py-1.5 font-medium">Stamps</th>
                      <th className="text-center py-1.5 font-medium">Reward</th>
                      <th className="py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomersList.map(c => (
                      <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2 text-cc-text-main">{c.first_name} {c.last_name}</td>
                        <td className="py-2 text-cc-text-muted">{c.phone}</td>
                        <td className="py-2 text-center">
                          {c.reward_available
                            ? <span className="font-bold text-green-400">3/3 ✓</span>
                            : <span><span className="font-bold text-cc-primary">{c.stamps}</span>/3</span>}
                        </td>
                        <td className="py-2 text-center">
                          {c.reward_available
                            ? <span className="text-green-400 font-bold">Sí</span>
                            : <span className="text-cc-text-muted">No</span>}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleSelectFromList(c)}
                            className="text-[10px] font-bold bg-cc-primary/20 text-cc-primary px-2 py-0.5 rounded hover:bg-cc-primary/30 transition-colors"
                          >
                            Elegir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};