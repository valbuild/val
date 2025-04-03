import { SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useEffect, useState } from "react";
import { ValidationErrors } from "../../components/ValidationError";
import { Loader2 } from "lucide-react";
import classNames from "classnames";

export function StringField({
  path,
  autoFocus,
}: {
  path: SourcePath;
  autoFocus?: boolean;
}) {
  const type = "string";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const [focus, setFocus] = useState(false);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  useEffect(() => {
    if (!focus && "data" in sourceAtPath && sourceAtPath.data !== undefined) {
      setCurrentValue(sourceAtPath.data);
    }
  }, ["data" in sourceAtPath && sourceAtPath.data, focus]);
  useEffect(() => {
    // TODO: sometimes characters are missing from patches but we do not really understand why...
    // This is just a hack to work around the issue. We can remove this once we fix the root cause.
    // NOTE: we do not think this hack will cause issues, since the current value should always match the actual source
    if (
      "data" in sourceAtPath &&
      sourceAtPath.data !== undefined &&
      currentValue !== null &&
      sourceAtPath.data !== currentValue
    ) {
      const timeout = setTimeout(() => {
        console.warn(
          `Mis-matched strings: '${sourceAtPath.data}' and '${currentValue}'. Patching...`,
        );
        addPatch(
          [
            {
              op: "replace",
              path: patchPath,
              value: currentValue,
            },
          ],
          type,
        );
      }, 3000);
      return () => {
        clearTimeout(timeout);
      };
    }
  }, ["data" in sourceAtPath && sourceAtPath.data, currentValue]);
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
  return (
    <div>
      <ValidationErrors path={path} />
      <div className="relative w-full">
        <Input
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          autoFocus={autoFocus}
          onFocus={() => {
            setFocus(true);
          }}
          onBlur={() => {
            setFocus(false);
          }}
          value={currentValue || ""}
          onChange={(ev) => {
            setCurrentValue(ev.target.value);
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: ev.target.value,
                },
              ],
              type,
            );
          }}
        />
        <span
          className={classNames(
            "absolute right-0 -translate-x-full top-4 duration-1000",
            {
              "opacity-0": sourceAtPath.data === currentValue,
              "opacity-100": sourceAtPath.data !== currentValue,
            },
          )}
        >
          <Loader2 className="transition-opacity animate-spin" size={12} />
        </span>
      </div>
    </div>
  );
}

export function StringPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "string");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="string" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
