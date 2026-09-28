import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

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

type PaymentMethod = 'credit_card' | 'debit_card' | 'net_banking' | 'cod';

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'credit_card', label: 'Credit Card', icon: '💳' },
  { id: 'debit_card', label: 'Debit Card', icon: '💳' },
  { id: 'net_banking', label: 'Net Banking', icon: '🏦' },
  { id: 'cod', label: 'Cash on Delivery', icon: '💵' },
];

type PaymentResult = {
  status: string;
  amount: number;
  payment_type: string;
  txn_id: string;
  processed_at: string;
};

export default function CheckoutPaymentPage() {
  const navigate = useNavigate();

  const [cart, setCart] = useState<CartState | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [upiId, setUpiId] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  useEffect(() => {
    fetch('/api/checkout/cart')
      .then((r) => r.json())
      .then(setCart)
      .finally(() => setLoading(false));
  }, []);

  function detailsValid() {
    if (method === 'credit_card' || method === 'debit_card') {
      return cardNumber.trim().length >= 8 && cardExpiry.trim().length >= 4;
    }
    if (method === 'net_banking') {
      return upiId.trim().length >= 3;
    }
    return method === 'cod';
  }

  async function handlePay() {
    if (!cart?.cart_id || !method) return;

    setPaying(true);
    setError('');

    try {
      const res = await fetch('/api/checkout/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cart.cart_id, payment_type: method }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Payment failed');

      setPaymentResult(data);
    } catch (err: any) {
      setError(err.message || 'Payment could not be completed.');
    } finally {
      setPaying(false);
    }
  }

  async function handleCreateOrder() {
    if (!cart?.cart_id) return;

    setCreatingOrder(true);
    setError('');

    try {
      const res = await fetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cart.cart_id }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to create order');

      navigate(`/orders/${data.order_id}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setCreatingOrder(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9]">
        <div className="text-sm font-semibold text-slate-400">Loading payment...</div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f9] text-center">
        <h2 className="text-xl font-black text-slate-900">Nothing to pay for yet</h2>
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
            onClick={() => navigate('/checkout/address')}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-lg"
          >
            ←
          </button>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">
              Step 2 of 2
            </p>
            <h1 className="text-lg font-black text-slate-950">Payment</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pt-6 lg:px-8">
        <AnimatePresence mode="wait">
          {!paymentResult ? (
            <motion.div
              key="pay-form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-5"
            >
              {/* Order summary */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">
                  Confirmed Items
                </h2>
                <div className="space-y-2">
                  {cart.items.map((item) => (
                    <div key={item.product_id} className="flex items-center gap-3">
                      {item.image_url && (
                        <img
                          src={item.image_url}
                          alt={item.product_name}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      )}
                      <div className="flex-1">
                        <p className="line-clamp-1 text-sm font-semibold text-slate-800">
                          {item.product_name}
                        </p>
                        <p className="text-xs text-slate-400">Qty: {item.quantity}</p>
                      </div>
                      <span className="text-sm font-bold text-slate-900">
                        ₹{(item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                {cart.delivery_address && (
                  <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Delivering to: <span className="font-semibold text-slate-700">{cart.delivery_address}</span>
                  </div>
                )}

                <div className="mt-3 flex justify-between border-t border-slate-100 pt-3">
                  <span className="font-black text-slate-900">Total Amount</span>
                  <span className="text-xl font-black text-[#ff6b00]">₹{cart.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Payment method */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-black uppercase tracking-wide text-slate-400">
                  Choose Payment Method
                </h2>

                <div className="grid grid-cols-2 gap-3">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id)}
                      className={`flex items-center gap-2 rounded-xl border-2 px-4 py-3.5 text-left text-sm font-bold transition ${
                        method === m.id
                          ? 'border-[#ff6b00] bg-orange-50 text-orange-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-lg">{m.icon}</span>
                      {m.label}
                    </button>
                  ))}
                </div>

                <AnimatePresence>
                  {(method === 'credit_card' || method === 'debit_card') && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 space-y-3 overflow-hidden"
                    >
                      <input
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="Card Number (demo only, not stored)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                      />
                      <input
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="Expiry (MM/YY)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                      />
                    </motion.div>
                  )}

                  {method === 'net_banking' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 overflow-hidden"
                    >
                      <input
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        placeholder="UPI ID (e.g. name@bank)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                      />
                    </motion.div>
                  )}

                  {method === 'cod' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 overflow-hidden rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500"
                    >
                      No advance payment needed — pay when your order arrives.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {error && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handlePay}
                disabled={!method || !detailsValid() || paying}
                className="w-full rounded-xl bg-[#ff6b00] px-6 py-4 text-sm font-black text-white shadow-lg shadow-orange-900/20 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {paying ? 'Processing payment...' : `Pay ₹${cart.total.toFixed(2)}`}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="pay-success"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-green-200 bg-white p-6 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600"
              >
                ✓
              </motion.div>

              <h2 className="mt-4 text-xl font-black text-slate-950">Payment Successful!</h2>
              <p className="mt-1 text-sm text-slate-500">Your payment has been processed.</p>

              <div className="mx-auto mt-5 max-w-sm space-y-2 rounded-xl bg-slate-50 p-4 text-left text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-bold text-slate-900">₹{paymentResult.amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Method</span>
                  <span className="font-bold text-slate-900">
                    {paymentResult.payment_type.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transaction ID</span>
                  <span className="font-mono text-xs font-bold text-slate-900">{paymentResult.txn_id}</span>
                </div>
              </div>

              {error && (
                <div className="mx-auto mt-4 max-w-sm rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleCreateOrder}
                disabled={creatingOrder}
                className="mx-auto mt-6 w-full max-w-sm rounded-xl bg-slate-950 px-6 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {creatingOrder ? 'Placing order...' : 'Create Order'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
