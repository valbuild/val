import {
  Internal,
  Json,
  RecordSchema,
  Schema,
  SelectorSource,
  SourcePath,
} from "@valbuild/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useNavigation } from "../Layout";
import { fromCamelToTitleCase } from "../../utils/prettifyText";
import { NullSource } from "../components/NullSource";
import { Preview } from "../components/Preview";

export function RecordFields({
  source,
  schema,
  path,
}: {
  source: any;
  schema: RecordSchema<Schema<SelectorSource>>;
  path: SourcePath;
}) {
  if (!source) {
    return <NullSource />;
  }

  const { navigate } = useNavigation();
  return (
    <div>
      {Object.entries(source).map(([key, value]) => (
        <Card key={key} onClick={() => navigate(concatSourcePath(path, key))}>
          <CardHeader>
            <CardTitle>{fromCamelToTitleCase(key)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Preview source={value as Json} schema={schema.item} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function concatSourcePath(path: SourcePath, key: string): SourcePath {
  const valPath = Internal.createValPathOfItem(path, key);
  if (!valPath) {
    throw new Error("Could not create path");
  }
  return valPath;
}
