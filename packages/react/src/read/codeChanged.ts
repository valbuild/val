import type { ModuleFilePath } from "@valbuild/core";
import {
  CODE_CHANGED_EVENT,
  type CodeChangedDetail,
} from "@valbuild/shared/internal";
import type { SchemaRule } from "./layered";

/**
 * What a page's hooks are told by the schema rule, kept as the set of
 * modules whose relayed content this page could not read, and announced each
 * time that set changes (`announce`).
 *
 * The rule runs while a component renders, so nothing is announced then: the
 * set is compared and announced once the render is over, in one microtask
 * for every module a render read. A module the page reads with its own
 * schema again -- its code caught up, which in local development is usually
 * a hot reload a moment after the Studio's -- leaves the set, so the notice
 * goes away by itself instead of asking for a reload nothing needs.
 */
export type CodeChangedReporter = {
  /** For the hooks' env (`SchemaRule.schemaChecked`). */
  schemaChecked: NonNullable<SchemaRule["schemaChecked"]>;
  /**
   * The modules refused now, as last announced: for whatever starts
   * listening after the announcement (the overlay once it has loaded, the
   * canvas bridge once it has mounted).
   */
  modules(): ModuleFilePath[];
};

export function codeChangedReporter(
  announce: (modules: ModuleFilePath[]) => void,
): CodeChangedReporter {
  const refused = new Map<ModuleFilePath, string>();
  let announced: ModuleFilePath[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const modules = [...refused.keys()].sort();
    if (modules.join("\n") === announced.join("\n")) return;
    announced = modules;
    announce(modules);
  };
  const schemaChecked: CodeChangedReporter["schemaChecked"] = (path, other) => {
    const before = refused.get(path);
    if (other === null) {
      if (before === undefined) return;
      refused.delete(path);
    } else {
      if (before === other.schema) return;
      refused.set(path, other.schema);
    }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };
  return { schemaChecked, modules: () => announced };
}

/** The `val-overlay-spa` event that says {@link CodeChangedReporter.modules}. */
export function dispatchCodeChanged(modules: ModuleFilePath[]): void {
  const detail: CodeChangedDetail = { type: CODE_CHANGED_EVENT, modules };
  window.dispatchEvent(new CustomEvent("val-overlay-spa", { detail }));
}

/** {@link codeChangedReporter} announcing to this window's Val overlay. */
export function windowCodeChangedReporter(): CodeChangedReporter {
  return codeChangedReporter(dispatchCodeChanged);
}
