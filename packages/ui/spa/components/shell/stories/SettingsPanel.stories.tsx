import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ASSISTANT_SETTINGS_MAX_LENGTH } from "@valbuild/core";
import {
  AssistantSettingsFields,
  AssistantSettingsValue,
  NoSettingsModule,
  SettingsPanel,
  SettingsTabs,
} from "../SettingsPanel";
import { Sparkles } from "lucide-react";
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
  /** The settings module's `ai` section, as source. */
  initial?: AssistantSettingsValue;
  /** No settings module in the project at all. */
  missing?: boolean;
  errors?: Partial<Record<keyof AssistantSettingsValue, string>>;
  readonly?: boolean;
  isLoading?: boolean;
  loadError?: string;
};

const UNSET: AssistantSettingsValue = {
  enabled: null,
  context: null,
  tone: null,
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
  readonly,
  isLoading,
  loadError,
}: HarnessProps) {
  const [value, setValue] = useState<AssistantSettingsValue>(initial);
  return (
    <div className="relative w-full h-svh bg-bg-canvas">
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
            tabs={[
              {
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
                    readonly={readonly}
                  />
                ),
              },
            ]}
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
