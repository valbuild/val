/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useState } from "react";
import { ValApi } from "./ValApi";
import { ValStore } from "./ValStore";
import { Inputs, Style, ValOverlay } from "@valbuild/ui";
import {
  FileSource,
  FILE_REF_PROP,
  Internal,
  RichText,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import { PatchJSON } from "@valbuild/core/patch";
import { ImageMetadata } from "@valbuild/core/src/schema/image";
import { AuthStatus } from "./AuthStatus";
import { ShadowRoot } from "./ShadowRoot";

export type ValUIProps = {
  valStore: ValStore;
  valApi: ValApi;
};

export default function ValUI({ valApi, valStore }: ValUIProps) {
  return (
    <ShadowRoot>
      {/* TODO: */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400;1,700&display=swap"
        rel="stylesheet"
      />
      <Style />
      <div className="fixed top-0 left-0 bg-white">Hei</div>
    </ShadowRoot>
  );
}
