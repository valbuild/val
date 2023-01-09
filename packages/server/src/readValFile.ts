import path from "path";
import { SerializedSchema } from "@val/lib";
import { ValContent } from "@val/lib/src/content";
import { ValidTypes } from "@val/lib/src/ValidTypes";

export const readValFile = async (
  rootDir: string,
  id: string
): Promise<{ val: ValidTypes; schema: SerializedSchema }> => {
  const filepaths = [
    path.join(rootDir, id) + ".val.ts",
    path.join(rootDir, id) + ".val.js",
  ];

  for (const filepath of filepaths) {
    try {
      // TODO: Load val modules in isolated context
      delete require.cache[require.resolve(filepath)];
      const valContent = (await import(filepath)).default as ValContent<any>;
      // FIXME:
      // if (val.default.id !== id) {
      //   throw Error(
      //     `File ${filepath} does not export a Val(id) module with the correct id. Asked for ${id}, got ${val.default.id}`
      //   );
      // }
      if (typeof valContent.val.serialize === "function") {
        return valContent.val.serialize();
      } else {
        throw Error(`File ${filepath} does not export a Val(id) module`);
      }
    } catch (err) {
      throw err;
    }
  }
  throw Error(`No files found! Searched: ${filepaths.join(", ")}`);
};
