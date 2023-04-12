import { ValModule } from "./module";
import { Schema } from "./schema/Schema";
import { Source } from "./Source";
import { Val } from "./val";

export interface Selectable<Src extends Source, Out extends Source> {
  getModule(): ValModule<Schema<Src, Source>>;

  getVal(source: Src, locale: "en_US"): Val<Out>;
}
