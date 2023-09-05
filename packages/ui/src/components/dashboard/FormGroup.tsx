import classNames from "classnames";
import { Children, ReactNode, useState } from "react";

interface FormGroupProps {
  children: ReactNode | ReactNode[];
}

export const FormGroup = ({ children }: FormGroupProps) => {
  const [firstChild, ...rest] = Children.toArray(children);
  const [expanded, setExpanded] = useState<boolean>(false);
  const defaultClass =
    "px-4 py-3 border-b border-dark-gray hover:bg-light-gray hover:border-light-gray";
  return (
    <div>
      <div className="flex flex-col font-serif text-xs leading-4 tracking-wider text-white">
        <button
          className={classNames(
            defaultClass,
            "bg-warm-black flex justify-between items-center"
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {firstChild}
          <div>{expanded ? "Collapse" : "Expand"}</div>
        </button>
        {expanded && (
          <div className="flex flex-col bg-medium-black">
            {Children.map(rest, (child) => (
              <div className={classNames(defaultClass)}>{child}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
