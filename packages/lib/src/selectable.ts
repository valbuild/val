import { Val } from "./Val";

export interface Selectable<Localized> {
  getVal(locale: "en_US"): Val<Localized>;
}
