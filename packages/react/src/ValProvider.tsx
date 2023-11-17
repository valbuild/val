import { lazy } from "react";
import type { ValProviderProps } from "./ValProviderInternal";

const ValProviderInternal =
  typeof window !== "undefined"
    ? lazy(() => import("./ValProviderInternal"))
    : null;

export function ValProvider({ children }: ValProviderProps): JSX.Element {
  if (ValProviderInternal) {
    return <ValProviderInternal>{children}</ValProviderInternal>;
  }
  return <>{children}</>;
}
