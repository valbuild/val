// Convenience types
import type { UseValType } from "./client/initValClient";
import { Schema, SelectorSource } from "@valbuild/core";
import { SelectorOfSchema } from "@valbuild/core";

export type inferSchema<S extends Schema<SelectorSource>> = UseValType<
  SelectorOfSchema<S>
>;
