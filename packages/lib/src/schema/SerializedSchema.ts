import { SerializedObjectSchema } from "./object";
import { SerializedStringSchema } from "./string";

export type SerializedSchema = SerializedStringSchema | SerializedObjectSchema;
