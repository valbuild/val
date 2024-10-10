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
    return <pre className="">{JSON.stringify(state.stat.data, null, 2)}</pre>;
  }
  console.log(state.stat);
  return <pre>{JSON.stringify(state.stat, null, 2)}</pre>;
};
