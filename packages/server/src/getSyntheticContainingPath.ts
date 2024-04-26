import path from "path";

export function getSyntheticContainingPath(rootDir: string) {
  return path.join(rootDir, "<val>"); // TODO: this is the synthetic path used when evaluating / patching modules. I am not sure <val> is the best choice: val.ts / js better? But that is weird too. At least now it is clear(er) that it is indeed a synthetic file (i.e. not an actual file)
}
