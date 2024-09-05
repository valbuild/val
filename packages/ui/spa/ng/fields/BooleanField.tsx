import { SourcePath, Json, BooleanSchema } from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { Checkbox } from "../../components/ui/checkbox";
import { NullSource } from "../components/NullSource";

export function BooleanField({
  // path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: BooleanSchema<boolean>;
}) {
  if (!source) {
    return <NullSource />;
  }
  if (typeof source !== "boolean") {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  return <Checkbox defaultChecked={source} />;
}

export function BooleanPreview({ source }: { source: any }) {
  return <div>{source}</div>;
}
