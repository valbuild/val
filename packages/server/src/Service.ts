import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { applyPatch, Operation } from "fast-json-patch";
import { readValFile } from "./readValFile";
import { writeValFile } from "./writeValFile";

export type ServiceOptions = {
  /**
   * Root directory of the project.
   */
  rootDir: string;
  /**
   * Relative path to the val.config.js file from the root directory.
   *
   * @example src
   */
  relativeValConfigPath?: string;
};

export function createService(opts: ServiceOptions): Service {
  return new Service(opts);
}

export class Service {
  readonly rootDir: string;
  readonly relativeValConfigPath?: string;

  constructor({ rootDir, relativeValConfigPath }: ServiceOptions) {
    this.rootDir = rootDir;
    this.relativeValConfigPath = relativeValConfigPath;
  }

  get(
    moduleId: string
  ): Promise<{ val: ValidTypes; schema: SerializedSchema }> {
    return readValFile(moduleId, this.rootDir, this.relativeValConfigPath);
  }

  async patch(moduleId: string, patch: Operation[]): Promise<void> {
    // TODO: Validate patch and/or resulting document against schema
    const document = (
      await readValFile(moduleId, this.rootDir, this.relativeValConfigPath)
    ).val;
    const result = applyPatch(document, patch, true, false);
    const newDocument = result.newDocument;

    await writeValFile(this.rootDir, moduleId, newDocument);
  }
}
