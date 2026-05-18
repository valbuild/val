import React from "react";

/**
 * Suspends the current render until `promise` resolves.
 *
 * Uses `React.use` when available (React 19+); otherwise throws the promise
 * for classic Suspense (React 18). A `<Suspense>` boundary higher up the tree
 * is required — in the Next.js App Router, `app/loading.tsx` provides one.
 */
export function valSuspense<T>(promise: Promise<T>): T {
  if ("use" in React) {
    return React.use(promise);
  }
  throw promise;
}
