import { CheckCircle2, RefreshCw } from "lucide-react";
import { Patch } from "@valbuild/core/patch";
import { useEffect, useState } from "react";

export type PatchCallback = (patchPath: string[]) => Promise<Patch>;
export type OnSubmit = (callback: PatchCallback) => Promise<void>;
export type SubmitStatus = "idle" | "loading" | "waiting" | "patch-success";

export function SubmitStatus({ submitStatus }: { submitStatus: SubmitStatus }) {
  if (submitStatus === "loading" || submitStatus === "waiting") {
    return <RefreshCw className="animate-spin" />;
  }
  if (submitStatus === "patch-success") {
    return <CheckCircle2 className="text-accent" />;
  }
  return null;
}
export function useBounceSubmit<V>(
  enabled: boolean,
  value: V,
  onSubmit: OnSubmit | undefined,
  applyPatch: (value: V, patchPath: string[]) => Promise<Patch>,
  latestValueRef?: V | null,
): SubmitStatus {
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [lastSubmit, setLastSubmit] = useState<V | null>(null);

  useEffect(() => {
    if (onSubmit && enabled) {
      setWaiting(true);
      const timeout = setTimeout(() => {
        setLoading(true);
        if (onSubmit) {
          if (latestValueRef) {
            setLastSubmit(latestValueRef);
            onSubmit((patchPath) =>
              applyPatch(latestValueRef, patchPath),
            ).finally(() => {
              setLoading(false);
              setWaiting(false);
              setTimeout(() => {
                setLastSubmit(null);
              }, 1000);
            });
          } else {
            setLastSubmit(value);
            onSubmit((patchPath) => applyPatch(value, patchPath)).finally(
              () => {
                setLoading(false);
                setWaiting(false);
                setTimeout(() => {
                  setLastSubmit(null);
                }, 1000);
              },
            );
          }
        }
      }, 1000);
      return () => {
        clearTimeout(timeout);
      };
    }
  }, [value, enabled]);
  const loadingSuccess = lastSubmit !== null && lastSubmit === (value ?? "");

  if (loadingSuccess) {
    return "patch-success";
  } else if (loading) {
    return "loading";
  } else if (waiting) {
    return "waiting";
  }
  return "idle";
}
