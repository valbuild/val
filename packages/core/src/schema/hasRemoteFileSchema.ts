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
    if (typeof schema.options?.inline?.img === "object") {
      return hasRemoteFileSchema(schema.options.inline.img);
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
  } else if (schema.type === "object") {
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

/**
 * Does this schema hold any media at all — remote or not?
 *
 * The sibling of {@link hasRemoteFileSchema}, and the same walk minus the
 * `remote` predicate. It answers the question an external record has to ask
 * before it will accept a binding: an item schema containing media needs a
 * `putFile`/`getFile` pair, and without one that is a schema error.
 *
 * It is a walk over the SERIALIZED schema for the reasons given above, and for
 * one more that is specific to this question: the two cases most likely to be
 * missed are invisible to a value type. A media collection (`s.images()` /
 * `s.files()`) serializes as a record of metadata with no image schema inside
 * it, and a richtext inline image lives in a constructor argument. A check
 * written against the item TYPE would silently pass both — and the gallery case
 * already has a data-loss incident attached to it (see above).
 */
export function hasMediaSchema(schema: SerializedSchema): boolean {
  if (schema.type === "file" || schema.type === "image") {
    return true;
  } else if (schema.type === "richtext") {
    // `img` is `boolean | SerializedImageSchema`: `true` means inline images are
    // allowed with the DEFAULT image schema, and is just as much media as a
    // spelled-out one. `hasRemoteFileSchema` tests only for an object because a
    // default image is not remote — a different question with a different
    // answer, which is why these two walks are separate functions.
    if (schema.options?.inline?.img) {
      return true;
    }
    return false;
  } else if (schema.type === "array") {
    return hasMediaSchema(schema.item);
  } else if (schema.type === "record") {
    // A media collection names its file by the record's KEY, so there is no
    // image schema inside to find: `mediaType` is where the answer is written.
    if (schema.mediaType) {
      return true;
    }
    return hasMediaSchema(schema.item);
  } else if (schema.type === "object") {
    for (const key in schema.items) {
      if (hasMediaSchema(schema.items[key])) {
        return true;
      }
    }
    return false;
  } else if (schema.type === "union") {
    const unionObjectSchema =
      typeof schema.key === "string"
        ? (schema as SerializedObjectUnionSchema)
        : undefined;
    if (unionObjectSchema) {
      for (const item of unionObjectSchema.items) {
        if (hasMediaSchema(item)) {
          return true;
        }
      }
    }
    // A string union's items are literals, so there is nothing to look inside.
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
    // Same contract as above: adding a schema type without teaching this
    // function about it must not compile.
    const exhaustiveCheck: never = schema;
    throw new Error(`Unexpected schema: ${JSON.stringify(exhaustiveCheck)}`);
  }
}
