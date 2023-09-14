import { GenericSelector } from "./index";
import { SourcePrimitive } from "../source";

export type Selector<T extends SourcePrimitive> = GenericSelector<T>;
