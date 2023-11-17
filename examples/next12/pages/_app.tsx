import { ValProvider } from "@valbuild/react";
import type { AppProps } from "next/app";
import { config } from "../val.config";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ValProvider config={config}>
      <Component {...pageProps} />
    </ValProvider>
  );
}

export default MyApp;
