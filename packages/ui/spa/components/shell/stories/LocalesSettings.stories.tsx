import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Languages } from "lucide-react";
import {
  LocalesSettingsFields,
  LocalesSettingsValue,
  SettingsPanel,
  SettingsTabs,
} from "../SettingsPanel";
import { ShellBreakpoint } from "../types";

/**
 * The Locales tab: which languages this project publishes.
 *
 * The list is the single source of truth for the whole feature. Every
 * `s.locale()` in the project is validated against it, the Studio's locale
 * picker offers it, and `assistant.translation` is keyed by it — so a language
 * is added here, by whoever writes the content, and not in `val.config.ts` by
 * whoever can deploy.
 *
 * Two things in the design carry weight:
 *
 * - **The order is the project's own**, and is kept rather than sorted. It
 *   decides the order of the locale picker and of the rows in a locale-keyed
 *   record, so a team that works in Norwegian can put Norwegian first.
 * - **Each language is named in its own language.** `Intl.DisplayNames` is
 *   asked in the tag's own locale, so `nb-NO` reads "norsk bokmål" rather than
 *   "Norwegian Bokmål". The row is read by the person who writes it.
 *
 * Removing a language is the destructive edit: content written in it stays, and
 * every piece of it then fails validation. The section says so rather than
 * discovering it for you.
 *
 * Presentational — local state, nothing saved.
 */
const meta: Meta<typeof LocalesSettingsHarness> = {
  title: "Shell/SettingsPanel/Locales",
  component: LocalesSettingsHarness,
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
  },
  argTypes: {
    breakpoint: {
      control: "inline-radio",
      options: ["desktop", "tablet", "mobile"],
    },
  },
  args: { breakpoint: "desktop" },
};

export default meta;

type HarnessProps = {
  breakpoint: ShellBreakpoint;
  /** The settings module's `locales` section, as source. */
  initial?: LocalesSettingsValue;
  errors?: { byIndex?: Record<number, string> };
  readonly?: boolean;
};

const NONE: LocalesSettingsValue = { available: [] };

function LocalesSettingsHarness({
  breakpoint,
  initial = NONE,
  errors,
  readonly,
}: HarnessProps) {
  const [value, setValue] = useState<LocalesSettingsValue>(initial);
  return (
    <div className="relative w-full h-svh bg-bg-canvas">
      <SettingsPanel breakpoint={breakpoint} onClose={() => undefined}>
        <SettingsTabs
          tabs={[
            {
              id: "locales",
              label: "Locales",
              icon: Languages,
              content: (
                <LocalesSettingsFields
                  value={value}
                  onChange={setValue}
                  errors={errors}
                  readonly={readonly}
                />
              ),
            },
          ]}
        />
      </SettingsPanel>
    </div>
  );
}

type Story = StoryObj<typeof LocalesSettingsHarness>;

/**
 * A project that has not said it is translated.
 *
 * Where every project starts, and where it stays unless someone comes here — so
 * the empty state has to explain what adding one does rather than merely say the
 * list is empty.
 */
export const NoLanguages: Story = {};

/**
 * Three languages.
 *
 * There is no default among them, deliberately: every locale-specific field
 * asks which language it is in, and a default is the answer that lets that
 * question go unanswered.
 */
export const Filled: Story = {
  args: { initial: { available: ["en-US", "nb-NO", "fr-FR"] } },
};

/**
 * Norwegian first, English second.
 *
 * The same three languages in a different order — which is the whole reason the
 * list is not sorted.
 */
export const NorwegianFirst: Story = {
  args: { initial: { available: ["nb-NO", "en-US", "fr-FR"] } },
};

/**
 * One language: a project that is not multilingual, but has said what it is.
 *
 * Worth having even alone — it is what `<html lang>` and the assistant read.
 */
export const OneLanguage: Story = {
  args: { initial: { available: ["nb-NO"] } },
};

/**
 * A tag written the POSIX way, and one that is not canonical.
 *
 * Both come from muscle memory — `nb_NO` from filenames and gettext, `en-us`
 * from lowercasing — and both are checked against `Intl.getCanonicalLocales`,
 * the same implementation the browser and every `Intl` constructor use. The
 * message names the canonical spelling, because "not canonical" is not an
 * instruction and `en-US` is.
 *
 * A malformed tag has no language name, so the row shows the tag itself rather
 * than crashing on `Intl.DisplayNames`.
 */
export const BadTags: Story = {
  args: {
    initial: { available: ["en-US", "nb_NO", "fr-fr"] },
    errors: {
      byIndex: {
        1: "'nb_NO' is not a language tag. Language then region, separated by a hyphen — 'nb-NO', not 'nb_NO'",
        2: "'fr-fr' is not canonical. Write it as 'fr-FR'",
      },
    },
  },
};

/**
 * The same language declared twice.
 *
 * Only reachable by hand-editing the settings module — the Add box refuses a
 * tag already in the list — which is why the panel has to be able to FIX it.
 * The error sits on the repeat, not on the list and not on the original, so the
 * second row is the one to delete; rows are identified by position for exactly
 * this case, or removing "en-US" would take both.
 */
export const DuplicateLanguage: Story = {
  args: {
    initial: { available: ["en-US", "nb-NO", "en-US"] },
    errors: { byIndex: { 2: "'en-US' is declared twice" } },
  },
};

/** `s.settings().readonly()`, or an editor without write access. */
export const Readonly: Story = {
  args: {
    initial: { available: ["en-US", "nb-NO", "fr-FR"] },
    readonly: true,
  },
};

/** The panel is full-screen below the tablet breakpoint. */
export const Mobile: Story = {
  args: {
    breakpoint: "mobile",
    initial: { available: ["en-US", "nb-NO", "fr-FR"] },
  },
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
