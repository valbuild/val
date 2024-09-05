import { SourcePath, StringSchema, Json } from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import { Input } from "../../components/ui/input";
import { NullSource } from "../components/NullSource";

export function StringField({
  // path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: StringSchema<string>;
}) {
  if (!source) {
    return <NullSource />;
  }
  if (typeof source !== "string") {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  return <Input defaultValue={source} />;
}

export function StringPreview({ source }: { source: any }) {
  return <div className="truncate">{source}</div>;
}
