const CART_ID_KEY = 'kharido_cart_id';
const CUSTOMER_ID_KEY = 'kharido_customer_id';
const CART_ITEMS_KEY = 'kharido_cart_items';
const CART_PRODUCTS_KEY = 'kharido_cart_products';

export type KharidoCartItems = Record<string, number>;

export type KharidoCartProduct = {
  product_id: string;
  product_name: string;
  product_description?: string;
  category: string;
  brand?: string;
  pack_size_or_quantity?: string;
  mrp: number;
  selling_price: number;
  discount_percent?: number;
  seller?: string;
  availability?: string;
  asin?: string;
  image_url?: string;
};

export type KharidoCartProducts =
  Record<string, KharidoCartProduct>;

export function getKharidoCartId(): string | null {
  return localStorage.getItem(CART_ID_KEY);
}

export function getKharidoCustomerId(): string | null {
  return localStorage.getItem(CUSTOMER_ID_KEY);
}

export function saveKharidoCartSession(
  cartId?: string | null,
  customerId?: string | null,
) {
  if (cartId) {
    localStorage.setItem(CART_ID_KEY, cartId);
  }

  if (customerId) {
    localStorage.setItem(CUSTOMER_ID_KEY, customerId);
  }
}

export function getKharidoCartItems(): KharidoCartItems {
  try {
    const raw = localStorage.getItem(CART_ITEMS_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }

    return {};
  } catch {
    return {};
  }
}

export function saveKharidoCartItems(
  items: KharidoCartItems,
) {
  localStorage.setItem(
    CART_ITEMS_KEY,
    JSON.stringify(items),
  );
}

export function addKharidoCartItem(
  productId: string,
  quantity = 1,
) {
  const items = getKharidoCartItems();

  items[productId] =
    (items[productId] ?? 0) + quantity;

  saveKharidoCartItems(items);

  return items;
}

export function updateKharidoCartItem(
  productId: string,
  quantity: number,
) {
  const items = getKharidoCartItems();

  if (quantity <= 0) {
    delete items[productId];
  } else {
    items[productId] = quantity;
  }

  saveKharidoCartItems(items);

  return items;
}

export function getKharidoCartProducts(): KharidoCartProducts {
  try {
    const raw = localStorage.getItem(
      CART_PRODUCTS_KEY,
    );

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }

    return {};
  } catch {
    return {};
  }
}

export function saveKharidoCartProduct(
  product: KharidoCartProduct,
) {
  const products = getKharidoCartProducts();

  products[product.product_id] = product;

  localStorage.setItem(
    CART_PRODUCTS_KEY,
    JSON.stringify(products),
  );

  return products;
}

export function clearKharidoCartItems() {
  localStorage.removeItem(CART_ITEMS_KEY);
  localStorage.removeItem(CART_PRODUCTS_KEY);
}

export function clearKharidoCartSession() {
  localStorage.removeItem(CART_ID_KEY);
  localStorage.removeItem(CUSTOMER_ID_KEY);
  localStorage.removeItem(CART_ITEMS_KEY);
  localStorage.removeItem(CART_PRODUCTS_KEY);
}