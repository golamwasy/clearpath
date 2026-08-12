import { Button } from "../../components/ui/Button";
import type { ItemResponse } from "../../api/queries/menu";
import { formatCents } from "../../lib/format";

interface ConflictBannerProps {
  current: ItemResponse | null;
  onAcknowledge: (current: ItemResponse) => void;
}

/**
 * Rendered inline on a row after a 409. Shows the server's current name and
 * price from ConflictResponse.current (not a follow-up GET — the 409 body
 * already carries it, see docs/plan-phase4.md section 1a) and lets the
 * merchant pull those values into the row's local edit state so the next
 * PUT starts from the real version instead of retrying against the stale
 * one (which would just 409 again).
 */
export function ConflictBanner({ current, onAcknowledge }: ConflictBannerProps) {
  if (!current) {
    return (
      <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        This item was changed or deleted by someone else. Reload the page to see the latest state.
      </div>
    );
  }

  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>
        This item was changed to &ldquo;{current.name}&rdquo; / {formatCents(current.priceCents)} —
        reload to see the latest.
      </span>
      <Button variant="secondary" onClick={() => onAcknowledge(current)}>
        Use latest values
      </Button>
    </div>
  );
}
