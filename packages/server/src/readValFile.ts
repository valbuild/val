import path from "path";
import { SerializedSchema } from "@val/lib";

export const readValFile = async (
  rootDir: string,
  id: string
): Promise<SerializedSchema> => {
  const filepaths = [
    path.join(rootDir, id) + ".val.ts",
    path.join(rootDir, id) + ".val.js",
  ];

  for (const filepath of filepaths) {
    try {
      const val = await import(filepath);
      // FIXME:
      // if (val.default.id !== id) {
      //   throw Error(
      //     `File ${filepath} does not export a Val(id) module with the correct id. Asked for ${id}, got ${val.default.id}`
      //   );
      // }
      if (typeof val.default.val.serialize === "function") {
        return val.default.val.serialize();
      } else {
        throw Error(`File ${filepath} does not export a Val(id) module`);
      }
    } catch (err) {
      throw err;
    }
  }
  throw Error(`No files found! Searched: ${filepaths.join(", ")}`);
};
