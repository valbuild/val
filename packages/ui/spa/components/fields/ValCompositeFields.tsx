import { SourcePath, Json, SerializedSchema } from "@valbuild/core";
import React from "react";
import { ValFormField, InitOnSubmit } from "./ValFormField";
import { isJsonArray } from "../../utils/isJsonArray";
import { GenericUnionField } from "./GenericUnionField";
import { ObjectFields } from "./primitives/ObjectFields";
import { ArrayFields } from "./primitives/ArrayFields";
import { ValRecord } from "./primitives/RecordFields";
import { ValDefaultOf } from "./DefaultField";
import { NullableField } from "./primitives/NullableField";

export function AnyVal({
  path,
  source,
  schema,
  field,
  initOnSubmit,
  top,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  field?: string;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}): React.ReactElement {
  if (schema.opt) {
    return (
      <NullableField
        path={path}
        source={source}
        schema={schema}
        field={field}
        initOnSubmit={initOnSubmit}
      />
    );
  }
  if (source === null) {
    return (
      <ValDefaultOf
        source={source}
        schema={schema}
        path={path}
        initOnSubmit={initOnSubmit}
      />
    );
  }
  if (schema.type === "object") {
    if (typeof source !== "object" || isJsonArray(source)) {
      return <div>ERROR: expected object, but found {typeof source}</div>;
    }
    return (
      <div>
        {field && <div className="text-left">{field}</div>}
        <ObjectFields
          source={source}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
          top={top}
        />
      </div>
    );
  } else if (schema.type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return <div>ERROR: expected array, but found {typeof source}</div>;
    }
    return (
      <div className="w-full">
        {field && <div className="text-left">{field}</div>}
        <ArrayFields
          source={source}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
        />
      </div>
    );
  } else if (schema.type === "record") {
    if (typeof source !== "object") {
      return (
        <div>
          ERROR: expected object for {schema.type}, but found {typeof source}
        </div>
      );
    }
    if (isJsonArray(source)) {
      return <div>ERROR: did not expect array for {schema.type}</div>;
    }
    return (
      <div>
        {field && <div className="text-left">{field}</div>}
        <ValRecord
          source={source}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
        />
      </div>
    );
  } else if (schema?.type === "union") {
    if (
      typeof schema.key === "string" &&
      typeof source === "object" &&
      !isJsonArray(source)
    ) {
      return (
        <GenericUnionField
          field={field}
          source={source}
          path={path}
          schema={
            schema as {
              type: "union";
              key: string;
              items: SerializedSchema[];
              opt: boolean;
            }
          }
          initOnSubmit={initOnSubmit}
          top={top}
        />
      );
    }
  } else if (schema?.type === "literal") {
    return <></>; // skip literals
  }

  return (
    <div className="py-2 gap-y-4">
      {field && <div className="text-left">{field}</div>}
      <ValFormField
        path={path}
        source={source}
        schema={schema}
        initOnSubmit={initOnSubmit}
      />
    </div>
  );
}
