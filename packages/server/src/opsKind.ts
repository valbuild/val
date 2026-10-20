import type { ValOpsFS } from "./ValOpsFS";
import type { ValOpsHttp } from "./ValOpsHttp";
import type { ValOpsMemory } from "./ValOpsMemory";

/*
 * `instanceof`, without the class.
 *
 * Type-only imports, so asking which mode a server is in does not load the
 * mode: see `ValOps.kind`.
 */

type AnyOps = ValOpsFS | ValOpsHttp | ValOpsMemory;

export function isFsOps(ops: AnyOps): ops is ValOpsFS {
  return ops.kind === "fs";
}

export function isHttpOps(ops: AnyOps): ops is ValOpsHttp {
  return ops.kind === "http";
}

export function isMemoryOps(ops: AnyOps): ops is ValOpsMemory {
  return ops.kind === "memory";
}
