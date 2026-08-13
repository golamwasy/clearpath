import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  /** Where this screen's data comes from — a SourceTag, shown right-aligned against the title. */
  source,
}: {
  title: string;
  subtitle?: ReactNode;
  source?: ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-prose text-sm text-slate-500">{subtitle}</p>}
      </div>
      {source && <div className="shrink-0 pt-1">{source}</div>}
    </div>
  );
}
