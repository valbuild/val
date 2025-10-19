export function AnimatedClock({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="11" />
      <line
        x1="12"
        y1="4"
        x2="12"
        y2="12"
        className="animate-rotate-clock-minute-hand origin-center"
      />
      <line
        x1="12"
        y1="8"
        x2="12"
        y2="12"
        className="animate-rotate-clock-hour-hand origin-center"
      />
    </svg>
  );
}
