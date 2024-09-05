import { Binary, Braces, Images, Rows3, SquareCheck, Type } from "lucide-react";
import { Badge } from "../../components/ui/badge";

export function RecordBadges({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {counts.strings > 0 && (
        <Badge variant="default" className="bg-[#EFC94333] text-[#C69F3A]">
          <div className="flex gap-1 align-baseline">
            <Type size={16} />
            {`Text (${counts.strings})`}
          </div>
        </Badge>
      )}
      {counts.numbers > 0 && (
        <Badge variant="default" className="bg-[#D9A9FF33] text-[#A76DCB]">
          <div className="flex gap-1 align-baseline">
            <Binary size={16} />
            {`Numbers (${counts.numbers})`}
          </div>
        </Badge>
      )}
      {counts.objects > 0 && (
        <Badge variant="default" className="bg-[#99D49F33] text-[#38CD47]">
          <div className="flex gap-1 align-baseline">
            <Braces size={16} />
            {`Objects (${counts.objects})`}
          </div>
        </Badge>
      )}
      {counts.arrays > 0 && (
        <Badge variant="default" className="bg-[#43DAEF33] text-[#33ADBE]">
          <div className="flex gap-1 align-baseline">
            <Rows3 size={16} />
            {`Arrays (${counts.arrays})`}
          </div>
        </Badge>
      )}
      {counts.booleans > 0 && (
        <Badge variant="default" className="bg-[#D9A9FF33] text-[#A76DCB]">
          <div className="flex gap-1 align-baseline">
            <SquareCheck size={16} />
            {`True/False (${counts.booleans})`}
          </div>
        </Badge>
      )}
      {counts.images > 0 && (
        <Badge variant="default" className="bg-[#99D49F33] text-[#38CD47]">
          <div className="flex gap-1 align-baseline">
            <Images size={16} />
            {`Images (${counts.images})`}
          </div>
        </Badge>
      )}
    </div>
  );
}
