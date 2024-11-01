import { AllRichTextOptions, RichTextSource, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  ShallowSource,
} from "../ValProvider";
import {
  RichTextEditor,
  useRichTextEditor,
} from "../../components/fields/RichTextEditor";
import {
  RemirrorJSON,
  remirrorToRichTextSource,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { Operation, Patch } from "@valbuild/core/patch";
import { useEffect, useState } from "react";
import { PreviewLoading, PreviewNull } from "../components/Preview";

export function RichTextField({
  path,
  autoFocus,
}: {
  path: SourcePath;
  autoFocus?: boolean;
}) {
  const type = "richtext";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const defaultValue =
    "data" in sourceAtPath
      ? (sourceAtPath.data as RichTextSource<AllRichTextOptions>)
      : undefined;
  const { state, manager, setState } = useRichTextEditor(
    defaultValue && richTextToRemirror(defaultValue),
  );
  const { patchPath, addDebouncedPatch } = useAddPatch(path);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus && defaultValue) {
      setState(
        manager.createState({
          content: richTextToRemirror(defaultValue),
        }),
      );
    }
  }, [focus, defaultValue, setState, manager]);

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
  const schema = schemaAtPath.data;
  return (
    <RichTextEditor
      autoFocus={autoFocus}
      state={state}
      options={schema.options}
      onFocus={setFocus}
      manager={manager}
      onChange={(event) => {
        if (focus) {
          setState(event.state);
          addDebouncedPatch(() => {
            return createRichTextPatch(patchPath, event.state.doc.toJSON());
          }, path);
        }
      }}
    />
  );
}

function createRichTextPatch(path: string[], content?: RemirrorJSON): Patch {
  const { blocks, files } = content
    ? remirrorToRichTextSource(content)
    : {
        blocks: [],
        files: {},
      };
  return [
    {
      op: "replace" as const,
      path,
      value: blocks,
    },
    ...Object.entries(files).flatMap(([filePath, { value, patchPaths }]) => {
      return patchPaths.map(
        (patchPath): Operation => ({
          op: "file" as const,
          path,
          filePath,
          value,
          nestedFilePath: patchPath,
        }),
      );
    }),
  ];
}

export function RichTextPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "richtext");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        type="richtext"
      />
    );
  }
  if (sourceAtPath.status == "not-found") {
    return <FieldNotFound path={path} type="richtext" />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const asString = richTextToString(sourceAtPath.data);
  if (asString.status === "error") {
    return (
      <FieldSourceError path={path} error={asString.error} type="richtext" />
    );
  }
  return <div className="truncate">{asString.value}</div>;
}

function richTextToString(source: ShallowSource["richtext"]):
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ok";
      value: string;
    } {
  let error: string | undefined;
  function rec(node: unknown): string {
    if (error) {
      return error;
    }
    if (typeof node === "string") {
      return node;
    }
    if (typeof node === "object" && node) {
      if ("children" in node && Array.isArray(node.children)) {
        return node.children.map(rec).join(" ");
      }
    }
    error = "Invalid richtext node: " + JSON.stringify(node);
    return JSON.stringify(node);
  }
  const value = source.map(rec).join(" ");
  if (error) {
    return { status: "error", error };
  } else {
    return { status: "ok", value };
  }
}
