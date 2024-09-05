import { SourcePath, Json, NumberSchema } from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { Input } from "../../components/ui/input";
import { NullSource } from "../components/NullSource";

export function NumberField({
  // path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: NumberSchema<number>;
}) {
  if (!source) {
    return <NullSource />;
  }
  if (typeof source !== "number") {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  return <Input type="number" defaultValue={source} />;
}

export function NumberPreview({ source }: { source: any }) {
  return <div>{source}</div>;
}
