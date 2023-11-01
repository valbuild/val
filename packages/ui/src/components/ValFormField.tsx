import {
  AnyRichTextOptions,
  FileSource,
  ImageMetadata,
  Internal,
  Json,
  RichTextSource,
  SerializedSchema,
  VAL_EXTENSION,
} from "@valbuild/core";
import { LexicalEditor } from "lexical";
import { useState, useEffect, useRef } from "react";
import { RichTextEditor } from "../exports";
import { lexicalToRichTextSource } from "../richtext/conversion/lexicalToRichTextSource";
import { LexicalRootNode } from "../richtext/conversion/richTextSourceToLexical";
import { readImage } from "../utils/readImage";
import { Input } from "./ui/input";
import { PatchCallback } from "./usePatch";

type ImageSource = FileSource<ImageMetadata>;

export function ValFormField({
  path,
  disabled,
  source: source,
  schema: schema,
  registerPatchCallback,
}: {
  path: string;
  disabled: boolean;
  source: Json;
  schema: SerializedSchema;
  registerPatchCallback: (callback: PatchCallback) => void;
}) {
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "string"
  ) {
    return (
      <StringField
        defaultValue={source}
        disabled={disabled}
        registerPatchCallback={registerPatchCallback}
      />
    );
  }
  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "richtext"
  ) {
    return (
      <RichTextField
        registerPatchCallback={registerPatchCallback}
        defaultValue={source as RichTextSource<AnyRichTextOptions>}
      />
    );
  }
  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "image"
  ) {
    return (
      <ImageField
        path={path}
        registerPatchCallback={registerPatchCallback}
        defaultValue={source as ImageSource}
      />
    );
  }
  return <div>Unsupported schema: {schema.type}</div>;
}

function ImageField({
  path,
  defaultValue,
  registerPatchCallback,
}: {
  path: string;
  registerPatchCallback: (callback: PatchCallback) => void;
  defaultValue?: ImageSource;
}) {
  const [data, setData] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<{
    width?: number;
    height?: number;
    sha256: string;
  } | null>(null);
  const url = defaultValue && Internal.convertFileSource(defaultValue).url;
  useEffect(() => {
    registerPatchCallback(async (path) => {
      const pathParts = path.split("/");
      if (!data) {
        return [];
      }
      return [
        {
          value: {
            ...defaultValue,
            metadata,
          },
          op: "replace",
          path,
        },
        // update the contents of the file:
        {
          value: data,
          op: "replace",
          path: `${pathParts.slice(0, -1).join("/")}/$${
            pathParts[pathParts.length - 1]
          }`,
        },
      ];
    });
  }, [data]);

  return (
    <div>
      <label htmlFor={`img_input:${path}`} className="">
        {data || url ? <img src={data || url} /> : <div>Empty</div>}
        <input
          id={`img_input:${path}`}
          type="file"
          hidden
          onChange={(ev) => {
            readImage(ev)
              .then((res) => {
                setData(res.src);
                setMetadata({
                  sha256: res.sha256,
                  width: res.width,
                  height: res.height,
                });
              })
              .catch((err) => {
                console.error(err.message);
                setData(null);
                setMetadata(null);
              });
          }}
        />
      </label>
    </div>
  );
}

function RichTextField({
  defaultValue,
  registerPatchCallback,
}: {
  registerPatchCallback: (callback: PatchCallback) => void;
  defaultValue?: RichTextSource<AnyRichTextOptions>;
}) {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  useEffect(() => {
    if (editor) {
      registerPatchCallback(async (path) => {
        const { templateStrings, exprs, files } = editor
          ? await lexicalToRichTextSource(
              editor.getEditorState().toJSON().root as LexicalRootNode
            )
          : ({
              [VAL_EXTENSION]: "richtext",
              templateStrings: [""],
              exprs: [],
              files: {},
            } as RichTextSource<AnyRichTextOptions> & {
              files: Record<string, string>;
            });
        return [
          {
            op: "replace" as const,
            path,
            value: {
              templateStrings,
              exprs,
              [VAL_EXTENSION]: "richtext",
            },
          },
          ...Object.entries(files).map(([path, value]) => {
            return {
              op: "file" as const,
              path,
              value,
            };
          }),
        ];
      });
    }
  }, [editor]);
  return (
    <RichTextEditor
      onEditor={(editor) => {
        setEditor(editor);
      }}
      richtext={
        defaultValue ||
        ({
          children: [],
          [VAL_EXTENSION]: "root",
        } as unknown as RichTextSource<AnyRichTextOptions>)
      }
    />
  );
}

function StringField({
  disabled,
  defaultValue,
  registerPatchCallback,
}: {
  registerPatchCallback: (callback: PatchCallback) => void;
  disabled: boolean;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue || "");

  // ref is used to get the value of the textarea without closing over the value field
  // to avoid registering a new callback every time the value changes
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    registerPatchCallback(async (path) => {
      return [
        {
          op: "replace",
          path,
          value: ref.current?.value || "",
        },
      ];
    });
  }, []);

  return (
    <div className="flex flex-col justify-between h-full p-4">
      <Input
        ref={ref}
        disabled={disabled}
        defaultValue={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
