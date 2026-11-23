import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { EditorState } from "prosemirror-state";
import { EditorView, type DirectEditorProps } from "prosemirror-view";
import type { SourcePath } from "@valbuild/core";
import {
  isInlineRichText,
  type InlineRichTextNode,
  type InlineSelection,
} from "@valbuild/shared/internal";
import { useSchemaAtPath } from "../../ValFieldProvider";
import { cn } from "../../designSystem/cn";
import {
  buildSchema,
  DEFAULT_FEATURES,
  marksToStyles,
  parseEditorDocument,
  serializeEditorDocument,
  useRichTextEditorConfig,
} from "../../RichTextEditor";
import type {
  EditorLinkCatalogItem,
  LinkPickerState,
  ResolvedEditorFeatures,
} from "../../RichTextEditor/types";
import { isPageEditableDocument } from "../../RichTextEditor/isPageEditableDocument";
import { ToolbarButtons } from "../../RichTextEditor/plugins/ToolbarButtonsComponent";
import {
  createLinkHelper,
  setLinkOnRange,
} from "../../RichTextEditor/plugins/formattingToolbarShared";
import { LinkCatalogPicker } from "../../RichTextEditor/plugins/LinkCatalogPickerComponent";
import { LinkUrlEditor } from "../../RichTextEditor/plugins/LinkUrlEditorComponent";
import {
  fromEditorSelection,
  toEditorSelection,
} from "./inlineSelectionMapping";
import {
  INLINE_TOOLBAR_ATTRIBUTE,
  placeInlineToolbar,
  type InlineEditLocation,
} from "./placeInlineToolbar";

/**
 * The Studio's editor, with nothing to look at.
 *
 * The controls below are the editor's own (`ToolbarButtons`), and they act
 * on an editor: they read what is selected from its state, and they change
 * the document by dispatching to it. So there is one, kept in step with the
 * text on the page -- its document and its selection are whatever the page
 * last said -- and never shown or typed in.
 *
 * `focus()` is the one thing it does differently. Every control ends by
 * focusing "the editor", and the editor a person is typing in is on the
 * page: so that is where the focus goes back to.
 */
class DetachedEditorView extends EditorView {
  private readonly giveFocusBack: () => void;
  constructor(
    place: HTMLElement,
    props: DirectEditorProps,
    giveFocusBack: () => void,
  ) {
    super(place, props);
    this.giveFocusBack = giveFocusBack;
  }
  focus(): void {
    this.giveFocusBack();
  }
}

/**
 * The formatting controls for a richtext being typed in ON the page.
 *
 * The same buttons the field has in the Studio's column, offering what the
 * field's schema allows, drawn by the Studio rather than by the page: the
 * page is the customer's document, with none of the Studio's styles, and it
 * may be shown at a quarter of its size.
 *
 * A press works on the page's selection (`selection`), in the page's
 * document (`value`), through the editor's own commands -- so bold here is
 * the same transaction as bold in the column. What comes out is handed to
 * `onApply`, which writes it and tells the page to show it.
 *
 * No image button. Adding one means uploading from here into a document
 * shown somewhere else, and is its own piece of work; the images a document
 * has are kept.
 */
export function CanvasInlineRichTextToolbar({
  path,
  value,
  selection,
  onApply,
  onMarks,
  onRefocus,
}: {
  path: SourcePath;
  /** The document on the page, as of the last keystroke. */
  value: readonly InlineRichTextNode[];
  /** What is selected in it, or `null` when the caret is not in its text. */
  selection: InlineSelection | null;
  onApply: (
    value: InlineRichTextNode[],
    selection: InlineSelection | null,
  ) => void;
  /**
   * A control pressed with only a caret: the marks the next text typed
   * there has (as a span's `styles`), or `null` for whatever is around it.
   * The editor keeps them as its stored marks, and the page is where the
   * next text is typed, so it has to be told.
   */
  onMarks: (styles: string[] | null, selection: InlineSelection | null) => void;
  /** Put the focus back in the text on the page. */
  onRefocus: () => void;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const options =
    "data" in schemaAtPath && schemaAtPath.data.type === "richtext"
      ? schemaAtPath.data.options
      : undefined;
  const { features, linkCatalog } = useRichTextEditorConfig(options);
  /*
   * Two sets of features, and the difference is the image. The SCHEMA has
   * to know images where the field allows them, or a document that holds
   * one could not be read at all; the BUTTONS do not offer one.
   */
  const featureKey = JSON.stringify(features);
  const schemaFeatures = useMemo<ResolvedEditorFeatures>(
    () => ({ ...DEFAULT_FEATURES, ...features }),
    // By what the features ARE: the hook hands back a new object for the
    // same options, and a new schema is a new editor.
    [featureKey],
  );
  const buttonFeatures = useMemo<ResolvedEditorFeatures>(
    () => ({ ...schemaFeatures, image: false }),
    [schemaFeatures],
  );
  const schema = useMemo(
    () => buildSchema({ features: schemaFeatures }),
    [schemaFeatures],
  );

  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [pickerState, setPickerState] = useState<LinkPickerState | null>(null);
  const pickerOpen = useRef(false);
  pickerOpen.current = pickerState !== null;
  const catalog = useRef<EditorLinkCatalogItem[] | undefined>(linkCatalog);
  catalog.current = linkCatalog;
  const containerRef = useRef<HTMLDivElement>(null);
  /*
   * Back to the page, a moment after it is asked for, and once more after
   * that. Every control ends in "focus the editor", and two of them are not
   * done when they say so:
   *
   * - the link button OPENS a box to type in on that same press, and the
   *   next keys belong in the box (`pickerWanted`, and the check for a box
   *   that has the focus);
   * - a menu that closes hands the focus to the button that opened it,
   *   after the choice made in it has already sent the focus to the page --
   *   which is what the second time is for.
   */
  const pickerWanted = useRef(false);
  const refocus = useCallback(() => {
    const back = () => {
      if (pickerWanted.current) return;
      const container = containerRef.current;
      const root = container?.getRootNode();
      const active =
        root instanceof Document || root instanceof ShadowRoot
          ? root.activeElement
          : null;
      const typing =
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement) &&
        container?.contains(active) === true;
      if (!typing) onRefocus();
    };
    setTimeout(back, 0);
    setTimeout(back, 60);
  }, [onRefocus]);
  const latest = useRef({
    value,
    selection,
    onApply,
    onMarks,
    onRefocus: refocus,
  });
  latest.current = { value, selection, onApply, onMarks, onRefocus: refocus };

  const mountRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<DetachedEditorView | null>(null);
  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;
    const made: DetachedEditorView = new DetachedEditorView(
      mount,
      {
        state: EditorState.create({ schema }),
        // Nothing is ever typed here: see the class.
        editable: () => false,
        dispatchTransaction(transaction) {
          const next = made.state.apply(transaction);
          made.updateState(next);
          if (transaction.docChanged) {
            const document: unknown = serializeEditorDocument(next.doc);
            if (isInlineRichText(document)) {
              latest.current.onApply(document, fromEditorSelection(next));
            }
          } else if (transaction.storedMarksSet) {
            // Bold with only a caret: nothing changed but what the next
            // text typed will be.
            latest.current.onMarks(
              next.storedMarks === null
                ? null
                : marksToStyles(next.storedMarks),
              fromEditorSelection(next),
            );
          }
          redraw();
        },
      },
      () => latest.current.onRefocus(),
    );
    setView(made);
    return () => {
      setView(null);
      made.destroy();
    };
  }, [schema]);

  // In step with the page: its document, and what is selected in it.
  useEffect(() => {
    if (view === null) return;
    if (!isPageEditableDocument(value)) return;
    const doc = parseEditorDocument(value, schema);
    const selected = toEditorSelection(doc, selection);
    /*
     * The marks a press with only a caret stored stay while the page says
     * the same again -- it does, whenever the text moves on the screen --
     * and go when the caret or the document does, as the page forgets them
     * then too.
     */
    const before = view.state;
    const same =
      before.doc.eq(doc) && selected !== null && before.selection.eq(selected);
    view.updateState(
      EditorState.create({
        schema,
        doc,
        ...(selected !== null ? { selection: selected } : {}),
        ...(same && before.storedMarks !== null
          ? { storedMarks: before.storedMarks }
          : {}),
      }),
    );
    redraw();
  }, [view, schema, value, selection]);

  const linkHelper = useMemo(
    () =>
      createLinkHelper({
        getLinkCatalog: () => catalog.current,
        onPickerStateChange: (next) => {
          pickerWanted.current = next !== null;
          setPickerState(next);
        },
        isPickerOpen: () => pickerOpen.current,
      }),
    [],
  );

  const applyLink = useCallback(
    (href: string | null) => {
      const markType = schema.marks.link;
      if (view === null || pickerState === null || markType === undefined) {
        return;
      }
      pickerWanted.current = false;
      setPickerState(null);
      setLinkOnRange(
        view,
        markType,
        { from: pickerState.savedFrom, to: pickerState.savedTo },
        href,
      );
      view.focus();
    },
    [view, schema, pickerState],
  );
  const closePicker = useCallback(() => {
    pickerWanted.current = false;
    setPickerState(null);
    latest.current.onRefocus();
  }, []);

  const popover = useContext(PopoverRoom);
  /*
   * A link being picked takes the focus: it is a box to type in, and until
   * it has the focus the keys still go to the page -- where Esc ends the
   * whole edit instead of closing this.
   */
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerKind = pickerState?.kind ?? null;
  useEffect(() => {
    if (pickerKind === null) return;
    pickerRef.current?.querySelector("input")?.focus();
  }, [pickerKind]);
  return (
    <div
      ref={containerRef}
      {...{ [INLINE_TOOLBAR_ATTRIBUTE]: "" }}
      className="relative"
      /*
       * Esc in here closes what is open in here -- a link being picked, the
       * menu of headings -- and goes no further. Further is the Studio's
       * own Esc, which turns Select off and the edit with it.
       */
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      /*
       * The focus has no business on a button here. A press does not put
       * it there (see the bar, below), so when it arrives it is a menu
       * closing and handing it to the button that opened it -- some time
       * after the choice, once the menu has finished leaving. It belongs
       * with the caret.
       */
      onFocusCapture={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        if (target.closest('[role="menu"]') !== null) return;
        refocus();
      }}
    >
      <div
        role="toolbar"
        // Not "Formatting", which the same field's toolbar in the column is.
        aria-label="Format the text on the page"
        className="flex max-w-full flex-row items-center gap-x-1 overflow-x-auto rounded-lg border border-border-float bg-bg-float px-1.5 py-1 shadow-lg scrollbar-none"
        /*
         * A press on a control must not take the focus: the caret it acts
         * on is in the page, and a button that takes the focus takes the
         * selection out from under itself. (A text box is the exception,
         * since it is there to be typed in.)
         */
        onMouseDownCapture={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLSelectElement ||
            target instanceof HTMLTextAreaElement
          ) {
            return;
          }
          event.preventDefault();
        }}
      >
        {view !== null && (
          <ToolbarButtons
            view={view}
            schema={schema}
            features={buttonFeatures}
            linkHelper={linkHelper}
            options={{ showBlockTypeSelect: true }}
            linkCatalog={linkCatalog}
            // Nothing to act on while the caret is not in the text.
            readOnly={selection === null}
          />
        )}
      </div>
      {pickerState !== null && (
        <div
          /*
           * Out of the bar, not part of it: the bar is placed by its own
           * size, and one that grew a list of pages would be moved away
           * from the text to make room for it. Towards whichever side of
           * the bar has the room, and no taller than that.
           */
          ref={pickerRef}
          className={cn(
            "absolute left-0 overflow-y-auto",
            popover.up ? "bottom-full mb-1" : "top-full mt-1",
            pickerState.kind === "catalog"
              ? "flex min-w-[280px] flex-col rounded-md border border-border-primary bg-bg-primary shadow-xl"
              : "flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-primary p-1.5 shadow-xl",
          )}
          style={{ maxHeight: popover.max }}
        >
          {pickerState.kind === "catalog" && pickerState.catalog ? (
            <LinkCatalogPicker
              catalog={pickerState.catalog}
              currentHref={pickerState.currentHref}
              onApplyLink={(item) => applyLink(item.href.trim())}
              onRemoveLink={
                pickerState.currentHref !== null ? () => applyLink(null) : null
              }
              onClose={closePicker}
            />
          ) : (
            <LinkUrlEditor
              currentHref={pickerState.currentHref ?? ""}
              isNewLink={pickerState.isNewLink ?? true}
              onApply={(href) => applyLink(href)}
              onUnlink={() => applyLink(null)}
              onClose={closePicker}
            />
          )}
        </div>
      )}
      {/*
       * The editor nobody sees. In the document, because the editor's link
       * controls ask it where the selection is; out of reach, because it is
       * not there to be used.
       */}
      <div
        ref={mountRef}
        aria-hidden
        inert
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
      />
    </div>
  );
}

/**
 * Which way something that opens out of the bar has room to open, and how
 * much: the bar can be at the bottom edge of the preview, where a list
 * hanging under it would be cut off.
 */
const PopoverRoom = createContext<{ up: boolean; max: number }>({
  up: false,
  max: 320,
});

/** In steps, so that a scroll does not re-render the controls per pixel. */
const ROOM_STEP = 40;

/**
 * Holds the controls where the text is.
 *
 * The text is in the page and the page is in a frame the Studio scales and
 * moves, so "where the text is" changes without anything here being told: a
 * zoom, a pan, the page scrolling. It is asked again every frame while the
 * controls are up, and the box is moved by hand rather than by a render --
 * following a scroll at sixty renders a second would re-render the buttons
 * sixty times a second to move them.
 *
 * `position: fixed`, in the Studio's portal: outside the preview's zoom,
 * which would otherwise shrink the controls with the page.
 */
export function CanvasInlineToolbarLayer({
  locate,
  children,
}: {
  locate: () => InlineEditLocation | null;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ up: false, max: 320 });
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const box = boxRef.current;
      if (box === null) return;
      const at = locate();
      const placed =
        at === null
          ? null
          : placeInlineToolbar(
              at.field,
              at.clip,
              { width: box.offsetWidth, height: box.offsetHeight },
              at.caret,
            );
      if (at === null || placed === null || !placed.shown) {
        box.style.visibility = "hidden";
        return;
      }
      box.style.visibility = "visible";
      box.style.left = `${placed.left}px`;
      box.style.top = `${placed.top}px`;
      // Never wider than the preview: the bar scrolls sideways inside it.
      box.style.maxWidth = `${Math.max(0, at.clip.width - 8)}px`;
      const above = placed.top - at.clip.top;
      const below =
        at.clip.top + at.clip.height - (placed.top + box.offsetHeight);
      const up = above > below;
      const max =
        Math.floor(Math.max(120, (up ? above : below) - 12) / ROOM_STEP) *
        ROOM_STEP;
      setRoom((current) =>
        current.up === up && current.max === max ? current : { up, max },
      );
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [locate]);
  return (
    <div
      ref={boxRef}
      className="fixed z-window"
      style={{ visibility: "hidden", left: 0, top: 0 }}
    >
      <PopoverRoom.Provider value={room}>{children}</PopoverRoom.Provider>
    </div>
  );
}
