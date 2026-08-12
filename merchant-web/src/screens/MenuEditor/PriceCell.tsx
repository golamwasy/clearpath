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
        className="rounded px-2 py-1 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {formatCents(priceCents)}
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
