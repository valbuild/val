import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LocalePicker } from "../LocaleField";
import { TooltipProvider } from "../../designSystem/tooltip";

/**
 * `s.locale()` as an editor meets it: a picker over the project's languages.
 *
 * The options do NOT come from the schema. A project declares its languages once
 * in the settings module, under `locales.available`, and every locale field in
 * the project offers that list — so adding a language is one edit in Settings
 * rather than a deploy per field. That is why `NoLanguages` is a real state
 * worth designing and not an error: the field is fine, the project simply has
 * not said it is translated yet, and the place to fix it is elsewhere.
 *
 * Presentational: these move local state and save nothing.
 */
const meta: Meta<typeof LocalePickerHarness> = {
  title: "Fields/Locale",
  component: LocalePickerHarness,
  parameters: { layout: "fullscreen" },
};

export default meta;

type HarnessProps = {
  /** What the settings module declares under `locales.available`. */
  projectLocales: string[];
  initial?: string | null;
  readonly?: boolean;
  /** What the Studio's locale filter is narrowed to, or `null` for all. */
  filterLocale?: string | null;
};

/**
 * The field on the canvas it is edited over, in the shell's dark mode.
 *
 * The stored value is shown under the picker because it is what ends up in the
 * content, and the row above it reads as a language name rather than a tag.
 */
function LocalePickerHarness({
  projectLocales,
  initial = null,
  readonly,
  filterLocale = null,
}: HarnessProps) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    // The real tree gets this from `ValProvider`; a story mounts its own.
    <TooltipProvider>
      <div
        data-mode="dark"
        className="min-h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
      >
        <div className="mx-auto flex max-w-[360px] flex-col gap-3">
          <label className="text-[0.8125rem] font-medium">Language</label>
          <LocalePicker
            options={projectLocales}
            value={value}
            readonly={readonly}
            filterLocale={filterLocale}
            onChange={setValue}
          />
          <p className="text-xs text-fg-secondary-alt">
            Stored: {value === null ? "nothing yet" : <code>{value}</code>}
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}

type Story = StoryObj<typeof LocalePickerHarness>;

/**
 * A field on a project that declares three languages, with nothing chosen.
 *
 * Each is named in its own language — "norsk bokmål", not "Norwegian Bokmål" —
 * because the row is read by the person who writes that language.
 */
export const Unset: Story = {
  args: { projectLocales: ["en-US", "nb-NO", "fr-FR"] },
};

/** The same field, set. */
export const Chosen: Story = {
  args: { projectLocales: ["en-US", "nb-NO", "fr-FR"], initial: "nb-NO" },
};

/**
 * The project has not declared any languages.
 *
 * Not an error: the field is correct and the project is simply not translated
 * yet, so the copy points at the one place that changes it. Every locale field
 * in such a project looks like this, which makes it the state worth getting
 * right first.
 */
export const NoLanguages: Story = {
  args: { projectLocales: [] },
};

/** `s.locale().readonly()` — shown, and not editable. */
export const Readonly: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO", "fr-FR"],
    initial: "fr-FR",
    readonly: true,
  },
};

/**
 * The locale filter is narrowed to one language, so the field is fixed to it.
 *
 * Hover it for the reason. Locking rather than merely defaulting is the point:
 * everything on screen is Norwegian because the filter made it so, and letting
 * this one field say otherwise would make the item vanish as it saved — which
 * reads as the Studio losing your work, not as a filter working.
 *
 * A new item created while the filter is on arrives already set to it, so this
 * is normally a field that is right rather than a field you cannot fix. The
 * way out is named in the tooltip: clear the filter.
 */
export const LockedByFilter: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO", "fr-FR"],
    initial: "nb-NO",
    filterLocale: "nb-NO",
  },
};

/**
 * Locked by the filter, on a field nobody has set.
 *
 * Reachable on content written before the language existed, or by hand. The
 * placeholder still reads "Pick a language" and the picker will not open,
 * which is exactly when the tooltip has to name the way out rather than just
 * saying no.
 */
export const LockedByFilterUnset: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO", "fr-FR"],
    filterLocale: "nb-NO",
  },
};
