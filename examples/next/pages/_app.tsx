import { ValProvider } from "@valcms/react";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ValProvider>
      <Component {...pageProps} />
    </ValProvider>
  );
}

export default MyApp;
