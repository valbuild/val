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
import type { PatchJSON } from "@valbuild/core/patch";
import { LexicalEditor } from "lexical";
import { useState, useEffect, useRef } from "react";
import { RichTextEditor } from "../exports";
import { lexicalToRichTextSource } from "../richtext/conversion/lexicalToRichTextSource";
import { LexicalRootNode } from "../richtext/conversion/richTextSourceToLexical";
import { readImage } from "../utils/readImage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { PatchCallback } from "./usePatch";

type ImageSource = FileSource<ImageMetadata>;
export type OnSubmit = (callback: PatchCallback) => Promise<void>;

export function ValFormField({
  path,
  disabled,
  source: source,
  schema: schema,
  registerPatchCallback,
  onSubmit,
}: {
  path: string;
  disabled: boolean;
  source: Json;
  schema: SerializedSchema;
  onSubmit?: OnSubmit;
  registerPatchCallback?: (callback: PatchCallback) => void;
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
        onSubmit={onSubmit}
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
        onSubmit={onSubmit}
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
        onSubmit={onSubmit}
        defaultValue={source as ImageSource}
      />
    );
  }
  return <div>Unsupported schema: {schema.type}</div>;
}

async function createImagePatch(
  path: string,
  data: string | null,
  metadata: ImageMetadata,
  defaultValue?: ImageSource
): Promise<PatchJSON> {
  const pathParts = path.split("/");
  if (!data || !metadata) {
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
}

function ImageField({
  path,
  defaultValue,
  onSubmit,
  registerPatchCallback,
}: {
  path: string;
  onSubmit?: OnSubmit;
  registerPatchCallback?: (callback: PatchCallback) => void;
  defaultValue?: ImageSource;
}) {
  const [data, setData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<ImageMetadata>();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(defaultValue && Internal.convertFileSource(defaultValue).url);
  }, [defaultValue]);

  useEffect(() => {
    if (registerPatchCallback) {
      registerPatchCallback(async (path) => {
        return createImagePatch(path, data, metadata, defaultValue);
      });
    }
  }, [data, defaultValue]);

  return (
    <div className="max-w-4xl p-4" key={path}>
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
                if (res.width && res.height) {
                  setMetadata({
                    sha256: res.sha256,
                    width: res.width,
                    height: res.height,
                  });
                } else {
                  setMetadata(undefined);
                }
              })
              .catch((err) => {
                console.error(err.message);
                setData(null);
                setMetadata(undefined);
              });
          }}
        />
      </label>
      {onSubmit && (
        <div>
          {data && (
            <Button
              disabled={loading}
              onClick={() => {
                setLoading(true);
                onSubmit((path) =>
                  createImagePatch(path, data, metadata, defaultValue)
                ).finally(() => {
                  setLoading(false);
                  setData(null);
                  setMetadata(undefined);
                });
              }}
            >
              {loading ? "Saving..." : "Submit"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

async function createRichTextPatch(path: string, editor: LexicalEditor) {
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
}
function RichTextField({
  defaultValue,
  onSubmit,
  registerPatchCallback,
}: {
  onSubmit?: OnSubmit;
  registerPatchCallback?: (callback: PatchCallback) => void;
  defaultValue?: RichTextSource<AnyRichTextOptions>;
}) {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [didChange, setDidChange] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (editor) {
      setDidChange(false);
      editor.registerTextContentListener(() => {
        setDidChange(true);
      });
      editor.registerDecoratorListener(() => {
        setDidChange(true);
      });
    }
  }, [editor]);
  useEffect(() => {
    if (editor && registerPatchCallback) {
      registerPatchCallback(async (path) => createRichTextPatch(path, editor));
    }
  }, [editor]);
  return (
    <div className="p-4 border rounded border-card">
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
      {onSubmit && (
        <div>
          {didChange && (
            <Button
              disabled={loading || !editor}
              onClick={() => {
                if (editor) {
                  setLoading(true);
                  onSubmit((path) => createRichTextPatch(path, editor)).finally(
                    () => {
                      setLoading(false);
                      setDidChange(false);
                    }
                  );
                }
              }}
            >
              {loading ? "Saving..." : "Submit"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StringField({
  disabled,
  defaultValue,
  registerPatchCallback,
  onSubmit,
}: {
  registerPatchCallback?: (callback: PatchCallback) => void;
  onSubmit?: OnSubmit;
  disabled: boolean;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue || "");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(disabled);
  }, [disabled]);

  // ref is used to get the value of the textarea without closing over the value field
  // to avoid registering a new callback every time the value changes
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (registerPatchCallback) {
      registerPatchCallback(async (path) => {
        return [
          {
            op: "replace",
            path,
            value: ref.current?.value || "",
          },
        ];
      });
    }
  }, []);

  return (
    <div className="flex flex-col justify-between h-full gap-y-4">
      <Input
        ref={ref}
        disabled={loading}
        defaultValue={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
      {onSubmit && (
        <div>
          {defaultValue !== value && (
            <Button
              disabled={loading}
              onClick={() => {
                setLoading(true);
                onSubmit(async (path) => [
                  {
                    op: "replace",
                    path,
                    value: ref.current?.value || "",
                  },
                ]).finally(() => {
                  setLoading(false);
                });
              }}
            >
              {loading ? "Saving..." : "Submit"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
