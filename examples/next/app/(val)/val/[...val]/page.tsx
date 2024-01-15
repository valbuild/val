import { ValApp } from "@valbuild/next";
import { config } from "../../../../val.config";

export default function Val() {
  return <ValApp config={config} />;
}
