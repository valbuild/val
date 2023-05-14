import { JsonPrimitive } from "../Json";
import { GenericSelector } from "./Selector";

/// Base

export type Selector<J extends JsonPrimitive> = GenericSelector<J> & {
  eq(other: JsonPrimitive): Selector<boolean>;
};
