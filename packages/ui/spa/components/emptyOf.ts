import {
  SerializedSchema,
  Json,
  VAL_EXTENSION,
  RichTextSource,
  AnyRichTextOptions,
  FileSource,
  ImageSource,
} from "@valbuild/core";

export function emptyOf(schema: SerializedSchema): Json {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.keys(schema.items).map((key) => [key, emptyOf(schema.items[key])])
    );
  } else if (schema.type === "array") {
    return [];
  } else if (schema.type === "record") {
    return {};
  } else if (schema.opt) {
    return null;
  } else if (schema.type === "richtext") {
    return {
      [VAL_EXTENSION]: "richtext",
      templateStrings: [""],
      exprs: [],
    } satisfies RichTextSource<AnyRichTextOptions>;
  } else if (schema.type === "string") {
    return "";
  } else if (schema.type === "boolean") {
    return false;
  } else if (schema.type === "number") {
    return 0;
  } else if (schema.type === "keyOf") {
    if (schema.values === "number") {
      return 0; // TODO: figure out this: user code might very well fail in this case
    } else if (schema.values === "string") {
      return ""; // TODO: figure out this: user code might very well fail in this case
    } else {
      return schema.values[0];
    }
  } else if (schema.type === "file") {
    return {
      _ref: "/public/",
      _type: "file",
      metadata: {
        sha256: "",
      },
    } satisfies FileSource;
  } else if (schema.type === "image") {
    return {
      _ref: "/public/",
      _type: "file",
      metadata: {
        height: 0,
        width: 0,
        mimeType: "application/octet-stream",
        sha256: "",
      },
    } satisfies ImageSource;
  } else if (schema.type === "literal") {
    return schema.value;
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      return {
        [schema.key]:
          schema.items[0].type === "literal" ? schema.items[0].value : "",
      };
    }
    return emptyOf(schema.items[0]);
  }
  const _exhaustiveCheck: never = schema;
  throw Error("Unexpected schema type: " + JSON.stringify(_exhaustiveCheck));
}
