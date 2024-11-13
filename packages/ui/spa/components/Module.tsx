import { SourcePath } from "@valbuild/core";
import { useSchemaAtPath } from "./ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigation } from "./ValRouter";
import {
  ArrayAndRecordTools,
  splitIntoInitAndLastParts,
} from "./ArrayAndRecordTools";
import { isParentArray, useParent } from "../hooks/useParent";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchema } = useParent(path);
  const { navigate } = useNavigation();
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
    <div className="flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-2 text-left">
        {parts.length > 1 && (
          <div className="inline-flex items-center text-sm text-text-quartenary">
            {init.map((part, i) => {
              if (i < init.length - 1) {
                return (
                  <Fragment key={i}>
                    <button
                      onClick={() => {
                        navigate(part.sourcePath);
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
                    navigate(part.sourcePath);
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
          <div className="flex items-center justify-between h-12 gap-4 text-xl">
            {!showNumber && <span>{last.text}</span>}
            {showNumber && <span>#{Number(last.text) + 1}</span>}
            <ArrayAndRecordTools path={path} variant={"module"} />
          </div>
        </div>
      </div>
      <AnyField key={path} path={path} schema={schema} />
    </div>
  );
}