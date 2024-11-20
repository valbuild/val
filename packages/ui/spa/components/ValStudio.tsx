import { FC } from "react";
import { ValCache } from "@valbuild/shared/internal";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";
import { ValProvider } from "./ValProvider";
import { Layout } from "./Layout";

interface ValFullscreenProps {
  client: ValClient;
}

export const ValStudio: FC<ValFullscreenProps> = ({ client }) => {
  return (
    <ValProvider client={client} dispatchValEvents={false}>
      <Layout />
    </ValProvider>
  );
};
