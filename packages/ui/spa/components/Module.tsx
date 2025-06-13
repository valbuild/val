import { SourcePath } from "@valbuild/core";
import {
  useAllSources,
  useSchemaAtPath,
  useSchemas,
  useValidationErrors,
} from "./ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { Fragment, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigation } from "./ValRouter";
import {
  ArrayAndRecordTools,
  splitIntoInitAndLastParts,
} from "./ArrayAndRecordTools";
import { isParentArray, useParent } from "../hooks/useParent";
import { getNavPathFromAll } from "./getNavPath";
import { FieldValidationError } from "./FieldValidationError";
import { cn } from "./designSystem/cn";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchema } = useParent(path);
  const { navigate } = useNavigation();
  const sources = useAllSources();
  const schemasRes = useSchemas();
  const validationErrors = useValidationErrors(path);
  const onNavigate = useCallback(
    (path: SourcePath) => {
      if ("data" in schemasRes) {
        const schemas = schemasRes.data;
        const navPath = getNavPathFromAll(path, sources, schemas);
        if (navPath) {
          navigate(navPath);
        } else {
          navigate(path);
          console.error(`Error navigating to path: ${path} - no schemas found`);
        }
      } else {
        console.warn("Schemas not loaded yet");
        navigate(path);
      }
    },
    [schemasRes, sources, navigate],
  );
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }

  const schema = schemaAtPath.data;
  const parts = splitIntoInitAndLastParts(path);
  const init = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  const showNumber = isParentArray(path, maybeParentPath, parentSchema);
  return (
    <div className="flex flex-col gap-6 pt-4 pb-40">
      <div className="flex flex-col gap-2 text-left">
        {parts.length > 1 && (
          <div className="inline-flex items-center text-sm text-text-quartenary">
            {init.map((part, i) => {
              if (i < init.length - 1) {
                return (
                  <Fragment key={i}>
                    <button
                      onClick={() => {
                        onNavigate(part.sourcePath);
                      }}
                    >
                      {part.text}
                    </button>
                    <span>
                      <ChevronRight size={16} />
                    </span>
                  </Fragment>
                );
              }
              return (
                <button
                  onClick={() => {
                    onNavigate(part.sourcePath);
                  }}
                  key={i}
                >
                  {part.text}
                </button>
              );
            })}
          </div>
        )}
        <div>
          <div className="flex items-center justify-between h-6 gap-4 text-xl">
            {!showNumber && <span>{last.text}</span>}
            {showNumber && <span>#{Number(last.text)}</span>}
            <ArrayAndRecordTools path={path} variant={"module"} />
          </div>
        </div>
      </div>
      <div
        className={cn({
          "border rounded-lg border-bg-error-secondary p-4":
            validationErrors.length > 0,
        })}
      >
        <AnyField key={path} path={path} schema={schema} />
        <FieldValidationError validationErrors={validationErrors} />
      </div>
    </div>
  );
}
