const reservedKeys = ["_val"] as const;
export type ReservedKeys = typeof reservedKeys[number];

export type ValidObject = { [key: string]: ValidTypes } & {
  [key in ReservedKeys]?: never;
};
export type ValidTypes = string | ValidObject;
