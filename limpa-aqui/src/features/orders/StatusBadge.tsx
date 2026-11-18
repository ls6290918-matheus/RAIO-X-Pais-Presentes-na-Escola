import { cn } from "@/components/shared/ui";
import type { OrderStatus } from "@/lib/types";
import { STATUS_LABEL, STATUS_STYLE } from "./status";

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
