import {
  useRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { EditorState, Selection } from "prosemirror-state";
import type { Node as PMNode, MarkType } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { compare } from "fast-json-patch";

import { buildSchema } from "./schema";
import { parseEditorDocument, serializeEditorDocument } from "./serialize";
import {
  buildKeymap,
  buildInputRules,
  createDiffPlugin,
  diffPluginKey,
  createErrorPlugin,
  errorPluginKey,
  createFixedToolbarPlugin,
  createFloatingToolbarPlugin,
  createGutterPlugin,
  createErrorTooltipPlugin,
  createLinkCatalogPlugin,
  createLinkClickPlugin,
  createImageNodeView,
  createSchemaValidationPlugin,
  applySchemaViolationFix,
} from "./plugins";
import { createLinkHelper } from "./plugins/formattingToolbarShared";
import type {
  EditorDocument,
  EditorFeatures,
  EditorError,
  EditorChangePayload,
  EditorLinkCatalogItem,
  EditorImage,
  EditorButtonVariant,
  EditorDetailsVariant,
  RichTextEditorRef,
  ImageSelectRenderer,
  LinkPickerState,
} from "./types";
import { ImagePicker } from "./plugins/ImagePickerComponent";
import { MediaPickerList } from "../MediaPicker/MediaPicker";
import type { GalleryEntry } from "../MediaPicker/MediaPicker";
import { useModuleMediaEntries } from "../MediaPicker/useModuleMediaEntries";
import { LinkCatalogPicker } from "./plugins/LinkCatalogPickerComponent";
import { LinkUrlEditor } from "./plugins/LinkUrlEditorComponent";
import { DEFAULT_FEATURES, type ResolvedEditorFeatures } from "./types";
import {
  createButtonAtomNodeView,
  createButtonEditableNodeView,
} from "./plugins/buttonNodeView";
import { createDetailsNodeView } from "./plugins/detailsNodeView";
import type { ModuleFilePath } from "@valbuild/core";

function LinkPickerOverlay({
  state,
  useFixedPosition,
  onApplyLink,
  onRemoveLink,
  onApplyUrl,
  onUnlink,
  onClose,
}: {
  state: LinkPickerState;
  useFixedPosition?: boolean;
  onApplyLink: (item: EditorLinkCatalogItem) => void;
  onRemoveLink: () => void;
  onApplyUrl: (href: string) => void;
  onUnlink: () => void;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (overlayRef.current && !overlayRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  const isCatalog = state.kind === "catalog";
  const positionClass = useFixedPosition ? "fixed" : "absolute";

  return (
    <div
      ref={overlayRef}
      className={
        isCatalog
          ? `${positionClass} z-[60] flex flex-col rounded-md border border-border-primary bg-bg-primary shadow-xl min-w-[280px]`
          : `${positionClass} z-[60] flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-primary p-1.5 shadow-xl`
      }
      style={{
        left: state.anchorRect.left,
        top: state.anchorRect.top,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {isCatalog && state.catalog ? (
        <LinkCatalogPicker
          catalog={state.catalog}
          currentHref={state.currentHref}
          onApplyLink={onApplyLink}
          onRemoveLink={state.currentHref !== null ? onRemoveLink : null}
          onClose={onClose}
        />
      ) : (
        <LinkUrlEditor
          currentHref={state.currentHref ?? ""}
          isNewLink={state.isNewLink ?? true}
          onApply={onApplyUrl}
          onUnlink={onUnlink}
          onClose={onClose}
        />
      )}
    </div>
  );
}

function resolveSelectionForNewDoc(
  oldSelection: Selection,
  newDoc: PMNode,
): Selection {
  const maxPos = newDoc.content.size;
  const anchor = Math.min(oldSelection.anchor, maxPos);
  try {
    return Selection.near(newDoc.resolve(anchor));
  } catch {
    return Selection.atStart(newDoc);
  }
}

export interface RichTextEditorProps {
  value?: EditorDocument;
  defaultValue?: EditorDocument;
  onChange?: (payload: EditorChangePayload) => void;
  onDirty?: () => void;
  readOnly?: boolean;
  features?: Partial<EditorFeatures>;
  diffBase?: EditorDocument;
  errors?: EditorError[];
  errorKindClassName?: Record<string, string>;
  onApplyErrorFix?: (args: {
    path: string;
    kind: string;
    fixId: string;
  }) => void;
  linkCatalog?: EditorLinkCatalogItem[];
  images?: EditorImage[];
  imageModulePath?: ModuleFilePath;
  onImageUpload?: (
    file: File,
    insertIntoView: (
      ref: string,
      opts?: {
        previewUrl?: string;
        width?: number;
        height?: number;
        mimeType?: string;
      },
    ) => string[] | null,
  ) => Promise<{ filePath: string; ref: string } | null>;
  imageAccept?: string;
  uploadProgress?: number | null;
  buttonVariants?: EditorButtonVariant[];
  detailsVariants?: EditorDetailsVariant[];
  className?: string;
  portalContainer?: HTMLElement | null;
}

export const RichTextEditor = forwardRef(function RichTextEditor(
  props: RichTextEditorProps,
  ref: Ref<RichTextEditorRef>,
) {
  const {
    value,
    defaultValue,
    onChange,
    onDirty,
    readOnly = false,
    features: featuresProp,
    diffBase,
    errors,
    errorKindClassName,
    onApplyErrorFix,
    linkCatalog,
    images,
    imageModulePath,
    onImageUpload,
    imageAccept,
    uploadProgress,
    buttonVariants,
    detailsVariants,
    className,
    portalContainer,
  } = props;

  const {
    moduleEntries: imageModuleEntries,
    getUrl: imageGetUrl,
    ready: imageModuleReady,
  } = useModuleMediaEntries(imageModulePath);
  const hasGalleryImages = imageModuleReady && !!imageModuleEntries;

  const containerRef = useRef<HTMLDivElement>(null);
  const fixedToolbarMountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const markTypeRef = useRef<MarkType | null>(null);
  const prevDocRef = useRef<EditorDocument>([]);
  const onChangeRef = useRef(onChange);
  const onDirtyRef = useRef(onDirty);
  const onApplyErrorFixRef = useRef(onApplyErrorFix);
  const linkCatalogRef = useRef(linkCatalog);
  const imagesRef = useRef(images);
  const imageModuleEntriesRef = useRef(imageModuleEntries);
  const imageGetUrlRef = useRef(imageGetUrl);

  const [pickerState, setPickerState] = useState<LinkPickerState | null>(null);
  const pickerStateRef = useRef(pickerState);
  pickerStateRef.current = pickerState;
  const imageSelectRendererRef = useRef<ImageSelectRenderer | undefined>(
    undefined,
  );
  const onImageUploadRef = useRef(onImageUpload);
  const imageAcceptRef = useRef(imageAccept);
  const uploadProgressRef = useRef(uploadProgress);
  const buttonVariantsRef = useRef(buttonVariants);
  const detailsVariantsRef = useRef(detailsVariants);
  const isControlled = value !== undefined;

  useEffect(() => {
    onChangeRef.current = onChange;
    onDirtyRef.current = onDirty;
    onApplyErrorFixRef.current = onApplyErrorFix;
    linkCatalogRef.current = linkCatalog;
    imagesRef.current = images;
    imageModuleEntriesRef.current = imageModuleEntries;
    imageGetUrlRef.current = imageGetUrl;
    onImageUploadRef.current = onImageUpload;
    imageAcceptRef.current = imageAccept;
    uploadProgressRef.current = uploadProgress;
    buttonVariantsRef.current = buttonVariants;
    detailsVariantsRef.current = detailsVariants;
    if (hasGalleryImages) {
      imageSelectRendererRef.current = (currentSrc, onSelectUrl) => (
        <MediaPickerList
          moduleEntries={imageModuleEntriesRef.current!}
          selectedRef={currentSrc}
          isImage
          getUrl={imageGetUrlRef.current}
          autoFocus
          maxHeight={280}
          onSelect={(entry: GalleryEntry) => {
            onSelectUrl(entry.filePath);
          }}
        />
      );
    } else if (images && images.length > 0) {
      imageSelectRendererRef.current = (currentSrc, onSelectUrl) => (
        <ImagePicker
          images={imagesRef.current!}
          currentSrc={currentSrc}
          onSelect={onSelectUrl}
        />
      );
    } else {
      imageSelectRendererRef.current = undefined;
    }
  });

  const features: ResolvedEditorFeatures = {
    ...DEFAULT_FEATURES,
    ...featuresProp,
  };

  const styleConfig = features.styles;

  // Schema is intentionally fixed at mount: changing features, variants, or
  // styleConfig after mount would also require recreating the EditorView and
  // re-parsing the document, so consumers must remount the editor (e.g. via a
  // key prop) to pick up new feature configuration.
  const schema = useMemo(
    () =>
      buildSchema({ features, buttonVariants, detailsVariants, styleConfig }),
    [],
  );

  markTypeRef.current = schema.marks.link ?? null;

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const initialDoc = isControlled ? value : (defaultValue ?? []);
    let doc;
    try {
      doc = parseEditorDocument(initialDoc ?? [], schema);
    } catch {
      doc = schema.node("doc", null, [schema.node("paragraph")]);
    }

    prevDocRef.current = initialDoc ?? [];

    const getPortalContainer = () => portalContainer ?? null;

    const plugins = [
      ...buildKeymap(schema, features),
      buildInputRules(schema, features),
      history(),
      dropCursor(),
      gapCursor(),
      createDiffPlugin(),
      createSchemaValidationPlugin(features),
      createErrorPlugin(),
      createErrorTooltipPlugin({
        getPortalContainer,
        onApplyErrorFix: (args) => {
          if (args.kind === "schema.violation" && viewRef.current) {
            applySchemaViolationFix(viewRef.current, args.path, args.fixId);
            return;
          }
          onApplyErrorFixRef.current?.(args);
        },
      }),
    ];

    const getLinkCatalog = () => linkCatalogRef.current;
    const getButtonVariants = () => buttonVariantsRef.current;
    const getDetailsVariants = () => detailsVariantsRef.current;
    const linkHelper = createLinkHelper({
      getLinkCatalog,
      getPortalContainer,
      onPickerStateChange: (state) => {
        setPickerState(state);
      },
      isPickerOpen: () => pickerStateRef.current !== null,
    });

    plugins.push(createLinkCatalogPlugin({ getLinkCatalog }));

    if (!readOnly && features.link) {
      plugins.push(
        createLinkClickPlugin(schema, { getLinkCatalog, linkHelper }),
      );
    }

    const getImages = () => imagesRef.current;
    const getImageModuleEntries = () => imageModuleEntriesRef.current;
    const getImageGetUrl = () => imageGetUrlRef.current;
    const getOnImageUpload = () => onImageUploadRef.current;
    const getImageAccept = () => imageAcceptRef.current;
    const getUploadProgress = () => uploadProgressRef.current;

    if (features.fixedToolbar && !readOnly) {
      plugins.push(
        createFixedToolbarPlugin(schema, {
          getMount: () => fixedToolbarMountRef.current,
          getLinkCatalog,
          getImages,
          getImageModuleEntries,
          getImageGetUrl,
          getOnImageUpload,
          getImageAccept,
          getUploadProgress,
          getButtonVariants,
          getDetailsVariants,
          linkHelper,
          styleConfig,
          features,
        }),
      );
    }

    if (features.floatingToolbar && !readOnly) {
      plugins.push(
        createFloatingToolbarPlugin(schema, {
          getPortalContainer,
          getLinkCatalog,
          getImages,
          getImageModuleEntries,
          getImageGetUrl,
          getOnImageUpload,
          getImageAccept,
          getUploadProgress,
          getButtonVariants,
          getDetailsVariants,
          linkHelper,
          styleConfig,
          features,
        }),
      );
    }

    if (features.gutter && !readOnly) {
      plugins.push(
        createGutterPlugin(schema, features, { getPortalContainer }),
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeViews: Record<string, (...args: any[]) => any> = {};
    if (schema.nodes.image) {
      nodeViews.image = createImageNodeView(imageSelectRendererRef, {
        inline: true,
        getPortalContainer,
        getUrl: getImageGetUrl,
        getOnImageUpload,
        getImageAccept,
      });
    }
    if (schema.nodes.button_atom) {
      nodeViews.button_atom = createButtonAtomNodeView(buttonVariantsRef, {
        getPortalContainer,
      });
    }
    if (schema.nodes.button_editable) {
      nodeViews.button_editable = createButtonEditableNodeView(
        buttonVariantsRef,
        {
          getPortalContainer,
        },
      );
    }
    if (schema.nodes.details) {
      nodeViews.details = createDetailsNodeView(schema);
    }

    const state = EditorState.create({ doc, plugins });
    const view = new EditorView(containerRef.current, {
      state,
      editable: () => !readOnly,
      nodeViews,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        if (tr.docChanged) {
          onDirtyRef.current?.();

          if (onChangeRef.current) {
            const newDoc = serializeEditorDocument(newState.doc);
            const patches = compare(prevDocRef.current, newDoc);
            prevDocRef.current = newDoc;
            onChangeRef.current({ value: newDoc, patches });
          }
        }
      },
    });

    viewRef.current = view;

    return () => {
      linkHelper.destroy();
      view.destroy();
      viewRef.current = null;
    };
  }, [
    schema,
    readOnly,
    features.fixedToolbar,
    features.floatingToolbar,
    features.gutter,
    portalContainer,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isControlled || !value) return;

    const currentSerialized = serializeEditorDocument(view.state.doc);
    if (JSON.stringify(currentSerialized) === JSON.stringify(value)) return;

    try {
      const newDoc = parseEditorDocument(value, schema);
      const oldSelection = view.state.selection;
      const state = EditorState.create({
        doc: newDoc,
        plugins: view.state.plugins,
        selection: resolveSelectionForNewDoc(oldSelection, newDoc),
      });
      view.updateState(state);
      prevDocRef.current = value;
    } catch (error) {
      console.error(error);
    }
  }, [value, isControlled, schema]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (diffBase) {
      try {
        const basePMDoc = parseEditorDocument(diffBase, schema);
        const tr = view.state.tr.setMeta(diffPluginKey, { baseDoc: basePMDoc });
        view.dispatch(tr);
      } catch {
        // ignore
      }
    } else {
      const tr = view.state.tr.setMeta(diffPluginKey, { baseDoc: null });
      view.dispatch(tr);
    }
  }, [diffBase, schema]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const tr = view.state.tr.setMeta(errorPluginKey, {
      errors: errors ?? [],
      errorKindClassName: errorKindClassName ?? {},
    });
    view.dispatch(tr);
  }, [errors, errorKindClassName]);

  const getDocument = useCallback((): EditorDocument => {
    if (!viewRef.current) return [];
    return serializeEditorDocument(viewRef.current.state.doc);
  }, []);

  const getPatches = useCallback((base: EditorDocument) => {
    const current = viewRef.current
      ? serializeEditorDocument(viewRef.current.state.doc)
      : [];
    return compare(base, current);
  }, []);

  const reset = useCallback(
    (data?: EditorDocument) => {
      const view = viewRef.current;
      if (!view) return;

      const newDoc = data
        ? parseEditorDocument(data, schema)
        : schema.node("doc", null, [schema.node("paragraph")]);
      const oldSelection = view.state.selection;
      const state = EditorState.create({
        doc: newDoc,
        plugins: view.state.plugins,
        selection: resolveSelectionForNewDoc(oldSelection, newDoc),
      });
      view.updateState(state);
      prevDocRef.current = data ?? [];
    },
    [schema],
  );

  useImperativeHandle(ref, () => ({ getDocument, getPatches, reset }), [
    getDocument,
    getPatches,
    reset,
  ]);

  const showFixedToolbar = features.fixedToolbar && !readOnly;

  const applyLink = useCallback((href: string | null) => {
    const view = viewRef.current;
    const mt = markTypeRef.current;
    const ps = pickerStateRef.current;
    if (!view || !mt || !ps) return;

    const { state, dispatch } = view;
    let tr = state.tr;
    if (href) {
      tr = tr.removeMark(ps.savedFrom, ps.savedTo, mt);
      tr = tr.addMark(ps.savedFrom, ps.savedTo, mt.create({ href }));
    } else {
      tr = tr.removeMark(ps.savedFrom, ps.savedTo, mt);
    }
    dispatch(tr);

    setPickerState(null);
    view.focus();
  }, []);

  const handlePickerApplyLink = useCallback(
    (item: EditorLinkCatalogItem) => {
      applyLink(item.href.trim());
    },
    [applyLink],
  );

  const handlePickerRemoveLink = useCallback(() => {
    applyLink(null);
  }, [applyLink]);

  const handlePickerApplyUrl = useCallback(
    (href: string) => {
      applyLink(href);
    },
    [applyLink],
  );

  const handlePickerUnlink = useCallback(() => {
    applyLink(null);
  }, [applyLink]);

  const handlePickerClose = useCallback(() => {
    setPickerState(null);
    viewRef.current?.focus();
  }, []);

  return (
    <div
      className={[
        "rich-text-editor relative flex flex-col",
        readOnly ? "cursor-default" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showFixedToolbar && (
        <div
          ref={fixedToolbarMountRef}
          className={[
            "rounded-t-md border border-input",
            "bg-bg-secondary absolute left-0 top-0 z-5 w-full",
          ].join(" ")}
        />
      )}
      <div
        ref={containerRef}
        className={[
          "prose-editor relative min-h-12 border border-input",
          "bg-bg-primary p-2 text-fg-primary caret-fg-primary",
          "ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 rounded-md",
          "p-4",
          showFixedToolbar ? "pt-14" : "",
          readOnly ? "opacity-80" : "",
        ].join(" ")}
      />
      {pickerState &&
        (portalContainer ? (
          createPortal(
            <LinkPickerOverlay
              state={pickerState}
              useFixedPosition
              onApplyLink={handlePickerApplyLink}
              onRemoveLink={handlePickerRemoveLink}
              onApplyUrl={handlePickerApplyUrl}
              onUnlink={handlePickerUnlink}
              onClose={handlePickerClose}
            />,
            portalContainer,
          )
        ) : (
          <LinkPickerOverlay
            state={pickerState}
            onApplyLink={handlePickerApplyLink}
            onRemoveLink={handlePickerRemoveLink}
            onApplyUrl={handlePickerApplyUrl}
            onUnlink={handlePickerUnlink}
            onClose={handlePickerClose}
          />
        ))}
    </div>
  );
});
