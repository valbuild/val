export const VAL_CLIENT = (configImportPath: string) => `import "client-only";
import { initValClient } from "@valbuild/next/client";
import { config } from "${configImportPath}";

const { useValStega: useVal } = initValClient(config);

export { useVal };
`;

export const VAL_RSC = (configImportPath: string) => `import "server-only";
import { initValRsc } from "@valbuild/next/rsc";
import { config } from "${configImportPath}";
import { cookies, draftMode, headers } from "next/headers";

const { fetchValStega: fetchVal } = initValRsc(config, {
  draftMode,
  headers,
  cookies,
});

export { fetchVal };
`;

export const VAL_SERVER = (configImportPath: string) => `import "server-only";
import { initValServer } from "@valbuild/next/server";
import { config } from "${configImportPath}";
import { draftMode } from "next/headers";

const { valNextAppRouter } = initValServer(
  { ...config },
  {
    draftMode,
  }
);

export { valNextAppRouter };
`;

// TODO: use Val config
type ValConfig = {
  valCloud?: string;
  gitCommit?: string;
  gitBranch?: string;
  valConfigPath?: string;
};
export const VAL_CONFIG = (
  isTypeScript: boolean,
  options: ValConfig
) => `import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal(${JSON.stringify(options, null, 2)});

${isTypeScript ? 'export type { t } from "@valbuild/next";' : ""};
export { s, c, val, config };
`;

export const VAL_API_ROUTER = (
  valServerPath: string
) => `import { valNextAppRouter } from "${valServerPath}";

export const GET = valNextAppRouter;
export const POST = valNextAppRouter;
export const PATCH = valNextAppRouter;
export const DELETE = valNextAppRouter;
export const PUT = valNextAppRouter;
export const HEAD = valNextAppRouter;
`;

export const VAL_APP_PAGE = (
  configImportPath: string
) => `import { ValApp } from "@valbuild/next";
import { config } from "${configImportPath}";

export default function Val() {
  return <ValApp config={config} />;
}
`;
