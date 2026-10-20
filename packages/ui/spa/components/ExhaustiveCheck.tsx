import { Internal } from "@valbuild/core";
export default function ExhaustiveCheck({ value }: { value: never }) {
  Internal.log.warn("Exhaustive check failed for value:", value);
  return null;
}
