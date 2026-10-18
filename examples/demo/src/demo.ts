/**
 * Whether this build is the demo: Val's API runs in the visitor's tab, nothing
 * is saved anywhere else, and the Studio opens with a tour.
 *
 * On unless the build says otherwise, because demoing is what this app is
 * for. `VITE_VAL_DEMO=false pnpm dev` makes it an ordinary Val project, which
 * is how the demo's own content is edited and committed.
 */
export const isDemo = import.meta.env.VITE_VAL_DEMO !== "false";
