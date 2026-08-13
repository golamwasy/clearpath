import { PageHeader } from "../../components/ui/PageHeader";
import { Table, THead, TBody, Th, Td } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { useConsumerLag } from "../../api/queries/lag";
import { FlowDiagram } from "./FlowDiagram";

export function SystemFlow() {
  const { data: lag } = useConsumerLag();

  return (
    <div className="space-y-6">
      <PageHeader
        title="System flow"
        subtitle="Real spans from trace-collector's SSE stream, animated as they happen — no simulated data."
      />
      <FlowDiagram variant="full" />
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Consumer lag</h2>
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
        {(lag ?? []).length === 0 && <p className="text-sm text-slate-500">No monitored consumer groups.</p>}
      </div>
    </div>
  );
}
