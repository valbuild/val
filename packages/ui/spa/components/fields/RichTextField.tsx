import {
  AllRichTextOptions,
  ConfigDirectory,
  RichTextSource,
  SourcePath,
} from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  RemirrorJSON,
  remirrorToRichTextSource,
  RemoteRichTextOptions,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { Operation, Patch } from "@valbuild/core/patch";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";
import {
  ShallowSource,
  useAddPatch,
  useCurrentRemoteFileBucket,
  useRemoteFiles,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValConfig,
} from "../ValProvider";
import { RichTextEditor, useRichTextEditor } from "../RichTextEditor";
import { useEffect, useMemo, useState } from "react";
import { EditorState } from "@remirror/core";

export function RichTextField({
  path,
  autoFocus,
}: {
  path: SourcePath;
  autoFocus?: boolean;
}) {
  const type = "richtext";
  const config = useValConfig();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const currentSourceData =
    "data" in sourceAtPath
      ? (sourceAtPath.data as RichTextSource<AllRichTextOptions>)
      : undefined;
  const { manager } = useRichTextEditor(
    currentSourceData && richTextToRemirror(currentSourceData),
  );
  const { patchPath, addPatch } = useAddPatch(path);
  const [editorState, setEditorState] = useState<Readonly<EditorState>>(
    manager.createState({
      content: currentSourceData && richTextToRemirror(currentSourceData),
    }),
  );
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (maybeClientSideOnly === false) {
      setEditorState((prevState) => {
        try {
          const newContent = maybeSourceData
            ? richTextToRemirror(
                maybeSourceData as RichTextSource<AllRichTextOptions>,
              )
            : undefined;
          const newState = manager.createState({
            content: newContent,
            selection: prevState.selection,
          });
          if (newState.doc.eq(prevState.doc)) {
            // Avoid (unnecessary) update that also erases the history
            return prevState;
          }
          return newState;
        } catch (e) {
          console.error(
            "Error (re)creating editor state with selection, retrying without...",
            e,
          );
          return manager.createState({
            content: maybeSourceData
              ? richTextToRemirror(
                  maybeSourceData as RichTextSource<AllRichTextOptions>,
                )
              : undefined,
          });
        }
      });
    }
  }, [maybeSourceData, maybeClientSideOnly]);

  const remoteOptions = useMemo(() => {
    if (!("data" in schemaAtPath && schemaAtPath.data.type === "richtext")) {
      return null;
    }
    const schema = schemaAtPath.data;
    return typeof schema.options?.inline?.img === "object" &&
      schema.options.inline.img.remote &&
      remoteFiles.status === "ready" &&
      config?.remoteHost &&
      currentRemoteFileBucket
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          bucket: currentRemoteFileBucket,
          coreVersion: remoteFiles.coreVersion,
          schema: schema.options.inline.img,
          remoteHost: config?.remoteHost,
        }
      : null;
  }, [schemaAtPath, remoteFiles, config, currentRemoteFileBucket]);

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
  if (!config?.remoteHost) {
    console.warn(
      "RichTextField: config.remoteHost is not set. Remote images will not work.",
    );
  }
  return (
    <div>
      <ValidationErrors path={path} />
      <RichTextEditor
        autoFocus={autoFocus}
        state={editorState}
        options={schema.options}
        manager={manager}
        onChange={(event) => {
          const currentDoc = editorState?.doc;
          setEditorState(event.state);
          if (currentDoc && !event.state.doc.eq(currentDoc)) {
            addPatch(
              createRichTextPatch(
                patchPath,
                config?.files?.directory ?? "/public/val",
                event.state.doc.toJSON(),
                remoteOptions,
              ),
              type,
            );
          }
        }}
      />
    </div>
  );
}

function createRichTextPatch(
  path: string[],
  configDirectory: ConfigDirectory,
  content: RemirrorJSON | undefined,
  remoteOptions: RemoteRichTextOptions | null,
): Patch {
  const { blocks, files } = content
    ? remirrorToRichTextSource(content, configDirectory, remoteOptions)
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
          remote: !!remoteOptions,
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
      } else if ("tag" in node && typeof node.tag === "string") {
        return "";
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
