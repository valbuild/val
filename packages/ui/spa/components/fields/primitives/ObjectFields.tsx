import { JsonObject, SourcePath, SerializedObjectSchema } from "@valbuild/core";
import { createValPathOfItem } from "@valbuild/core/src/selector/SelectorProxy";
import classNames from "classnames";
import { AnyVal } from "../ValCompositeFields";
import { InitOnSubmit } from "../ValFormField";

export function ObjectFields({
  path,
  source,
  schema,
  initOnSubmit,
  top,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedObjectSchema;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}): React.ReactElement {
  return (
    <div
      key={path}
      className={classNames("flex flex-col gap-y-1", {
        "border-l-2 border-border pl-6 mt-4": !top,
      })}
    >
      {Object.entries(schema.items).map(([key, property]) => {
        const subPath = createValPathOfItem(path, key);
        if (!subPath) {
          console.error("Could not extract subpath from", path, key);
          return null;
        }
        return (
          <AnyVal
            key={subPath}
            path={subPath}
            source={source?.[key] ?? null}
            schema={property}
            field={key}
            initOnSubmit={initOnSubmit}
          />
        );
      })}
    </div>
  );
}
