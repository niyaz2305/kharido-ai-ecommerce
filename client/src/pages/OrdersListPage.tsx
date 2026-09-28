import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

type Order = {
  order_id: string;
  amount: number;
  status: string;
  created_at: string;
  cart_id: string;
};

export default function OrdersListPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/checkout/orders')
      .then((r) => r.json())
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

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
          <h1 className="text-lg font-black text-slate-950">My Orders</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pt-6 lg:px-8">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <div className="text-5xl">📦</div>
            <h2 className="text-xl font-black text-slate-900">No orders yet</h2>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
            >
              Start shopping
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order, index) => (
              <motion.button
                key={order.order_id}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/orders/${order.order_id}`)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-orange-300 hover:shadow-md"
              >
                <div>
                  <p className="font-mono text-xs font-bold text-slate-400">{order.order_id}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                  <span className="mt-2 inline-block rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold uppercase text-green-700">
                    {order.status}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-slate-950">₹{order.amount.toFixed(2)}</p>
                  <p className="text-xs font-bold text-orange-600">View details →</p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
