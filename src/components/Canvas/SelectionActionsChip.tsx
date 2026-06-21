interface Props {
  /** Top edge of the selection in viewport coordinates (px). */
  selectionTop: number;
  /** Right edge of the selection in viewport coordinates (px). */
  selectionRight: number;
  /** Container's top edge in viewport coordinates — used to clamp the chip
   * so it never escapes the canvas area when the selection is near the top. */
  containerTop: number;
  onClick: (clientX: number, clientY: number) => void;
  /** When true, shows an amber warning that the selection content is on other layers. */
  warnOtherLayer?: boolean;
}

const CHIP_HEIGHT = 22;
const GAP_ABOVE_SELECTION = 6;

/**
 * Floating discoverability badge anchored to the top-right of the selection.
 * Clicking it opens the same context menu that right-click does, both for
 * users who don't know about the right-click menu and for touch users who
 * have no right mouse button.
 */
export function SelectionActionsChip({
  selectionTop,
  selectionRight,
  containerTop,
  onClick,
  warnOtherLayer,
}: Props) {
  // Anchor: chip's right edge aligned with selection's right edge; chip sits
  // GAP_ABOVE_SELECTION above the selection's top. Clamp top so the chip
  // never floats above the container (i.e., out of the canvas area).
  const desiredTop = selectionTop - CHIP_HEIGHT - GAP_ABOVE_SELECTION;
  const top = Math.max(containerTop + 2, desiredTop);

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick(e.clientX, e.clientY);
        }}
        className="fixed flex items-center gap-1 px-2 text-[11px] leading-none bg-white border border-gray-300 rounded-full shadow-sm hover:bg-blue-50 text-gray-700 z-40 whitespace-nowrap select-none"
        style={{
          top,
          // Place the chip so its RIGHT edge equals selectionRight.
          // `right: viewport - selectionRight` does that for `position: fixed`.
          right: typeof window !== "undefined"
            ? Math.max(2, window.innerWidth - selectionRight)
            : 0,
          height: CHIP_HEIGHT,
        }}
      >
        <span aria-hidden="true" className="text-gray-400">⋮</span>
        <span>右键查看操作</span>
      </button>
      {warnOtherLayer && (
        <div
          className="fixed z-40 px-2 py-0.5 text-[10px] leading-none bg-amber-50 border border-amber-300 text-amber-700 rounded shadow-sm whitespace-nowrap select-none pointer-events-none"
          style={{
            top: top + CHIP_HEIGHT + 4,
            right: typeof window !== "undefined" ? Math.max(2, window.innerWidth - selectionRight) : 0,
          }}
        >
          ⚠ 选区内容在其他图层（当前图层为空）
        </div>
      )}
    </>
  );
}
