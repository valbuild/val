import {
  AllRichTextOptions,
  FILE_REF_PROP,
  FileMetadata,
  ImageMetadata,
  ImageSource,
  Internal,
  Json,
  NumberSchema,
  RichTextSource,
  SerializedBooleanSchema,
  SerializedNumberSchema,
  SerializedRichTextSchema,
  SerializedSchema,
  SerializedStringSchema,
  SourcePath,
  StringSchema,
  VAL_EXTENSION,
  ValidationError,
  ValidationErrors,
} from "@valbuild/core";
import type { Operation, Patch } from "@valbuild/core/patch";
import { useState, useEffect, useRef, ChangeEvent } from "react";
import {
  RemirrorJSON as ValidRemirrorJSON,
  getMimeType,
  mimeTypeToFileExt,
  remirrorToRichTextSource,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { createFilename, readImage } from "../utils/readImage";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useValUIContext } from "./ValUIContext";
import classNames from "classnames";
import { CalendarIcon, File } from "lucide-react";
import { RichTextEditor, useRichTextEditor } from "./RichTextEditor";
import { RemirrorJSON } from "@remirror/core";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { OnSubmit, SubmitStatus, useBounceSubmit } from "./SubmitStatus";
import { useValFromPath } from "./ValStoreContext";
import { Preview } from "./Preview";
import { isJsonArray } from "../utils/isJsonArray";
import { Checkbox } from "./ui/checkbox";
import { SerializedDateSchema } from "@valbuild/core";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { format } from "date-fns";

export type InitOnSubmit = (path: SourcePath) => OnSubmit;

export function ValFormField({
  path,
  source: source,
  schema: schema,
  initOnSubmit,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
}) {
  const onSubmit = initOnSubmit(path);
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "string"
  ) {
    return (
      <BasicInputField
        path={path}
        defaultValue={source}
        schema={schema}
        onSubmit={onSubmit}
        type="text"
        validate={(path, value) => {
          return new StringSchema(
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
          ).validate(path, value);
        }}
      />
    );
  }
  if (
    (typeof source === "number" || source === null) &&
    schema?.type === "number"
  ) {
    return (
      <BasicInputField
        path={path}
        defaultValue={source?.toString()}
        schema={schema}
        onSubmit={onSubmit}
        type="number"
        validate={(path, value) => {
          return new NumberSchema(schema.options).validate(path, Number(value));
        }}
      />
    );
  }
  if (
    (typeof source === "boolean" || source === null) &&
    schema?.type === "boolean"
  ) {
    return (
      <BooleanField
        path={path}
        defaultValue={source}
        schema={schema}
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
        onSubmit={onSubmit}
        selector={schema.path}
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
        defaultValue={source as RichTextSource<AllRichTextOptions>}
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
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "union" &&
    typeof schema.key !== "string"
  ) {
    if (schema.key.type !== "literal") {
      console.error(
        "Val: found union with non-literal key type. Check schema corresponding to path:",
        path
      );
    } else {
      return (
        <StringUnionField
          path={path}
          options={schema.items.flatMap((item) =>
            item.type === "literal" ? [item.value] : []
          )}
          onSubmit={onSubmit}
          defaultValue={source}
        />
      );
    }
  }

  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "date"
  ) {
    return (
      <DateField
        path={path}
        defaultValue={source}
        onSubmit={onSubmit}
        schema={schema}
      />
    );
  }

  console.warn(
    `Unsupported schema: ${
      schema.type
    } (source type: ${typeof source}) source:`,
    source
  );
  throw Error(
    `Unsupported schema: ${schema.type} (source type: ${typeof source}) source:`
  );
}

function DateField({
  defaultValue,
  schema,
  onSubmit,
}: {
  path: SourcePath;
  defaultValue?: string | null;
  schema: SerializedDateSchema;
  onSubmit?: OnSubmit;
}) {
  const [date, setDate] = useState<Date>();
  useEffect(() => {
    try {
      if (defaultValue) {
        const date = new Date(defaultValue);
        if (!isNaN(date.getTime())) {
          setDate(date);
        }
      }
    } catch (err) {
      console.error("Invalid date", defaultValue);
    }
  }, [defaultValue]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-[280px] justify-start text-left font-normal",
            !date && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="w-4 h-4 mr-2" />
          {date ? format(date, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown-buttons"
          defaultMonth={date}
          fromDate={
            schema.options?.from ? new Date(schema.options.from) : undefined
          }
          toDate={schema.options?.to ? new Date(schema.options.to) : undefined}
          selected={date}
          onSelect={(date) => {
            if (onSubmit) {
              setDate(date);
              onSubmit(async (path) => {
                if (!date) {
                  return [
                    {
                      op: "replace",
                      path,
                      value: null,
                    },
                  ];
                }
                return [
                  {
                    op: "replace",
                    path,
                    value: format(date, "yyyy-MM-dd"),
                  },
                ];
              }).catch((err) => {
                console.error("Could not save date", err);
                setDate(undefined);
              });
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function BooleanField({
  defaultValue,
  onSubmit,
}: {
  path: SourcePath;
  defaultValue?: boolean | null;
  schema: SerializedBooleanSchema;
  onSubmit?: OnSubmit;
}) {
  const [value, setValue] = useState<boolean | null>(defaultValue ?? null);
  const [loading, setLoading] = useState(false);
  return (
    <FieldContainer>
      <div className="flex items-center justify-between">
        <Checkbox
          checked={value || false}
          onCheckedChange={(checkedValue) => {
            const value =
              typeof checkedValue === "boolean" ? checkedValue : null;
            setValue(value);
            if (onSubmit) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve([
                  {
                    op: "replace",
                    path,
                    value,
                  },
                ])
              ).finally(() => {
                setLoading(false);
              });
            }
          }}
        />
        <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
      </div>
    </FieldContainer>
  );
}

function StringUnionField({
  onSubmit,
  options,
  defaultValue,
}: {
  path: string;
  options: string[];
  onSubmit?: OnSubmit;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState<string>();
  useEffect(() => {
    if (defaultValue !== null && defaultValue !== undefined) {
      setValue(defaultValue);
    }
  }, [defaultValue]);
  const [loading, setLoading] = useState(false);
  return (
    <FieldContainer>
      <div className="flex items-center justify-between">
        <Select
          value={value}
          onValueChange={(value) => {
            setValue(value);
            if (onSubmit) {
              setLoading(true);
              onSubmit((path) =>
                Promise.resolve(createStringUnionPatch(path, value))
              ).finally(() => {
                setLoading(false);
              });
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
      </div>
    </FieldContainer>
  );
}

export function createStringUnionPatch(
  path: string[],
  value: string | null
): Patch {
  return [
    {
      value,
      op: "replace",
      path,
    },
  ];
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
  metadata: Partial<ImageMetadata | FileMetadata>
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
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const url = defaultValue && Internal.convertFileSource(defaultValue).url;
    setUrl(url);
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
          <div className="absolute top-6 right-6 text-background">
            <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
          </div>
          <input
            hidden
            disabled={loading}
            id={`img_input:${path}`}
            type="file"
            onChange={(ev) => {
              if (onSubmit) {
                readFile(ev)
                  .then((res) => {
                    const data = { src: res.src, filename: res.filename };
                    setData(data);
                    let metadata: FileMetadata | undefined;
                    if (res.mimeType) {
                      metadata = {
                        sha256: res.sha256,
                        mimeType: res.mimeType,
                      };
                    }
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
                    });
                  })
                  .catch((err) => {
                    console.error(err.message);
                    setData(null);
                  });
              }
            }}
          />
        </div>
      </div>
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
  const [data, setData] = useState<string>();
  const [metadata, setMetadata] = useState<ImageMetadata>();
  const [loading, setLoading] = useState(false);
  const [hotspot, setHotspot] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(
      defaultValue &&
        "/api/val/files/public" + Internal.convertFileSource(defaultValue).url
    );
    setHotspot(defaultValue?.metadata?.hotspot);
  }, [defaultValue]);

  return (
    <FieldContainer>
      <div className="pr-6 w-fit">
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
                src={data || url}
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
                  if (onSubmit) {
                    setLoading(true);
                    onSubmit(async (path) => {
                      if (metadata) {
                        return createFileMetadataPatch(path, {
                          ...metadata,
                          hotspot: {
                            x: hotspotX,
                            y: hotspotY,
                            width: 1,
                            height: 1,
                          },
                        });
                      } else if (defaultValue) {
                        return createFileMetadataPatch(path, {
                          ...defaultValue.metadata,
                          hotspot: {
                            x: hotspotX,
                            y: hotspotY,
                            width: 1,
                            height: 1,
                          },
                        });
                      } else {
                        throw new Error("No metadata to update");
                      }
                    }).finally(() => {
                      setLoading(false);
                    });
                  }
                }}
              />
            </div>
          ) : (
            <div>Select image below</div>
          )}
        </div>
        <div className="relative p-4 border border-t-0 rounded-b-sm bg-background border-input">
          <label
            htmlFor={`img_input:${path}`}
            className="block px-1 py-2 text-sm text-center rounded-md cursor-pointer bg-primary text-background"
          >
            Update
          </label>
          <div className="absolute top-6 right-6 text-background">
            <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
          </div>
          <input
            hidden
            disabled={loading}
            id={`img_input:${path}`}
            type="file"
            accept="image/*"
            onChange={(ev) => {
              if (onSubmit) {
                readImage(ev)
                  .then((res) => {
                    const data = { src: res.src, filename: res.filename };
                    setData(res.src);
                    setHotspot(undefined);
                    let metadata: ImageMetadata | undefined;
                    if (res.width && res.height && res.mimeType) {
                      metadata = {
                        sha256: res.sha256,
                        width: res.width,
                        height: res.height,
                        mimeType: res.mimeType,
                      };
                      setMetadata(metadata);
                    }
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
                    });
                  })
                  .catch((err) => {
                    console.error(err.message);
                  });
              }
            }}
          />
        </div>
      </div>
    </FieldContainer>
  );
}

function createRichTextPatch(
  path: string[],
  content?: ValidRemirrorJSON
): Patch {
  console.log("content", content);
  const { blocks, files } = content
    ? remirrorToRichTextSource(content)
    : {
        blocks: [],
        files: {},
      };
  console.log("blocks", blocks);
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
        })
      );
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
  defaultValue?: RichTextSource<AllRichTextOptions>;
}) {
  const [didChange, setDidChange] = useState(false);
  const [content, setContent] = useState<RemirrorJSON>();
  useEffect(() => {
    setDidChange(false);
    setContent(undefined);
  }, [defaultValue]);
  const { state, manager } = useRichTextEditor(
    defaultValue && richTextToRemirror(defaultValue)
  );

  const submitStatus = useBounceSubmit<RemirrorJSON | undefined>(
    didChange,
    content,
    onSubmit,
    async (value, patchPath) => {
      if (!value) {
        return [];
      }
      const validRemirrorJSON = ValidRemirrorJSON.safeParse(content);
      if (validRemirrorJSON.success) {
        return createRichTextPatch(patchPath, validRemirrorJSON.data);
      } else {
        return [];
      }
    }
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
        submitStatus={submitStatus}
      />
    </FieldContainer>
  );
}

function KeyOfField({
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

function BasicInputField({
  defaultValue,
  path,
  onSubmit,
  type,
  validate,
}:
  | {
      onSubmit?: OnSubmit;
      path: SourcePath;
      schema: SerializedStringSchema;
      defaultValue?: string | null;
      type: "text";
      validate: (path: SourcePath, value: string) => ValidationErrors;
    }
  | {
      onSubmit?: OnSubmit;
      path: SourcePath;
      schema: SerializedNumberSchema;
      defaultValue?: string | null;
      type: "number";
      validate: (path: SourcePath, value: string) => ValidationErrors;
    }) {
  const [value, setValue] = useState(defaultValue || "");
  const ref = useRef<HTMLInputElement>(null);
  const [didChange, setDidChange] = useState(false);
  useEffect(() => {
    setDidChange(false);
  }, [path]);
  const validationErrors = validate(path, value);
  const submitStatus = useBounceSubmit(
    didChange,
    value,
    onSubmit,
    async (value, path) => [
      {
        op: "replace",
        path,
        value: type === "number" ? Number(value) : value,
      },
    ],
    ref.current?.value ?? null
  );
  return (
    <FieldContainer>
      <div className="relative flex gap-2 pr-6">
        <Input
          ref={ref}
          defaultValue={value ?? ""}
          onChange={(e) => {
            setDidChange(true);
            setValue(e.target.value);
          }}
          type={type}
        />
        <div className="absolute top-2 -right-4">
          <SubmitStatus submitStatus={submitStatus} />
        </div>
      </div>
      {validationErrors && validationErrors[path] ? (
        <InlineValidationErrors
          errors={(validationErrors && validationErrors[path]) || []}
        />
      ) : (
        <span></span>
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
  return <div className={classNames("pl-4 pt-4", className)}>{children}</div>;
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
      <div className="grid justify-start gap-2 text">
        {validationErrors ? (
          <InlineValidationErrors errors={validationErrors || []} />
        ) : (
          <span></span>
        )}
        <Button disabled={loading || !enabled} onClick={onClick}>
          {loading
            ? isProxy
              ? "Staging..."
              : "Saving..."
            : isProxy
            ? "Stage"
            : "Save"}
        </Button>{" "}
      </div>
    </div>
  );
}
