import {
  deserializeSchema,
  GenericSelector,
  KeyOfSchema,
  ModuleFilePath,
  ModulePath,
  SourceArray,
  SourceObject,
  SourcePath,
} from "@valbuild/core";
import { UnexpectedSourceType } from "../../components/fields/UnexpectedSourceType";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../components/ui/select";
import { NullSource } from "../components/NullSource";
import { useModuleSource } from "../ValProvider";

export function KeyOfField({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: any;
  schema: KeyOfSchema<GenericSelector<SourceArray | SourceObject>>;
}) {
  const remoteReferencedSource = useModuleSource(
    (schema.sourcePath ?? null) as ModuleFilePath | null,
  );
  if (!source) {
    return <NullSource />;
  }
  if (source === null) {
    return <UnexpectedSourceType source={source} schema={schema} />;
  }
  if (remoteReferencedSource.status === "error") {
    throw new Error(remoteReferencedSource.error);
  }
  if (remoteReferencedSource.status !== "success") {
    return <div>Loading...</div>;
  }
  if (typeof remoteReferencedSource.data !== "object") {
    return (
      <UnexpectedSourceType
        source={remoteReferencedSource.data}
        schema={schema}
      />
    );
  }
  const referencedSchema = schema.schema && deserializeSchema(schema.schema);
  const keys =
    remoteReferencedSource.data && Object.keys(remoteReferencedSource.data);
  return (
    <Select>
      <SelectTrigger className="h-[8ch]">{source}</SelectTrigger>
      <SelectContent>
        {referencedSchema &&
          keys?.map((key) => (
            <SelectItem className="h-[8ch]" key={key} value={key}>
              {key}
              {/* TODO: preview key */}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export function KeyOfPreview({ source }: { source: any }) {
  return <pre>{JSON.stringify(source)}</pre>;
}
