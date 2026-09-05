import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LocaleOption, LocalePicker, localeOptionsOf } from "../LocaleField";

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
 * `.aliases()` is the other thing to look at. It changes what is STORED, not
 * merely what is accepted, so a field can hold `no` rather than `nb-NO` and a
 * page can live at `/no/vinterjakke`. Each option is then labelled with the
 * language it means, so a list of `us-sales` and `us-support` still reads as
 * English.
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
  /** The field's own `.aliases()` map, if it has one. */
  aliases?: Record<string, string[]>;
  initial?: string | null;
  readonly?: boolean;
};

/**
 * The field on the canvas it is edited over, in the shell's dark mode.
 *
 * The stored value is shown under the picker because it is the thing aliases
 * make non-obvious: with them, what is in the content is not the tag.
 */
function LocalePickerHarness({
  projectLocales,
  aliases,
  initial = null,
  readonly,
}: HarnessProps) {
  const [value, setValue] = useState<string | null>(initial);
  const options: LocaleOption[] = localeOptionsOf(projectLocales, aliases);
  return (
    <div
      data-mode="dark"
      className="min-h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
    >
      <div className="mx-auto flex max-w-[360px] flex-col gap-3">
        <label className="text-[0.8125rem] font-medium">Language</label>
        <LocalePicker
          options={options}
          value={value}
          readonly={readonly}
          onChange={setValue}
        />
        <p className="text-xs text-fg-secondary-alt">
          Stored: {value === null ? "nothing yet" : <code>{value}</code>}
        </p>
      </div>
    </div>
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

/**
 * `s.locale().aliases({ "en-US": "en", "nb-NO": "no" })`.
 *
 * The stored value is the short segment, and the tag is no longer accepted at
 * all — if both were, one page could exist at `/no/foo` and at `/nb-NO/foo`.
 * The label carries the language so the short form is still readable.
 */
export const ShortUrlSegments: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO"],
    aliases: { "en-US": ["en"], "nb-NO": ["no"] },
    initial: "no",
  },
};

/**
 * Two spellings of one language: two divisions, both writing American English.
 *
 * This is the case a union type could not express and the reason aliases are a
 * map to many rather than a rename. Both options read as English; what differs
 * is which division's content this is.
 */
export const CustomSpellings: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO"],
    aliases: { "en-US": ["us-sales", "us-support"], "nb-NO": ["no"] },
    initial: "us-support",
  },
};

/**
 * A partial map is a subset: this field has no French, though the project does.
 *
 * How a bilingual section of an otherwise trilingual site says so.
 */
export const ASubsetOfTheProject: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO", "fr-FR"],
    aliases: { "en-US": ["en"], "nb-NO": ["no"] },
    initial: "en",
  },
};

/** `s.locale().readonly()` — shown, and not editable. */
export const Readonly: Story = {
  args: {
    projectLocales: ["en-US", "nb-NO", "fr-FR"],
    initial: "fr-FR",
    readonly: true,
  },
};
