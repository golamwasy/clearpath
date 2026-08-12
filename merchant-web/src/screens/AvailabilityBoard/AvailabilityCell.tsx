import { useId, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Input } from "../../components/ui/Input";
import { Popover } from "../../components/ui/Popover";
import { formatDateTime } from "../../lib/format";
import type { AvailabilityState, AvailabilityStatus } from "../../api/queries/availability";

interface AvailabilityCellProps {
  itemLabel: string;
  state: AvailabilityState | undefined;
  onChange: (status: AvailabilityStatus, soldOutUntil: string | null) => void;
  disabled?: boolean;
}

/** Tri-state availability cell: in stock / sold out / sold out until a time, toggled via a small popover. */
export function AvailabilityCell({ itemLabel, state, onChange, disabled }: AvailabilityCellProps) {
  const [open, setOpen] = useState(false);
  const [untilDraft, setUntilDraft] = useState("");
  const popoverId = useId();
  const untilInputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const status = state?.status ?? "in_stock";

  function apply(next: AvailabilityStatus) {
    if (next === "sold_out_until") {
      if (!untilDraft) return;
      onChange(next, new Date(untilDraft).toISOString());
    } else {
      onChange(next, null);
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="group inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white py-1 pl-2 pr-1.5 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-300 disabled:hover:bg-white"
      >
        <StatusBadge status={status} soldOutUntil={state?.soldOutUntil} />
        <span aria-hidden="true" className="text-slate-400 group-hover:text-slate-600">
          ▾
        </span>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        id={popoverId}
        label={`Set availability for ${itemLabel}`}
      >
        <div className="flex flex-col gap-2">
          <Button
            variant={status === "in_stock" ? "primary" : "secondary"}
            onClick={() => apply("in_stock")}
            className="justify-start"
          >
            In stock
          </Button>
          <Button
            variant={status === "sold_out" ? "primary" : "secondary"}
            onClick={() => apply("sold_out")}
            className="justify-start"
          >
            Sold out
          </Button>
          <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
            <label htmlFor={untilInputId} className="text-xs font-medium text-slate-600">
              Sold out until
            </label>
            <Input
              id={untilInputId}
              type="datetime-local"
              value={untilDraft}
              onChange={(e) => setUntilDraft(e.target.value)}
              className="w-full"
            />
            <Button variant="primary" onClick={() => apply("sold_out_until")} disabled={!untilDraft}>
              Set
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function StatusBadge({ status, soldOutUntil }: { status: AvailabilityStatus; soldOutUntil?: string | null }) {
  if (status === "in_stock") return <Badge tone="success">In stock</Badge>;
  if (status === "sold_out_until") {
    return <Badge tone="warning">Sold out until {formatDateTime(soldOutUntil)}</Badge>;
  }
  return <Badge tone="danger">Sold out</Badge>;
}
