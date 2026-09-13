import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LocaleFilter } from "../LocaleFilter";

/**
 * The locale filter, as it sits in the studio's chrome.
 *
 * A view filter rather than an action, which is why in the top bar it comes
 * FIRST in the right-hand cluster — before Preview, Review and Publish. Those
 * are things you do; this is what you are looking at while you do them. On a
 * phone it moves to the bottom bar, where the actions are, and opens upward.
 *
 * What it does: picking a language hides content in a DIFFERENT language.
 * Content in no language at all is always shown, which in most projects is most
 * of it — the filter narrows a translated section rather than emptying the
 * studio. And it changes what is *listed*, never what is reachable: a link to a
 * Norwegian page opens it while the filter says English.
 */
const meta: Meta<typeof LocaleFilterHarness> = {
  title: "Shell/Locale filter",
  component: LocaleFilterHarness,
  parameters: { layout: "fullscreen" },
};

export default meta;

function LocaleFilterHarness({
  locales,
  initial = null,
  menuPlacement = "below",
}: {
  locales: string[];
  initial?: string | null;
  menuPlacement?: "below" | "above";
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div
      data-mode="dark"
      className="min-h-screen bg-bg-canvas p-6 font-sans text-fg-primary"
    >
      {/* The bar it lives in, so the control is shown at the size it really is. */}
      <div className="mx-auto flex h-11 max-w-[560px] items-center gap-1.5 rounded-lg border border-border-float bg-bg-float px-2">
        <span className="text-xs font-medium text-fg-secondary">
          my-project
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <LocaleFilter
            locales={locales}
            value={value}
            onChange={setValue}
            menuPlacement={menuPlacement}
          />
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[560px] text-xs text-fg-secondary-alt">
        Showing: {value === null ? "all locales" : <code>{value}</code>}
      </p>
    </div>
  );
}

type Story = StoryObj<typeof LocaleFilterHarness>;

/** The default: every language, and everything with none. */
export const AllLocales: Story = {
  args: { locales: ["en-US", "nb-NO", "fr-FR"] },
};

/** Filtered. The control fills in, because a filter that is ON has to look it. */
export const Filtered: Story = {
  args: { locales: ["en-US", "nb-NO", "fr-FR"], initial: "nb-NO" },
};

/**
 * A project that has declared no languages.
 *
 * Renders nothing at all — a picker offering only "All locales" is furniture
 * that explains nothing, and every untranslated project would carry it.
 */
export const NoLanguages: Story = {
  args: { locales: [] },
};

/**
 * A language the project no longer has, from an old link.
 *
 * Reads as no filter rather than as an empty studio.
 */
export const AnUnknownLanguage: Story = {
  args: { locales: ["en-US", "nb-NO"], initial: "sv-SE" },
};

/** The mobile bottom bar: the menu opens upward, or it opens off the screen. */
export const OnTheBottomBar: Story = {
  args: {
    locales: ["en-US", "nb-NO", "fr-FR"],
    initial: "fr-FR",
    menuPlacement: "above",
  },
};
