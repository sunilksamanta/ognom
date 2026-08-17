import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Design-system checkbox row (`.check`): a 15px box with the label inline. */
export function CheckRow({
  on,
  onChange,
  children,
  disabled,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={cn("check", on && "on", className)}
      onClick={() => onChange(!on)}
      disabled={disabled}
    >
      <i>
        <Check strokeWidth={3} />
      </i>
      {children}
    </button>
  );
}
