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

  const Item = ({
    label,
    onClick,
    disabled,
    hasSubmenu,
  }: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    hasSubmenu?: boolean;
  }) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        if (onClick) {
          onClick();
          onClose();
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

  const Divider = () => <div className="my-1 border-t border-gray-200" />;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed bg-white border border-gray-300 rounded shadow-lg z-50 py-1"
      style={{ left, top, width: MENU_WIDTH }}
    >
      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("mirror")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="镜像" hasSubmenu />
        {openSubmenu === "mirror" && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1"
            style={submenuOpensLeft ? { right: MENU_WIDTH - 4, left: undefined, top: 0, width: SUBMENU_WIDTH } : { left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            <Item label="水平翻转" onClick={() => onMirror("horizontal")} />
            <Item label="垂直翻转" onClick={() => onMirror("vertical")} />
          </div>
        )}
      </div>

      <Divider />

      <Item label="移到新图层" onClick={onMoveToNewLayer} />

      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("moveToLayer")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="移到图层" hasSubmenu disabled={otherLayers.length === 0} />
        {openSubmenu === "moveToLayer" && otherLayers.length > 0 && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1 max-h-60 overflow-y-auto"
            style={submenuOpensLeft ? { right: MENU_WIDTH - 4, left: undefined, top: 0, width: SUBMENU_WIDTH } : { left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            {otherLayers.map((l) => (
              <Item key={l.id} label={l.name} onClick={() => onMoveToLayer(l.id)} />
            ))}
          </div>
        )}
      </div>

      <Divider />

      <Item label="复制" onClick={onCopy} />
      <Item label="原地复制并拖动" onClick={onDuplicateDraggable} />

      <Divider />

      <Item label="替换颜色..." onClick={onReplaceColor} />
    </div>
  );
}
