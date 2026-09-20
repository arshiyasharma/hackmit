import type { Product, SourceResultGroup } from "@/lib/types";
import { formatDimensions, formatPriceCents } from "@/lib/types";

function ProductCard({ product }: { product: Product }) {
  const dims = formatDimensions(product);
  const retailer = product.retailer.replace(/\.com$/, "");

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-[#E6E0D8] bg-white">
      <div className="aspect-4/3 bg-[#F1ECE5]">
        {product.image_url ? (
          // External retailer / Google Shopping thumbnails; domains vary.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#776E66]">
            No image
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-xs font-medium tracking-wide text-[#C97B5F] uppercase">
          {retailer}
          {product.in_stock === true
            ? " · in stock"
            : product.in_stock === false
              ? " · out of stock"
              : ""}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-[#2A2724]">
          {product.title || "Untitled product"}
        </h3>
        <p className="text-base font-semibold text-[#2A2724]">
          {formatPriceCents(product.price_cents)}
        </p>
        {dims && (
          <p className="text-xs text-[#776E66]">
            {dims}
            {product.dimensions.estimated ? " (est.)" : ""}
          </p>
        )}
        <a
          href={product.product_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center justify-center rounded-xl bg-[#2A2724] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#3D3833]"
        >
          View product
        </a>
      </div>
    </article>
  );
}

export function ProductResults({
  groups,
  isLoading,
  emptyMessage,
}: {
  groups: SourceResultGroup[];
  isLoading?: boolean;
  emptyMessage?: string;
}) {
  if (isLoading) {
    return (
      <section className="mt-10 rounded-3xl border border-[#E6E0D8] bg-white p-6 sm:p-8">
        <p className="text-sm text-[#776E66]">
          Searching retailers and reading product dimensions…
        </p>
      </section>
    );
  }

  if (!groups.length) {
    return null;
  }

  const total = groups.reduce((n, g) => n + g.products.length, 0);
  if (total === 0) {
    return (
      <section className="mt-10 rounded-3xl border border-[#E6E0D8] bg-white p-6 sm:p-8">
        <p className="text-sm text-[#776E66]">
          {emptyMessage ??
            "No whitelist retailer matches yet. Try a different request."}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 space-y-10">
      {groups.map((group) =>
        group.products.length === 0 ? null : (
          <div key={group.searchTerm}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-[#2A2724]">
                {group.searchTerm}
              </h2>
              <p className="text-sm text-[#776E66]">
                {group.products.length} piece
                {group.products.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        )
      )}
    </section>
  );
}
