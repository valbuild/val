import { Sparkles } from "lucide-react";
import { ModuleFilePath } from "@valbuild/core";
import { Button } from "./designSystem/button";
import { useSchemas } from "./ValFieldProvider";
import { settingsModuleFilePath } from "../hooks/assistantSettings";
import { useWriteAssistantSetting } from "../hooks/useWriteAssistantSetting";

/**
 * The offer, shown in place of the assistant where nobody has accepted it yet.
 *
 * This is what `"unconfigured"` means (see `assistantAvailability`): the project
 * has a settings module, and nothing in it says whether editors should have an
 * assistant. Hiding it would mean nobody ever finds out there is one; turning it
 * on quietly would mean a project starts sending its content to a model because
 * it did not know to say no. So it is shown, and it asks.
 *
 * Accepting writes `assistant.enabled: true` to the settings module — an
 * ordinary content change, which is why the small print says so: it is a draft
 * until someone publishes it, and then it is on for everyone.
 */
export function EnableAssistantPrompt() {
  const schemas = useSchemas();
  const moduleFilePath =
    schemas.status === "success" ? settingsModuleFilePath(schemas.data) : null;
  if (moduleFilePath === null) {
    // Unreachable by design: a project with no settings module reads as "on",
    // so this component is never rendered for one. It also has nowhere to write
    // the answer, which is the same fact from the other side.
    return null;
  }
  return <Prompt moduleFilePath={moduleFilePath} />;
}

function Prompt({ moduleFilePath }: { moduleFilePath: ModuleFilePath }) {
  const writeAssistantSetting = useWriteAssistantSetting(moduleFilePath);
  return (
    <EnableAssistantPromptView
      onEnable={() => writeAssistantSetting("enabled", true)}
    />
  );
}

/**
 * The offer itself, with nothing behind it.
 *
 * Split from the component above so it can be looked at: everything the
 * connected half does needs a store system, and this is the half that is worth
 * reviewing — it is the first thing an editor sees of the assistant, and the
 * only place the project decides to have one.
 */
export function EnableAssistantPromptView({
  onEnable,
}: {
  onEnable: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 h-full px-6 py-16 text-center">
      <div className="rounded-full p-3">
        <Sparkles className="h-8 w-8" />
      </div>
      <div className="max-w-xs">
        <h2 className="text-lg font-semibold text-fg-primary">
          Turn on the assistant?
        </h2>
        <p className="mt-2 text-sm text-fg-secondary leading-relaxed">
          It can read this project&apos;s content and change it for you.
          Everything it changes is a draft you review before publishing, and
          nothing is sent anywhere until you turn it on.
        </p>
      </div>
      <Button onClick={onEnable}>Turn on the assistant</Button>
      <p className="max-w-xs text-xs text-fg-secondary-alt leading-relaxed">
        This is a change to the project&apos;s settings, so it is a draft like
        any other — publish it and the assistant is on for everyone. You can
        turn it off again under Settings.
      </p>
    </div>
  );
}
