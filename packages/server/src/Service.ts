import { SerializedSchema } from "@valcms/lib";
import { ValidTypes } from "@valcms/lib/src/ValidTypes";
import { applyPatch, Operation } from "fast-json-patch";
import { readValFile } from "./readValFile";
import { writeValFile } from "./writeValFile";

export type ServiceOptions = {
  /**
   * Root directory of the project.
   */
  rootDir: string;
};

export function createService(opts: ServiceOptions): Service {
  return new Service(opts);
}

export class Service {
  readonly rootDir: string;

  constructor({ rootDir }: ServiceOptions) {
    this.rootDir = rootDir;
  }

  get(
    moduleId: string
  ): Promise<{ val: ValidTypes; schema: SerializedSchema }> {
    return readValFile(this.rootDir, moduleId);
  }

  async patch(moduleId: string, patch: Operation[]): Promise<void> {
    // TODO: Validate patch and/or resulting document against schema
    const document = (await readValFile(this.rootDir, moduleId)).val;
    const result = applyPatch(document, patch, true, false);
    const newDocument = result.newDocument;

    await writeValFile(this.rootDir, moduleId, newDocument);
  }
}
