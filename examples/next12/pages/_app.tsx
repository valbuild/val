import { ValProvider } from "@valbuild/react";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ValProvider host="/api/val">
      <Component {...pageProps} />
    </ValProvider>
  );
}

export default MyApp;
