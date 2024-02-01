// import { RemoteCompatibleSource, RemoteSource } from "../source/remote";
import { SelectorSource } from "../selector";
import { SourcePath } from "../val";
import { ArraySchema, SerializedArraySchema } from "./array";
import { BooleanSchema, SerializedBooleanSchema } from "./boolean";
import { FileSchema, SerializedFileSchema } from "./file";
import { ImageSchema, SerializedImageSchema } from "./image";
import { KeyOfSchema, SerializedKeyOfSchema } from "./keyOf";
import { LiteralSchema, SerializedLiteralSchema } from "./literal";
import { NumberSchema, SerializedNumberSchema } from "./number";
import { ObjectSchema, SerializedObjectSchema } from "./object";
import { RecordSchema, SerializedRecordSchema } from "./record";
import { RichTextSchema, SerializedRichTextSchema } from "./richtext";
import { SerializedStringSchema, StringSchema } from "./string";
import { SerializedUnionSchema, UnionSchema } from "./union";
import { ValidationErrors } from "./validation/ValidationError";
// import { SerializedI18nSchema } from "./future/i18n";
// import { SerializedOneOfSchema } from "./future/oneOf";

export type SerializedSchema =
  // | SerializedOneOfSchema
  // | SerializedI18nSchema
  | SerializedStringSchema
  | SerializedLiteralSchema
  | SerializedBooleanSchema
  | SerializedNumberSchema
  | SerializedObjectSchema
  | SerializedArraySchema
  | SerializedUnionSchema
  | SerializedRichTextSchema
  | SerializedRecordSchema
  | SerializedKeyOfSchema
  | SerializedFileSchema
  | SerializedImageSchema;

export abstract class Schema<Src extends SelectorSource> {
  // TODO: types
  static deserialize(serialized: SerializedSchema): Schema<SelectorSource> {
    switch (serialized.type) {
      case "string":
        return new StringSchema(
          {
            ...serialized,
            regexp:
              serialized.options?.regexp &&
              new RegExp(
                serialized.options.regexp.source,
                serialized.options.regexp.flags
              ),
          },
          serialized.opt
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
              return [key, Schema.deserialize(item)];
            })
          ),
          serialized.opt
        );
      case "array":
        return new ArraySchema(
          Schema.deserialize(serialized.item),
          serialized.opt
        );
      case "union":
        return new UnionSchema(
          typeof serialized.key === "string"
            ? serialized.key
            : this.deserialize(serialized.key),
          serialized.items.map(Schema.deserialize),
          serialized.opt
        );
      case "richtext":
        return new RichTextSchema(serialized.options, serialized.opt);
      case "record":
        return new RecordSchema(
          Schema.deserialize(serialized.item),
          serialized.opt
        );
      case "keyOf":
        return new KeyOfSchema(
          serialized.schema,
          serialized.path as SourcePath,
          serialized.opt
        );
      case "file":
        return new FileSchema(serialized.options, serialized.opt);
      case "image":
        return new ImageSchema(serialized.options, serialized.opt);

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
            `Unknown schema: ${JSON.stringify(unknownSerialized, null, 2)}`
          );
        }
      }
    }
  }
  abstract validate(path: SourcePath, src: Src): ValidationErrors;
  abstract assert(src: Src): boolean; // TODO: false | Record<SourcePath, string[]>;
  abstract optional(): Schema<Src | null>;
  abstract serialize(): SerializedSchema;
  // remote(): Src extends RemoteCompatibleSource
  //   ? Schema<RemoteSource<Src>>
  //   : never {
  //   // TODO: Schema<never, "Cannot create remote schema from non-remote source.">
  //   throw new Error("You need Val Ultra to use .remote()");
  // }

  /** MUTATES! since internal and perf sensitive */
  protected appendValidationError(
    current: ValidationErrors,
    path: SourcePath,
    message: string,
    value?: unknown
  ): ValidationErrors {
    if (current) {
      if (current[path]) {
        current[path].push({ message, value });
      } else {
        current[path] = [{ message, value }];
      }
      return current;
    } else {
      return { [path]: [{ message, value }] } as ValidationErrors;
    }
  }
}

export type SelectorOfSchema<T extends Schema<SelectorSource>> =
  T extends Schema<infer Src> ? Src : never; // TODO: SourceError<"Could not determine type of Schema">
