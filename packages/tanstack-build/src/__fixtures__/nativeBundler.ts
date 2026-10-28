/**
 * The probes build in Node, so they build with native rolldown, as
 * `val publish` does (`../rolldown.ts`). rolldown's WebAssembly build in
 * Node's worker threads crashed under a loaded test run ("memory access out
 * of bounds"), and Node no longer builds with it: the tab's build is the
 * end-to-end suites' to test.
 */
import { nativeRolldown } from "../node/rolldown";
import { useRolldown } from "../rolldown";

useRolldown(nativeRolldown);
