import { SerializedSchema } from "@valbuild/core";

export function UnexpectedSchemaType({ schema }: { schema: SerializedSchema }) {
  return (
    <div>
      <div>Unexpected schema type: {schema.type}</div>
    </div>
  );
}
