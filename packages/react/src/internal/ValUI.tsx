"use client";
import { Style, ValOverlay } from "@valbuild/ui";
import { ShadowRoot } from "./ShadowRoot";
import { useValApi, useValStore } from "./ValProvider";

export default function ValUI(props: { host: string }) {
  const api = useValApi();
  const store = useValStore();
  if (!api || !store) {
    return null;
  }
  return (
    <>
      <ShadowRoot
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 8999, // 1 less than the NextJS error z-index: 9000
        }}
      >
        {/* TODO: */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;1,100;1,300;1,400;1,500;1,700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
        <Style route={props?.host} />
        <ValOverlay api={api} store={store} />
      </ShadowRoot>
    </>
  );
}
