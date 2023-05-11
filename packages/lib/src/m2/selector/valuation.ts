import { Selector } from ".";
import { Source } from "../Source";
import { JsonOfSource, Val } from "../val";

export function valuation<S extends Source, T extends Selector<S>>(
  selector: T
): Promise<Val<JsonOfSource<S>>> {
  throw Error("TODO");
}
