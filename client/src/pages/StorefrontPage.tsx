import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { KharidoProductCard } from '@/components/kharido/KharidoProductCard';
import { KharidoProductGrid } from '@/components/kharido/KharidoProductGrid';

const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='300' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='300' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='16'%3ENo image%3C/text%3E%3C/svg%3E";

type Product = KharidoProduct;

type CartItem = {
  product_id: string;
  product_name: string;
  image_url: string;
  quantity: number;
  price: number;
};

type CartState = {
  cart_id: string | null;
  status: string | null;
  items: CartItem[];
  total: number;
  delivery_address: string | null;
};

function formatCategory(category: string) {
  if (!category || category === 'All') return 'All Products';
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function productImage(url?: string) {
  return url || FALLBACK_IMAGE;
}

const EMPTY_CART: CartState = {
  cart_id: null,
  status: null,
  items: [],
  total: 0,
  delivery_address: null,
};

export default function StorefrontPage() {
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeCategory, setActiveCategory] = useState('All');
  const [searchText, setSearchText] = useState('');

  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const [cartLoading, setCartLoading] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [cartPulseKey, setCartPulseKey] = useState(0);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!Array.isArray(data)) {
          setProducts([]);
          return;
        }

        setProducts(
          data.map((p: any) => ({
            product_id: String(p.product_id ?? ''),
            product_name: String(p.product_name ?? 'Unnamed product'),
            product_description: String(p.product_description ?? ''),
            category: String(p.category ?? 'other'),
            brand: String(p.brand ?? ''),
            pack_size_or_quantity: String(p.pack_size_or_quantity ?? ''),
            mrp: Number(p.mrp ?? 0),
            selling_price: Number(p.selling_price ?? 0),
            discount_percent: Number(p.discount_percent ?? 0),
            seller: String(p.seller ?? ''),
            availability: String(p.availability ?? 'IN_STOCK'),
            asin: String(p.asin ?? ''),
            image_url: String(p.image_url ?? ''),
          })),
        );
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));

    refreshCart();
  }, []);

  async function refreshCart() {
    try {
      const res = await fetch('/api/checkout/cart');
      const data = await res.json();
      setCart(data);
    } catch {
      // keep whatever cart state we had
    }
  }

  const categories = useMemo(() => {
    const unique = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort();
    return ['All', ...unique];
  }, [products]);

  const filtered = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return products.filter((p) => {
      const categoryMatch = activeCategory === 'All' || p.category === activeCategory;
      if (!query) return categoryMatch;

      const searchableText = [p.product_id, p.product_name, p.brand, p.category]
        .join(' ')
        .toLowerCase();

      return categoryMatch && searchableText.includes(query);
    });
  }, [products, activeCategory, searchText]);

  const cartItemCount = useMemo(
    () => cart.items.reduce((total, item) => total + item.quantity, 0),
    [cart.items],
  );

  async function handleAdd(product: Product) {
    setAddingProductId(product.product_id);

    try {
      await fetch('/api/checkout/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.product_id,
          quantity: 1,
          price: product.selling_price,
        }),
      });

      await refreshCart();
      setCartPulseKey((k) => k + 1);
      setShowCart(true);
    } catch {
      // silently ignore for now - cart will just not update
    } finally {
      setAddingProductId(null);
    }
  }

  async function handleRemove(productId: string) {
    if (!cart.cart_id) return;

    setCartLoading(true);

    try {
      await fetch('/api/checkout/cart/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cart.cart_id, product_id: productId }),
      });

      await refreshCart();
    } finally {
      setCartLoading(false);
    }
  }

  function handleGoToCheckout() {
    setShowCart(false);
    navigate('/checkout/address');
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-slate-900">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-5 px-5 lg:px-8">
          <button
            type="button"
            onClick={() => {
              setActiveCategory('All');
              setSearchText('');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex shrink-0 items-center gap-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff6b00] text-xl font-black text-white shadow-sm">
              K
            </div>
            <div className="hidden sm:block">
              <div className="text-xl font-black tracking-tight text-slate-950">Kharido</div>
              <div className="-mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                Smart Commerce
              </div>
            </div>
          </button>

          <div className="flex min-w-0 flex-1">
            <div className="relative w-full">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">
                ⌕
              </span>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search products, brands and more..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-[#ff6b00] focus:bg-white focus:ring-4 focus:ring-orange-100"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/assistant')}
            className="hidden items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-bold text-orange-700 transition hover:bg-orange-100 md:flex"
          >
            <span>✦</span>
            Kharido AI
          </button>

          <button
            type="button"
            onClick={() => navigate('/orders')}
            className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 lg:flex"
          >
            My Orders
          </button>

          <button
            type="button"
            onClick={() => setShowCart(true)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl transition hover:border-orange-300 hover:bg-orange-50"
          >
            🛒
            <AnimatePresence>
              {cartItemCount > 0 && (
                <motion.span
                  key={cartPulseKey}
                  initial={{ scale: 0.6 }}
                  animate={{ scale: [1.35, 1] }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff6b00] px-1 text-[10px] font-black text-white"
                >
                  {cartItemCount}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>

        <div className="border-t border-slate-100 bg-white">
          <div className="mx-auto flex max-w-[1440px] gap-2 overflow-x-auto px-5 py-2.5 scrollbar-hide lg:px-8">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold transition-colors duration-200 ${
                  activeCategory === category
                    ? 'bg-slate-950 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-orange-50 hover:text-orange-700'
                }`}
              >
                {formatCategory(category)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 pb-20 lg:px-8">
        {/* HERO */}
        <section className="mt-6 overflow-hidden rounded-3xl bg-slate-950 shadow-xl">
          <div className="relative overflow-hidden px-7 py-12 sm:px-10 lg:px-16 lg:py-16">
            <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
            <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />

            <div className="relative max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-400/20 bg-orange-400/10 px-3 py-1.5 text-xs font-bold text-orange-300">
                ✦ AI-powered shopping
              </div>

              <h1 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
                Shop smarter.
                <br />
                <span className="text-orange-400">Buy with confidence.</span>
              </h1>

              <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                Discover products, build your cart and complete secure AI-driven purchases with
                Kharido.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
                  className="rounded-xl bg-[#ff6b00] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-500"
                >
                  Shop products
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/assistant')}
                  className="rounded-xl border border-white/15 bg-white/10 px-6 py-3.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/15"
                >
                  Ask Kharido AI
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* PRODUCTS */}
        <section id="products" className="mt-10 scroll-mt-32">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">
                Explore
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                {activeCategory === 'All' ? 'Popular products' : formatCategory(activeCategory)}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{filtered.length} products available</p>
            </div>
            <div className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200">
              Powered by Databricks
            </div>
          </div>

          {loading ? (
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="aspect-square animate-pulse bg-slate-100" />
                  <div className="space-y-3 p-4">
                    <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <div className="text-5xl">🔎</div>
              <h3 className="mt-4 text-xl font-black text-slate-900">No products found</h3>
              <button
                type="button"
                onClick={() => {
                  setSearchText('');
                  setActiveCategory('All');
                }}
                className="mt-5 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
              >
                Show all products
              </button>
            </div>
          ) : (
            <div className="mt-6">
              <KharidoProductGrid products={filtered} onAddToCart={handleAdd} />
            </div>
          )}
        </section>
      </main>

      {/* FLOATING AI BUTTON */}
      <motion.button
        type="button"
        onClick={() => navigate('/assistant')}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-3 rounded-2xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white shadow-2xl shadow-slate-900/20"
        whileHover={{ y: -4 }}
        animate={{
          boxShadow: [
            '0 0 0 0 rgba(255,107,0,0.35)',
            '0 0 0 10px rgba(255,107,0,0)',
            '0 0 0 0 rgba(255,107,0,0)',
          ],
        }}
        transition={{ boxShadow: { duration: 2.2, repeat: Infinity, ease: 'easeOut' }, y: { duration: 0.2 } }}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500">✦</span>
        <span className="hidden sm:inline">Ask Kharido AI</span>
        <span className="sm:hidden">AI</span>
      </motion.button>

      {/* CART DRAWER */}
      <AnimatePresence>
        {showCart && (
          <div className="fixed inset-0 z-50">
            <motion.button
              type="button"
              aria-label="Close cart"
              onClick={() => setShowCart(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            />

            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-orange-600">Kharido</p>
                  <h2 className="text-xl font-black text-slate-950">Your Cart</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCart(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg transition hover:bg-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {cart.items.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="text-6xl">🛒</div>
                    <h3 className="mt-5 text-xl font-black">Your cart is empty</h3>
                    <button
                      type="button"
                      onClick={() => setShowCart(false)}
                      className="mt-6 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
                    >
                      Continue shopping
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {cart.items.map((item) => (
                      <div
                        key={item.product_id}
                        className="flex gap-4 rounded-2xl border border-slate-200 p-3"
                      >
                        <img
                          src={productImage(item.image_url)}
                          alt={item.product_name}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
                          }}
                          className="h-20 w-20 shrink-0 rounded-xl object-cover"
                        />

                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-bold text-slate-900">
                            {item.product_name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Quantity: {item.quantity}</p>
                          <p className="mt-2 text-sm font-black">
                            ₹{(item.price * item.quantity).toFixed(2)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemove(item.product_id)}
                          disabled={cartLoading}
                          className="self-start rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}

                    <div className="mt-6 rounded-2xl bg-slate-50 p-5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-500">Subtotal</span>
                        <span className="text-xl font-black text-slate-950">
                          ₹{cart.total.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGoToCheckout}
                      className="w-full rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-black text-white transition hover:bg-slate-800"
                    >
                      Confirm Cart & Continue
                    </button>
                  </div>
                )}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-5 py-8 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left lg:px-8">
          <div>
            <div className="font-black text-slate-950">Kharido</div>
            <p className="mt-1 text-xs text-slate-400">AI-powered commerce with secure AP2 transactions.</p>
          </div>
          <div className="text-xs text-slate-400">Powered by Databricks</div>
        </div>
      </footer>
    </div>
  );
}
