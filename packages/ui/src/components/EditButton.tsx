export function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="px-[24px] py-4 text-lg font-semibold border-2 rounded-md text-warm-black dark:border-white border-warm-black bg-highlight"
      onClick={onClick}
    >
      Edit page
    </button>
  );
}
