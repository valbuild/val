import { FC } from "react";
import { ValCache } from "@valbuild/shared/internal";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { useValState } from "../../ng/useValState";

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
    console.log(state.stat.data);
    return (
      <div className="flex flex-col gap-10">
        <pre>{JSON.stringify(state.stat.data, null, 2)}</pre>
        <pre>{JSON.stringify(state.sources, null, 2)}</pre>
        <pre>{JSON.stringify(state.sourcePathErrors, null, 2)}</pre>
        <button
          onClick={() => {
            state.addPatch("/content/authors.val.ts" as any, [
              {
                op: "replace",
                path: ["freekh", "name"],
                value: new Date().toISOString(),
              },
            ]);
          }}
        >
          Add patch
        </button>
      </div>
    );
  }
  console.log(state.stat);
  return <pre>{JSON.stringify(state.stat, null, 2)}</pre>;
};
