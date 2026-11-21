import type { PickedElement } from "@valbuild/shared/internal";
import type { ChatMessageAttachment } from "../components/AIChat";
import {
  chatDocumentToHtmlText,
  collectImageNodesFromDoc,
  type ChatDocument,
} from "../components/AIChatEditor";
import { pickedElementPrompt } from "../proposals/proposalCode";
import {
  AISteerStatus,
  type AIMessageContentBlock,
  type AISteerStatusMessage,
} from "./useAIWebSocket";

/**
 * The parts of talking to the assistant that a prompt and a steer share, and
 * the routing of what comes back about a steer. Out of `useAI` so they can be
 * tested without it.
 */

/**
 * What the server is sent for a message the person wrote: its text, with the
 * keys of its images listed for the model and the element they picked, and
 * the images as `image_key` blocks. One shape for a prompt (`ai_prompt`) and
 * for a message steered into a running turn (`ai_steer`).
 */
export function promptContentBlocks(
  content: string | ChatDocument,
  attachments: ChatMessageAttachment[] | undefined,
  pointedAt: PickedElement | null,
): AIMessageContentBlock[] {
  const baseText =
    typeof content === "string" ? content : chatDocumentToHtmlText(content);
  // Pull inline image nodes out of the rich document so their keys are
  // registered as `image_key` content blocks (the protocol the server
  // expects), not buried in the HTML text. Drop any still-pending keys —
  // the editor should already block Send while uploads are in flight, but
  // this is a defence-in-depth check.
  const inlineImages =
    typeof content === "string" ? [] : collectImageNodesFromDoc(content);
  const inlineImageAttachments: ChatMessageAttachment[] = inlineImages
    .filter((n) => n.key && !n.key.startsWith("pending:"))
    .map((n) => ({
      key: n.key,
      name: n.alt || "inline image",
      mimeType: n.mimeType,
      previewUrl: n.previewUrl,
    }));
  const mergedAttachments: ChatMessageAttachment[] = [];
  const seenKeys = new Set<string>();
  for (const a of [...(attachments ?? []), ...inlineImageAttachments]) {
    if (seenKeys.has(a.key)) continue;
    seenKeys.add(a.key);
    mergedAttachments.push(a);
  }
  let augmentedText = baseText;
  if (mergedAttachments.length > 0) {
    const lines = mergedAttachments.map(
      (a) => `- ${a.name}: image_key="${a.key}"`,
    );
    augmentedText =
      baseText +
      "\n\n[Attached images — when calling convert_session_image_to_patch, " +
      "use the exact image_key string from this list (NOT any vision-system file id):\n" +
      lines.join("\n") +
      "]";
  }
  if (pointedAt !== null) {
    augmentedText = `${augmentedText}\n\n${pickedElementPrompt(pointedAt)}`;
  }
  return [
    { type: "text", text: augmentedText },
    ...mergedAttachments.map(
      (attachment): AIMessageContentBlock => ({
        type: "image_key",
        key: attachment.key,
      }),
    ),
  ];
}

/**
 * Who an `ai_steer_status` is for. Decided by `steerId`, not by the prompt:
 * `too_late` arrives after the turn's answer, when its prompt is no longer
 * this chat's to follow, and a steer that fell back to the queue still needs
 * its late `accepted`.
 */
export function routeSteerStatus(
  message: AISteerStatusMessage,
  ownSteerIds: ReadonlySet<string>,
  watching: boolean,
):
  | { to: "chat"; status: AISteerStatus }
  | { to: "watched" }
  | { to: "nobody" } {
  // A status the server has and this client does not: ignored.
  const status = AISteerStatus.safeParse(message.status);
  if (!status.success) return { to: "nobody" };
  if (ownSteerIds.has(message.steerId)) {
    return { to: "chat", status: status.data };
  }
  // Someone else's, in a chat this socket watches: its turn is shown whole
  // when it ends, with what they sent where it was delivered.
  return watching ? { to: "watched" } : { to: "nobody" };
}
