import { useEffect } from "react";
import type { PatchId } from "@valbuild/core";
import { useValSystem } from "../stores/react/SystemContext";
import { useProfilesByAuthorId, useValMode } from "./ValProvider";
import { AvatarStack } from "./ComparePatchSets";
import { toast } from "./designSystem/sonner";

const TOAST_DURATION = 8000;

/**
 * Say so when a save pulls other authors' patches into your changes.
 *
 * The write closure is the one place other people's work enters your view
 * without you asking for it: you edit a field whose path only means what it
 * means because of somebody else's earlier insert, so that insert has to come
 * with you or your edit publishes onto content that never existed. Until now
 * that happened in silence — the scope widened, the modules rebuilt, and the
 * only trace was the number on the Review button changing.
 *
 * **After the fact, and with no undo.** The edit that triggered this was
 * written against a view these patches produce, so it already depends on them;
 * offering to take them back would be offering to break the thing just typed.
 * The compare view shows the widened set, which is where it can be acted on.
 * See "Editing inside a region you are holding back" in
 * `docs/independent-publish/DESIGN.md` for why the alternative — refusing the
 * edit outright — was rejected.
 *
 * Here rather than in the store: resolving an author id to a face needs the
 * provider, and `createSystem` has no business knowing one exists. The event
 * carries ids; this turns them into people.
 */
export function PatchGroupWidenedToasts() {
  const val = useValSystem();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const mode = useValMode();

  useEffect(() => {
    if (val === null) return;
    return val.system.patchSync.events.on("patch:group-widened", (event) => {
      const patches: PatchId[] = event.patches;
      if (patches.length === 0) return;
      /*
       * Authors, deduplicated and in first-seen order.
       *
       * A patch whose record has not arrived, or which an api key wrote, has no
       * author — `AvatarStack` already draws that as an anonymous face, so the
       * id is kept rather than dropped and the count stays honest.
       */
      const authorIds: string[] = [];
      for (const record of val.system.patchStore.recordsFor(patches)) {
        const authorId = record.authorId ?? "";
        if (!authorIds.includes(authorId)) authorIds.push(authorId);
      }
      toast(
        patches.length === 1
          ? "1 change was added to your changes"
          : `${patches.length} changes were added to your changes`,
        {
          // Keyed on the ids, so a save retried by the sync engine does not
          // stack a second identical toast.
          id: `group-widened:${[...patches].sort().join(",")}`,
          description:
            "Your edit depends on them, so they will publish with it. See Review.",
          duration: TOAST_DURATION,
          icon: (
            <AvatarStack
              authorIds={authorIds}
              profilesByAuthorIds={profilesByAuthorIds}
              mode={mode}
            />
          ),
        },
      );
    });
  }, [val, profilesByAuthorIds, mode]);

  return null;
}
