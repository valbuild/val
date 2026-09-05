import type {
  SerializedObjectUnionSchema,
  SerializedStringUnionSchema,
} from "./union";
import type { SerializedSchema } from "./index";

/**
 * Does this schema store any file remotely?
 *
 * The one answer to that question. There used to be two — `hasRemoteFileSchema`
 * in the server, gating whether `/save` demands remote credentials, and
 * `findRequiredRemoteFiles` in the Studio, gating the `/remote/settings` fetch —
 * and they disagreed about `s.images({ remote: true })`: the Studio's counted a
 * remote media record, the server's did not, because a media collection
 * serializes as a `record` of metadata rather than as an image schema.
 *
 * The server's answer was the wrong one, and silently so. With it false,
 * `/save` runs `saveOrUploadFiles` in `skip-remote` mode, and that mode does not
 * merely skip the upload — it drops every remote descriptor without an error. The
 * commit then lands a remote ref with no bytes behind it: a broken image, in the
 * repository, with nothing anywhere saying why.
 *
 * ## Why it stays a walk over the SERIALIZED schema
 *
 * Both callers have a `SerializedSchema` and not a `Schema`: the server reads
 * them out of `getSchemas()`, and the Studio is handed them by `host.receive`.
 * Asking the schema classes directly would mean a method on every one of them,
 * and the two places that need the answer cannot call it.
 *
 * ## Throwing
 *
 * The `never` assignment at the end is the point of the default branch: adding a
 * schema type without teaching this function about it must not compile. The throw
 * is what happens if one arrives anyway — which for a caller reading schemas out
 * of its own process should be impossible. A caller that cannot afford to throw
 * (the Studio, whose whole UI is downstream of this) catches it; returning `false`
 * instead would reintroduce exactly the silent skip described above.
 */
export function hasRemoteFileSchema(schema: SerializedSchema): boolean {
  if (schema.type === "file" || schema.type === "image") {
    return !!schema.remote;
  } else if (schema.type === "richtext") {
    if (typeof schema.options?.img === "object") {
      return hasRemoteFileSchema(schema.options.img);
    }
    return false;
  } else if (schema.type === "array") {
    return hasRemoteFileSchema(schema.item);
  } else if (schema.type === "record") {
    /**
     * A media collection — `s.images()` / `s.files()` — is the case both of the
     * old functions were written around, and the one they disagreed on.
     *
     * It has no file or image schema inside it to find: `item` is an object of
     * width/height/mimeType/alt, and the file itself is named by the record's
     * KEY. So `remote` on the record is the only place the answer is written
     * down, and recursing into `item` can only ever say no.
     */
    if (schema.mediaType && schema.remote) {
      return true;
    }
    return hasRemoteFileSchema(schema.item);
  } else if (schema.type === "object" || schema.type === "settings") {
    // Settings holds its sections the way an object holds its keys, so looking
    // inside is the same walk. Nothing in settings takes a file today, but the
    // answer should stay right when something does.
    for (const key in schema.items) {
      const hasRemoteFile = hasRemoteFileSchema(schema.items[key]);
      if (hasRemoteFile) {
        return true;
      }
    }
    return false;
  } else if (schema.type === "union") {
    const unionStringSchema =
      typeof schema.key === "object" && schema.key.type === "literal"
        ? (schema as SerializedStringUnionSchema)
        : undefined;
    const unionObjectSchema =
      typeof schema.key === "string"
        ? (schema as SerializedObjectUnionSchema)
        : undefined;
    if (unionStringSchema) {
      // A string union's items are literals, so there is nothing to look inside.
      return false;
    }
    if (unionObjectSchema) {
      for (const item of unionObjectSchema.items) {
        const hasRemoteFile = hasRemoteFileSchema(item);
        if (hasRemoteFile) {
          return true;
        }
      }
    }
    return false;
  } else if (
    schema.type === "boolean" ||
    schema.type === "number" ||
    schema.type === "string" ||
    schema.type === "literal" ||
    schema.type === "date" ||
    schema.type === "dateTime" ||
    schema.type === "color" ||
    schema.type === "code" ||
    schema.type === "keyOf" ||
    schema.type === "route"
  ) {
    return false;
  } else {
    const exhaustiveCheck: never = schema;
    throw new Error(`Unexpected schema: ${JSON.stringify(exhaustiveCheck)}`);
  }
}
