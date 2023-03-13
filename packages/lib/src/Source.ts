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

export type SourceObject = { [key: string]: Source } & {
  [key in ReservedKeys]?: never;
};
export type SourcePrimitive = string;
export type Source = SourcePrimitive | SourceObject | Source[];
