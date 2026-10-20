import { SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { useAllValidationErrors } from "../ValErrorProvider";
import { buildValidateGroups, openRowCount } from "./buildValidateGroups";
import { useValidateSession } from "./validateSession";

/**
 * The number on the top bar's Validate button: the rows the page would show
 * that still need something. The Studio's own errors, plus what "Check
 * everything" found this session -- built by the page's own
 * `buildValidateGroups`, so the button and the page cannot disagree.
 */
export function useValidateCount(): number {
  const ownErrors = useAllValidationErrors();
  const session = useValidateSession();
  return useMemo(() => {
    const ownPaths = (Object.keys(ownErrors) as SourcePath[]).filter(
      (path) => (ownErrors[path]?.length ?? 0) > 0,
    );
    return openRowCount(
      buildValidateGroups({
        ownPaths,
        ownErrors,
        results: session.results,
        fixes: session.fixes,
        schemas: undefined,
      }).groups,
    );
  }, [ownErrors, session.results, session.fixes]);
}
