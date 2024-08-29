import { Json, SerializedSchema } from "@valbuild/core";

export function UnexpectedSourceType({
  source,
  schema,
}: {
  source: Json;
  schema: SerializedSchema;
}) {
  return (
    <div>
      <div>Unexpected source type: {typeof source}</div>
      <pre>{JSON.stringify(source, null, 2)}</pre>
      <pre>{JSON.stringify(schema, null, 2)}</pre>
    </div>
  );
}
