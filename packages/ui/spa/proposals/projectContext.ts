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
 * find.
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

export function projectContextOf(
  project: Record<string, string>,
): ProjectContext {
  const map = buildProjectMap(project);
  return {
    instructions: projectInstructionsOf(project),
    map,
    mapText: projectMapText(map),
    project,
  };
}

export async function readProjectContext(
  deps: ProjectReadDeps,
): Promise<ProjectContext> {
  const { project } = await readProject(deps);
  return projectContextOf(project);
}
