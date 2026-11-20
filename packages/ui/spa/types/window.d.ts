import type { ValModules } from "@valbuild/core";

declare global {
  interface Window {
    __VAL_MODULES__?: ValModules;
  }
}

export {};
