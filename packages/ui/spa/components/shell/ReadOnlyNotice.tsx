import type { FetchAnswer } from "./planLimits/studioAccess";
import { useStudioAccess } from "./planLimits/useStudioAccess";
import { PlanNoticeCard } from "./planLimits/PlanNoticeCard";
import { readOnlyNotice } from "./planLimits/planNotices";
import { type PlanAccess, type ReadOnlyAccess } from "./planLimits/readOnly";

/**
 * The organization's half of `/access`: a failed payment past its grace makes
 * the whole Studio read-only. The code lives in `planLimits/` with the
 * project's own limits, which it is said beside (`planNotices.ts`); this file
 * keeps the names it has always exported.
 */
export {
  parsePlanAccess,
  readOnlyCopy,
  type PlanAccess,
} from "./planLimits/readOnly";
export type { FetchAnswer } from "./planLimits/studioAccess";

/**
 * Whether this project's Studio can edit, as the organization says it. The
 * same single request as `useStudioAccess`, which the shell uses for the
 * project's limits too.
 */
export function usePlanAccess(
  projectName: string | undefined,
  fetchImpl: FetchAnswer = fetch,
): PlanAccess | null {
  return useStudioAccess(projectName, fetchImpl).access?.plan ?? null;
}

export function ReadOnlyCard({
  access,
  projectUrl = null,
}: {
  access: ReadOnlyAccess;
  /** The project's page in Val Build: where the owners are, when none were named. */
  projectUrl?: string | null;
}) {
  return <PlanNoticeCard notice={readOnlyNotice(access, projectUrl)} />;
}
