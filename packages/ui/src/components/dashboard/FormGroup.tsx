import classNames from "classnames";
import { Children, ReactNode, useState } from "react";

interface FormGroupProps {
  children: ReactNode | ReactNode[];
  className?: string;
  defaultExpanded?: boolean;
}

export const FormGroup = ({
  children,
  className,
  defaultExpanded,
}: FormGroupProps) => {
  const [firstChild, ...rest] = Children.toArray(children);
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded ?? true);
  const defaultClass = "py-3 " + (className ? ` ${className}` : "");
  return (
    <div>
      <div className="flex flex-col font-serif text-xs leading-4 tracking-wider text-white">
        <button
          className={classNames(
            defaultClass,
            "bg-warm-black flex justify-between items-center",
            { "border-y border-highlight": !expanded }
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {firstChild}
          <div>{expanded ? "Collapse" : "Expand"}</div>
        </button>
        {expanded && (
          <div className="flex flex-col bg-base">
            {Children.map(rest, (child) => (
              <div className={classNames(defaultClass)}>{child}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
