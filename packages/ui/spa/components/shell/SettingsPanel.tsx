import { ReactNode, useEffect, useState } from "react";
import { LucideIcon } from "lucide-react";
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
      <SettingsTextField
        label="Tone of voice"
        description="How it should write: formal or playful, British or American, how headings are cased."
        placeholder="Plain and direct. Sentence case in headings, no exclamation marks…"
        value={value.tone}
        onChange={(next) => onChange("tone", next)}
        maxLength={maxLength}
        error={errors?.tone}
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
  readonly,
}: {
  label: string;
  description: string;
  placeholder?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength: number;
  error?: string;
  readonly?: boolean;
}) {
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
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <span className="block mt-0.5 text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
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
        rows={4}
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
        <span className="text-[0.6875rem] text-fg-error-on-surface leading-relaxed">
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
    </label>
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

export type LocalesSettingsValue = {
  /** The declared languages, in the project's own order. */
  available: string[];
  /** One of `available`, or `null` where nothing has been chosen. */
  default: string | null;
};

export type LocalesSettingsFieldsProps = {
  value: LocalesSettingsValue;
  onChange: (next: LocalesSettingsValue) => void;
  /**
   * What validation says, by language tag and about the default.
   *
   * Keyed by tag rather than by index so a row keeps its message when the row
   * above it is removed — the source has not been re-validated yet at that
   * point, and an index would shift the message onto its neighbour.
   */
  errors?: { byTag?: Record<string, string>; default?: string };
  readonly?: boolean;
};

/**
 * The languages a project publishes, and which one it writes in first.
 *
 * The list is the project's own order, and it is kept rather than sorted: it
 * decides the order of the locale picker and of the rows in a locale-keyed
 * record, so a team that works in Norwegian can put Norwegian at the top.
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
    onChange({
      available: [...value.available, tag],
      // The first language declared is the one a project writes in until it
      // says otherwise, which saves a second decision on the common path.
      default: value.default ?? tag,
    });
    setDraft("");
  };
  const remove = (tag: string) => {
    const available = value.available.filter((each) => each !== tag);
    onChange({
      available,
      // A default that has just been removed is not a default any more. Left
      // alone it would be a dangling tag that every check then complains about.
      default: value.default === tag ? (available[0] ?? null) : value.default,
    });
  };
  return (
    <SettingsSection description="The languages this project publishes. Content is checked against this list, so removing a language reports every piece of content still written in it.">
      <div className="flex flex-col gap-1.5">
        {value.available.length === 0 && (
          <p className="text-[0.6875rem] text-fg-secondary-alt leading-relaxed">
            No languages yet. Add one and this project becomes translated.
          </p>
        )}
        {value.available.map((tag) => (
          <LocaleRow
            key={tag}
            tag={tag}
            isDefault={value.default === tag}
            error={errors?.byTag?.[tag]}
            readonly={readonly}
            onMakeDefault={() => onChange({ ...value, default: tag })}
            onRemove={() => remove(tag)}
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
        {errors?.default && (
          <span className="mt-1 block text-[0.6875rem] text-fg-error-on-surface leading-relaxed">
            {errors.default}
          </span>
        )}
      </label>
    </SettingsSection>
  );
}

function LocaleRow({
  tag,
  isDefault,
  error,
  readonly,
  onMakeDefault,
  onRemove,
}: {
  tag: string;
  isDefault: boolean;
  error?: string;
  readonly?: boolean;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  const name = localeName(tag);
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
        {isDefault ? (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-medium bg-bg-float-raised text-fg-secondary">
            Written in first
          </span>
        ) : (
          <button
            type="button"
            disabled={readonly}
            onClick={onMakeDefault}
            className="shrink-0 text-[0.6875rem] text-fg-secondary hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Write in this first
          </button>
        )}
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
