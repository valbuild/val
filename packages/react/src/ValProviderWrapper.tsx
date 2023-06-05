import { lazy } from "react";
import { ValProviderProps } from "./ValProvider";

const ValProvider =
  typeof window === "undefined" && lazy(() => import("./ValProvider"));

export function ValProviderWrapper({
  host = "/api/val",
  children,
}: ValProviderProps) {
  if (!ValProvider) {
    return null;
  }
  return <ValProvider host={host}>{children}</ValProvider>;
}
