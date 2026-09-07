import { c, s } from "../val.config";

/**
 * A record whose entries live in a database.
 *
 * The whole of what makes it external is `.external("products")`. Nothing here
 * imports a driver, and nothing here knows there is one — this file is evaluated
 * by the CLI in a `node:vm` sandbox and its schema is shipped to the browser, so
 * it must stay as inert as any other `.val.ts`.
 *
 * The adapter that serves this label is registered in `val/external.ts`, which is
 * `server-only` and is where the driver lives.
 */
export default c.define(
  "/content/products.val.ts",
  s
    .record(
      s.object({
        title: s.string(),
        description: s.string(),
        /** In minor units, because money in a float is a bug waiting to happen. */
        price: s.number(),
        inStock: s.boolean(),
      }),
    )
    .external("products"),
  // Entries could be written here instead, and would compile: that is how
  // content moves INTO a store, one paste at a time. `val validate` reports each
  // one as an `external:upload` fix rather than as a type error, because a type
  // error would be a dead end — there would be nothing to write instead.
  c.external(),
);
