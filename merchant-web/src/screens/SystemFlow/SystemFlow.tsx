import { PageHeader } from "../../components/ui/PageHeader";
import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { useConsumerLag } from "../../api/queries/lag";
import { FlowDiagram } from "./FlowDiagram";
import { SourceTag } from "../../components/ui/SourceTag";
import { InvariantBadge } from "../../components/ui/InvariantBadge";

export function SystemFlow() {
  const { data: lag } = useConsumerLag();

  return (
    <div className="space-y-6">
      <PageHeader
        title="System flow"
        subtitle={
          <>
            Every dot is a real span arriving on trace-collector's SSE stream. Boxes are the actual
            services, databases and Kafka topics; arrows show direction and name the mechanism. The
            write path runs left to right along the top — note that the outbox row commits inside the
            same Postgres transaction as the item, which is what makes a lost publish impossible.{" "}
            <InvariantBadge n={1} />
          </>
        }
        source={<SourceTag tone="live" origin="trace-collector · SSE" freshness="live" />}
      />
      <FlowDiagram variant="full" />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Kafka consumer lag</h2>
          <SourceTag origin="trace-collector · AdminClient" freshness="polled" />
        </div>
        <Table>
          <THead>
            <tr>
              <Th>Group</Th>
              <Th>Topic</Th>
              <Th>Lag</Th>
              <Th>Partitions</Th>
            </tr>
          </THead>
          <TBody>
            {(lag ?? []).map((entry) => (
              <tr key={entry.groupId}>
                <Td className="font-medium text-slate-900">{entry.groupId}</Td>
                <Td>{entry.topic}</Td>
                <Td>
                  <Badge tone={entry.lag > 0 ? "warning" : "success"}>{entry.lag}</Badge>
                </Td>
                <Td className="text-slate-500">
                  {entry.partitions.map((p) => `p${p.partition}:${p.lag}`).join(", ") || "—"}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
        {(lag ?? []).length === 0 && (
          <p className="text-sm text-slate-500">
            No monitored consumer groups. trace-collector reads lag for the groups named in
            MONITORED_CONSUMER_GROUPS via Kafka's AdminClient — that list is static config, not
            auto-discovery, so a new consumer has to be added to it explicitly.
          </p>
        )}
      </div>
    </div>
  );
}
