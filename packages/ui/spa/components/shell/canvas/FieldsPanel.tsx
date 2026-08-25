import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Link2, Paperclip, Type } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { PanelFilterInput } from "../PanelPrimitives";
import { CanvasField, CanvasPageData } from "./types";

/**
 * Every editable field on the page, in one list at the side.
 *
 * This is the half of the experiment worth judging: instead of hunting across
 * a page for the thing you want to change, the page's content is a list you
 * can read top to bottom, filter, and work down. The canvas is then for
 * seeing the result rather than for aiming at it.
 *
 * Selection is shared with the canvas in both directions — the selected
 * field scrolls into view here when it is picked over there.
 */
export function FieldsPanel({
  page,
  selectedFieldId,
  onSelectField,
  onChangeField,
  onAttachField,
  attachedFieldIds,
  isDevMode,
}: {
  page: CanvasPageData;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string) => void;
  onChangeField: (fieldId: string, value: string) => void;
  /** Hand this field to the assistant as context. */
  onAttachField: (fieldId: string) => void;
  attachedFieldIds: readonly string[];
  isDevMode?: boolean;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return page.sections
      .map((section) => ({
        ...section,
        fields: section.fieldIds
          .map((id) => page.fields[id])
          .filter(
            (field): field is CanvasField =>
              field !== undefined &&
              (q === "" ||
                field.label.toLowerCase().includes(q) ||
                field.value.toLowerCase().includes(q)),
          ),
      }))
      .filter((section) => section.fields.length > 0);
  }, [page, query]);

  // Picking something on the canvas should bring its field into view here,
  // otherwise the two halves drift apart the moment the list is long.
  //
  // Scrolled by hand rather than with `scrollIntoView`, which walks up and
  // scrolls every scrollable ancestor — including the document, which drags
  // the whole view out of position.
  useEffect(() => {
    if (!selectedFieldId) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(
      `[data-field-row="${selectedFieldId}"]`,
    );
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTo({ top, behavior: "smooth" });
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTo({
        top: bottom - list.clientHeight,
        behavior: "smooth",
      });
    }
  }, [selectedFieldId]);

  return (
    <div className="flex h-full flex-col bg-bg-float">
      {/*
       * No title row: the switch above the column already says Fields, and
       * carries the count. A second heading saying the same word twice in
       * 40 pixels is noise.
       */}
      <div className="shrink-0 border-b border-border-float px-3 py-2">
        <PanelFilterInput
          value={query}
          onChange={setQuery}
          placeholder="Filter fields…"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {sections.length === 0 && (
          <p className="px-4 py-6 text-xs text-fg-secondary-alt">
            No fields match this filter.
          </p>
        )}
        {sections.map((section) => (
          <section key={section.id}>
            <h3 className="px-4 pb-1.5 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-secondary-alt">
              {section.name}
            </h3>
            {section.fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                selected={selectedFieldId === field.id}
                attached={attachedFieldIds.includes(field.id)}
                onSelect={() => onSelectField(field.id)}
                onChange={(value) => onChangeField(field.id, value)}
                onAttach={() => onAttachField(field.id)}
                isDevMode={isDevMode}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

const FIELD_ICON: Record<CanvasField["type"], typeof Type> = {
  string: Type,
  text: Type,
  richtext: Type,
  image: ImageIcon,
  link: Link2,
};

function FieldRow({
  field,
  selected,
  attached,
  onSelect,
  onChange,
  onAttach,
  isDevMode,
}: {
  field: CanvasField;
  selected: boolean;
  attached: boolean;
  onSelect: () => void;
  onChange: (value: string) => void;
  onAttach: () => void;
  isDevMode?: boolean;
}) {
  const Icon = FIELD_ICON[field.type];
  return (
    <div
      data-field-row={field.id}
      onFocusCapture={onSelect}
      onClick={onSelect}
      className={cn(
        "px-3 py-2 border-l-2 transition-colors",
        selected
          ? "border-bg-page-selection bg-bg-float-raised"
          : "border-transparent hover:bg-bg-float-raised/60",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={12} className="shrink-0 text-fg-secondary-alt" />
        <span className="text-[0.8125rem] font-medium">{field.label}</span>
        {attached && (
          <span
            title="Attached to the assistant"
            className="text-fg-secondary-alt"
          >
            <Paperclip size={11} />
          </span>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAttach();
          }}
          className="ml-auto rounded px-1.5 py-0.5 text-[0.625rem] text-fg-secondary-alt opacity-0 transition-opacity hover:bg-bg-float-raised hover:text-fg-primary focus:opacity-100 group-hover:opacity-100 [div:hover>div>&]:opacity-100"
        >
          Ask AI
        </button>
      </div>
      {field.type === "image" ? (
        <div className="flex items-center gap-2 rounded-md border border-border-float bg-bg-surface px-2 py-1.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-bg-float-raised text-fg-secondary-alt">
            <ImageIcon size={13} />
          </span>
          <span className="truncate font-mono text-[0.6875rem] text-fg-secondary">
            {field.value}
          </span>
        </div>
      ) : field.type === "text" || field.type === "richtext" ? (
        <textarea
          value={field.value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          aria-label={field.label}
          className="w-full resize-none rounded-md border border-border-float bg-bg-surface px-2 py-1.5 text-xs leading-relaxed focus:border-border-brand-primary focus:outline-none"
        />
      ) : (
        <input
          value={field.value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={field.label}
          className={cn(
            "h-8 w-full rounded-md border border-border-float bg-bg-surface px-2 text-xs focus:border-border-brand-primary focus:outline-none",
            field.type === "link" && "font-mono",
          )}
        />
      )}
      {isDevMode && (
        <p className="mt-1 truncate font-mono text-[0.625rem] text-fg-secondary-alt">
          {field.sourcePath}
        </p>
      )}
    </div>
  );
}
