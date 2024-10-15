import { SerializedSchema } from "@valbuild/core";

export function UnexpectedSourceType({ schema }: { schema: SerializedSchema }) {
  return (
    <div>
      <div>Unexpected source type: {typeof schema.type}</div>
    </div>
  );
}
