export type Json = JsonPrimitive | JsonObject | JsonArray;
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly Json[];
export type JsonObject = { readonly [key in string]: Json };
