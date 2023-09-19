export type TextData = string;
export type TextInputProps = {
  name: string;
  text: TextData;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function TextArea({ name, disabled, text, onChange }: TextInputProps) {
  return (
    <div
      className="w-full h-full py-2 overflow-y-scroll grow-wrap"
      data-replicated-value={text} /* see grow-wrap */
    >
      <textarea
        disabled={disabled}
        name={name}
        className="p-2 border outline-none resize-none bg-fill text-primary border-border focus-visible:border-highlight"
        defaultValue={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
