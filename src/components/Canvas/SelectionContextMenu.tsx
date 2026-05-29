import { useEffect, useRef, useState } from "react";
import type { BeadLayer } from "../../types";

interface Props {
  x: number;
  y: number;
  layers: BeadLayer[];
  activeLayerId: string;
  onMirror: (direction: "horizontal" | "vertical") => void;
  onMoveToNewLayer: () => void;
  onMoveToLayer: (targetLayerId: string) => void;
  onCopy: () => void;
  onDuplicateDraggable: () => void;
  onReplaceColor: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 180;
const SUBMENU_WIDTH = 160;
const ITEM_HEIGHT = 28;

interface ItemProps {
  label: string;
  onClick?: () => void;
  onCloseMenu: () => void;
  disabled?: boolean;
  hasSubmenu?: boolean;
}

// Defined at module scope: ensures stable React component identity across
// parent re-renders (e.g., the marching-ants overlay tick in PixelCanvas).
// If this were nested inside SelectionContextMenu, every parent re-render
// would recreate Item as a new function, causing React to unmount and
// remount all menu buttons — clicks that arrive mid-remount get dropped.
function Item({ label, onClick, onCloseMenu, disabled, hasSubmenu }: ItemProps) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        if (onClick) {
          onClick();
          onCloseMenu();
        }
      }}
      className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
        disabled ? "text-gray-300 cursor-not-allowed" : "hover:bg-blue-50 text-gray-700"
      }`}
      style={{ height: ITEM_HEIGHT }}
    >
      <span>{label}</span>
      {hasSubmenu && <span aria-hidden="true" className="text-gray-400">▸</span>}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-gray-200" />;
}

export function SelectionContextMenu({
  x,
  y,
  layers,
  activeLayerId,
  onMirror,
  onMoveToNewLayer,
  onMoveToLayer,
  onCopy,
  onDuplicateDraggable,
  onReplaceColor,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<"mirror" | "moveToLayer" | null>(null);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(x, vw - MENU_WIDTH - 8);
  const top = Math.min(y, vh - 240);
  const submenuOpensLeft = left + MENU_WIDTH + SUBMENU_WIDTH > vw;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const otherLayers = layers.filter((l) => l.id !== activeLayerId);

  return (
    <div
      ref={ref}
      role="menu"
      // Stop mousedown from bubbling to the canvas container. Without this,
      // canvas.handleMouseDown sees the left-click on a menu item, and when
      // the active tool is "select" calls clearSelection() — which races
      // ahead of the React onClick that fires the menu action, so the action
      // reads selection==null and silently no-ops.
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed bg-white border border-gray-300 rounded shadow-lg z-50 py-1"
      style={{ left, top, width: MENU_WIDTH }}
    >
      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("mirror")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="镜像" hasSubmenu onCloseMenu={onClose} />
        {openSubmenu === "mirror" && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1"
            style={submenuOpensLeft ? { right: MENU_WIDTH - 4, left: undefined, top: 0, width: SUBMENU_WIDTH } : { left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            <Item label="水平翻转" onClick={() => onMirror("horizontal")} onCloseMenu={onClose} />
            <Item label="垂直翻转" onClick={() => onMirror("vertical")} onCloseMenu={onClose} />
          </div>
        )}
      </div>

      <Divider />

      <Item label="移到新图层" onClick={onMoveToNewLayer} onCloseMenu={onClose} />

      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("moveToLayer")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="移到图层" hasSubmenu disabled={otherLayers.length === 0} onCloseMenu={onClose} />
        {openSubmenu === "moveToLayer" && otherLayers.length > 0 && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1 max-h-60 overflow-y-auto"
            style={submenuOpensLeft ? { right: MENU_WIDTH - 4, left: undefined, top: 0, width: SUBMENU_WIDTH } : { left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            {otherLayers.map((l) => (
              <Item key={l.id} label={l.name} onClick={() => onMoveToLayer(l.id)} onCloseMenu={onClose} />
            ))}
          </div>
        )}
      </div>

      <Divider />

      <Item label="复制" onClick={onCopy} onCloseMenu={onClose} />
      <Item label="原地复制并拖动" onClick={onDuplicateDraggable} onCloseMenu={onClose} />

      <Divider />

      <Item label="替换颜色..." onClick={onReplaceColor} onCloseMenu={onClose} />
    </div>
  );
}
