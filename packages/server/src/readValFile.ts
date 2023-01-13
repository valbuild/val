import path from "path";
import { SerializedSchema, ValContent, ValidTypes } from "@valcms/lib";

const resolveValModule = async (
  rootDir: string,
  id: string
): Promise<ValContent<ValidTypes>> => {
  const filepaths = [
    path.join(rootDir, id) + ".val.ts",
    path.join(rootDir, id) + ".val.js",
  ];

  for (const filepath of filepaths) {
    try {
      // TODO: Load val modules in isolated context
      delete require.cache[require.resolve(filepath)];
      return (await import(filepath)).default as ValContent<ValidTypes>;
    } catch (err) {
      // TODO: Detect err is module not found
      console.debug(err);
    }
  }
  throw Error(`No files found! Searched: ${filepaths.join(", ")}`);
};

export const readValFile = async (
  rootDir: string,
  id: string
): Promise<{ val: ValidTypes; schema: SerializedSchema }> => {
  const module = await resolveValModule(rootDir, id);
  if (typeof module.val.serialize === "function") {
    return module.val.serialize();
  } else {
    throw Error(`${id} is not a Val(id) module`);
  }
};
