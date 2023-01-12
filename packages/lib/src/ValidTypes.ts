export type ValProps<T> = {
  val: T;
  valId: string;
};

type ReservedKeys = keyof ValProps<unknown>;

const reservedKeysObj: { [key in ReservedKeys]: true } = {
  val: true,
  valId: true,
};

export const reservedKeys = Object.keys(reservedKeysObj) as ReservedKeys[];

export type ValidObject = { [key: string]: ValidTypes } & {
  [key in ReservedKeys]?: never;
};
export type ValidPrimitive = string;
export type ValidTypes = ValidPrimitive | ValidObject | ValidTypes[];
