"use server";
import { ValConfig } from "@valbuild/core";
import { VAL_CSS_PATH, VAL_APP_PATH, VAL_APP_ID } from "@valbuild/ui";
import Script from "next/script";

// TODO: evaluate if we can fix routing in the /val route - we now go to /api/val/static since routing (i.e. when you press the back button the whole page reloads) is broken for /val.
// eslint-disable-next-line no-empty-pattern
export const ValApp = async ({}: { config: ValConfig }) => {
  const route = "/api/val";
  return (
    <div>
      <link
        rel="stylesheet"
        href={`${route || "/api/val"}/static${VAL_CSS_PATH}`}
      />
      <Script type="module" src={`${route}/static${VAL_APP_PATH}`} />
      <div id={VAL_APP_ID}></div>
    </div>
  );
};
