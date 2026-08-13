import type { ReactNode } from "react";

/**
 * An empty screen is frequently the first designed thing a demo viewer reads — a fresh stack has an
 * empty menu, no traces, and no sync runs all at once. So an empty state here is not a shrug: it
 * says why the region is empty (`reason`), what would fill it (`fills`), and offers the action that
 * does so. `reason` should name the actual service and store involved, since explaining the
 * architecture is the job this component is really doing.
 */
export function EmptyState({
  title,
  reason,
  fills,
  action,
}: {
  title: string;
  reason: ReactNode;
  fills?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-6">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="max-w-prose text-sm text-slate-600">{reason}</p>
        {fills && <p className="max-w-prose text-sm text-slate-500">{fills}</p>}
      </div>
      {action}
    </div>
  );
}
