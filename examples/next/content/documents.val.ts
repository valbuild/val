import { c, s } from "../val.config";

/**
 * A files gallery whose bytes live in a database.
 *
 * `s.files()` is a `RecordSchema` with media options, so it gets external
 * storage from the same `.external()` as any other record. What it adds is the
 * requirement that the adapter implement `putFile` and `getFile`: a gallery's
 * files are named by the record's KEY, so there is no image schema inside the
 * item to notice, and the check is made against the schema at startup instead.
 *
 * `directory` stays required. The path is virtual once the bytes are in a store,
 * but it is the file's identity — it travels inside the reference, exactly as it
 * does for a remote file — and it is what makes moving back to local storage a
 * matter of writing the bytes where the reference already says they belong.
 */
export default c.define(
  "/content/documents.val.ts",
  s
    .files({
      accept: "application/pdf,text/plain",
      directory: "/public/val/documents",
    })
    .external("documents"),
  c.external(),
);
