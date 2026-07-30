"use client";
import { ValApp } from "@valbuild/next";
import { config } from "../../../../val.config";
import { ValModulesClient } from "../../../ValModulesClient";

export default function Val() {
  return (
    <ValApp config={config}>
      <ValModulesClient />
    </ValApp>
  );
}
