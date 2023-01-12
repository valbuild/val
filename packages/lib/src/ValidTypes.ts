const reservedKeys = ["val", "id"] as const;
export type ReservedKeys = (typeof reservedKeys)[number];

export type ValidObject = { [key: string]: ValidTypes } & {
  [key in ReservedKeys]?: never;
};
export type ValidPrimitive = string;
export type ValidTypes = ValidPrimitive | ValidObject | ValidTypes[];
