import { ValConfig } from "@valbuild/core";
import { createRequestListener } from "@valbuild/server";
import type { draftMode } from "next/headers";

const initCreateRequestHandler = (config: ValConfig) => () =>
  createRequestListener(
    "/api/val", // TODO: get from config
    { ...config }
  );

type ValServerNextConfig =
  | {
      draftMode: typeof draftMode;
    }
  | {
      onDraftEnable: (res: {
        setDraftMode: (options: { enable: boolean }) => void;
      }) => void;
      onDraftDisable: (res: {
        setDraftMode: (options: { enable: boolean }) => void;
      }) => void;
    };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValServer(
  config: ValConfig,
  nextConfig: ValServerNextConfig
): {
  createValApi: () => ReturnType<typeof createRequestListener>;
} {
  return {
    createValApi: initCreateRequestHandler(config),
  };
}
