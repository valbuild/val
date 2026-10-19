import type { Json, ModuleFilePath, ValModules } from "@valbuild/core";

declare global {
  interface Window {
    __VAL_MODULES__?: ValModules;
    /**
     * The Source the page serves where it is not the bundle's -- a content
     * version, a proposal's saves -- which the Studio takes as its base
     * instead (`HostStore.receive`). Set by `@valbuild/tanstack` from the
     * draft the page was rendered with.
     */
    __VAL_BASE__?: Record<ModuleFilePath, Json>;
  }
}

export {};
