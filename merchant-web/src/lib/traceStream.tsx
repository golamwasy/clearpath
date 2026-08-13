import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { serviceBaseUrl } from "../api/client";
import type { components } from "../api/generated/trace";

export type Span = components["schemas"]["Span"];

const MAX_BUFFERED_SPANS = 200;

interface TraceStreamValue {
  spans: Span[];
  connected: boolean;
}

const TraceStreamContext = createContext<TraceStreamValue | null>(null);

/**
 * One shared EventSource to trace-collector's /traces/stream for the whole app, so the flow
 * sidebar, the full flow page, and the chaos panel's duplicate-delivery visualizer all observe
 * the same live span feed without each opening its own SSE connection. EventSource reconnects
 * natively on error; `connected` surfaces stream health honestly rather than pretending the feed
 * is always live.
 */
export function TraceStreamProvider({ children }: { children: ReactNode }) {
  const [spans, setSpans] = useState<Span[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${serviceBaseUrl("trace")}/traces/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      const span = JSON.parse(event.data) as Span;
      setSpans((prev) => [...prev.slice(-(MAX_BUFFERED_SPANS - 1)), span]);
    };
    return () => source.close();
  }, []);

  return <TraceStreamContext.Provider value={{ spans, connected }}>{children}</TraceStreamContext.Provider>;
}

export function useTraceStream(): TraceStreamValue {
  const ctx = useContext(TraceStreamContext);
  if (!ctx) throw new Error("useTraceStream must be used within TraceStreamProvider");
  return ctx;
}
