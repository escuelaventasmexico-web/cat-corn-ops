/**
 * Catálogo de productos para comodato
 * Define variantes permitidas, tamaños y precios automáticos
 */

export interface ComodatoProduct {
  product_name: string;
  allowed_variants: string[];
  size: string;
  prices: Record<string, number>;
}

export const COMODATO_PRODUCTS: ComodatoProduct[] = [
  {
    product_name: 'Michi',
    allowed_variants: ['Clásico', 'Sabores'],
    size: '90 gr',
    prices: {
      'Clásico': 30,
      'Sabores': 30,
    },
  },
  {
    product_name: 'Gato Mayor',
    allowed_variants: ['Clásico', 'Sabores'],
    size: '180 gr',
    prices: {
      'Clásico': 50,
      'Sabores': 50,
    },
  },
  {
    product_name: 'Jefe Felino',
    allowed_variants: ['Clásico', 'Sabores'],
    size: '240 gr',
    prices: {
      'Clásico': 70,
      'Sabores': 70,
    },
  },
  {
    product_name: 'Caramelo Michi',
    allowed_variants: ['Caramelo'],
    size: '90 gr',
    prices: {
      'Caramelo': 40,
    },
  },
  {
    product_name: 'Caramelo Gato Mayor',
    allowed_variants: ['Caramelo'],
    size: '180 gr',
    prices: {
      'Caramelo': 80,
    },
  },
];

/**
 * Obtener producto por nombre
 */
export const getComodatoProduct = (productName: string): ComodatoProduct | undefined =>
  COMODATO_PRODUCTS.find(p => p.product_name === productName);

/**
 * Obtener variantes permitidas para un producto
 */
export const getAllowedVariants = (productName: string): string[] =>
  getComodatoProduct(productName)?.allowed_variants ?? [];

/**
 * Obtener tamaño automático para un producto
 */
export const getProductSize = (productName: string): string | null =>
  getComodatoProduct(productName)?.size ?? null;

/**
 * Obtener precio automático para producto + variante
 */
export const getProductPrice = (productName: string, variant: string): number | null => {
  const product = getComodatoProduct(productName);
  if (!product) return null;
  return product.prices[variant] ?? null;
};

/**
 * Validar si una combinación producto + variante es válida
 */
export const isValidProductVariant = (productName: string, variant: string): boolean => {
  const product = getComodatoProduct(productName);
  return product ? product.allowed_variants.includes(variant) : false;
};

/**
 * Obtener lista de nombres de productos para el catálogo
 */
export const getProductNames = (): string[] =>
  COMODATO_PRODUCTS.map(p => p.product_name);
