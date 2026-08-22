"use client";

import { ValModulesClient as Base } from "@valbuild/next";
import valModules from "../val.modules";

export function ValModulesClient() {
  return <Base modules={valModules} />;
}
