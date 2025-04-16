import { FC } from "react";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { ValProvider } from "./ValProvider";
import { Layout } from "./Layout";
import { SharedValConfig } from "@valbuild/shared/internal";
import { ValRouter } from "./ValRouter";

interface ValFullscreenProps {
  client: ValClient;
  config: SharedValConfig | null;
}

export const ValStudio: FC<ValFullscreenProps> = ({ client, config }) => {
  return (
    <ValProvider client={client} dispatchValEvents={false} config={config}>
      <ValRouter>
        <Layout />
      </ValRouter>
    </ValProvider>
  );
};
