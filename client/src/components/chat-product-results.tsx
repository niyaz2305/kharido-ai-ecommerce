export type ChatProduct = {
  product_id: string;
  product_name: string;
  product_description?: string;
  category: string;
  brand?: string;
  pack_size_or_quantity?: string;
  mrp?: number;
  selling_price: number;
  discount_percent?: number;
  seller?: string;
  availability?: string;
  asin?: string;
  image_url?: string;
};

type ChatProductResultsProps = {
  products: ChatProduct[];
};

const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='300' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='300' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='16'%3ENo image%3C/text%3E%3C/svg%3E";

function formatCategory(category: string) {
  if (!category) return 'Other';
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChatProductResults({
  products,
}: ChatProductResultsProps) {
  if (products.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="mb-3">
        <p className="text-sm font-black text-slate-900">
          Products
        </p>

        <p className="text-xs text-slate-500">
          {products.length} products found — tell me the product
          number if you want to add one to your cart.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((product, index) => {
          const hasDiscount = (product.discount_percent ?? 0) > 0;

          return (
            <article
              key={product.product_id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex gap-3 p-3">
                <div className="relative shrink-0">
                  <img
                    src={product.image_url || FALLBACK_IMAGE}
                    alt={product.product_name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
                    }}
                    className="h-24 w-24 rounded-xl object-cover"
                    loading="lazy"
                  />

                  <span className="absolute -left-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#ff6b00] text-xs font-black text-white shadow">
                    {index + 1}
                  </span>

                  {hasDiscount && (
                    <span className="absolute -bottom-1 left-1 rounded-full bg-green-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow">
                      {Math.round(product.discount_percent!)}% OFF
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Product {index + 1}
                    {product.brand ? ` · ${product.brand}` : ''}
                  </p>

                  <h3 className="mt-1 line-clamp-2 text-sm font-black text-slate-900">
                    {product.product_name || formatCategory(product.category)}
                  </h3>

                  <div className="mt-2 flex items-baseline gap-2">
                    <p className="text-lg font-black text-slate-950">
                      ₹{product.selling_price.toFixed(2)}
                    </p>

                    {hasDiscount &&
                      product.mrp !== undefined &&
                      product.mrp > product.selling_price && (
                        <p className="text-xs text-slate-400 line-through">
                          ₹{product.mrp.toFixed(2)}
                        </p>
                      )}
                  </div>

                  {product.category && (
                    <p className="mt-1 truncate text-[10px] text-slate-500">
                      {formatCategory(product.category)}
                    </p>
                  )}
                </div>
              </div>

              <div className="px-3 pb-3">
                <div className="mt-2 rounded-xl bg-orange-50 px-3 py-2 text-center text-[11px] font-bold text-orange-700">
                  Say "add product {index + 1}" to select this product
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
