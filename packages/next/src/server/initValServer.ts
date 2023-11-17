import { ValConfig } from "@valbuild/core";
import { createRequestListener } from "@valbuild/server";

const initCreateRequestHandler = (opts: ValConfig) => () =>
  createRequestListener(
    "/api/val", // TODO: get from config
    opts
  );

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValServer(config: ValConfig): {
  createValApi: () => ReturnType<typeof createRequestListener>;
} {
  return {
    createValApi: initCreateRequestHandler(config),
  };
}
