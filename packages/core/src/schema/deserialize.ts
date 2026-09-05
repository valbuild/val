import { SerializedSchema, Schema } from ".";
import { SelectorSource } from "../selector";
import { ImageSource } from "../source/media";
import { RichTextOptions } from "../source/richtext";
import { SourcePath } from "../val";
import { ArraySchema } from "./array";
import { BooleanSchema } from "./boolean";
import { CodeSchema } from "./code";
import { ColorSchema } from "./color";
import { DateSchema } from "./date";
import { DateTimeSchema } from "./datetime";
import { FileSchema } from "./file";
import { ImageSchema } from "./image";
import { KeyOfSchema } from "./keyOf";
import { LiteralSchema } from "./literal";
import { NumberSchema } from "./number";
import { ObjectSchema } from "./object";
import { RecordSchema } from "./record";
import { RichTextSchema } from "./richtext";
import { LocaleSchema } from "./locale";
import { RouteSchema } from "./route";
import { SettingsSchema } from "./settings";
import { StringSchema } from "./string";
import { UnionSchema } from "./union";

export function deserializeSchema(
  serialized: SerializedSchema,
): Schema<SelectorSource> {
  let schema = deserializeSchemaImpl(serialized);
  if (serialized.readonly) {
    schema = schema.readonly();
  }
  if (serialized.hidden) {
    schema = schema.hidden();
  }
  return schema;
}

function deserializeSchemaImpl(
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
          regExpMessage: serialized.options?.regexp?.message,
        },
        serialized.opt,
        serialized.raw,
        [],
        // A render is static data, so it survives serialization and must be
        // carried back: it is the schema's own configuration now, not something
        // recomputed from an instance.
        serialized.render ?? null,
        false,
        false,
        serialized.description,
        null,
        serialized.multiline ?? false,
      );
    case "literal":
      return new LiteralSchema(
        serialized.value,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "boolean":
      return new BooleanSchema(
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "number":
      return new NumberSchema(
        serialized.options,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "object":
      return new ObjectSchema(
        Object.fromEntries(
          Object.entries(serialized.items).map(([key, item]) => {
            return [key, deserializeSchema(item)];
          }),
        ),
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "settings":
      return new SettingsSchema(
        Object.fromEntries(
          Object.entries(serialized.items).map(([key, item]) => {
            return [key, deserializeSchema(item)];
          }),
        ),
        serialized.opt,
        false,
        false,
        serialized.description,
      );
    case "array":
      return new ArraySchema(
        deserializeSchema(serialized.item),
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        // The preview closure cannot survive serialization; the render can.
        null,
        serialized.render ?? null,
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
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "richtext": {
      const deserializedOptions: RichTextOptions & {
        maxLength?: number;
        minLength?: number;
      } = {
        ...(serialized.options || {}),
        a:
          typeof serialized.options?.a === "object"
            ? (deserializeSchema(serialized.options.a) as
                | RouteSchema<string>
                | StringSchema<string>)
            : serialized.options?.a,
        img:
          typeof serialized.options?.img === "object"
            ? (deserializeSchema(
                serialized.options.img,
              ) as ImageSchema<ImageSource>)
            : serialized.options?.img,
      };
      return new RichTextSchema(
        deserializedOptions,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    }
    case "record":
      return new RecordSchema(
        deserializeSchema(serialized.item),
        serialized.opt,
        [],
        null,
        serialized.key
          ? (deserializeSchema(serialized.key) as Schema<string>)
          : null,
        serialized.mediaType
          ? {
              type: serialized.mediaType,
              accept: serialized.accept ?? "*/*",
              directory: serialized.directory ?? "/public/val",
              remote: serialized.remote ?? false,
              altSchema: serialized.alt
                ? deserializeSchema(serialized.alt)
                : undefined,
            }
          : undefined,
        false,
        false,
        serialized.description,
        serialized.jsonValues ?? false,
        // The preview closure cannot survive serialization; the render can.
        null,
        serialized.render ?? null,
      );
    case "keyOf":
      return new KeyOfSchema(
        serialized.schema,
        serialized.path as SourcePath,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "locale": {
      return new LocaleSchema(
        serialized.aliases,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    }
    case "route": {
      const routeOptions = serialized.options
        ? {
            include: serialized.options.include
              ? new RegExp(
                  serialized.options.include.source,
                  serialized.options.include.flags,
                )
              : undefined,
            exclude: serialized.options.exclude
              ? new RegExp(
                  serialized.options.exclude.source,
                  serialized.options.exclude.flags,
                )
              : undefined,
          }
        : undefined;
      return new RouteSchema(
        routeOptions,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    }
    case "file":
      return new FileSchema(
        serialized.options,
        serialized.opt,
        serialized.remote,
        [],
        {},
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "image":
      return new ImageSchema(
        serialized.options,
        serialized.opt,
        serialized.remote,
        [],
        {},
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "date":
      return new DateSchema(
        serialized.options,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "dateTime":
      return new DateTimeSchema(
        serialized.options,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "color":
      return new ColorSchema(
        serialized.options,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
    case "code":
      return new CodeSchema(
        serialized.options,
        serialized.opt,
        [],
        false,
        false,
        serialized.description,
        serialized.render ?? null,
      );
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
