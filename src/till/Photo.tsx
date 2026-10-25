import type { Product } from "./types";

// Placeholder colour per category until each product has a real photo.
const TINTS: Record<string, string> = {
  "Salad Greens": "#DDEFD0",
  "Cooking Greens": "#D6E8D3",
  Roots: "#FBE3CC",
  Brassica: "#D3E6D1",
  Fruiting: "#F8D5D0",
  Alliums: "#EFE9DD",
  Herbs: "#D8EBD4",
  Legume: "#E0EDD3",
  Flowers: "#F5D5E8",
};

export const tint = (category: string) => TINTS[category] ?? "#E5E8E6";

// The product's photo, or its category colour with its initial.
export function Photo({ product, className }: { product: Pick<Product, "name" | "category" | "photo">; className: string }) {
  const style = product.photo
    ? { backgroundImage: `url(${product.photo})`, backgroundColor: tint(product.category) }
    : { backgroundColor: tint(product.category) };
  return (
    <span className={`photo ${className}`} style={style} aria-hidden="true">
      {product.photo ? null : product.name.charAt(0)}
    </span>
  );
}
