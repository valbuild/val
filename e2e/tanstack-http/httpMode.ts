/**
 * The proxy-mode helpers. One app serves every proxy-mode spec -- the copy of
 * `examples/tanstack` in `e2e/http/config.ts` -- so the builder tab's specs use
 * exactly what `e2e/http/` does.
 */
export {
  contextAs,
  createUnsavedPatch,
  mock,
  openHttpStudio,
  sessionCookie,
  writePatch,
} from "../http/httpMode";
