import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

type OrderDetail = {
  order_id: string;
  amount: number;
  status: string;
  created_at: string;
  txn_id: string;
  payment_type: string | null;
  delivery_address: string | null;
  items: {
    product_id: string;
    product_name: string;
    image_url: string;
    quantity: number;
    price: number;
  }[];
  delivery: {
    tracking_id: string;
    carrier: string;
    delivery_status: string;
    estimated_delivery_date: string;
    shipped_date: string;
  } | null;
};

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;

    fetch(`/api/checkout/orders/${orderId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setOrder(data);
      })
      .catch((err) => setError(err.message || 'Order not found'))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9]">
        <div className="text-sm font-semibold text-slate-400">Loading order...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7f9] text-center">
        <h2 className="text-xl font-black text-slate-900">{error || 'Order not found'}</h2>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
        >
          Back to store
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] pb-20">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur lg:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-lg"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => navigate('/orders')}
            className="text-sm font-bold text-orange-600 hover:underline"
          >
            View All Orders
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pt-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-green-200 bg-white p-6 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600"
          >
            🎉
          </motion.div>
          <h1 className="mt-4 text-2xl font-black text-slate-950">Order Placed Successfully!</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{order.order_id}</p>
        </motion.div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">Items</h2>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div key={item.product_id} className="flex items-center gap-3">
                {item.image_url && (
                  <img src={item.image_url} alt={item.product_name} className="h-14 w-14 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800">{item.product_name}</p>
                  <p className="text-xs text-slate-400">Qty: {item.quantity}</p>
                </div>
                <span className="text-sm font-bold text-slate-900">₹{(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">Payment</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-bold text-slate-900">₹{order.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Method</span>
                <span className="font-bold text-slate-900">
                  {(order.payment_type || '').replace('_', ' ').toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Transaction ID</span>
                <span className="font-mono text-xs font-bold text-slate-900">{order.txn_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Order Date</span>
                <span className="font-bold text-slate-900">
                  {new Date(order.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-400">Delivery</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Location</span>
                <span className="text-right font-bold text-slate-900">{order.delivery_address || '—'}</span>
              </div>
              {order.delivery && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <span className="font-bold text-green-600">{order.delivery.delivery_status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tracking ID</span>
                    <span className="font-mono text-xs font-bold text-slate-900">{order.delivery.tracking_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Est. Delivery</span>
                    <span className="font-bold text-slate-900">
                      {new Date(order.delivery.estimated_delivery_date).toLocaleDateString()}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex-1 rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Continue Shopping
          </button>
          <button
            type="button"
            onClick={() => navigate('/orders')}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            View All Orders
          </button>
        </div>
      </main>
    </div>
  );
}
