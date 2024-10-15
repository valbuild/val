import { LiteralSchema, SourcePath, UnionSchema } from "@valbuild/core";

function isStringUnion(
  schema: UnionSchema<LiteralSchema<string> | string, any>,
): schema is UnionSchema<LiteralSchema<string>, any> {
  return schema.key instanceof LiteralSchema;
}

export function UnionField({ path }: { path: SourcePath }) {
  return <div>TODO union field</div>;
}

export function UnionPreview({ source }: { source: any }) {
  return <div>{source}</div>;
}
