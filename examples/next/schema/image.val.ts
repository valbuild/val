import { s } from "../val.config";

// A shared schema, not a Val module: it is `.val.ts` because it imports `s`,
// and a NAMED export because only a module may be the default export of a
// `.val.ts` — `val validate` reports a default export that is not one.
export const defaultImage = s.image();
