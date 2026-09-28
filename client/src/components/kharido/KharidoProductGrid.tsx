import { motion } from "framer-motion";
import {
  KharidoProduct,
  KharidoProductCard,
} from "./KharidoProductCard";

interface KharidoProductGridProps {
  products: KharidoProduct[];
  onAddToCart?: (product: KharidoProduct) => void;
}

export function KharidoProductGrid({
  products,
  onAddToCart,
}: KharidoProductGridProps) {
  if (!products.length) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed">
        <p className="text-sm text-muted-foreground">
          No products found.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.045 },
        },
      }}
    >
      {products.map((product) => (
        <motion.div
          key={product.product_id}
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0 },
          }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <KharidoProductCard
            product={product}
            onAddToCart={onAddToCart}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
