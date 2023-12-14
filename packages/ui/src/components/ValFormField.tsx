import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  ImageMetadata,
  ImageSource,
  Internal,
  Json,
  RichTextSource,
  SerializedSchema,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import type { PatchJSON } from "@valbuild/core/patch";
import { LexicalEditor, TextNode } from "lexical";
import { useState, useEffect, useRef } from "react";
import { getMimeType, mimeTypeToFileExt } from "@valbuild/shared/internal";
import { RichTextEditor } from "../exports";
import { lexicalToRichTextSource } from "@valbuild/shared/internal";
import { LexicalRootNode } from "@valbuild/shared/internal";
import { readImage } from "../utils/readImage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { PatchCallback } from "./usePatch";
import { useValModuleFromPath } from "./ValFullscreen";
import { LinkNode } from "@lexical/link";
import { ImageNode } from "./RichTextEditor/Nodes/ImageNode";

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
    (typeof source === "number" || source === null) &&
    schema?.type === "number"
  ) {
    return (
      <NumberField
        defaultValue={source}
        disabled={disabled}
        registerPatchCallback={registerPatchCallback}
        onSubmit={onSubmit}
      />
    );
  }
  if (
    (typeof source === "number" ||
      typeof source === "string" ||
      source === null) &&
    schema?.type === "keyOf"
  ) {
    return (
      <KeyOfField
        defaultValue={source}
        disabled={disabled}
        registerPatchCallback={registerPatchCallback}
        onSubmit={onSubmit}
        selector={schema.selector}
      />
    );
  }
  if (
    (typeof source === "number" || source === null) &&
    schema?.type === "number"
  ) {
    return (
      <NumberField
        defaultValue={source}
        disabled={disabled}
        registerPatchCallback={registerPatchCallback}
        onSubmit={onSubmit}
      />
    );
  }
  if (
    (typeof source === "number" ||
      typeof source === "string" ||
      source === null) &&
    schema?.type === "keyOf"
  ) {
    return (
      <KeyOfField
        defaultValue={source}
        disabled={disabled}
        registerPatchCallback={registerPatchCallback}
        onSubmit={onSubmit}
        selector={schema.selector}
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

export function createImagePatch(
  path: string,
  data: string | null,
  filename: string | null,
  metadata: ImageMetadata | undefined
): PatchJSON {
  if (!data || !metadata) {
    return [];
  }
  const shaSuffix = metadata.sha256.slice(0, 5);
  const newFilePath = (function () {
    const mimeType = getMimeType(data) ?? "unknown";
    const newExt = mimeTypeToFileExt(mimeType); // Dont trust the file extension
    if (filename) {
      let cleanFilename =
        filename.split(".").slice(0, -1).join(".") || filename; // remove extension if it exists
      const maybeShaSuffixPos = cleanFilename.lastIndexOf("_");
      const currentShaSuffix = cleanFilename.slice(
        maybeShaSuffixPos + 1,
        cleanFilename.length
      );
      if (currentShaSuffix === shaSuffix) {
        cleanFilename = cleanFilename.slice(0, maybeShaSuffixPos);
      }
      return `/public/${cleanFilename}_${shaSuffix}.${newExt}`;
    }
    return `/public/${metadata.sha256}.${newExt}`;
  })();

  return [
    {
      value: {
        [FILE_REF_PROP]: newFilePath,
        [VAL_EXTENSION]: "file",
        metadata,
      },
      op: "replace",
      path,
    },
    {
      value: data,
      op: "file",
      path,
      filePath: newFilePath,
    },
  ];
}

export function createImageMetadataPatch(
  path: string,
  metadata: ImageMetadata
): PatchJSON {
  const metadataPath = path + "/metadata";
  return [
    {
      value: metadata,
      op: "replace",
      path: metadataPath,
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
  const [data, setData] = useState<{ filename?: string; src: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<ImageMetadata>();
  const [hotspot, setHotspot] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(defaultValue && Internal.convertFileSource(defaultValue).url);
  }, [defaultValue]);

  useEffect(() => {
    if (registerPatchCallback) {
      registerPatchCallback(async (path) => {
        return createImagePatch(
          path,
          data?.src ?? null,
          data?.filename ?? null,
          metadata
        );
      });
    }
  }, [data, defaultValue]);

  // TODO: this smells bad:
  useEffect(() => {
    if (hotspot) {
      if (metadata) {
        const newMetadata = {
          ...metadata,
          hotspot,
        };
        setMetadata(newMetadata);
      } else if (defaultValue?.metadata) {
        setMetadata({
          ...defaultValue.metadata,
          hotspot,
        });
      } else {
        console.error("Neither image metadata nor value is set");
      }
    } else {
      if (defaultValue?.metadata?.hotspot) {
        setHotspot(defaultValue.metadata.hotspot);
      }
    }
  }, [hotspot, defaultValue]);

  return (
    <FieldContainer>
      <div className="flex flex-col max-w-4xl p-4 gap-y-4" key={path}>
        {data || url ? (
          <div className="relative">
            {hotspot && (
              <div
                className="rounded-full h-[20px] w-[20px] bg-accent absolute"
                style={{
                  top: `${hotspot.y * 100}%`,
                  left: `${hotspot.x * 100}%`,
                }}
              />
            )}
            <img
              src={data?.src || url}
              className="w-full cursor-crosshair"
              onClick={(ev) => {
                // compute hotspot position based on mouse click:
                const x = ev.nativeEvent.offsetX;
                const y = ev.nativeEvent.offsetY;
                const width = ev.currentTarget.clientWidth;
                const height = ev.currentTarget.clientHeight;
                const hotspotX = Math.round((x / width) * 100) / 100;
                const hotspotY = Math.round((y / height) * 100) / 100;
                setHotspot({ x: hotspotX, y: hotspotY, width: 1, height: 1 });
              }}
            />
          </div>
        ) : (
          <div>Select image below</div>
        )}
        <label htmlFor={`img_input:${path}`} className="">
          <div className="px-1 py-2 text-center rounded-md bg-primary text-background">
            Update image
          </div>
          <input
            hidden
            id={`img_input:${path}`}
            type="file"
            onChange={(ev) => {
              readImage(ev)
                .then((res) => {
                  setData({ src: res.src, filename: res.filename });
                  if (res.width && res.height && res.mimeType) {
                    setMetadata({
                      sha256: res.sha256,
                      width: res.width,
                      height: res.height,
                      mimeType: res.mimeType,
                      hotspot,
                    });
                  } else {
                    setMetadata(undefined);
                    setHotspot(undefined);
                  }
                })
                .catch((err) => {
                  console.error(err.message);
                  setData(null);
                  setHotspot(undefined);
                  setMetadata(undefined);
                });
            }}
          />
        </label>
      </div>
      {onSubmit && data && (
        <SubmitButton
          loading={loading}
          onClick={() => {
            setLoading(true);
            onSubmit((path) =>
              Promise.resolve(
                createImagePatch(
                  path,
                  data.src,
                  data.filename ?? null,
                  metadata
                )
              )
            ).finally(() => {
              setLoading(false);
              setData(null);
              setMetadata(undefined);
            });
          }}
        />
      )}
      {onSubmit && !data && metadata && (
        <SubmitButton
          loading={loading}
          onClick={() => {
            setLoading(true);
            onSubmit((path) =>
              Promise.resolve(createImageMetadataPatch(path, metadata))
            ).finally(() => {
              setLoading(false);
              setData(null);
              setMetadata(undefined);
            });
          }}
        />
      )}
    </FieldContainer>
  );
}

function createRichTextPatch(path: string, editor: LexicalEditor) {
  const { templateStrings, exprs, files } = editor
    ? lexicalToRichTextSource(
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
    ...Object.entries(files).map(([filePath, value]) => {
      return {
        op: "file" as const,
        path,
        filePath,
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
      editor.registerMutationListener(LinkNode, () => {
        setDidChange(true);
      });
      editor.registerMutationListener(ImageNode, () => {
        setDidChange(true);
      });
      editor.registerMutationListener(TextNode, () => {
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
    <FieldContainer>
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
      {onSubmit && didChange && (
        <SubmitButton
          loading={loading || !editor}
          onClick={() => {
            if (editor) {
              setLoading(true);
              onSubmit(async (path) =>
                createRichTextPatch(path, editor)
              ).finally(() => {
                setLoading(false);
                setDidChange(false);
              });
            }
          }}
        />
      )}
    </FieldContainer>
  );
}

function KeyOfField({
  disabled,
  defaultValue,
  registerPatchCallback,
  onSubmit,
  selector,
}: {
  registerPatchCallback?: (callback: PatchCallback) => void;
  onSubmit?: OnSubmit;
  disabled: boolean;
  defaultValue?: string | number | null;
  selector: SourcePath;
}) {
  const valModule = useValModuleFromPath(selector);
  const getValuesFromModule = (module: typeof valModule) => {
    if (Array.isArray(module.moduleSource)) {
      return {
        type: "number",
        values: Object.keys(module.moduleSource).map((key) => parseInt(key)),
      };
    }
    return {
      type: "string",
      values: Object.keys(module.moduleSource ?? ["ERROR fetching source"]),
    };
  };
  const typeAndValues = getValuesFromModule(valModule);
  const [value, setValue] = useState(defaultValue || typeAndValues.values[0]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(disabled);
  }, [disabled]);

  const parse = (value: string) => {
    if (typeAndValues.type === "number") {
      if (value === "") {
        throw new Error("Value cannot be empty");
      }
      if (Number.isNaN(Number(value))) {
        throw new Error("Value was not a number: " + JSON.stringify(value));
      }
      return Number(value);
    }
    return value;
  };

  useEffect(() => {
    if (registerPatchCallback) {
      registerPatchCallback(async (path) => {
        return [
          {
            op: "replace",
            path,
            value: value,
          },
        ];
      });
    }
  }, [value]);

  return (
    <FieldContainer>
      <Select
        defaultValue={value.toString()}
        disabled={loading}
        onValueChange={(value) => {
          setValue(parse(value));
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a value" />
        </SelectTrigger>
        <SelectContent>
          {typeAndValues.values.map((value) => (
            <SelectItem key={value} value={value.toString()}>
              {value.toString()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onSubmit && defaultValue !== value && (
        <SubmitButton
          loading={loading}
          onClick={() => {
            setLoading(true);
            onSubmit(async (path) => [
              {
                op: "replace",
                path,
                value: value,
              },
            ]).finally(() => {
              setLoading(false);
            });
          }}
        />
      )}
    </FieldContainer>
  );
}
function NumberField({
  disabled,
  defaultValue,
  registerPatchCallback,
  onSubmit,
}: {
  registerPatchCallback?: (callback: PatchCallback) => void;
  onSubmit?: OnSubmit;
  disabled: boolean;
  defaultValue?: number | null;
}) {
  const [value, setValue] = useState(defaultValue || 0);
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
            value: Number(ref.current?.value) || 0,
          },
        ];
      });
    }
  }, []);

  return (
    <FieldContainer>
      <Input
        ref={ref}
        disabled={loading}
        defaultValue={value ?? 0}
        onChange={(e) => setValue(Number(e.target.value))}
        type="number"
      />
      {onSubmit && defaultValue !== value && (
        <SubmitButton
          loading={loading}
          onClick={() => {
            setLoading(true);
            onSubmit(async (path) => [
              {
                op: "replace",
                path,
                value: Number(ref.current?.value) || 0,
              },
            ]).finally(() => {
              setLoading(false);
            });
          }}
        />
      )}
    </FieldContainer>
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
    <FieldContainer>
      <Input
        ref={ref}
        disabled={loading}
        defaultValue={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
      {onSubmit && defaultValue !== value && (
        <SubmitButton
          loading={loading}
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
        />
      )}
    </FieldContainer>
  );
}

function FieldContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative p-4 border rounded border-card">{children}</div>
  );
}

function SubmitButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="sticky bottom-0">
      <div className="flex justify-end w-full py-2">
        <Button disabled={loading} onClick={onClick}>
          {loading ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
