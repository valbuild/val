import { SerializedSchema, Schema } from ".";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { ArraySchema } from "./array";
import { BooleanSchema } from "./boolean";
import { DateSchema } from "./date";
import { FileSchema } from "./file";
import { ImageSchema } from "./image";
import { KeyOfSchema } from "./keyOf";
import { LiteralSchema } from "./literal";
import { NumberSchema } from "./number";
import { ObjectSchema } from "./object";
import { RecordSchema } from "./record";
import { RichTextSchema } from "./richtext";
import { StringSchema } from "./string";
import { UnionSchema } from "./union";

export function deserializeSchema(
  serialized: SerializedSchema,
): Schema<SelectorSource> {
  switch (serialized.type) {
    case "string":
      return new StringSchema(
        {
          ...serialized.options,
          regexp:
            serialized.options?.regexp &&
            new RegExp(
              serialized.options.regexp.source,
              serialized.options.regexp.flags,
            ),
        },
        serialized.opt,
      );
    case "literal":
      return new LiteralSchema(serialized.value, serialized.opt);
    case "boolean":
      return new BooleanSchema(serialized.opt);
    case "number":
      return new NumberSchema(serialized.options, serialized.opt);
    case "object":
      return new ObjectSchema(
        Object.fromEntries(
          Object.entries(serialized.items).map(([key, item]) => {
            return [key, deserializeSchema(item)];
          }),
        ),
        serialized.opt,
      );
    case "array":
      return new ArraySchema(
        deserializeSchema(serialized.item),
        serialized.opt,
      );
    case "union":
      return new UnionSchema(
        typeof serialized.key === "string"
          ? serialized.key
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (deserializeSchema(serialized.key) as any), // TODO: we do not really need any here - right?
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialized.items.map(deserializeSchema) as any, // TODO: we do not really need any here - right?
        serialized.opt,
      );
    case "richtext":
      return new RichTextSchema(serialized.options || {}, serialized.opt);
    case "record":
      return new RecordSchema(
        deserializeSchema(serialized.item),
        serialized.opt,
      );
    case "keyOf":
      return new KeyOfSchema(
        serialized.schema,
        serialized.path as SourcePath,
        serialized.opt,
      );
    case "file":
      return new FileSchema(serialized.options, serialized.opt);
    case "image":
      return new ImageSchema(serialized.options, serialized.opt);
    case "date":
      return new DateSchema(serialized.options);
    default: {
      const exhaustiveCheck: never = serialized;
      const unknownSerialized: unknown = exhaustiveCheck;
      if (
        unknownSerialized &&
        typeof unknownSerialized === "object" &&
        "type" in unknownSerialized
      ) {
        throw new Error(`Unknown schema type: ${unknownSerialized.type}`);
      } else {
        throw new Error(
          `Unknown schema: ${JSON.stringify(unknownSerialized, null, 2)}`,
        );
      }
    }
  }
}
