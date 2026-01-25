import { SerializedSchema, SourcePath } from "@valbuild/core";
import { useEffect, useState } from "react";
import { FieldLoading } from "./FieldLoading";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { urlOf } from "@valbuild/shared/internal";

export function FieldNotFound({
  path,
  type,
}: {
  path: SourcePath;
  type: SerializedSchema["type"] | "module";
}) {
  const [didTimeout, setDidTimeout] = useState(false);

  useEffect(() => {
    // allow 2 seconds before showing not found
    const timeout = setTimeout(() => {
      setDidTimeout(true);
    }, 2000);
    return () => {
      clearTimeout(timeout);
    };
  }, []);

  const handleGoBack = () => {
    window.location.href = window.origin + urlOf("/val");
  };

  if (path.length === 0) {
    return null;
  }
  if (!didTimeout) {
    return <FieldLoading path={path} type={type} />;
  }
  return (
    <div
      id={path}
      className="pt-6 flex flex-col items-center justify-center text-center gap-4"
    >
      <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg-tertiary">
        <AlertCircle className="w-8 h-8 text-fg-tertiary" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg-primary">Not Found</h2>
        <p className="text-sm text-fg-tertiary max-w-md">
          The path{" "}
          <code className="px-1.5 py-0.5 bg-bg-tertiary rounded text-fg-secondary font-mono text-xs">
            {path}
          </code>{" "}
          can no longer be found.
        </p>
      </div>
      <button
        onClick={handleGoBack}
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-fg-primary bg-bg-secondary hover:bg-bg-tertiary rounded-md transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Go Home
      </button>
    </div>
  );
}
