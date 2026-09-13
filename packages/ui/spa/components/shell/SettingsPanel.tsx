import type { Json } from "@valbuild/core";
import { ReactNode, useEffect, useId, useState } from "react";
import { ImagePlus, LucideIcon, Sparkles } from "lucide-react";
import { THEME_RADIUS_STEPS, ThemeRadius } from "@valbuild/core";
// From `ColorFieldPure`, not from `ColorField`: the connected field in that
// module reaches the whole editor tree, and this panel is presentational.
import { ColorFieldPure } from "../fields/ColorFieldPure";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import { PanelErrorState, PanelSkeleton } from "./PanelPrimitives";
import { Switch } from "../designSystem/switch";
import { cn } from "../designSystem/cn";
import { ShellBreakpoint } from "./types";
import {
  DebouncedFieldWrite,
  useDebouncedFieldWrite,
} from "../fields/useDebouncedFieldWrite";
import { localeName } from "../../utils/localeName";

export type SettingsPanelProps = {
  breakpoint: ShellBreakpoint;
  onClose: () => void;
  /** Mobile destination switcher, rendered below the panel header. */
  navSwitcher?: ReactNode;
  /**
   * The sections, connected to the store by the app.
   *
   * A slot rather than props, for the same reason the editor is a slot: a
   * section edits content, and the panel is presentational. Storybook passes
   * the same section components with local state — see the stories.
   */
  children?: ReactNode;
  /** Show placeholder rows instead of content while data loads. */
  isLoading?: boolean;
  /** Message to show instead of content when the data could not be loaded. */
  loadError?: string;
  onRetryLoad?: () => void;
};

/**
 * The project's settings: the `s.settings()` module, one section at a time.
 *
 * Not the account panel ({@link AccountPanel}, at the foot of the rail), and the
 * difference is not cosmetic: everything here is CONTENT. It is edited as a
 * draft, it shows up in the publish diff, and it is the same for everyone
 * working on the project — where the theme and auto save are one person's, on
 * one machine.
 *
 * Each section gets a UI built for it rather than the generic field renderer.
 * That is the whole reason settings is a destination instead of a module under
 * Data: `assistant.context` is a paragraph about the project, not a string
 * field, and
 * what follows it — locales, skills, permissions — will each want their own
 * shape too.
 */
export function SettingsPanel({
  breakpoint,
  onClose,
  navSwitcher,
  children,
  isLoading,
  loadError,
  onRetryLoad,
}: SettingsPanelProps) {
  return (
    <FloatingPanel
      side="left"
      width={360}
      title="Settings"
      mobileVariant="sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      subheader={navSwitcher}
    >
      {isLoading ? (
        <PanelSkeleton rows={4} />
      ) : loadError ? (
        <PanelErrorState message={loadError} onRetry={onRetryLoad} />
      ) : (
        children
      )}
    </FloatingPanel>
  );
}

export type SettingsTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
};

/**
 * The settings panel's tabs.
 *
 * One tab today — AI — and the strip is drawn anyway. Settings is a place with
 * sections coming to it (locales, skills, a permissions model), and a panel
 * that grows a tab strip later would move everything an editor had learned the
 * position of. A single tab also says what this panel is: not "the AI panel",
 * but the project's settings, of which AI is one.
 *
 * Presentational, and the selected tab is its own state: which tab you were on
 * is not worth a URL parameter, and reopening the panel on the first one is the
 * behaviour every other panel in the shell has.
 */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  if (!current) {
    return null;
  }
  return (
    <div className="flex flex-col">
      <div
        role="tablist"
        aria-label="Settings sections"
        // Left-aligned and natural width, not `flex-1`: with one tab, stretching
        // it to the panel drew a full-width button rather than a tab, and a strip
        // that re-flows every tab as sections are added is one that moves the tab
        // an editor had learned the position of.
        className="flex gap-0.5 m-3 p-0.5 rounded-md bg-bg-float-raised self-start w-fit"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={current.id === id}
            onClick={() => setActive(id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-7 px-3 rounded text-[0.6875rem]",
              current.id === id
                ? "bg-bg-float text-fg-primary shadow-sm font-medium"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.content}</div>
    </div>
  );
}

/** One settings section: a lead paragraph and the fields under it. */
export function SettingsSection({
  description,
  children,
}: {
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4 pb-4">
      <p className="text-xs text-fg-secondary-alt leading-relaxed">
        {description}
      </p>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export type AssistantSettingsValue = {
  /**
   * Three states, not two — see `assistantAvailability`.
   *
   * `null` is "nobody has decided": the assistant is offered to editors and
   * asks before it is used. It is NOT the same as `false`, which hides it.
   */
  enabled: boolean | null;
  context: string | null;
  tone: string | null;
};

export type AssistantSettingsFieldsProps = {
  value: AssistantSettingsValue;
  /**
   * One field changed.
   *
   * Per field rather than per section: the panel does not know whether the
   * project has an `assistant` section yet, and whoever writes the patch does —
   * see `ValSettingsSections`.
   */
  onChange: (
    field: keyof AssistantSettingsValue,
    value: string | boolean | null,
  ) => void;
  /** The cap each field is validated against, from the schema. */
  maxLength: number;
  /** Validation messages, keyed by field, as the Studio has them. */
  errors?: Partial<Record<keyof AssistantSettingsValue, string>>;
  /**
   * Ask the assistant to write the tone of voice from the project's content.
   *
   * Absent where there is no assistant to ask — a project that has turned it
   * off, or a layout with no chat surface — in which case the button is not
   * drawn rather than drawn and dead. See `ValSettingsSections`.
   */
  onGenerateTone?: () => void;
  readonly?: boolean;
};

/**
 * The assistant: whether editors have one, and what it is told about the
 * project.
 *
 * Two paragraphs, sent with every message the chat makes. `context` is
 * background it would otherwise guess at; `tone` is how it should write when it
 * writes content.
 */
export function AssistantSettingsFields({
  value,
  onChange,
  maxLength,
  errors,
  onGenerateTone,
  readonly,
}: AssistantSettingsFieldsProps) {
  /**
   * A two-position switch for a three-state setting, and the third state is
   * carried by the words under it rather than by the switch.
   *
   * Unset draws as off, which is the safe way round: it is not on, and nothing
   * is sent until someone says so. What it is NOT is `false` — the assistant is
   * still offered to editors, who are asked before it is used — so the line
   * below says which of the two "off"s this is. Flicking the switch decides,
   * and there is no way back to undecided from here, which is right: the state
   * exists because nobody had answered, and now somebody has.
   */
  const isOn = value.enabled === true;
  const isUndecided = value.enabled === null || value.enabled === undefined;
  return (
    <SettingsSection description="Told to the assistant with every message it sends.">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="val-assistant-enabled" className="text-xs font-medium">
          Enabled
          <span className="block mt-0.5 text-[0.6875rem] font-normal text-fg-secondary-alt">
            {isOn
              ? "Editors have an assistant in this project."
              : isUndecided
                ? "Not decided yet. Editors are offered the assistant and asked to turn it on before it is used."
                : "Off. The assistant is hidden everywhere, and nothing is sent."}
          </span>
        </label>
        <Switch
          id="val-assistant-enabled"
          checked={isOn}
          disabled={readonly}
          onCheckedChange={(next) => onChange("enabled", next)}
        />
      </div>
      {/*
       * Tone of voice first, context second.
       *
       * Not the order the schema declares them in, and the panel wins: tone is
       * the field an editor comes here to write, and the one with something to
       * offer while it is empty. Context is background you fill in once and do
       * not look at again.
       */}
      <SettingsTextField
        label="Tone of voice"
        description="How it should write: formal or playful, British or American, how headings are cased."
        placeholder="Plain and direct. Sentence case in headings, no exclamation marks…"
        value={value.tone}
        onChange={(next) => onChange("tone", next)}
        maxLength={maxLength}
        error={errors?.tone}
        readonly={readonly || value.enabled === false}
        /*
         * Offered only while the field is empty, and that is the whole rule:
         * with something in it the button would be an invitation to overwrite
         * what somebody wrote, and there is no undo in a settings panel. To
         * regenerate, clear it.
         */
        action={
          onGenerateTone && !value.tone?.trim() ? (
            <SettingsFieldAction
              icon={Sparkles}
              label="Generate from my content"
              onClick={onGenerateTone}
              disabled={readonly || value.enabled === false}
            />
          ) : undefined
        }
      />
      <SettingsTextField
        label="Context"
        description="What this site is, who runs it, names and spellings that matter."
        placeholder="A CMS for developers, run by a team of four…"
        value={value.context}
        onChange={(next) => onChange("context", next)}
        maxLength={maxLength}
        error={errors?.context}
        readonly={readonly || value.enabled === false}
      />
    </SettingsSection>
  );
}

/**
 * A multiline settings field with a character count.
 *
 * The input never waits for the write — the typed value is local state, and the
 * patch happens on a pause, the way every other text field in the Studio does
 * it (see `useDebouncedFieldWrite`). Empty is written as `null`, not as `""`:
 * unset is a real state in a settings module, and an empty string is a value
 * that would be handed to the model as one.
 */
export function SettingsTextField({
  label,
  description,
  placeholder,
  value,
  onChange,
  maxLength,
  error,
  action,
  readonly,
}: {
  label: string;
  description: string;
  placeholder?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength: number;
  error?: string;
  /** Drawn on the label's row, right-aligned. See `SettingsFieldAction`. */
  action?: ReactNode;
  readonly?: boolean;
}) {
  // `useId` rather than a slug of the label: two fields could share a label,
  // and an id that collides silently points a label at the wrong box.
  const fieldId = useId();
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const [current, setCurrent] = useState(value ?? "");
  const write: DebouncedFieldWrite<string> = useDebouncedFieldWrite<string>(
    (next) => onChange(next === "" ? null : next),
  );
  useEffect(() => {
    // Not while a keystroke is still unwritten: between a keystroke and its
    // patch the source still holds the pre-edit value, and taking it would put
    // back the character just typed. The same guard `StringField` needs.
    if (write.hasPending()) {
      return;
    }
    setCurrent(value ?? "");
  }, [value, write]);
  const overBy = current.length - maxLength;
  return (
    /*
     * A `<div>` with a `<label htmlFor>`, not a `<label>` wrapping everything.
     *
     * The wrapping form is shorter and was what this had, and it makes two
     * things wrong that nothing on screen shows:
     *
     * A BUTTON INSIDE A LABEL TAKES THE LABEL'S NAME. Add "Generate from my
     * content" to a wrapping label and it is announced as "Tone of voice,
     * button" — the label's text wins the accessible-name computation over the
     * button's own contents. It also swallows the click, since a label forwards
     * clicks to its control, so pressing it put the caret in the box.
     *
     * AND THE DESCRIPTION BECAME PART OF THE FIELD'S NAME. Everything inside a
     * wrapping label names the control, so the textarea was called "Tone of
     * voice How it should write: formal or playful, British or American, how
     * headings are cased." It is a description; `aria-describedby` is where a
     * description goes.
     */
    <div className="block">
      {/*
       * The action is a SIBLING of the label, on its row: next to the name of
       * the thing it fills in, and outside the label for the reason above.
       */}
      <span className="flex items-start justify-between gap-2">
        <label htmlFor={fieldId} className="text-xs font-medium">
          {label}
        </label>
        {action}
      </span>
      <span
        id={descriptionId}
        className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed"
      >
        {description}
      </span>
      {/*
       * A box with a ceiling, not an auto-growing one.
       *
       * `AutoGrowingTextarea` takes exactly as much height as its content, and
       * these fields are capped at thousands of characters: a value near the cap
       * grew the box past the panel and pushed the counter and the validation
       * message — the two things that explain what is wrong — out of sight. It
       * scrolls instead, and can be dragged taller.
       */}
      <textarea
        id={fieldId}
        rows={4}
        // The description and, when there is one, the validation message: both
        // are about the value rather than part of its name.
        aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        aria-invalid={error ? true : undefined}
        className="mt-1.5 w-full resize-y max-h-56 rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-xs leading-relaxed placeholder:text-fg-secondary-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={placeholder}
        value={current}
        disabled={readonly}
        onChange={(event) => {
          setCurrent(event.currentTarget.value);
          write.push(event.currentTarget.value);
        }}
        onBlur={() => write.flush()}
      />
      <span className="mt-1 flex items-start justify-between gap-2">
        <span
          id={errorId}
          className="text-[0.6875rem] text-fg-error-on-surface leading-relaxed"
        >
          {error}
        </span>
        <span
          className={cn(
            "shrink-0 text-[0.6875rem] tabular-nums",
            overBy > 0 ? "text-fg-error-on-surface" : "text-fg-secondary-alt",
          )}
        >
          {overBy > 0 ? `${overBy} over` : `${current.length} / ${maxLength}`}
        </span>
      </span>
    </div>
  );
}

/** Shown in the panel when the project has no settings module. */
export function NoSettingsModule() {
  return (
    <PanelEmptyState>
      This project has no settings module. Add one at the root of the content
      tree — <code>/settings.val.ts</code> — with{" "}
      <code>c.define(&quot;/settings.val.ts&quot;, s.settings(), {"{}"})</code>,
      and register it in <code>val.modules.ts</code>.
    </PanelEmptyState>
  );
}

export type ThemeSettingsValue = {
  /** A hex colour, or `null` for Val's own green. */
  accent: string | null;
  radius: ThemeRadius | null;
  /** The project's default mode, or `null` for "no preference". */
  mode: "dark" | "light" | null;
};

export type ThemeSettingsFieldsProps = {
  value: ThemeSettingsValue;
  /** One field changed. Per field for the same reason the assistant's is. */
  onChange: (field: keyof ThemeSettingsValue, value: string | null) => void;
  /** Validation messages, keyed by field, as the Studio has them. */
  errors?: Partial<Record<keyof ThemeSettingsValue, string>>;
  /**
   * The logo's field, as an element.
   *
   * A slot rather than props, for the reason the sections themselves are a slot
   * in {@link SettingsPanel}: uploading an image is `ImageField`'s whole job —
   * the ref from the file's hash, the two-phase upload, the progress, local or
   * remote — and none of that can be reimplemented in a presentational panel
   * without being a worse copy of it. `ValSettingsSections` passes the real
   * field; the stories pass a still of one.
   */
  logoField?: ReactNode;
  readonly?: boolean;
};

export type LocalesSettingsValue = {
  /**
   * Every POSITION the source has, in the project's own order — not only the
   * ones holding a language.
   *
   * `Json` rather than `string[]` because a settings module is a file people
   * edit by hand, and dropping what is not a string would take the row with it:
   * validation reports by index, so the message for `available.0` would land on
   * whatever survived to position 0, and the value that caused it would have no
   * row to be removed from. A panel has to be able to repair what it reports.
   */
  available: Json[];
};

export type LocalesSettingsFieldsProps = {
  value: LocalesSettingsValue;
  onChange: (next: LocalesSettingsValue) => void;
  /**
   * What validation says about each language, by its POSITION in the list.
   *
   * By position and not by tag, because a tag is not a row: `available` can
   * hold the same language twice — that is exactly what the duplicate-language
   * rule reports, on the repeat — and a tag-keyed map would put that message on
   * both rows, leaving the editor no way to see which one to delete.
   */
  errors?: { byIndex?: Record<number, string> };
  readonly?: boolean;
};

/**
 * The presets, in swatch order.
 *
 * A fast path, not the whole feature: the field below them takes any hex, and
 * both go through the same generator — so these are eight values in an array
 * rather than eight themes with anything of their own. Chosen to be
 * distinguishable from each other at 22px, which rules out having both an
 * indigo and a violet.
 */
const ACCENT_PRESETS: { hex: string; name: string }[] = [
  { hex: "#2563eb", name: "Blue" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#db2777", name: "Pink" },
  { hex: "#dc2626", name: "Red" },
  { hex: "#ea580c", name: "Orange" },
  { hex: "#ca8a04", name: "Amber" },
  { hex: "#0891b2", name: "Cyan" },
  { hex: "#64748b", name: "Slate" },
];

const RADIUS_LABELS: Record<ThemeRadius, string> = {
  square: "Square",
  tight: "Tight",
  default: "Default",
  soft: "Soft",
};

/**
 * How the Studio looks in this project: one colour, and how round the corners
 * are.
 *
 * Chrome, and only chrome — nothing here reaches a visitor to the site. It is
 * content all the same: it is edited as a draft, it shows up in the publish
 * diff, and it is the same for everyone working on the project. Which is what
 * makes the preview free: the draft is what the Studio reads, so the colour
 * changes as it is picked.
 */
export function ThemeSettingsFields({
  value,
  onChange,
  errors,
  logoField,
  readonly,
}: ThemeSettingsFieldsProps) {
  const accent = value.accent?.trim().toLowerCase() ?? null;
  return (
    <SettingsSection description="The Studio's own chrome, for everyone working on this project. Nothing here changes the site.">
      <div>
        <span className="text-xs font-medium">Accent</span>
        <span className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
          One colour, and the whole chrome is built from it. Anything is
          allowed: the shades are generated so text stays legible on them.
        </span>
        <div
          role="radiogroup"
          aria-label="Accent"
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {/*
           * Val's green is the first swatch rather than a "reset" button
           * somewhere else, because it is not a reset — it is one of the
           * choices, and the one the project starts on. It writes `null`: the
           * absence of an accent, so an untouched settings module stays empty.
           */}
          <AccentSwatch
            name="Val green"
            css="var(--brand-val-green)"
            selected={accent === null}
            disabled={readonly}
            onSelect={() => onChange("accent", null)}
          />
          {ACCENT_PRESETS.map((preset) => (
            <AccentSwatch
              key={preset.hex}
              name={preset.name}
              css={preset.hex}
              selected={accent === preset.hex}
              disabled={readonly}
              onSelect={() => onChange("accent", preset.hex)}
            />
          ))}
        </div>
        <div className="mt-2">
          {/*
           * The same field the Studio uses for any `s.color()`, in hex — so a
           * brand colour can be pasted in, and the OS picker is the OS picker.
           * It never writes `null`, which is what the first swatch is for.
           */}
          <ColorFieldPure
            id="val-theme-accent"
            value={value.accent}
            onChange={(next) => onChange("accent", next)}
            format="hex"
            readonly={readonly}
          />
        </div>
        {errors?.accent && (
          <span className="block mt-1 text-[0.6875rem] text-fg-error-on-surface leading-relaxed">
            {errors.accent}
          </span>
        )}
      </div>
      <SettingsChoice
        label="Corners"
        description="How round every panel, field and button in the Studio is."
        options={THEME_RADIUS_STEPS.map((step) => ({
          // `default` writes `null`: it is the same value the stylesheet
          // already has, and writing it would put a setting in the file that
          // changes nothing.
          id: step === "default" ? null : step,
          label: RADIUS_LABELS[step],
        }))}
        selected={value.radius === "default" ? null : value.radius}
        onSelect={(next) => onChange("radius", next)}
        readonly={readonly}
        error={errors?.radius}
      />
      {logoField && (
        <div>
          <span className="text-xs font-medium">Logo</span>
          <span className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            Shown where Val&apos;s mark is, at the top of the rail. A square-ish
            mark rather than a wordmark — the slot is small, and a wide image is
            fitted into it rather than cropped.
          </span>
          <div className="mt-2">{logoField}</div>
        </div>
      )}
      <SettingsChoice
        label="Opens in"
        description="What an editor who has never picked a mode sees. It does not change the mode for anyone who has."
        options={[
          { id: null, label: "No preference" },
          { id: "dark", label: "Dark" },
          { id: "light", label: "Light" },
        ]}
        selected={value.mode}
        onSelect={(next) => onChange("mode", next)}
        readonly={readonly}
        error={errors?.mode}
      />
    </SettingsSection>
  );
}

/**
 * The languages a project publishes.
 *
 * The list is the project's own order, and it is kept rather than sorted: it
 * decides the order of the locale picker and of the rows in a locale-keyed
 * record, so a team that works in Norwegian can put Norwegian at the top.
 *
 * There is no default. Every locale-specific field asks which language it is
 * in, and a default is exactly the answer that lets that question go
 * unanswered — content ends up filed under a language nobody chose.
 *
 * Each language is named as well as tagged. `Intl.DisplayNames` is asked in the
 * language's OWN language, so Norwegian reads "norsk bokmål" rather than
 * "Norwegian Bokmål" — the row is for the person who writes that language.
 */
export function LocalesSettingsFields({
  value,
  onChange,
  errors,
  readonly,
}: LocalesSettingsFieldsProps) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = draft.trim();
    if (tag === "" || value.available.includes(tag)) {
      setDraft("");
      return;
    }
    onChange({ available: [...value.available, tag] });
    setDraft("");
  };
  // By position, not by value. A hand-edited settings module can declare the
  // same language twice, and removing "every en-US" would delete the good row
  // along with the duplicate the editor came here to fix.
  const remove = (index: number) => {
    onChange({ available: value.available.filter((_, i) => i !== index) });
  };
  return (
    <SettingsSection description="The languages this project publishes. Content is checked against this list, so removing a language reports every piece of content still written in it.">
      <div className="flex flex-col gap-1.5">
        {value.available.length === 0 && (
          <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            No languages yet. Add one and this project becomes translated.
          </p>
        )}
        {value.available.map((entry, index) => (
          // Keyed by position for the same reason: a tag is not unique, so a
          // duplicate would collide. Safe here because a row holds no state of
          // its own and the list is never reordered.
          <LocaleRow
            key={index}
            entry={entry}
            error={errors?.byIndex?.[index]}
            readonly={readonly}
            onRemove={() => remove(index)}
          />
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-medium">Add a language</span>
        <span className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
          A BCP 47 tag: language, then region, separated by a hyphen — en-US,
          nb-NO.
        </span>
        <span className="mt-1.5 flex gap-1.5">
          <input
            className="flex-1 min-w-0 rounded-md border border-border-primary bg-bg-primary px-3 h-8 text-xs placeholder:text-fg-secondary-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="nb-NO"
            value={draft}
            disabled={readonly}
            spellCheck={false}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <button
            type="button"
            disabled={readonly || draft.trim() === ""}
            onClick={add}
            className="shrink-0 h-8 px-3 rounded-md border border-border-primary text-xs font-medium hover:bg-bg-float-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </span>
      </label>
    </SettingsSection>
  );
}

/**
 * One preset colour.
 *
 * A radio rather than a button: the row is a choice of one, and a screen reader
 * should say which is chosen — the ring alone says it only to people who can
 * see it.
 */
function AccentSwatch({
  name,
  css,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  /** Any CSS colour: the presets are hex, Val's green is its own token. */
  css: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={name}
      title={name}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-6 h-6 rounded-full border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // The selected ring carries no offset, deliberately: `ring-offset-*`
        // resolves `--tw-ring-offset-color` from `--background`, which is dead
        // inside the shadow root, and an invalid colour voids the whole
        // box-shadow — so the ring would vanish rather than lose its gap. The
        // outline of the swatch itself provides the separation instead.
        selected
          ? "border-bg-float ring-2 ring-fg-primary"
          : "border-border-primary",
      )}
      style={{ backgroundColor: css }}
    />
  );
}

/**
 * A settings field that is a choice between a few named options.
 *
 * The same radio group the account panel draws for light and dark, because it
 * is the same question shape — and a `<select>` for four options hides three of
 * them behind a click.
 */
function SettingsChoice<Id extends string | null>({
  label,
  description,
  options,
  selected,
  onSelect,
  readonly,
  error,
}: {
  label: string;
  description: string;
  options: { id: Id; label: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
  readonly?: boolean;
  error?: string;
}) {
  return (
    <div>
      <span className="text-xs font-medium">{label}</span>
      <span className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
        {description}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-2 flex p-0.5 rounded-md bg-bg-float-raised"
      >
        {options.map((option) => (
          <button
            key={option.id ?? "unset"}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            disabled={readonly}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex-1 inline-flex items-center justify-center h-7 rounded text-[0.6875rem]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected === option.id
                ? "bg-bg-float text-fg-primary shadow-sm font-medium"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && (
        <span className="block mt-1 text-[0.6875rem] text-fg-error-on-surface leading-relaxed">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * A small button beside a settings field's label.
 *
 * A sibling of the label rather than inside it, which is `SettingsTextField`'s
 * doing and is the whole reason that component is a `<div>` with a
 * `<label htmlFor>`: a button inside a label is announced with the LABEL's text
 * and has its click forwarded to the control.
 */
export function SettingsFieldAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded",
        "text-[0.6875rem] text-fg-secondary hover:text-fg-primary",
        "bg-bg-float-raised hover:bg-bg-secondary-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

/**
 * Where the logo field goes before the project has a `theme` section at all.
 *
 * Not politeness — a necessity, and the reason is patch semantics meeting an
 * optional section. `ImageField` writes `replace`, which fails for a key that
 * does not exist, so `useWriteThemeSetting`'s section-creating write leaves a
 * `logo: null` for it to replace. Until something has written that section,
 * there is no key: the field's source never resolves and it renders a spinner
 * that never stops. (An absent optional key resolving as pending rather than as
 * null is the underlying thing, and it is not this feature's to fix — every
 * optional nested key has it.)
 *
 * So this button, whose only job is to create the section. It writes a change
 * an editor asked for by pressing it, rather than one the panel wrote for
 * everybody who merely looked at the tab.
 */
export function SettingsLogoPlaceholder({
  onAdd,
  disabled,
}: {
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onAdd}
      className={cn(
        "w-full inline-flex items-center justify-center gap-1.5 h-16 rounded-md",
        "border border-dashed border-border-primary",
        "text-[0.6875rem] text-fg-secondary hover:text-fg-primary hover:bg-bg-float-raised",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <ImagePlus size={13} />
      Add a logo
    </button>
  );
}

/**
 * One declared position.
 *
 * Usually a language. Where it is not — a number, an object, whatever a hand
 * edit left behind — the row still draws, showing the value as it is written so
 * it can be recognised and removed. Validation has already said what is wrong
 * with it; the row's job is to be the thing that can be deleted.
 */
function LocaleRow({
  entry,
  error,
  readonly,
  onRemove,
}: {
  entry: Json;
  error?: string;
  readonly?: boolean;
  onRemove: () => void;
}) {
  const tag = typeof entry === "string" ? entry : JSON.stringify(entry);
  const name = typeof entry === "string" ? localeName(entry) : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-primary px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium truncate">
            {name ?? tag}
          </span>
          {name !== undefined && (
            <span className="block text-[0.6875rem] text-fg-secondary-alt tabular-nums">
              {tag}
            </span>
          )}
        </span>
        <button
          type="button"
          disabled={readonly}
          onClick={onRemove}
          aria-label={`Remove ${name ?? tag}`}
          className="shrink-0 text-[0.6875rem] text-fg-secondary hover:text-fg-error-on-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {error && (
        <span className="text-[0.6875rem] text-fg-error-on-surface leading-relaxed">
          {error}
        </span>
      )}
    </div>
  );
}
