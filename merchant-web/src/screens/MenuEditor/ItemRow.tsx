import { Td } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { PriceCell } from "./PriceCell";
import { ConflictBanner } from "./ConflictBanner";
import type { ItemResponse } from "../../api/queries/menu";

interface ItemRowProps {
  item: ItemResponse;
  conflict: ItemResponse | null | undefined;
  onPriceCommit: (nextCents: number | null) => void;
  onAcknowledgeConflict: (current: ItemResponse) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
}

/**
 * A single menu item row. Reordering exposes up/down buttons rather than
 * relying on drag alone — drag-only reordering isn't keyboard-operable, and
 * this repo has no drag library (no component library per CLAUDE.md), so
 * the keyboard path has to be a first-class control, not an afterthought.
 * Native HTML5 drag-and-drop is layered on the row as a mouse-only
 * convenience via draggable/onDragOver/onDrop wired up by the parent list.
 */
export function ItemRow({
  item,
  conflict,
  onPriceCommit,
  onAcknowledgeConflict,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  disabled,
}: ItemRowProps) {
  return (
    <>
      <tr className="hover:bg-slate-50">
        <Td className="w-24">
          <div className="flex items-center gap-1">
            <Button
              aria-label={`Move ${item.name} up`}
              onClick={onMoveUp}
              disabled={disabled || !canMoveUp}
              className="px-1.5 py-0.5"
            >
              ↑
            </Button>
            <Button
              aria-label={`Move ${item.name} down`}
              onClick={onMoveDown}
              disabled={disabled || !canMoveDown}
              className="px-1.5 py-0.5"
            >
              ↓
            </Button>
          </div>
        </Td>
        <Td>{item.name}</Td>
        <Td className="text-slate-500">{item.description ?? "—"}</Td>
        <Td className="text-slate-500">{item.categoryId ?? "—"}</Td>
        <Td>
          <PriceCell
            itemName={item.name}
            priceCents={item.priceCents}
            onCommit={onPriceCommit}
            disabled={disabled}
          />
        </Td>
        <Td className="text-slate-400">v{item.version}</Td>
      </tr>
      {conflict !== undefined && (
        <tr>
          <td colSpan={6} className="px-3 pb-2">
            <ConflictBanner current={conflict} onAcknowledge={onAcknowledgeConflict} />
          </td>
        </tr>
      )}
    </>
  );
}
