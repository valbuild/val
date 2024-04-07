"use client";

import { ValConfig } from "@valbuild/core";
import { VAL_CSS_PATH, VAL_APP_PATH, VAL_APP_ID } from "@valbuild/ui";
import Script from "next/script";

// eslint-disable-next-line no-empty-pattern
export const ValApp = ({}: { config: ValConfig }) => {
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
