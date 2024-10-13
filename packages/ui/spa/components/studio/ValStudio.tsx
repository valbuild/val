import { FC } from "react";
import { ValCache } from "@valbuild/shared/internal";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { useValState } from "../../ng/useValState";
import { ModuleFilePath } from "@valbuild/core";

interface ValFullscreenProps {
  client: ValClient;
  cache: ValCache;
}

export const ValStudio: FC<ValFullscreenProps> = ({ client }) => {
  const state = useValState(client);
  if (
    state.stat.status !== "initializing" &&
    state.stat.status !== "not-asked"
  ) {
    return (
      <div className="flex flex-col gap-10">
        <input
          className="w-[400px] text-black"
          disabled={
            state?.sources?.["/content/authors.val.ts"]?.data?.["freekh"]
              ?.name === undefined
          }
          value={
            state?.sources?.["/content/authors.val.ts"]?.data?.["freekh"]
              ?.name || ""
          }
          onChange={(ev) => {
            const value = ev.target.value;
            state.addPatch("/content/authors.val.ts" as ModuleFilePath, [
              {
                op: "replace",
                path: ["freekh", "name"],
                value,
              },
            ]);
          }}
        />
        <div className="grid">
          <div>Status: {state.stat.status}</div>
          <div>Type: {state.stat.data?.type}</div>
          <div>Base sha: {state.stat.data?.baseSha}</div>
          <div>Patch count: {state.stat.data?.patches.length}</div>
        </div>
        <pre>{JSON.stringify(state.sources, null, 2)}</pre>
        <pre>{JSON.stringify(state.sourcePathErrors, null, 2)}</pre>
      </div>
    );
  }
  return <pre>{JSON.stringify(state.stat, null, 2)}</pre>;
};
