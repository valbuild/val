import { useEffect } from "react";

/**
 * Loads the Studio's ES module bundle.
 *
 * `next/script` in the Next package; here it is a `<script>` appended to the
 * head, because TanStack Start has no script component and React 19's own
 * script hoisting does not cover `type="module"` — it dedupes `<script async
 * src>` only, and a module script rendered into the tree would be re-inserted
 * on every remount.
 *
 * Deduped by `src` against the document, so the overlay and the studio page
 * can both ask for the same bundle (and a remount can ask again) without
 * loading it twice. Never removed on unmount: the bundle has registered custom
 * elements and event listeners by then, and re-running it is not free.
 */
export function ValScript({ src }: { src: string }) {
  useEffect(() => {
    const existing = document.querySelector(
      `script[data-val-script="${CSS.escape(src)}"]`,
    );
    if (existing) {
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.crossOrigin = "anonymous";
    script.src = src;
    script.dataset["valScript"] = src;
    document.head.appendChild(script);
  }, [src]);
  return null;
}
