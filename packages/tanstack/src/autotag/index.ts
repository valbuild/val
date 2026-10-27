/**
 * `import "@valbuild/tanstack/autotag"`, as the FIRST import of the app's
 * `src/router.tsx`: Val's edit tags turned into `data-val-path` attributes
 * from the very first component.
 *
 * `@valbuild/tanstack` does the same when it is imported, but by then
 * `@tanstack/react-router` -- which it imports -- has been, and under
 * `vite dev` a module takes its own copy of what it imports from React when
 * it first runs. A component whose module ran before the wrapping kept
 * React's own `jsx` and `createElement`, and its text kept its edit tag:
 * on the page in development, and named by the leak warning as if the app
 * had leaked it. A production build reads React's exports when it calls
 * them, so there it makes no difference -- which is why it is safe to have
 * both.
 */
import { autoTagJSX } from "@valbuild/react/stega";

autoTagJSX();
