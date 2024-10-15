import { SourcePath } from "@valbuild/core";

export function KeyOfField({ path }: { path: SourcePath }) {
  return <div>TODO: keyOf</div>;
}

export function KeyOfPreview({ source }: { source: any }) {
  return <pre>{JSON.stringify(source)}</pre>;
}
