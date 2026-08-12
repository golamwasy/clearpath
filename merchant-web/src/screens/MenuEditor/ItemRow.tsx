import { Td } from "../../components/ui/Table";
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
        <Td className="w-16">
          <div className="inline-flex flex-col overflow-hidden rounded-md border border-slate-300 shadow-sm">
            <button
              type="button"
              aria-label={`Move ${item.name} up`}
              onClick={onMoveUp}
              disabled={disabled || !canMoveUp}
              className="flex h-7 w-9 items-center justify-center border-b border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            >
              <span aria-hidden="true">▲</span>
            </button>
            <button
              type="button"
              aria-label={`Move ${item.name} down`}
              onClick={onMoveDown}
              disabled={disabled || !canMoveDown}
              className="flex h-7 w-9 items-center justify-center bg-white text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
            >
              <span aria-hidden="true">▼</span>
            </button>
          </div>
        </Td>
        <Td className="font-medium text-slate-900">{item.name}</Td>
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
        <Td>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            v{item.version}
          </span>
        </Td>
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
