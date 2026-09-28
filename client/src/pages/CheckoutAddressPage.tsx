import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

type Address = {
  address_id: string;
  city: string;
  state: string;
  is_default: boolean;
};

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

export default function CheckoutAddressPage() {
  const navigate = useNavigate();

  const [cart, setCart] = useState<CartState | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/checkout/cart').then((r) => r.json()),
      fetch('/api/checkout/addresses').then((r) => r.json()),
    ])
      .then(([cartData, addressData]) => {
        setCart(cartData);
        setAddresses(Array.isArray(addressData) ? addressData : []);

        const defaultAddr = (addressData || []).find((a: Address) => a.is_default);
        if (defaultAddr) setSelectedAddressId(defaultAddr.address_id);
        else if (addressData?.[0]) setSelectedAddressId(addressData[0].address_id);
        else setShowAddForm(true);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleAddAddress() {
    if (!newCity.trim() || !newState.trim()) {
      setError('Please enter both city and state.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/checkout/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: newCity.trim(), state: newState.trim() }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to save address');

      setAddresses((prev) => [data, ...prev]);
      setSelectedAddressId(data.address_id);
      setNewCity('');
      setNewState('');
      setShowAddForm(false);
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (!cart?.cart_id || !selectedAddressId) return;

    setConfirming(true);
    setError('');

    try {
      const res = await fetch('/api/checkout/cart/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cart.cart_id, address_id: selectedAddressId }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to confirm cart');

      navigate('/checkout/payment');
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9]">
        <div className="text-sm font-semibold text-slate-400">Loading checkout...</div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f9] text-center">
        <div className="text-5xl">🛒</div>
        <h2 className="text-xl font-black text-slate-900">Your cart is empty</h2>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
        >
          Continue shopping
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] pb-20">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur lg:px-8">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-lg"
          >
            ←
          </button>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
              Step 1 of 2
            </p>
            <h1 className="text-lg font-black text-slate-950">Delivery Address</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pt-6 lg:px-8">
        {/* Cart summary */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">
            Order Summary
          </h2>
          <div className="space-y-2">
            {cart.items.map((item) => (
              <div key={item.product_id} className="flex justify-between text-sm">
                <span className="text-slate-700">
                  {item.product_name} × {item.quantity}
                </span>
                <span className="font-bold text-slate-900">
                  ₹{(item.price * item.quantity).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-slate-100 pt-3">
            <span className="font-black text-slate-900">Total</span>
            <span className="text-lg font-black text-slate-950">₹{cart.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Address selection */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-400">
              Choose Delivery Address
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm((s) => !s)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100 text-lg font-black text-orange-600 transition hover:bg-orange-200"
              aria-label="Add new address"
            >
              +
            </button>
          </div>

          <AnimatePresence>
            {showAddForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden rounded-xl border border-orange-200 bg-orange-50/50 p-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="City"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
                  />
                  <input
                    value={newState}
                    onChange={(e) => setNewState(e.target.value)}
                    placeholder="State"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddAddress}
                  disabled={saving}
                  className="mt-3 w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Address'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {addresses.length === 0 && !showAddForm ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No saved addresses yet. Click + to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {addresses.map((addr) => (
                <button
                  key={addr.address_id}
                  type="button"
                  onClick={() => setSelectedAddressId(addr.address_id)}
                  className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3.5 text-left transition ${
                    selectedAddressId === addr.address_id
                      ? 'border-[#ff6b00] bg-orange-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div>
                    <p className="font-bold text-slate-900">
                      {addr.city}, {addr.state}
                    </p>
                    {addr.is_default && (
                      <p className="text-[10px] font-bold uppercase text-orange-600">Default</p>
                    )}
                  </div>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      selectedAddressId === addr.address_id
                        ? 'border-[#ff6b00] bg-[#ff6b00]'
                        : 'border-slate-300'
                    }`}
                  >
                    {selectedAddressId === addr.address_id && (
                      <span className="text-[10px] text-white">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!selectedAddressId || confirming}
          className="mt-6 w-full rounded-xl bg-[#ff6b00] px-6 py-4 text-sm font-black text-white shadow-lg shadow-orange-900/20 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirming ? 'Confirming...' : 'Proceed to Payment'}
        </button>
      </main>
    </div>
  );
}
