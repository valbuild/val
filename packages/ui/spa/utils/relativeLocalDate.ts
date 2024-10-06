export function relativeLocalDate(now: Date, date: string) {
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  if (diff < 1000 * 60) {
    return "just now";
  }
  if (diff < 1000 * 60 * 60 * 24) {
    return "yesterday";
  }
  if (diff < 1000 * 60 * 60) {
    return `${Math.floor(diff / 1000 / 60)}m ago`;
  }
  if (diff < 1000 * 60 * 60 * 24) {
    return `${Math.floor(diff / 1000 / 60 / 60)}h ago`;
  }
  return `${Math.floor(diff / 1000 / 60 / 60 / 24)}d ago`;
}
