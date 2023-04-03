import { ValModule } from "./module";
import { Schema } from "./schema/Schema";
import { Source } from "./Source";
import { Val } from "./Val";

export interface Selectable<S extends Source, Out> {
  getModule(): ValModule<Schema<S, Source>>;

  getVal(source: S, locale: "en_US"): Val<Out>;
}
