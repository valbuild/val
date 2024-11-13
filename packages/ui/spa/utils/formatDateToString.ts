export function formatDateToString(date: Date): string {
  const dateString = date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });
  return dateString.replace(" at ", ", ");
}
