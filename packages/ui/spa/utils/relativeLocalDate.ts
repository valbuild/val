export function relativeLocalDate(now: Date, date: string): string {
  const past = new Date(date).getTime();
  const nowTime = now.getTime();
  const diffInSeconds = Math.floor((nowTime - past) / 1000);

  const minutes = Math.floor(diffInSeconds / 60);
  const hours = Math.floor(diffInSeconds / 3600);
  const days = Math.floor(diffInSeconds / 86400);
  const months = Math.floor(days / 30); // approximate month length as 30 days

  if (diffInSeconds < 60) {
    return "just now";
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days === 1) {
    return "yesterday";
  } else if (days < 30) {
    return `${days}d ago`;
  } else {
    return `${months}mo ago`;
  }
}
