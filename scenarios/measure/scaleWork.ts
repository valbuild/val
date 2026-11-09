/**
 * Phase 10 of `docs/plans/one-content-model.md`: a project of the real shapes
 * at size, and what the Studio does with it, with nothing from Node in it.
 *
 * Two parts, used by two callers, so both measure the same thing:
 *
 * - **The generator**, {@link scaleProject}: a `.jsonValues()` router of N
 *   blog posts (title, slug, rich text, an image picked from the library,
 *   tags), image, file and video libraries (`s.imagedir`, `s.filedir`,
 *   `s.videodir`) of N entries each, and a page whose fields pick from all
 *   three and point at one post (`s.keyOf`). Local refs or remote ones
 *   (`https://remote.val.build/file/p/…`; nothing needs to be fetchable for
 *   counted work). The shapes are the content-shape matrix's
 *   (`src/matrix.*.scenario.test.ts`), with more entries.
 * - **The Studio's surfaces**, {@link openRecord} and the rest: each is the
 *   store calls a component makes when it mounts or is used (named on each),
 *   in the order it makes them -- the product's own functions, not a model of
 *   them (`.agent/rules.md`, test rule 3). React is the edge: what a hook does
 *   on its first render and in its effect is called here directly.
 *
 * Callers: `src/scale.scenario.test.ts` counts the work (requests, entry
 * imports, versions hashed, bytes copied, previews computed), and
 * `measure/scale.ts` times it and weighs the heap.
 */
import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import type { PatchId } from "@valbuild/core";
import type { System } from "../../packages/ui/spa/stores/createSystem";
import { stringFieldPatch } from "../../packages/ui/spa/components/fields/stringFieldPatch";
import { mediaPickPatch } from "../../packages/ui/spa/components/fields/mediaPickPatch";
import { sourcePathOfItem } from "../../packages/ui/spa/utils/sourcePathOfItem";
import {
  allJsonValuesModules,
  jsonValuesLoadRequirements,
  type JsonValuesLoadQuery,
} from "../../packages/ui/spa/components/jsonValuesLoadRequirements";
import { getReferencedFiles } from "../../packages/ui/spa/components/getReferencedFiles";
import {
  getKeysOf,
  keyOfScanTarget,
} from "../../packages/ui/spa/components/getKeysOf";

export * from "./scaleProject";
import {
  FEATURED,
  FILES,
  IMAGES,
  POSTS,
  VIDEOS,
  type ScaleProject,
} from "./scaleProject";

// ---------------------------------------------------------------------------
// The Studio's surfaces. Each returns what it leaves mounted, to unmount.

let nextInstance = 0;
/** A component instance's id, as `useId` gives one. */
function instanceId(what: string): string {
  return `scale:${what}:${++nextInstance}`;
}

/**
 * How many rows a record list renders when it opens: `VirtualizedRecordList`
 * sizes itself to the room it has (800 px before it is measured) at 74 px a
 * preview row, plus its overscan of 8.
 */
export const RECORD_WINDOW_ROWS = Math.ceil(800 / 74) + 8;

type Unmount = () => void;

/**
 * A source read as a field's hook makes it (`usePeek`, then
 * `useEntryDemand`): a listener at the path, a peek, and a `get` when the
 * peek says a `.jsonValues()` entry is missing.
 */
async function mountSourceRead(
  system: System,
  path: SourcePath,
  id: string,
): Promise<Unmount> {
  const off = system.sourceStore.addListener(path, id, () => {});
  if (system.sourceStore.peek(path).status === "entry-missing") {
    await system.sourceStore.get(path, null);
  }
  return off;
}

/**
 * A preview read as `usePreviewAtPath` makes it: a listener at the path (the
 * demand signal), a peek, and a `get` while the peek says `needs-preview`.
 */
async function mountPreviewRead(
  system: System,
  path: SourcePath,
  id: string,
): Promise<Unmount> {
  const off = system.sourceStore.addListener(path, id, () => {});
  if (system.previewStore.peek(path).status === "needs-preview") {
    await system.previewStore.get(path);
  }
  return off;
}

/**
 * Opening a record: `RecordFields` on the module (its shallow source, its
 * preview, `useJsonEntryRowStates`' whole-module source read), then
 * `VirtualizedRecordList` asking for the window it renders
 * (`sourceStore.loadEntries`), then every row's `RefPreview`
 * (`useRefPreview`: the container's preview again, per row) once the
 * entries are in -- which re-renders the list, so the preview is read again.
 */
export async function openRecord(
  system: System,
  moduleFilePath: ModuleFilePath,
  keys: readonly string[],
  rows: number = RECORD_WINDOW_ROWS,
): Promise<{ unmount: Unmount; window: string[] }> {
  const path = moduleFilePath as unknown as SourcePath;
  const offs: Unmount[] = [];
  offs.push(await mountSourceRead(system, path, instanceId("record")));
  offs.push(await mountPreviewRead(system, path, instanceId("record-preview")));
  offs.push(await mountSourceRead(system, path, instanceId("record-rows")));
  const window = keys.length > 50 ? keys.slice(0, rows) : [...keys];
  await system.sourceStore.loadEntries(moduleFilePath, window);
  for (const key of window) {
    offs.push(
      await mountPreviewRead(system, path, instanceId(`row-preview:${key}`)),
    );
  }
  return { unmount: () => offs.forEach((off) => off()), window };
}

/**
 * What `useReferenceScanStatus` loads before a reference scan can be trusted
 * (`useJsonValuesLoad`): every entry of each `.jsonValues()` module the
 * query's requirements name (`jsonValuesLoadRequirements`), from the schemas
 * alone. In the common case it names none.
 */
async function loadForScan(
  system: System,
  query: JsonValuesLoadQuery,
): Promise<ModuleFilePath[]> {
  const required = jsonValuesLoadRequirements(system.schemaStore.all(), query);
  await Promise.all(
    required.map((module) => system.sourceStore.loadAllEntries(module)),
  );
  return required;
}

/**
 * Opening one entry of the record: `AnyField` on the entry, each field of it
 * a source read at its own path (`useShallowSourceAtPath` per field), and the
 * entry's `ArrayAndRecordTools`, whose delete and rename guards scan for
 * what points at it -- `useKeysOf` (a `keyOf` into the record) and, for a
 * router, `useEagerRouteReferences` (a route) -- loading what those scans
 * need first.
 */
export async function openEntry(
  system: System,
  moduleFilePath: ModuleFilePath,
  key: string,
  fields: readonly string[],
): Promise<Unmount> {
  const entry = sourcePathOfItem(moduleFilePath, key);
  const offs: Unmount[] = [
    await mountSourceRead(system, entry, instanceId(`entry:${key}`)),
  ];
  await loadForScan(system, { kind: "keyOf", module: moduleFilePath });
  if (system.schemaStore.get(moduleFilePath)?.type === "record") {
    await loadForScan(system, { kind: "route" });
  }
  for (const field of fields) {
    offs.push(
      await mountSourceRead(
        system,
        sourcePathOfItem(entry, field),
        instanceId(`field:${key}:${field}`),
      ),
    );
  }
  return () => offs.forEach((off) => off());
}

/**
 * Typing into a string field: `useDebouncedFieldWrite` writes once a pause,
 * through `useAddPatch` -> `patchStore.createPatch` with `stringFieldPatch`.
 */
export async function keystroke(
  system: System,
  moduleFilePath: ModuleFilePath,
  patchPath: string[],
  value: string,
): Promise<PatchId> {
  const res = await system.patchStore.createPatch(
    moduleFilePath,
    stringFieldPatch(patchPath, value),
  );
  if (res.status !== "created") {
    throw new Error(`the keystroke was refused: ${res.message}`);
  }
  return res.record.patchId;
}

/**
 * Opening a library's picker (`ModuleMediaPicker` -> `useModuleMediaEntries`:
 * the library module's whole source), and its list
 * (`MediaPickerList` filters every key of it). Answers how many rows it holds.
 */
export async function openPicker(
  system: System,
  library: ModuleFilePath,
): Promise<{ unmount: Unmount; rows: number }> {
  const path = library as unknown as SourcePath;
  const off = await mountSourceRead(system, path, instanceId("picker"));
  const read = await system.sourceStore.get(path, null);
  const data = "data" in read ? read.data : null;
  const rows =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data).length
      : 0;
  return { unmount: off, rows };
}

/**
 * Picking an entry: the patch every picker writes (`mediaPickPatch`), then
 * the field reading what it picked -- its own source, and the ONE library
 * entry `fillFromGallery` looks the path up by (`ImageField`'s gallery
 * entry read, `useSourceAtPath` on the entry's path).
 */
export async function pick(
  system: System,
  field: ModuleFilePath,
  patchPath: string[],
  library: ModuleFilePath,
  ref: string,
): Promise<Unmount> {
  const res = await system.patchStore.createPatch(
    field,
    mediaPickPatch(patchPath, ref),
  );
  if (res.status !== "created") {
    throw new Error(`the pick was refused: ${res.message}`);
  }
  const fieldPath = Internal.joinModuleFilePathAndModulePath(
    field,
    Internal.patchPathToModulePath(patchPath),
  );
  const offs = [
    await mountSourceRead(system, fieldPath, instanceId("picked")),
    await mountSourceRead(
      system,
      sourcePathOfItem(library, ref),
      instanceId("gallery-entry"),
    ),
  ];
  return () => offs.forEach((off) => off());
}

/**
 * A `keyOf` field's dropdown (`KeyOfField`): the referenced module's shallow
 * source (its keys) and its preview (`usePreviewAtPath` on the module, which
 * names the options).
 */
export async function keyOfDropdown(
  system: System,
  target: ModuleFilePath,
): Promise<Unmount> {
  const path = target as unknown as SourcePath;
  const offs = [
    await mountSourceRead(system, path, instanceId("keyof-source")),
    await mountPreviewRead(system, path, instanceId("keyof-preview")),
  ];
  return () => offs.forEach((off) => off());
}

/**
 * Selecting an entry in a library's gallery (`GalleryEntryInspector`): its
 * "used by" list, `useReferencedFiles(library, ref)`, which loads what a scan
 * for a file of that library needs first -- every entry of a `.jsonValues()`
 * module whose item can hold one -- then walks every module's source
 * (`getReferencedFiles`). Answers how many fields use the file.
 */
export async function inspectLibraryEntry(
  system: System,
  library: ModuleFilePath,
  ref: string,
): Promise<{ referrers: number; loaded: ModuleFilePath[] }> {
  const loaded = await loadForScan(system, { kind: "file", module: library });
  const referrers = getReferencedFiles(
    system.schemaStore.all(),
    system.sourceStore.allSources(),
    library,
    ref,
  );
  return { referrers: referrers.length, loaded };
}

/**
 * Typing a query in the search box (`SearchField`): `useAllJsonValuesLoad`
 * starts loading every entry of every `.jsonValues()` module on the first
 * non-empty query, and `system.search` (which indexes what it has to first)
 * answers at once, and again as the entries arrive. Answers the first answer
 * and the last.
 */
export async function search(system: System, query: string) {
  const loading = Promise.all(
    allJsonValuesModules(system.schemaStore.all()).map((module) =>
      system.sourceStore.loadAllEntries(module),
    ),
  );
  const first = await system.search(query, 10);
  await loading;
  const last = await system.search(query, 10);
  return { first, last };
}

/** "Validate everything", as the Studio runs it once saving has caught up. */
export async function validateAll(system: System): Promise<void> {
  await system.validateEverything();
}

/** Discard all, as Review's button does: every patch in the chain. */
export async function discardAll(system: System) {
  return system.discard(
    system.patchStore.allRecords().map((record) => record.patchId),
  );
}

/**
 * The page that picks from the libraries, open: each field's source read
 * (`useShallowSourceAtPath` per field), the ONE library entry each picked
 * field reads (`fillFromGallery`'s lookup), the `keyOf` field's reads of the
 * record it points at (its keys and its preview), and the reference scan the
 * page's header makes where it makes one (`ArrayAndRecordTools`:
 * `keyOfScanTarget`, then `useKeysOf` -> `getKeysOf`). Answers what that scan
 * targets, `null` where it makes none.
 */
export async function openPickingPage(
  system: System,
  project: Pick<ScaleProject, "imagePaths" | "filePaths" | "videoPaths">,
): Promise<{ unmount: Unmount; scan: { parent: string } | null }> {
  const page = FEATURED as unknown as SourcePath;
  const offs: Unmount[] = [
    await mountSourceRead(system, page, instanceId("page")),
  ];
  for (const field of ["title", "post", "hero", "download", "clip"]) {
    offs.push(
      await mountSourceRead(
        system,
        sourcePathOfItem(page, field),
        instanceId(`page-field:${field}`),
      ),
    );
  }
  for (const [library, ref] of [
    [IMAGES, project.imagePaths[0]],
    [FILES, project.filePaths[0]],
    [VIDEOS, project.videoPaths[0]],
  ] as const) {
    offs.push(
      await mountSourceRead(
        system,
        sourcePathOfItem(library, ref),
        instanceId("page-gallery-entry"),
      ),
    );
  }
  offs.push(await keyOfDropdown(system, POSTS));
  const schema = system.schemaStore.get(FEATURED);
  const target = keyOfScanTarget({
    path: page,
    parentPath: page,
    parentSchema: schema,
    schema,
    key: undefined,
  });
  if (target !== null) {
    await loadForScan(system, { kind: "keyOf", module: target.parent });
    getKeysOf(
      system.schemaStore.all(),
      system.sourceStore.allSources(),
      target.parent,
      target.key,
    );
  }
  return {
    unmount: () => offs.forEach((off) => off()),
    scan: target === null ? null : { parent: target.parent },
  };
}
