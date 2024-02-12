import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  FileMetadata,
  ImageMetadata,
  ImageSource,
  Internal,
  Json,
  RichTextSource,
  SerializedRichTextSchema,
  SerializedSchema,
  SerializedStringSchema,
  SourcePath,
  StringSchema,
  VAL_EXTENSION,
  ValidationError,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { useState, useEffect, useRef, ChangeEvent } from "react";
import {
  RemirrorJSON as ValidRemirrorJSON,
  getMimeType,
  mimeTypeToFileExt,
  parseRichTextSource,
  remirrorToRichTextSource,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { createFilename, readImage } from "../utils/readImage";
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
import { useValUIContext } from "./ValUIContext";
import classNames from "classnames";
import { File } from "lucide-react";
import { RichTextEditor, useRichTextEditor } from "./RichTextEditor";
import { RemirrorJSON } from "@remirror/core";

export type OnSubmit = (callback: PatchCallback) => Promise<void>;
export type InitOnSubmit = (path: SourcePath) => OnSubmit;

export function ValFormField({
  path,
  disabled,
  source: source,
  schema: schema,
  onSubmit,
}: {
  path: SourcePath;
  disabled: boolean;
  source: Json;
  schema: SerializedSchema;
  onSubmit?: OnSubmit;
}) {
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "string"
  ) {
    return (
      <StringField
        path={path}
        defaultValue={source}
        disabled={disabled}
        schema={schema}
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
        onSubmit={onSubmit}
        selector={schema.path}
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
        onSubmit={onSubmit}
        selector={schema.path}
      />
    );
  }
  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "richtext"
  ) {
    return (
      <RichTextField
        schema={schema}
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
        onSubmit={onSubmit}
        defaultValue={source as ImageSource}
      />
    );
  }

  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "file"
  ) {
    return (
      <FileField
        path={path}
        onSubmit={onSubmit}
        defaultValue={source as ImageSource}
      />
    );
  }

  return (
    <div>
      Unsupported schema: {schema.type} (source type: {typeof source} source:{" "}
      {JSON.stringify(source)})
    </div>
  );
}

export function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  metadata: FileMetadata | ImageMetadata | undefined
): Patch {
  const newFilePath = createFilename(data, filename, metadata);
  if (!newFilePath || !metadata) {
    return [];
  }
  return [
    {
      value: {
        [FILE_REF_PROP]: `/public/${newFilePath}`,
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
      filePath: `/public/${newFilePath}`,
    },
  ];
}

export function createFileMetadataPatch(
  path: string[],
  metadata: ImageMetadata | FileMetadata
): Patch {
  const metadataPath = path.concat("metadata");
  return [
    {
      value: metadata,
      op: "replace",
      path: metadataPath,
    },
  ];
}

const textEncoder = new TextEncoder();

export function readFile(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    sha256: string;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const file = ev.currentTarget.files?.[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const sha256 = Internal.getSHA256Hash(textEncoder.encode(result));
        const mimeType = getMimeType(result);
        resolve({
          src: result,
          filename: file?.name,
          sha256,
          mimeType,
          fileExt: mimeType && mimeTypeToFileExt(mimeType),
        });
      } else if (!result) {
        reject({ message: "Empty result" });
      } else {
        reject({ message: "Unexpected file result type", result });
      }
    });
    if (file) {
      reader.readAsDataURL(file);
    }
  });
}
function FileField({
  path,
  defaultValue,
  onSubmit,
}: {
  path: string;
  onSubmit?: OnSubmit;
  defaultValue?: ImageSource;
}) {
  const [data, setData] = useState<{ filename?: string; src: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<FileMetadata>();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const url = defaultValue && Internal.convertFileSource(defaultValue).url;
    setUrl(url);
    // TODO: get filename
    // const filename = url
    //   ?.split("/")
    //   .pop()
    //   ?.slice(
    //     0,
    //     -(metadata?.sha256
    //       ? metadata.sha256.length + "?sha256=".length
    //       : url.length)
    //   );
    // console.log("url", url, "filename", filename);
    // if (filename && data) {
    //   setData({ ...data, filename });
    // }
  }, [defaultValue]);

  return (
    <FieldContainer>
      <div className="w-fit">
        <div
          className="flex flex-col justify-start p-2 border border-b-0 rounded-sm rounded-b-none gap-y-4 bg-background text-foreground border-input"
          key={path}
        >
          {data || url ? (
            <div className="relative flex flex-col justify-center items-center min-h-[100px] min-w-[200px]">
              <div>
                <File />
              </div>
              <div>{data?.filename}</div>
            </div>
          ) : (
            <div>Select file below</div>
          )}
        </div>
        <div className="p-4 border border-t-0 rounded-b-sm bg-background border-input">
          <label
            htmlFor={`img_input:${path}`}
            className="block px-1 py-2 text-sm text-center rounded-md cursor-pointer bg-primary text-background"
          >
            Update
          </label>
          <input
            hidden
            id={`img_input:${path}`}
            type="file"
            onChange={(ev) => {
              readFile(ev)
                .then((res) => {
                  setData({ src: res.src, filename: res.filename });
                  if (res.mimeType) {
                    setMetadata({
                      sha256: res.sha256,
                      mimeType: res.mimeType,
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
        </div>
      </div>
      {onSubmit && (
        <SubmitButton
          loading={loading}
          enabled={
            !!data ||
            defaultValue?.metadata?.mimeType !== metadata?.mimeType ||
            defaultValue?.metadata?.sha256 !== metadata?.sha256
          }
          onClick={() => {
            if (data) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(
                  createFilePatch(
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
            } else if (metadata) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(createFileMetadataPatch(path, metadata))
              ).finally(() => {
                setLoading(false);
                setData(null);
                setMetadata(undefined);
              });
            }
          }}
        />
      )}
    </FieldContainer>
  );
}

function ImageField({
  path,
  defaultValue,
  onSubmit,
}: {
  path: string;
  onSubmit?: OnSubmit;
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
      <div className="w-fit">
        <div
          className="flex flex-col justify-start p-2 border border-b-0 rounded-sm rounded-b-none gap-y-4 bg-background text-foreground border-input"
          key={path}
        >
          {data || url ? (
            <div className="relative">
              {hotspot && (
                <div
                  className="rounded-full h-[12px] w-[12px] bg-background mix-blend-difference border-accent border-2 absolute pointer-events-none"
                  style={{
                    top: `${hotspot.y * 100}%`,
                    left: `${hotspot.x * 100}%`,
                  }}
                />
              )}
              <img
                src={data?.src || url}
                draggable={false}
                className="object-contain w-full max-h-[500px]"
                style={{
                  cursor: "crosshair",
                }}
                onClick={(ev) => {
                  // compute hotspot position based on mouse click:
                  const { width, height, left, top } =
                    ev.currentTarget.getBoundingClientRect();
                  const hotspotX = (ev.clientX - 6 - left) / width;
                  const hotspotY = (ev.clientY - 6 - top) / height;
                  setHotspot({
                    x: hotspotX,
                    y: hotspotY,
                    width: 1,
                    height: 1,
                  });
                }}
              />
            </div>
          ) : (
            <div>Select image below</div>
          )}
        </div>
        <div className="p-4 border border-t-0 rounded-b-sm bg-background border-input">
          <label
            htmlFor={`img_input:${path}`}
            className="block px-1 py-2 text-sm text-center rounded-md cursor-pointer bg-primary text-background"
          >
            Update
          </label>
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
        </div>
      </div>
      {onSubmit && (
        <SubmitButton
          loading={loading}
          enabled={
            !!data ||
            defaultValue?.metadata?.hotspot?.height !== hotspot?.height ||
            defaultValue?.metadata?.hotspot?.width !== hotspot?.width ||
            defaultValue?.metadata?.hotspot?.x !== hotspot?.x ||
            defaultValue?.metadata?.hotspot?.y !== hotspot?.y ||
            defaultValue?.metadata?.width !== metadata?.width ||
            defaultValue?.metadata?.height !== metadata?.height ||
            defaultValue?.metadata?.mimeType !== metadata?.mimeType ||
            defaultValue?.metadata?.sha256 !== metadata?.sha256
          }
          onClick={() => {
            if (data) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(
                  createFilePatch(
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
            } else if (metadata) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(createFileMetadataPatch(path, metadata))
              ).finally(() => {
                setLoading(false);
                setData(null);
                setMetadata(undefined);
              });
            }
          }}
        />
      )}
    </FieldContainer>
  );
}

function createRichTextPatch(path: string[], content?: ValidRemirrorJSON) {
  const { templateStrings, exprs, files } = content
    ? remirrorToRichTextSource(content)
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
  schema,
  onSubmit,
}: {
  onSubmit?: OnSubmit;
  schema: SerializedRichTextSchema;
  defaultValue?: RichTextSource<AnyRichTextOptions>;
}) {
  const [didChange, setDidChange] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<RemirrorJSON>();
  useEffect(() => {
    setDidChange(true);
    setContent(undefined);
  }, [defaultValue]);
  const { state, manager } = useRichTextEditor(
    defaultValue && richTextToRemirror(parseRichTextSource(defaultValue))
  );

  return (
    <FieldContainer>
      <RichTextEditor
        options={schema.options}
        onChange={(content) => {
          setDidChange(true);
          setContent(content);
        }}
        state={state}
        manager={manager}
      />
      {onSubmit && (
        <SubmitButton
          loading={loading}
          enabled={didChange}
          onClick={() => {
            if (content) {
              setLoading(true);
              const validRemirrorJSON = ValidRemirrorJSON.safeParse(content);
              if (validRemirrorJSON.success) {
                onSubmit(async (path) =>
                  createRichTextPatch(path, validRemirrorJSON.data)
                ).finally(() => {
                  setLoading(false);
                  setDidChange(false);
                });
              } else {
                setLoading(false);
                alert(
                  "Could not parse Rich Text\n" +
                    JSON.stringify(validRemirrorJSON.error, null, 2)
                );
              }
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
  onSubmit,
  selector,
}: {
  onSubmit?: OnSubmit;
  disabled: boolean;
  defaultValue?: string | number | null;
  selector: SourcePath;
}) {
  return <div>TODO</div>;
  // const valModule = useValModuleFromPath(selector);
  // const getValuesFromModule = (module: typeof valModule) => {
  //   if (Array.isArray(module.moduleSource)) {
  //     return {
  //       type: "number",
  //       values: Object.keys(module.moduleSource).map((key) => parseInt(key)),
  //     };
  //   }
  //   return {
  //     type: "string",
  //     values: Object.keys(module.moduleSource ?? ["ERROR fetching source"]),
  //   };
  // };
  // const typeAndValues = getValuesFromModule(valModule);
  // const [value, setValue] = useState(defaultValue || typeAndValues.values[0]);
  // const [loading, setLoading] = useState(false);
  // useEffect(() => {
  //   setLoading(disabled);
  // }, [disabled]);

  // const parse = (value: string) => {
  //   if (typeAndValues.type === "number") {
  //     if (value === "") {
  //       throw new Error("Value cannot be empty");
  //     }
  //     if (Number.isNaN(Number(value))) {
  //       throw new Error("Value was not a number: " + JSON.stringify(value));
  //     }
  //     return Number(value);
  //   }
  //   return value;
  // };

  // return (
  //   <FieldContainer>
  //     <Select
  //       defaultValue={value.toString()}
  //       disabled={loading}
  //       onValueChange={(value) => {
  //         setValue(parse(value));
  //       }}
  //     >
  //       <SelectTrigger>
  //         <SelectValue placeholder="Select a value" />
  //       </SelectTrigger>
  //       <SelectContent>
  //         {typeAndValues.values.map((value) => (
  //           <SelectItem key={value} value={value.toString()}>
  //             {value.toString()}
  //           </SelectItem>
  //         ))}
  //       </SelectContent>
  //     </Select>
  //     {onSubmit && (
  //       <SubmitButton
  //         loading={loading}
  //         enabled={defaultValue !== value}
  //         onClick={() => {
  //           setLoading(true);
  //           onSubmit(async (path) => [
  //             {
  //               op: "replace",
  //               path,
  //               value: value,
  //             },
  //           ]).finally(() => {
  //             setLoading(false);
  //           });
  //         }}
  //       />
  //     )}
  //   </FieldContainer>
  // );
}

function NumberField({
  disabled,
  defaultValue,
  onSubmit,
}: {
  onSubmit?: OnSubmit;
  disabled: boolean;
  defaultValue?: number | null;
}) {
  const [value, setValue] = useState(defaultValue || 0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(disabled);
  }, [disabled]);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <FieldContainer>
      <Input
        ref={ref}
        disabled={loading}
        defaultValue={value ?? 0}
        onChange={(e) => setValue(Number(e.target.value))}
        type="number"
      />
      {onSubmit && (
        <SubmitButton
          loading={loading}
          enabled={defaultValue !== value}
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
  path,
  schema,
  onSubmit,
}: {
  onSubmit?: OnSubmit;
  path: SourcePath;
  schema: SerializedStringSchema;
  disabled: boolean;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue || "");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(disabled);
  }, [disabled]);
  const ref = useRef<HTMLInputElement>(null);

  const actualSchema = new StringSchema(
    schema.options
      ? {
          ...schema.options,
          regexp: schema.options.regexp
            ? new RegExp(
                schema.options.regexp.source,
                schema.options.regexp.flags
              )
            : undefined,
        }
      : undefined
  );
  const validationErrors = actualSchema.validate(path, value);

  return (
    <FieldContainer>
      <Input
        ref={ref}
        disabled={loading}
        defaultValue={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
      {onSubmit && (
        <SubmitButton
          validationErrors={validationErrors && validationErrors[path]}
          loading={loading}
          enabled={defaultValue !== value && !validationErrors}
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

function InlineValidationErrors({ errors }: { errors: ValidationError[] }) {
  return (
    <div className="flex flex-col p-2 text-sm rounded-md gap-y-1 text-destructive-foreground bg-destructive">
      {errors.map((error, i) => (
        <div key={i}>{error.message}</div>
      ))}
    </div>
  );
}

export function FieldContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames("relative max-w-lg px-4 pt-4", className)}>
      {children}
    </div>
  );
}

export function SubmitButton({
  loading,
  enabled,
  validationErrors,
  onClick,
}: {
  loading: boolean;
  enabled: boolean;
  validationErrors?: false | ValidationError[];
  onClick: () => void;
}) {
  const { session } = useValUIContext();
  const isProxy = session.status === "success" && session.data.mode === "proxy";
  return (
    <div className="sticky bottom-0 m-4 mt-2 ml-0">
      <div className="flex justify-start w-full gap-2 text-sm">
        <Button disabled={loading || !enabled} onClick={onClick}>
          {loading
            ? isProxy
              ? "Staging..."
              : "Saving..."
            : isProxy
            ? "Stage"
            : "Save"}
        </Button>{" "}
        {validationErrors ? (
          <InlineValidationErrors errors={validationErrors || []} />
        ) : (
          <span></span>
        )}
      </div>
    </div>
  );
}
