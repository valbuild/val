import {
  projectInstructionsOf,
  readProject,
  type ProjectReadDeps,
} from "./proposalCode";
import { buildProjectMap, projectMapText, type ProjectMap } from "./projectMap";

/**
 * What the assistant is told about the project in code mode, before its
 * first tool call: the project's own instructions and the Studio's map of
 * its files. Made from one read of the project, the same one the code
 * tools read (`readProject`), so the map names the files `read_file` will
 * find. Through the chat's snapshot (`projectSnapshot.ts`) where there is
 * one: it costs no request while the snapshot holds the proposal, and is
 * read again when what it holds is not current.
 */
export type ProjectContext = {
  /** `projectInstructionsOf`: the project's `AGENTS.md` / `CLAUDE.md`. */
  instructions: string | null;
  map: ProjectMap;
  /** `projectMapText`: the map as the prompt carries it. */
  mapText: string;
  /** The files it was made from, for resolving a picked element. */
  project: Record<string, string>;
};

/**
 * By the project it was made from: the snapshot hands back the project it
 * holds for as long as nothing moved, and the map of it is made once.
 */
const made = new WeakMap<Record<string, string>, ProjectContext>();

export function projectContextOf(
  project: Record<string, string>,
): ProjectContext {
  const held = made.get(project);
  if (held !== undefined) return held;
  const map = buildProjectMap(project);
  const context: ProjectContext = {
    instructions: projectInstructionsOf(project),
    map,
    mapText: projectMapText(map),
    project,
  };
  made.set(project, context);
  return context;
}

export async function readProjectContext(
  deps: ProjectReadDeps,
): Promise<ProjectContext> {
  const { project } = await readProject(deps);
  return projectContextOf(project);
}
