import { useId, useState } from "react";
import { Input } from "../../components/ui/Input";
import { formatCents } from "../../lib/format";

interface PriceCellProps {
  itemName: string;
  priceCents: number | null;
  onCommit: (nextCents: number | null) => void;
  disabled?: boolean;
}

/** Inline-editable price. Commits on blur or Enter; Escape reverts without saving. */
export function PriceCell({ itemName, priceCents, onCommit, disabled }: PriceCellProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => centsToDollarsString(priceCents));

  function beginEdit() {
    setDraft(centsToDollarsString(priceCents));
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    const nextCents = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100);
    setEditing(false);
    if (Number.isNaN(nextCents as number)) return;
    if (nextCents !== priceCents) onCommit(nextCents);
  }

  function cancel() {
    setDraft(centsToDollarsString(priceCents));
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        disabled={disabled}
        className="group inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-left font-medium text-slate-900 hover:border-solid hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-dashed disabled:hover:border-slate-300 disabled:hover:bg-transparent"
      >
        {formatCents(priceCents)}
        <span aria-hidden="true" className="text-xs text-slate-400 group-hover:text-blue-500">
          ✎
        </span>
      </button>
    );
  }

  return (
    <span>
      <label htmlFor={inputId} className="sr-only">
        Price for {itemName}
      </label>
      <Input
        id={inputId}
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-24"
      />
    </span>
  );
}

function centsToDollarsString(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}
