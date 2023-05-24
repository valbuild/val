export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="px-4 py-[2px] border rounded-sm border-border bg-fill text-primary hover:dark:bg-yellow hover:bg-warm-black hover:dark:text-dark-gray hover:text-white">
      {children}
    </button>
  );
}
