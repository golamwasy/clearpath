/**
 * Names exactly where a region's data came from and how fresh it is.
 *
 * This project's claim is that nothing on screen is fabricated in the browser. Stating that once, in
 * one screen's subtitle, asks a viewer to take it on faith. Putting the origin next to every data
 * region instead makes the claim checkable at a glance — and teaches the architecture passively,
 * since the tag names the actual service and store rather than a vague "live".
 */
export function SourceTag({
  origin,
  freshness,
  tone = "neutral",
}: {
  /** The service and store, in the system's own vocabulary — e.g. "menu-service · Postgres". */
  origin: string;
  /** How it arrives: "live · SSE", "polled 5s", "on load". */
  freshness?: string;
  tone?: "neutral" | "live";
}) {
  const isLive = tone === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        isLive ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {isLive && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-500" />}
      <span className="font-mono">{origin}</span>
      {freshness && <span className="text-slate-400">·</span>}
      {freshness && <span>{freshness}</span>}
    </span>
  );
}
