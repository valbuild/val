/*
 * NOTE: no `import "client-only"`.
 *
 * That package is a Next.js build-time guard implemented with an export
 * condition webpack sets; Vite does not set it, so importing it here would only
 * add a dependency that does nothing. What keeps this entry off the server is
 * that its hooks read React context — a server function calling one gets an
 * error saying so, which is the same lesson a bit later.
 */
export { initValClient } from "./initValClient";
