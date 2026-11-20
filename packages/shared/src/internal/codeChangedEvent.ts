import type { ModuleFilePath } from "@valbuild/core";

/**
 * The `val-overlay-spa` event a page sends when what it renders and what the
 * Studio relays have stopped agreeing about the code: these modules came
 * made with another schema than this page's build has. The on-site overlay
 * shows it with a reload; in the Studio's canvas the bridge passes it on
 * (`codeChanged` in `valCanvasProtocol.ts`). An empty list takes it back.
 */
export const CODE_CHANGED_EVENT = "codeChanged";

export type CodeChangedDetail = {
  type: typeof CODE_CHANGED_EVENT;
  modules: ModuleFilePath[];
};

/** Whether a `val-overlay-spa` event's detail is a {@link CodeChangedDetail}. */
export function isCodeChangedDetail(
  detail: unknown,
): detail is CodeChangedDetail {
  if (typeof detail !== "object" || detail === null) return false;
  if (!("type" in detail) || detail.type !== CODE_CHANGED_EVENT) return false;
  if (!("modules" in detail) || !Array.isArray(detail.modules)) return false;
  return detail.modules.every(
    (module: unknown) => typeof module === "string" && module.startsWith("/"),
  );
}
