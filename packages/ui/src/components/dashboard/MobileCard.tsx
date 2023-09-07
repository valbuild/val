import { JsonPath } from "./ModuleMenu";

export type MobileCardProps = {
  children?: React.ReactNode | [React.ReactNode, React.ReactNode];
};

export function MobileCard({ children }: MobileCardProps): React.ReactElement {
  return <div className="gap-4 bg-fill text-primary">{children}</div>;
}

export type MobileCardHeaderProps = {
  path: JsonPath;
  children: React.ReactNode[] | React.ReactNode;
};

MobileCard.Header = ({
  path,
  children,
}: MobileCardHeaderProps): React.ReactElement => {
  return (
    <div className="bg-base">
      <div className="flex items-center justify-between p-4">
        <span>{path}</span>
        <button className="inline-block text-xl">
          <svg
            fill="currentColor"
            height="16px"
            width="16px"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
          >
            <path d="M8,6.5A1.5,1.5,0,1,1,6.5,8,1.5,1.5,0,0,1,8,6.5ZM.5,8A1.5,1.5,0,1,0,2,6.5,1.5,1.5,0,0,0,.5,8Zm12,0A1.5,1.5,0,1,0,14,6.5,1.5,1.5,0,0,0,12.5,8Z" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap justify-start px-4 pb-4 gap-x-4">
        {children}
      </div>
    </div>
  );
};

export type MobileCardSummaryProps = {
  name: string;
  number: number;
  icon: React.ReactNode;
};

MobileCard.Summary = ({
  name,
  number,
  icon,
}: MobileCardSummaryProps): React.ReactElement => {
  return (
    <span className="flex items-center space-x-2">
      <span>{icon}</span>
      <span>{number}</span>
      <span>{name}</span>
    </span>
  );
};

export type MobileCardContentProps = {
  children?: React.ReactNode;
};

MobileCard.Content = ({
  children,
}: MobileCardContentProps): React.ReactElement => {
  return (
    <div
      className="grid border-t border-border"
      style={{
        gridTemplateColumns: "minmax(100px, auto) auto",
      }}
    >
      {children}
    </div>
  );
};

export type MobileCardContentRowProps = {
  name: string;
  amount?: number;
  icon: React.ReactNode;
  children?: React.ReactNode;
};

MobileCard.ContentRow = ({
  name,
  amount,
  icon,
  children,
}: MobileCardContentRowProps): React.ReactElement => {
  return (
    <>
      <span className="flex p-4 items-center gap-x-2 min-h-[40px] border-b border-border border-l">
        <span>{icon}</span>
        <span className="flex gap-x-2">
          <span className="truncate text-ellipsis">{name}</span>
          {typeof amount !== "undefined" && (
            <span className="font-serif">{amount}</span>
          )}
        </span>
      </span>
      <span className="p-4 border-b border-r border-border">{children}</span>
    </>
  );
};
