import { fetchValKeys, fetchValEntries } from "../../val/rsc";
import productsVal from "../../content/products.val";

/**
 * A page over content that lives in a database.
 *
 * `force-dynamic` is the point of the example as much as the adapter is. The
 * store's content changes on its own clock — the repository's is committed,
 * built and deployed; the store's is live — so this page must not be
 * prerendered. It is also what makes `next build` green against a database that
 * does not exist yet: the build never reads the store.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  // Two calls, not one per row: `fetchValKeys` pages the store and
  // `fetchValEntries` reads a whole page in one round trip — and, because the
  // adapter declares an `around`, in one transaction.
  const page = await fetchValKeys(productsVal, {
    cursor: cursor ?? null,
    limit: PAGE_SIZE,
  });
  const entries = await fetchValEntries(productsVal, page.keys);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Products</h1>
      <p>
        {page.total === undefined
          ? // Not asked for on this page: `fetchValKeys` counts on the first page
            // only, because a store with no `count` is counted by walking its
            // keys. Saying nothing is right; saying "unavailable" would blame
            // the adapter for a question nobody asked.
            null
          : page.total === "unavailable"
            ? // The adapter declined to count. NOT zero — rendering it as zero
              // would claim an empty store.
              "Product count unavailable"
            : // `exact: false` means Val counted as far as it was willing to
              // walk. A flat number there would be a lie about a big store.
              `${page.total.count}${page.total.exact ? "" : "+"} products`}
      </p>
      <ul>
        {page.keys.map((key) => {
          const product = entries[key];
          if (!product) {
            // A key the store listed but could not return: reported, not
            // silently skipped, because the two mean different things.
            return <li key={key}>{key} — could not be loaded</li>;
          }
          return (
            <li key={key}>
              <strong>{product.title}</strong> — {product.description} (
              {(product.price / 100).toFixed(2)}
              {product.inStock ? "" : ", out of stock"})
            </li>
          );
        })}
      </ul>
      {page.cursor !== null && (
        <a href={`/products?cursor=${encodeURIComponent(page.cursor)}`}>
          Next page
        </a>
      )}
    </main>
  );
}
