import { SourcePath } from "@valbuild/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useSchemaAtPath, useShallowSourceAtPath } from "../ValProvider";
import { fixCapitalization } from "../../utils/fixCapitalization";
import { RecordBadges } from "../components/RecordBadges";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { PreviewLoading, PreviewNull } from "../components/Preview";

export function RecordFields({ path }: { path: SourcePath }) {
  const type = "record";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type={type} />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const source = sourceAtPath.data;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {source &&
        Object.entries(source).map(([key]) => (
          <Card
            key={key}
            onClick={() => navigate(sourcePathOfItem(path, key))}
            className="bg-primary-foreground cursor-pointer hover:bg-primary-foreground/50 min-w-[274px]"
          >
            <CardHeader>
              <CardTitle className="text-md">{key}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <RecordBadges counts={{}} />
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

export function RecordPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "record");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="record" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const keys = Object.keys(sourceAtPath.data);
  return (
    <div className="text-left">
      <span className="text-fg-brand-primary">{keys.length}</span>
      <span className="mr-1">{` item${keys.length === 1 ? "" : "s"}:`}</span>
      {keys.map((key, index) => (
        <>
          <span key={key} className="text-fg-brand-primary">
            {key}
          </span>
          {index < keys.length - 1 ? ", " : ""}
        </>
      ))}
    </div>
  );
}
