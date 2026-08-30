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
import {
  createLinkHelper,
  hasFixedToolbarContent,
} from "./plugins/formattingToolbarShared";
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
      /*
       * `z-window`, not a number of its own.
       *
       * This is a floating piece of the *editor*, so it belongs on the scale
       * with everything else that floats: above the content it is attached to,
       * below the app's own chrome. It used to be `z-[60]`, which beat every
       * token on that scale — so the shell's floating panels, rail and bars all
       * rendered underneath a link toolbar.
       */
      className={
        isCatalog
          ? `${positionClass} z-window flex flex-col rounded-md border border-border-primary bg-bg-primary shadow-xl min-w-[280px]`
          : `${positionClass} z-window flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-primary p-1.5 shadow-xl`
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
  /**
   * Where a popup mounts, read at USE time rather than at view-creation time.
   *
   * This used to be closed over by `getPortalContainer` and therefore had to be
   * a dependency of the effect that builds the `EditorView` — so a portal
   * container that arrives after the first paint (which is the normal order:
   * `useValPortal` is filled on commit) destroyed and rebuilt the view. A ref
   * takes it out of the deps entirely: the popups ask when they open, and the
   * answer is whatever is current then.
   */
  const portalContainerRef = useRef(portalContainer);
  /**
   * The live document, carried across a view REBUILD.
   *
   * The view is recreated whenever `readOnly` or one of the toolbar features
   * changes, and a recreated view used to parse `defaultValue` again — which for
   * an uncontrolled editor means the document it mounted with, or nothing. Since
   * `schema` is fixed at mount, the ProseMirror node is still valid, so carrying
   * it is exact and costs no serialization.
   *
   * The alternative — asking the consumer to re-seed after a rebuild — is what
   * `RichTextField` was implicitly relying on, and it cannot work: the consumer
   * re-seeds from source, and source has not moved.
   */
  const carriedDocRef = useRef<PMNode | null>(null);
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
    portalContainerRef.current = portalContainer;
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

  /**
   * Mounted only when it has something in it.
   *
   * `features.fixedToolbar` says the editor is ALLOWED a fixed toolbar; it does
   * not say the toolbar has any buttons. With `s.richtext()` and no options it
   * had none, and the empty bar still drew a border over the editor's own top
   * border and still reserved `pt-14` of space below itself.
   *
   * Asked through the same functions that BUILD the bar, so "is it shown" and
   * "does it have buttons" cannot drift apart. And answered from things that
   * are settled at mount — `imageModulePath`, not the gallery's loaded entries,
   * which arrive a tick later: the view is rebuilt on this value, so a late
   * flip would mount a bar that nothing ever renders into.
   */
  const showFixedToolbar =
    features.fixedToolbar &&
    hasFixedToolbarContent({
      schema,
      features,
      styleConfig,
      canInsertImage: !!onImageUpload || !!images?.length || !!imageModulePath,
      buttonVariants,
      detailsVariants,
    });

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const initialDoc = isControlled ? value : (defaultValue ?? []);
    let doc;
    /**
     * A REBUILD keeps the document it was showing.
     *
     * `carriedDocRef` is only set by this effect's own cleanup, so it is null on
     * the first mount and a live node on every rebuild after it. The schema
     * guard is belt and braces: `schema` is memoised on `[]` today, so it never
     * changes under a mounted editor, but a node from another schema cannot be
     * put in this view and failing loudly here would be worse than re-parsing.
     */
    const carried = carriedDocRef.current;
    carriedDocRef.current = null;
    if (carried !== null && carried.type.schema === schema) {
      doc = carried;
    } else {
      try {
        doc = parseEditorDocument(initialDoc ?? [], schema);
      } catch {
        doc = schema.node("doc", null, [schema.node("paragraph")]);
      }
      prevDocRef.current = initialDoc ?? [];
    }

    const getPortalContainer = () => portalContainerRef.current ?? null;

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

    if (features.fixedToolbar) {
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
          readOnly,
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
      // Handed to whatever runs next. React clears this on unmount too, but a
      // ref on an unmounted component is unreachable, so there is nothing to
      // release.
      carriedDocRef.current = view.state.doc;
      linkHelper.destroy();
      view.destroy();
      viewRef.current = null;
    };
  }, [
    schema,
    readOnly,
    showFixedToolbar,
    features.floatingToolbar,
    features.gutter,
  ]);

  /**
   * Repaint the toolbar when the gallery finally answers.
   *
   * The image control is gated on entries that arrive a round trip after
   * mount, and the toolbar is an imperative plugin: it re-renders on a
   * ProseMirror `update` and on nothing else. So an image-only field mounted
   * its bar, found no entries, and left it empty until the user happened to
   * click into the text.
   *
   * An EMPTY transaction is the fix rather than a view rebuild. `docChanged`
   * is false for one, so it does not mark the field dirty, does not re-parse
   * `defaultValue`, and cannot drop a keystroke still inside the debounce —
   * which is exactly what rebuilding the view on this would risk.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.tr);
  }, [
    imageModuleEntries,
    images,
    onImageUpload,
    buttonVariants,
    detailsVariants,
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
            "rounded-t-md border border-border-primary",
            // `z-hover`: a bar pinned over the top of the editor's own content,
            // and nothing more. `z-5` put it over the shell's chrome as well.
            "bg-bg-secondary absolute left-0 top-0 z-hover w-full",
          ].join(" ")}
        />
      )}
      <div
        ref={containerRef}
        className={[
          /*
           * Sized as a text field, because that is what it is.
           *
           * `h-10` + `px-3 py-2` + `text-base` is `Input`, and a richtext field
           * sits in the same column as one — it had `min-h-12` and `p-4`, so a
           * one-line rich text box stood 68px tall next to a 40px string box
           * with its text starting 4px further in. `min-h-10` rather than
           * `h-10` because this one grows with its content.
           *
           * `pt-14` still wins over `py-2` when there is a toolbar: Tailwind
           * emits `pt-*` after `py-*`, so the single-side utility overrides.
           */
          "prose-editor relative min-h-10 border border-border-primary",
          "bg-bg-primary text-fg-primary caret-fg-primary",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-border-focus rounded-md",
          "px-3 py-2",
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
