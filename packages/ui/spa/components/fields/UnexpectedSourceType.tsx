import { Json, Schema, SelectorSource, SerializedSchema } from "@valbuild/core";

export function UnexpectedSourceType({
  source,
  schema,
}: {
  source: Json;
  schema: Schema<SelectorSource> | SerializedSchema;
}) {
  return (
    <div>
      <div>Unexpected source type: {typeof source}</div>
      <pre>Source: {JSON.stringify(source, null, 2)}</pre>
      <pre>Schema: {JSON.stringify(schema, null, 2)}</pre>
    </div>
  );
}
