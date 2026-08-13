import { useServiceHealth } from "../../api/queries/health";

/**
 * Live `/health` for every service this page talks to. Deliberately shows each service's language
 * and store alongside its status: for a first-time viewer this panel is where "clearpath is five
 * separate processes in three languages, not one app" stops being a claim in a README.
 */
export function ServiceHealthGrid() {
  const services = useServiceHealth();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Services, live</h2>
        <p className="text-xs text-slate-500">
          polled every 5s · <span className="font-mono">GET /health</span> on each service
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {services.map((service) => (
          <li
            key={service.service}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  service.isPending ? "bg-slate-300" : service.isUp ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="truncate font-mono text-sm font-medium text-slate-900">{service.label}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">
                {service.isPending ? "…" : service.isUp ? `${service.latencyMs}ms` : "down"}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">{service.role}</p>
            <p className="mt-auto flex flex-wrap gap-1.5 pt-1 text-[11px]">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {service.language}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                {service.stores}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        storefront-api (Kotlin/Ktor, read composition + Redis cache) is running too, but sends no CORS
        headers, so this page cannot call it. It appears on the flow diagram, not in this panel.
      </p>
    </section>
  );
}
