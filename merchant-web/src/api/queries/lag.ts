import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../client";
import type { components } from "../generated/trace";

export type ConsumerGroupLag = components["schemas"]["ConsumerGroupLag"];

const LAG_POLL_INTERVAL_MS = 3000;

export function useConsumerLag() {
  return useQuery({
    queryKey: ["consumer-lag"],
    queryFn: () => apiRequest<ConsumerGroupLag[]>("trace", "/consumer-lag"),
    refetchInterval: LAG_POLL_INTERVAL_MS,
  });
}
