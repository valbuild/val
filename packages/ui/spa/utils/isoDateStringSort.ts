export function isoDateStringSort(a: string, b: string) {
  // NOTE: we benchmarked different sort methods on ISO datetime strings on node v18.17.0 and v22.9.0 and localeCompare was about 10x faster than new Date().getTime and about 100x faster than localeCompare with numeric: true or sensitivity: 'base' (or both) despite various AIs telling us the opposite. Go figure...
  // the undefined sets the locale to
  return a.localeCompare(b, ["en-US"]);
}
