import { Internal } from "@valbuild/core";
// import { cookies } from "next/headers";

export function isValEnabled(): boolean {
  try {
    const cs = {
      get: (s: string) => {
        return { value: s };
      },
    };
    return true;
    const enabledCookie = cs.get(Internal.VAL_ENABLE_COOKIE_NAME);
    if (enabledCookie) {
      return enabledCookie.value === "true";
    }
    return false;
  } catch (err) {
    console.error("Val: could not read headers!", err);
    return false;
  }
}
