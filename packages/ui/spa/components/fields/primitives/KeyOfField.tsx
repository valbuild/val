import { SourcePath, Internal, Json, SerializedSchema } from "@valbuild/core";
import { useState, useEffect } from "react";
import { isJsonArray } from "../../../utils/isJsonArray";
import { Preview } from "../Preview";
import { OnSubmit, SubmitStatus } from "../SubmitStatus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { useValFromPath } from "../../ValStoreContext";
import { FieldContainer } from "../FieldContainer";

export function KeyOfField({
  defaultValue,
  onSubmit,
  selector,
}: {
  onSubmit?: OnSubmit;
  defaultValue?: string | number | null;
  selector: SourcePath;
}) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(selector);
  const moduleRes = useValFromPath(moduleFilePath, modulePath);
  const [current, setCurrent] = useState<{
    source: Json;
    schema: SerializedSchema;
  }>();
  const [loading, setLoading] = useState(false);
  const [currentSelector, setCurrentSelector] = useState<
    string | number | null | undefined
  >(defaultValue);
  useEffect(() => {
    setCurrentSelector(defaultValue);
  }, [defaultValue]);
  useEffect(() => {
    if (moduleRes.status === "success" && currentSelector !== null) {
      const { source: selectorSource, schema: selectorSchema } = moduleRes;
      if (typeof selectorSource !== "object") {
        console.error("Invalid selector source", selectorSource);
        return;
      }
      if (selectorSource === null) {
        return;
      }
      if (currentSelector === undefined) {
        return;
      }
      let source;
      if (isJsonArray(selectorSource)) {
        source = selectorSource[Number(currentSelector)];
      } else {
        source = selectorSource[currentSelector];
      }
      if (selectorSchema.type === "object") {
        setCurrent({
          source: source,
          schema: selectorSchema.items[currentSelector],
        });
      } else if (
        selectorSchema.type === "array" ||
        selectorSchema.type === "record"
      ) {
        setCurrent({ source: source, schema: selectorSchema.item });
      } else {
        console.error("Invalid selector schema", selectorSchema);
      }
    }
  }, [moduleRes, currentSelector]);

  if (moduleRes.status === "loading" || moduleRes.status === "idle") {
    return <span>Loading...</span>;
  }
  if (moduleRes.status === "error") {
    return <span>Error: {moduleRes.error.message}</span>;
  }
  const { source: selectorSource, schema: selectorSchema } = moduleRes;

  if (
    !(
      selectorSchema.type === "array" ||
      selectorSchema.type === "record" ||
      selectorSchema.type === "object"
    )
  ) {
    return (
      <span>
        Contact developer. Cannot use key of on: {selectorSchema.type}
      </span>
    );
  }

  if (selectorSource === null) {
    return <span>Module not found</span>;
  }
  if (typeof selectorSource !== "object") {
    return <span>Invalid module source</span>;
  }

  return (
    <FieldContainer>
      <Select
        disabled={loading}
        onValueChange={(key) => {
          if (onSubmit) {
            setLoading(true);
            onSubmit((path) => {
              setCurrentSelector(key);
              return Promise.resolve([
                {
                  op: "replace",
                  path,
                  value: moduleRes.schema.type === "array" ? Number(key) : key,
                },
              ]);
            }).finally(() => {
              setLoading(false);
            });
          }
        }}
      >
        <SelectTrigger className="h-[8ch]">
          {current && current.source !== undefined ? (
            <PreviewDropDownItem
              source={current.source}
              schema={current.schema}
            />
          ) : (
            <SelectValue className="h-[8ch]" />
          )}
        </SelectTrigger>
        <SelectContent>
          <div className="relative pr-6">
            {Object.keys(selectorSource).map((key) => (
              <SelectItem className="h-[8ch]" key={key} value={key}>
                <PreviewDropDownItem
                  source={
                    isJsonArray(selectorSource)
                      ? selectorSource[Number(key)]
                      : selectorSource[key]
                  }
                  schema={
                    selectorSchema.type === "object"
                      ? selectorSchema.items[key]
                      : selectorSchema.item
                  }
                />
              </SelectItem>
            ))}
            <div className="absolute top-2 -right-4">
              <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
            </div>
          </div>
        </SelectContent>
      </Select>
    </FieldContainer>
  );
}

function PreviewDropDownItem({
  source,
  schema,
}: {
  source: Json;
  schema: SerializedSchema;
}) {
  return (
    <div className="h-[5ch] overflow-y-hidden ">
      <Preview source={source} schema={schema} />
    </div>
  );
}
