import { motion } from "framer-motion";
import { ShoppingCart, Tag } from "lucide-react";

export interface KharidoProduct {
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
}

interface KharidoProductCardProps {
  product: KharidoProduct;
  onAddToCart?: (product: KharidoProduct) => void;
}

const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8,%3Csvg width='300' height='300' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='300' height='300' fill='%23f1f5f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='16'%3ENo image%3C/text%3E%3C/svg%3E";

export function KharidoProductCard({
  product,
  onAddToCart,
}: KharidoProductCardProps) {
  const hasDiscount = (product.discount_percent ?? 0) > 0;
  const inStock = (product.availability ?? "IN_STOCK").toUpperCase() === "IN_STOCK";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={{ y: -6 }}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-200 hover:shadow-lg"
    >
      {/* Product Image */}
      <div className="relative aspect-square overflow-hidden bg-slate-50">
        <motion.img
          src={product.image_url || FALLBACK_IMAGE}
          alt={product.product_name}
          onError={(e) => {
            (e.target as HTMLImageElement).src = FALLBACK_IMAGE;
          }}
          className="h-full w-full object-cover"
          whileHover={{ scale: 1.07 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />

        {/* Discount ribbon */}
        {hasDiscount && (
          <div className="absolute left-0 top-3 flex items-center gap-1 rounded-r-full bg-[#ff6b00] py-1 pl-3 pr-3 text-xs font-black text-white shadow-sm">
            <Tag className="h-3 w-3" />
            {Math.round(product.discount_percent!)}% OFF
          </div>
        )}

        {/* Brand */}
        {product.brand && (
          <div className="absolute right-3 top-3 max-w-[55%] truncate rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm">
            {product.brand}
          </div>
        )}

        {!inStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
              Out of stock
            </span>
          </div>
        )}
      </div>

      {/* Product Information */}
      <div className="space-y-3 p-4">
        <div>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-slate-900">
            {product.product_name}
          </h3>

          {product.pack_size_or_quantity && product.pack_size_or_quantity !== "NA" && (
            <p className="mt-1 text-xs text-slate-400">
              {product.pack_size_or_quantity}
            </p>
          )}
        </div>

        {/* Price */}
        <div className="flex items-end gap-2">
          <p className="text-xl font-bold text-slate-950">
            ₹{product.selling_price.toFixed(0)}
          </p>

          {hasDiscount && product.mrp > product.selling_price && (
            <p className="pb-0.5 text-xs text-slate-400 line-through">
              ₹{product.mrp.toFixed(0)}
            </p>
          )}
        </div>

        {/* Add to Cart */}
        <motion.button
          type="button"
          onClick={() => onAddToCart?.(product)}
          disabled={!inStock}
          whileTap={{ scale: 0.95 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShoppingCart className="h-4 w-4" />
          {inStock ? "Add to Cart" : "Out of stock"}
        </motion.button>
      </div>
    </motion.div>
  );
}
