import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  ASSISTANT_SETTINGS_MAX_LENGTH,
  THEME_RADIUS_LENGTHS,
} from "@valbuild/core";
import { themeCustomProperties } from "@valbuild/shared/internal";
import { mockProjectLogo } from "../mockShellData";
import {
  AssistantSettingsFields,
  AssistantSettingsValue,
  NoSettingsModule,
  SettingsLogoPlaceholder,
  SettingsPanel,
  SettingsTabs,
  ThemeSettingsFields,
  ThemeSettingsValue,
} from "../SettingsPanel";
import { Palette, Sparkles } from "lucide-react";
import { ShellBreakpoint } from "../types";
import { EnableAssistantPromptView } from "../../EnableAssistantPrompt";

/**
 * The project's settings, behind the cog in the left rail.
 *
 * The panel is presentational and the sections are a slot, so a story supplies
 * the same section components the app does — with local state instead of the
 * store. What that state stands in for is a settings module:
 * `assistant.enabled`, `assistant.context` and `assistant.tone`, where `null`
 * means UNSET rather than empty.
 *
 * That distinction is the point of the whole schema, and `enabled` is where it
 * shows: unset is neither on nor off but "nobody has decided", which the Studio
 * treats as an offer — the assistant is visible to editors and asks before it
 * is used. See `Empty` and `AssistantOff` for the two ends of it.
 *
 * Editing writes a patch on a pause in typing in the real app; here it only
 * moves local state, so the character counters and the disabled states are
 * live but nothing is saved.
 */
const meta: Meta<typeof SettingsPanelHarness> = {
  title: "Shell/SettingsPanel",
  component: SettingsPanelHarness,
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
  args: {
    breakpoint: "desktop",
  },
};

export default meta;

type HarnessProps = {
  breakpoint: ShellBreakpoint;
  /** The settings module's `assistant` section, as source. */
  initial?: AssistantSettingsValue;
  /** No settings module in the project at all. */
  missing?: boolean;
  errors?: Partial<Record<keyof AssistantSettingsValue, string>>;
  /** Whether there is an assistant to ask. See `onGenerateTone`. */
  canAskAssistant?: boolean;
  /** The settings module's `theme` section, as source. */
  initialTheme?: ThemeSettingsValue;
  themeErrors?: Partial<Record<keyof ThemeSettingsValue, string>>;
  /** Open on the Appearance tab instead of Assistant. */
  appearance?: boolean;
  /**
   * What goes in the logo slot.
   *
   * A slot, not a value: uploading is `ImageField`'s job and it needs the
   * stores, so the panel takes an element. "placeholder" is what a project with
   * no `theme` section sees — the button that creates it — and "field" stands
   * in for the real image field.
   */
  logoSlot?: "none" | "placeholder" | "field";
  readonly?: boolean;
  isLoading?: boolean;
  loadError?: string;
};

const UNSET: AssistantSettingsValue = {
  enabled: null,
  context: null,
  tone: null,
};

const UNSET_THEME: ThemeSettingsValue = {
  accent: null,
  radius: null,
  mode: null,
};

/**
 * The panel over the canvas it floats above.
 *
 * A panel on a bare Storybook background does not show what it is: it is an
 * overlay, drawn on the editor rather than beside it.
 */
function SettingsPanelHarness({
  breakpoint,
  initial = UNSET,
  missing,
  errors,
  canAskAssistant = true,
  initialTheme = UNSET_THEME,
  themeErrors,
  appearance,
  logoSlot = "none",
  readonly,
  isLoading,
  loadError,
}: HarnessProps) {
  const [value, setValue] = useState<AssistantSettingsValue>(initial);
  const [theme, setTheme] = useState<ThemeSettingsValue>(initialTheme);
  /*
   * The theme is APPLIED here, not just edited, so a story shows what picking
   * an accent does rather than only what the control looks like. In the real
   * app this object is on the element that stamps `data-mode` — see
   * `ValThemeProvider`; here the canvas the panel floats over stands in for it.
   */
  const themeStyle = themeCustomProperties({
    accent: theme.accent,
    radius: theme.radius === null ? null : THEME_RADIUS_LENGTHS[theme.radius],
  });
  const assistantTab = {
    id: "assistant",
    label: "Assistant",
    icon: Sparkles,
    content: (
      <AssistantSettingsFields
        value={value}
        onChange={(field, next) =>
          setValue((current) => ({ ...current, [field]: next }))
        }
        maxLength={ASSISTANT_SETTINGS_MAX_LENGTH}
        errors={errors}
        onGenerateTone={
          canAskAssistant
            ? () => {
                // The real one opens the assistant and sends a prompt; there
                // is no assistant here, so it writes what one would plausibly
                // have written. What the story is for is the button's own
                // rule: it is offered while the field is empty and gone once
                // it is not.
                setValue((current) => ({
                  ...current,
                  tone: "Plain and direct. British English, sentence case in headings, no exclamation marks. Contractions are fine. Sentences run short.",
                }));
              }
            : undefined
        }
        readonly={readonly}
      />
    ),
  };
  const appearanceTab = {
    id: "theme",
    label: "Appearance",
    icon: Palette,
    content: (
      <ThemeSettingsFields
        value={theme}
        onChange={(field, next) =>
          setTheme((current) => ({ ...current, [field]: next }))
        }
        errors={themeErrors}
        logoField={
          logoSlot === "placeholder" ? (
            <SettingsLogoPlaceholder
              onAdd={() => undefined}
              disabled={readonly}
            />
          ) : logoSlot === "field" ? (
            // A still of the real field: the point of the story is the row it
            // sits in, not `ImageField`'s own states, which have stories of
            // their own.
            <div className="flex items-center gap-3">
              <img
                src={mockProjectLogo.square.url}
                alt=""
                className="w-16 h-16 rounded-md border border-border-primary object-contain"
              />
              <div className="text-[0.6875rem] text-fg-secondary-alt">
                mark_a1b2c.svg
                <br />
                64 × 64 · image/svg+xml
              </div>
            </div>
          ) : undefined
        }
        readonly={readonly}
      />
    ),
  };
  return (
    <div className="relative w-full h-svh bg-bg-canvas" style={themeStyle}>
      <SettingsPanel
        breakpoint={breakpoint}
        onClose={() => undefined}
        isLoading={isLoading}
        loadError={loadError}
      >
        {missing ? (
          <NoSettingsModule />
        ) : (
          <SettingsTabs
            tabs={
              appearance
                ? [appearanceTab, assistantTab]
                : [assistantTab, appearanceTab]
            }
          />
        )}
      </SettingsPanel>
    </div>
  );
}

type Story = StoryObj<typeof SettingsPanelHarness>;

/**
 * A settings module as it starts life: `c.define("/settings.val.ts",
 * s.settings(), {})`.
 *
 * Nothing is set, so both fields are empty and `enabled` is undecided: the
 * switch is off, and the line under it says which kind of off this is — editors
 * still see the assistant, and are asked before it is used. This is what the
 * panel looks like for every project that has just added the module, which
 * makes it the state worth getting right.
 */
export const Empty: Story = {};

/**
 * The same undecided state with the prose already written.
 *
 * A project may well describe itself before deciding whether to have an
 * assistant, which is why the two text fields stay editable while `enabled` is
 * unset — and go disabled only when it is explicitly off.
 */
export const UndecidedWithContext: Story = {
  args: {
    initial: {
      enabled: null,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. Sentence case in headings.",
    },
  },
};

/** Both AI fields filled in, the way the example app ships them. */
export const Filled: Story = {
  args: {
    initial: {
      enabled: true,
      context:
        "This is the Val example app: a Next.js site used to exercise every part of Val itself. Its content is fixtures — blogs, authors, a support section, a handbook, media galleries — so treat requests as demonstrations rather than as real editorial work.",
      tone: "Plain and direct. British English, sentence case in headings, and no exclamation marks.",
    },
  },
};

/**
 * The assistant turned off — decided, not merely unset.
 *
 * Every way into it goes: no button in the top bar, no row in the quick
 * actions, no panel. The fields stay visible but go disabled: what was written
 * about the project does not stop being true because the chat is off, and it
 * comes straight back when it is turned on again.
 */
export const AssistantOff: Story = {
  args: {
    initial: {
      enabled: false,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct.",
    },
  },
};

/**
 * A field over the schema's cap.
 *
 * The counter turns and says how far over, and the validation message the
 * Studio produced sits under the field. Both matter because these two strings
 * are prepended to every message the assistant sends: the cost of a runaway
 * paragraph here is paid on every turn.
 */
export const OverTheLimit: Story = {
  args: {
    initial: {
      enabled: true,
      context: "Nordic design studio. ".repeat(220),
      tone: "Formal.",
    },
    errors: {
      context: `Value is too long. Max length is ${ASSISTANT_SETTINGS_MAX_LENGTH} characters.`,
    },
  },
};

/** A settings module the schema marked `readonly()`. */
export const Readonly: Story = {
  args: {
    initial: {
      enabled: true,
      context: "Managed centrally — ask the platform team to change this.",
      tone: "Formal, in the second person.",
    },
    readonly: true,
  },
};

/**
 * A project with no settings module.
 *
 * Reachable only from a link or a restored `?panel=settings`, since the cog is
 * hidden for such a project — so the panel says how to add one rather than
 * showing an empty form.
 */
export const NoModule: Story = {
  args: { missing: true },
};

/** While the module's source is still loading. */
export const Loading: Story = {
  args: { isLoading: true },
};

/** When the source could not be loaded at all. */
export const LoadError: Story = {
  args: {
    loadError: "Could not load /settings.val.ts. Check the dev server.",
  },
};

/** The same panel as a mobile sheet. */
export const Mobile: Story = {
  args: {
    breakpoint: "mobile",
    initial: {
      enabled: true,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. Sentence case in headings.",
    },
  },
};

/**
 * The offer, as an editor meets it.
 *
 * Not part of the Settings panel: this is what the assistant's own panel shows
 * while `assistant.enabled` is unset — see `EnableAssistantPrompt`. It is here
 * because it is the other half of the same setting, and the two are worth
 * reading side by side: this is what "undecided" looks like to the person who
 * has to decide.
 */
export const TheOfferEditorsSee: StoryObj<typeof EnableAssistantPromptView> = {
  render: () => (
    <div className="w-full h-svh bg-bg-canvas">
      <div className="mx-auto max-w-sm h-full">
        <EnableAssistantPromptView onEnable={() => undefined} />
      </div>
    </div>
  ),
};

/**
 * The Appearance tab as a project that has never touched it sees it.
 *
 * Val green selected, Default corners, no mode preference — which is the same
 * state as `theme` being absent from the settings module altogether, because
 * every one of those choices writes `null`. An untouched settings module stays
 * `{}`.
 */
export const Appearance: Story = {
  args: { appearance: true },
};

/**
 * A themed Studio, live.
 *
 * The accent is applied to the canvas this panel floats over, so the swatches,
 * the selected ring and the panel's own focus rings are all drawn from the
 * generated ramp rather than from Val's green. This is what an editor sees
 * while they pick: the theme is content, so the draft is what the Studio reads.
 */
export const AppearanceThemed: Story = {
  args: {
    appearance: true,
    initialTheme: { accent: "#7c3aed", radius: "tight", mode: "light" },
  },
};

/**
 * An accent that is not a colour.
 *
 * Only reachable by hand-editing the settings file — the picker cannot produce
 * it — and the reason the panel shows validation rather than trusting the
 * field. Nothing is applied: `themeCustomProperties` returns an empty object
 * for an accent it cannot parse, because half a ramp is worse than none.
 */
export const AppearanceInvalidAccent: Story = {
  args: {
    appearance: true,
    initialTheme: { accent: "cornflower", radius: null, mode: null },
    themeErrors: { accent: "Invalid color: 'cornflower'" },
  },
};

/**
 * The whole panel readonly, on a schema that says so.
 *
 * Both tabs: the swatches, the segmented controls and the colour field all go
 * disabled together, since a readonly settings module is readonly as a whole.
 */
export const AppearanceReadonly: Story = {
  args: {
    appearance: true,
    initialTheme: { accent: "#ea580c", radius: "soft", mode: "dark" },
    readonly: true,
  },
};

/**
 * An empty tone of voice, offering to write itself.
 *
 * The button asks the assistant to read a spread of the project's content and
 * write the field — through the ordinary chat, with the ordinary patch, so the
 * editor sees which modules it read and gets a draft they can edit. Pressing it
 * here fills the field with something a real run might produce, which is enough
 * to show the rule: the offer is gone once there is something to overwrite.
 */
export const GenerateToneOfVoice: Story = {
  args: {
    initial: { enabled: true, context: null, tone: null },
  },
};

/**
 * Nothing to ask, so nothing offered.
 *
 * `onGenerateTone` is absent whenever the chat cannot take a message — an
 * assistant the project turned off, one whose socket has not connected, or a
 * layout with no chat surface at all. The button is not drawn rather than drawn
 * and dead, which is the same rule the "mention this field" button follows.
 */
export const NoAssistantToAsk: Story = {
  args: {
    initial: { enabled: true, context: null, tone: null },
    canAskAssistant: false,
  },
};

/**
 * The logo slot before the project has a `theme` section at all.
 *
 * The button is a necessity rather than a nicety: an image field writes
 * `replace`, which fails for a key that does not exist, and until something has
 * written the section there is no `logo` key for it to replace — the field's
 * source never resolves and it renders a spinner that never stops. So the first
 * step creates the section, as a change the editor asked for by pressing it.
 */
export const AppearanceLogoPlaceholder: Story = {
  args: { appearance: true, logoSlot: "placeholder" },
};

/**
 * The logo slot with an image in it.
 *
 * The real panel puts `ImageField` here — the upload, the progress, the alt
 * text and the focal point all come with it. This is a still of that row, so
 * the story is about the slot rather than about the field.
 */
export const AppearanceWithLogo: Story = {
  args: {
    appearance: true,
    logoSlot: "field",
    initialTheme: { accent: "#ea580c", radius: "tight", mode: null },
  },
};
