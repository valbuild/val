import { RemoteSource } from "./Source";

export function remote<F extends string>(ref: F): RemoteSource<F> {
  return { type: "remote", ref } as RemoteSource<F>;
}

export function isRemoteRef(
  refObject: unknown
): refObject is RemoteSource<string> {
  return (
    typeof refObject === "object" &&
    refObject !== null &&
    "type" in refObject &&
    refObject["type"] === "remote" &&
    "ref" in refObject
  );
}
