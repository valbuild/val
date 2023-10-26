export function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="val-px-[24px] val-py-4 val-font-serif val-text-lg val-font-semibold val-border-2 val-rounded-md val-text-warm-black dark:val-border-white val-border-warm-black bg-highlight"
      onClick={onClick}
    >
      Edit page
    </button>
  );
}
