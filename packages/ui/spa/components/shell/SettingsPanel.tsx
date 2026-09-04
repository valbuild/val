import { ReactNode, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { FloatingPanel, PanelEmptyState } from "./FloatingPanel";
import { PanelErrorState, PanelSkeleton } from "./PanelPrimitives";
import { Switch } from "../designSystem/switch";
import { cn } from "../designSystem/cn";
import { ShellBreakpoint } from "./types";
import {
  DebouncedFieldWrite,
  useDebouncedFieldWrite,
} from "../fields/useDebouncedFieldWrite";

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
  /**
   * Where settings live, e.g. `/settings.val.ts`.
   *
   * Shown at the foot of the panel because the answer to "where do I put this
   * in source control" is the first thing a developer asks of a screen that
   * edits project-wide configuration.
   */
  moduleFilePath?: string;
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
 * Data: `ai.context` is a paragraph about the project, not a string field, and
 * what follows it — locales, skills, permissions — will each want their own
 * shape too.
 */
export function SettingsPanel({
  breakpoint,
  onClose,
  navSwitcher,
  children,
  moduleFilePath,
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
      footer={
        moduleFilePath ? (
          <div className="px-4 py-2 text-[0.6875rem] text-fg-secondary-alt truncate">
            {moduleFilePath}
          </div>
        ) : undefined
      }
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

/** One settings section: a titled block with an icon and a lead paragraph. */
export function SettingsSection({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4 py-4 border-b border-border-float last:border-b-0">
      <h3 className="flex items-center gap-2 text-[0.8125rem] font-medium tracking-tight">
        <Icon size={14} className="text-fg-secondary-alt" />
        {title}
      </h3>
      <p className="mt-1 text-xs text-fg-secondary-alt leading-relaxed">
        {description}
      </p>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export type AiSettingsValue = {
  /** `null` is unset, which means ON — see `isAiEnabled`. */
  enabled: boolean | null;
  context: string | null;
  tone: string | null;
};

export type AiSettingsFieldsProps = {
  value: AiSettingsValue;
  /**
   * One field changed.
   *
   * Per field rather than per section: the panel does not know whether the
   * project has an `ai` section yet, and whoever writes the patch does — see
   * `ValSettingsSections`.
   */
  onChange: (
    field: keyof AiSettingsValue,
    value: string | boolean | null,
  ) => void;
  /** The cap each field is validated against, from the schema. */
  maxLength: number;
  /** Validation messages, keyed by field, as the Studio has them. */
  errors?: Partial<Record<keyof AiSettingsValue, string>>;
  readonly?: boolean;
};

/**
 * The AI section: what the assistant is told about this project.
 *
 * Two paragraphs, sent with every message the chat makes. `context` is
 * background it would otherwise guess at; `tone` is how it should write when it
 * writes content.
 */
export function AiSettingsFields({
  value,
  onChange,
  maxLength,
  errors,
  readonly,
}: AiSettingsFieldsProps) {
  /**
   * Unset reads as ON, so the switch is `!== false` rather than `!!`.
   *
   * A project that wrote a settings module did not do so to turn the assistant
   * off, and the difference shows the first time someone opens this panel: a
   * `!!` would draw the switch off and the two paragraphs below it as pointless.
   */
  const enabled = value.enabled !== false;
  return (
    <SettingsSection
      title="AI"
      icon={Sparkles}
      description="Told to the assistant with every message it sends."
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="val-ai-enabled" className="text-xs font-medium">
          Assistant
          <span className="block mt-0.5 text-[0.6875rem] font-normal text-fg-secondary-alt">
            {enabled
              ? "Available to editors in this project."
              : "Off. Nothing below is sent, and the chat is hidden."}
          </span>
        </label>
        <Switch
          id="val-ai-enabled"
          checked={enabled}
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
        readonly={readonly || !enabled}
      />
      <SettingsTextField
        label="Tone of voice"
        description="How it should write: formal or playful, British or American, how headings are cased."
        placeholder="Plain and direct. Sentence case in headings, no exclamation marks…"
        value={value.tone}
        onChange={(next) => onChange("tone", next)}
        maxLength={maxLength}
        error={errors?.tone}
        readonly={readonly || !enabled}
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
