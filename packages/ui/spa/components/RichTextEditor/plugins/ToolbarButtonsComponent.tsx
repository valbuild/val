import { useState, useRef, useEffect, forwardRef } from "react";
import type { EditorView } from "prosemirror-view";
import { toggleMark } from "prosemirror-commands";
import type { Schema } from "prosemirror-model";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Upload,
  Loader2,
  MousePointerClick,
  PanelTop,
  type LucideIcon,
} from "lucide-react";
import {
  getFormattingButtons,
  getCustomStyleButtons,
  getListButtons,
  getBlockTypeItems,
  detectCurrentBlockType,
  isMarkActive,
  isListActive,
  toggleList,
  applyBlockType,
  insertButton,
  insertDetailsBlock,
  insertImage,
  type LinkHelper,
  type RenderToolbarOptions,
} from "./formattingToolbarShared";
import type {
  EditorButtonVariant,
  EditorDetailsVariant,
  EditorImage,
  EditorLinkCatalogItem,
  EditorStyleConfig,
  ResolvedEditorFeatures,
} from "../types";
import { Button } from "../../designSystem/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../designSystem/dropdown-menu";
import { cn } from "../../designSystem/cn";
import { ImagePicker } from "./ImagePickerComponent";
import { MediaPickerList } from "../../MediaPicker/MediaPicker";
import type { GalleryEntry } from "../../MediaPicker/MediaPicker";
import { LinkCatalogPicker } from "./LinkCatalogPickerComponent";
import { LinkUrlEditor } from "./LinkUrlEditorComponent";

export interface ToolbarButtonsProps {
  view: EditorView;
  schema: Schema;
  features?: ResolvedEditorFeatures;
  linkHelper: LinkHelper;
  options?: RenderToolbarOptions;
  images?: EditorImage[];
  imageModuleEntries?: Record<string, Record<string, Record<string, unknown>>>;
  imageGetUrl?: (filePath: string) => string;
  onImageUpload?: (file: File, insertIntoView: (ref: string, opts?: { previewUrl?: string; width?: number; height?: number; mimeType?: string }) => string[] | null) => Promise<{ filePath: string; ref: string } | null>;
  imageAccept?: string;
  uploadProgress?: number | null;
  buttonVariants?: EditorButtonVariant[];
  detailsVariants?: EditorDetailsVariant[];
  linkCatalog?: EditorLinkCatalogItem[];
  styleConfig?: EditorStyleConfig;
}

const MARK_ICON: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  code: Code,
  link: Link,
};

const LIST_ICON: Record<string, LucideIcon> = {
  bullet_list: List,
  ordered_list: ListOrdered,
};

const HEADING_ICON: Record<number, LucideIcon> = {
  1: Heading1,
  2: Heading2,
  3: Heading3,
  4: Heading4,
  5: Heading5,
  6: Heading6,
};

function Separator() {
  return (
    <div
      className="mx-0.5 w-px self-stretch bg-border-primary"
      role="separator"
    />
  );
}

export function ToolbarButtons({
  view,
  schema,
  features,
  linkHelper,
  options,
  images,
  imageModuleEntries,
  imageGetUrl,
  onImageUpload,
  imageAccept,
  uploadProgress,
  buttonVariants,
  detailsVariants,
  linkCatalog,
  styleConfig,
}: ToolbarButtonsProps) {
  const markButtons = getFormattingButtons(schema, features);
  const customStyleButtons = getCustomStyleButtons(schema, styleConfig);
  const listButtons = getListButtons(schema, features);

  const blockTypes = options?.showBlockTypeSelect
    ? getBlockTypeItems(schema, features)
    : [];
  const showBlockSelect = blockTypes.length > 1;
  const currentBlockType = showBlockSelect
    ? detectCurrentBlockType(view.state, blockTypes)
    : "paragraph";

  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div className="h-0" ref={dropdownContainerRef} />

      {showBlockSelect && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="min-w-[3.5rem]">
                {currentBlockType.startsWith("heading") &&
                  (() => {
                    const level = Number(
                      currentBlockType.replace("heading", ""),
                    );
                    const Icon = HEADING_ICON[level];
                    return Icon ? <Icon size={16} /> : currentBlockType;
                  })()}
                {!currentBlockType.startsWith("heading") &&
                  (blockTypes.find((bt) => bt.value === currentBlockType)
                    ?.label ??
                    "Normal")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent container={dropdownContainerRef.current}>
              {blockTypes.map((bt) => {
                const headingLevel = bt.attrs?.level as number | undefined;
                const HeadingIcon = headingLevel
                  ? HEADING_ICON[headingLevel]
                  : undefined;
                return (
                  <DropdownMenuItem
                    key={bt.value}
                    onClick={() => {
                      applyBlockType(view, schema, bt);
                      view.focus();
                    }}
                  >
                    {HeadingIcon ? <HeadingIcon size={16} /> : bt.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator />
        </>
      )}

      {markButtons.map((btn) => {
        const active = isMarkActive(view.state, btn.markType);
        const Icon = MARK_ICON[btn.markType.name];
        return (
          <Button
            key={btn.markType.name}
            variant="ghost"
            size="icon-sm"
            title={btn.title}
            className={cn({
              "text-accent": active,
              "stroke-[3px]": active,
            })}
            onClick={(e) => {
              e.preventDefault();
              if (btn.markType.name === "link") {
                linkHelper.handleLinkToggle(view, btn.markType);
              } else {
                toggleMark(btn.markType)(view.state, view.dispatch, view);
              }
              view.focus();
            }}
          >
            {Icon ? <Icon size={16} /> : btn.label}
          </Button>
        );
      })}

      {customStyleButtons.length > 0 && markButtons.length > 0 && <Separator />}

      {customStyleButtons.map((btn) => {
        const active = isMarkActive(view.state, btn.markType);
        return (
          <Button
            key={btn.markType.name}
            variant="ghost"
            size="icon-sm"
            title={btn.title}
            className={cn({
              "text-accent": active,
              "stroke-[3px]": active,
            })}
            onClick={(e) => {
              e.preventDefault();
              toggleMark(btn.markType)(view.state, view.dispatch, view);
              view.focus();
            }}
          >
            {btn.label}
          </Button>
        );
      })}

      {listButtons.length > 0 &&
        (markButtons.length > 0 || customStyleButtons.length > 0) && (
          <Separator />
        )}

      {listButtons.map((btn) => {
        const active = isListActive(view.state, btn.nodeType);
        const Icon = LIST_ICON[btn.nodeType.name];
        return (
          <Button
            key={btn.nodeType.name}
            variant="ghost"
            size="icon-sm"
            title={btn.title}
            className={cn({
              "text-accent": active,
              "stroke-[3px]": active,
            })}
            onClick={(e) => {
              e.preventDefault();
              toggleList(btn.nodeType, schema)(view.state, view.dispatch, view);
              view.focus();
            }}
          >
            {Icon ? <Icon size={16} /> : btn.label}
          </Button>
        );
      })}

      {schema.nodes.image &&
        (!features || features.image) &&
        ((images && images.length > 0) || imageModuleEntries || onImageUpload) && (
          <>
            <Separator />
            <ImageInsertDropdown
              view={view}
              schema={schema}
              images={images}
              imageModuleEntries={imageModuleEntries}
              imageGetUrl={imageGetUrl}
              onImageUpload={onImageUpload}
              imageAccept={imageAccept}
              uploadProgress={uploadProgress}
            />
          </>
        )}

      {buttonVariants &&
        buttonVariants.length > 0 &&
        (!features || features.button) && (
          <>
            <Separator />
            <ButtonInsertDropdown
              view={view}
              schema={schema}
              variants={buttonVariants}
              linkHelper={linkHelper}
              linkCatalog={linkCatalog}
              dropdownContainer={dropdownContainerRef.current}
            />
          </>
        )}

      {detailsVariants &&
        detailsVariants.length > 0 &&
        (!features || features.details) && (
          <>
            <Separator />
            <DetailsInsertDropdown
              view={view}
              schema={schema}
              variants={detailsVariants}
              dropdownContainer={dropdownContainerRef.current}
            />
          </>
        )}
    </>
  );
}

function ImageInsertDropdown({
  view,
  schema,
  images,
  imageModuleEntries,
  imageGetUrl,
  onImageUpload,
  imageAccept,
  uploadProgress,
}: {
  view: EditorView;
  schema: Schema;
  images?: EditorImage[];
  imageModuleEntries?: Record<string, Record<string, Record<string, unknown>>>;
  imageGetUrl?: (filePath: string) => string;
  onImageUpload?: (file: File, insertIntoView: (ref: string, opts?: { previewUrl?: string; width?: number; height?: number; mimeType?: string }) => string[] | null) => Promise<{ filePath: string; ref: string } | null>;
  imageAccept?: string;
  uploadProgress?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!pickerRef.current || !pickerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const hasPicker = !!imageModuleEntries || (images && images.length > 0);

  function handleFileSelect(file: File) {
    if (!onImageUpload) return;
    setUploading(true);
    onImageUpload(file, (ref, opts) => {
      return insertImage(view, schema, ref, opts);
    }).then((result) => {
      setUploading(false);
      if (result) {
        setOpen(false);
        view.focus();
      }
    });
  }

  return (
    <div className="relative flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Insert image"
        disabled={uploading}
        className={cn({ "text-accent stroke-[3px]": open })}
        onClick={(e) => {
          e.preventDefault();
          if (!hasPicker && onImageUpload) {
            fileInputRef.current?.click();
          } else {
            setOpen((prev) => !prev);
          }
        }}
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Image size={16} />}
      </Button>
      {uploading && uploadProgress !== null && uploadProgress !== undefined && (
        <span className="text-[10px] font-medium tabular-nums text-fg-secondary select-none">
          {uploadProgress}%
        </span>
      )}

      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept={imageAccept ?? "image/*"}
        onChange={(ev) => {
          const file = ev.currentTarget.files?.[0];
          if (file) handleFileSelect(file);
          ev.target.value = "";
        }}
      />

      {open && (
        <div
          ref={pickerRef}
          className={cn(
            "absolute left-0 top-full z-50 mt-1 rounded-md",
            "border border-border-primary bg-bg-primary shadow-xl",
            imageModuleEntries ? "min-w-[280px] p-0" : "min-w-[240px] p-2",
          )}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          {imageModuleEntries ? (
            <MediaPickerList
              moduleEntries={imageModuleEntries}
              isImage
              getUrl={imageGetUrl}
              autoFocus
              maxHeight={280}
              onSelect={(entry: GalleryEntry) => {
                insertImage(view, schema, entry.filePath);
                setOpen(false);
                view.focus();
              }}
              onEscape={() => setOpen(false)}
            />
          ) : images && images.length > 0 ? (
            <ImagePicker
              images={images}
              currentSrc=""
              onSelect={(url) => {
                insertImage(view, schema, url);
                setOpen(false);
                view.focus();
              }}
            />
          ) : null}
          {onImageUpload && (
            <>
              {hasPicker && (
                <div className="mx-2 my-1 border-t border-border-primary" />
              )}
              <div className={cn("flex items-center gap-2", hasPicker ? "px-2 pb-2" : "")}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={uploading}
                  onClick={(e) => {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }}
                >
                  {uploading ? (
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <Upload size={14} className="mr-1.5" />
                  )}
                  {uploading
                    ? uploadProgress !== null && uploadProgress !== undefined
                      ? `Uploading ${uploadProgress}%`
                      : "Uploading..."
                    : "Upload image"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetailsInsertDropdown({
  view,
  schema,
  variants,
  dropdownContainer,
}: {
  view: EditorView;
  schema: Schema;
  variants: EditorDetailsVariant[];
  dropdownContainer: HTMLElement | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Insert details">
          <PanelTop size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent container={dropdownContainer}>
        {variants.map((dv) => (
          <DropdownMenuItem
            key={dv.variant}
            onClick={() => {
              insertDetailsBlock(view, schema, dv.variant);
              view.focus();
            }}
          >
            {dv.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function resolveLinkCatalog(
  variant: EditorButtonVariant,
): EditorLinkCatalogItem[] | undefined {
  if (Array.isArray(variant.link)) return variant.link;
  return undefined;
}

function ButtonInsertDropdown({
  view,
  schema,
  variants,
  dropdownContainer,
}: {
  view: EditorView;
  schema: Schema;
  variants: EditorButtonVariant[];
  linkHelper: LinkHelper;
  linkCatalog?: EditorLinkCatalogItem[];
  dropdownContainer: HTMLElement | null;
}) {
  const [pendingLinkVariant, setPendingLinkVariant] =
    useState<EditorButtonVariant | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingLinkVariant) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!pickerRef.current || !pickerRef.current.contains(target)) {
        setPendingLinkVariant(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pendingLinkVariant]);

  function handleLinkVariantClick(bv: EditorButtonVariant) {
    setPendingLinkVariant(bv);
  }

  function handleHrefSelected(href: string) {
    if (!pendingLinkVariant) return;
    insertButton(view, schema, pendingLinkVariant, href);
    setPendingLinkVariant(null);
    view.focus();
  }

  function handlePickerClose() {
    setPendingLinkVariant(null);
    view.focus();
  }

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Insert button"
            className={cn({ "text-accent stroke-[3px]": !!pendingLinkVariant })}
          >
            <MousePointerClick size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent container={dropdownContainer}>
          {variants.map((bv) => (
            <DropdownMenuItem
              key={bv.variant}
              onClick={() => {
                if (bv.link) {
                  handleLinkVariantClick(bv);
                } else {
                  insertButton(view, schema, bv);
                  view.focus();
                }
              }}
            >
              {bv.label}
              {bv.link && (
                <span className="ml-1.5 text-xs text-fg-secondary-alt">
                  (link)
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {pendingLinkVariant && (
        <ButtonLinkPicker
          ref={pickerRef}
          linkCatalog={resolveLinkCatalog(pendingLinkVariant)}
          onSelectHref={handleHrefSelected}
          onClose={handlePickerClose}
        />
      )}
    </div>
  );
}

const ButtonLinkPicker = forwardRef<
  HTMLDivElement,
  {
    linkCatalog?: EditorLinkCatalogItem[];
    onSelectHref: (href: string) => void;
    onClose: () => void;
  }
>(function ButtonLinkPicker({ linkCatalog, onSelectHref, onClose }, ref) {
  const hasCatalog = linkCatalog && linkCatalog.length > 0;

  return (
    <div
      ref={ref}
      className={cn(
        "absolute left-0 top-full z-50 mt-1 rounded-md",
        "border border-border-primary bg-bg-primary shadow-xl",
        hasCatalog
          ? "min-w-[280px] flex flex-col"
          : "flex items-center gap-1.5 p-1.5",
      )}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {hasCatalog ? (
        <LinkCatalogPicker
          catalog={linkCatalog}
          currentHref={null}
          onApplyLink={(item) => onSelectHref(item.href.trim())}
          onRemoveLink={null}
          onClose={onClose}
        />
      ) : (
        <LinkUrlEditor
          currentHref=""
          isNewLink
          onApply={(href) => onSelectHref(href)}
          onUnlink={onClose}
          onClose={onClose}
        />
      )}
    </div>
  );
});
