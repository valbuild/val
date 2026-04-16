import { useSyncExternalStore, useCallback } from "react";
import { SourcePath, splitModuleFilePathAndModulePath } from "@valbuild/core";
import { useWsMessages, useSyncEngine } from "../components/ValProvider";

type ValidationErrorEntry = {
  sourcePath: string;
  messages: string[];
  typeError?: boolean;
  schemaError?: boolean;
  keyError?: boolean;
};

type ValidationErrorsByModule = {
  modulePath: string;
  errors: ValidationErrorEntry[];
};

export function useAIValidation() {
  const { sendWsMessage } = useWsMessages();
  const syncEngine = useSyncEngine();

  const validationErrors = useSyncExternalStore(
    syncEngine.subscribe("all-validation-errors"),
    () => syncEngine.getAllValidationErrorsSnapshot(),
    () => syncEngine.getAllValidationErrorsSnapshot(),
  );

  const getErrors = useCallback(
    (toolCallId: string) => {
      try {
        const snapshot = validationErrors ?? {};
        const byModule = new Map<string, ValidationErrorEntry[]>();

        for (const sourcePathS in snapshot) {
          const sourcePath = sourcePathS as SourcePath;
          const [modulePath] = splitModuleFilePathAndModulePath(sourcePath);
          const errorsForPath = snapshot[sourcePath] ?? [];

          const entry: ValidationErrorEntry = {
            sourcePath: sourcePathS,
            messages: errorsForPath.map((e) => e.message),
          };
          if (errorsForPath.some((e) => e.typeError)) entry.typeError = true;
          if (errorsForPath.some((e) => e.schemaError))
            entry.schemaError = true;
          if (errorsForPath.some((e) => e.keyError)) entry.keyError = true;

          const existing = byModule.get(modulePath) ?? [];
          existing.push(entry);
          byModule.set(modulePath, existing);
        }

        const result: ValidationErrorsByModule[] = Array.from(
          byModule.entries(),
        ).map(([modulePath, errors]) => ({ modulePath, errors }));

        sendWsMessage({ type: "ai_tool_result", toolCallId, result });
      } catch (error) {
        sendWsMessage({
          type: "ai_tool_result",
          toolCallId,
          result: String(error),
          isError: true,
        });
      }
    },
    [validationErrors, sendWsMessage],
  );

  return { getErrors };
}
