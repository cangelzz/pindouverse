import { useEffect, useRef, useState } from "react";

type Kind = "prompt" | "alert" | "confirm";

type Request = {
  id: number;
  kind: Kind;
  title?: string;
  message: string;
  defaultValue?: string;
  resolve: (value: any) => void;
};

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function enqueue(req: Omit<Request, "id">): Promise<any> {
  return new Promise((resolve) => {
    queue.push({ ...req, id: nextId++, resolve });
    notify();
  });
}

export function appPrompt(
  message: string,
  defaultValue: string = "",
  options: { title?: string } = {}
): Promise<string | null> {
  return enqueue({
    kind: "prompt",
    message,
    defaultValue,
    title: options.title,
    resolve: () => {},
  });
}

export function appAlert(
  message: string,
  options: { title?: string } = {}
): Promise<void> {
  return enqueue({
    kind: "alert",
    message,
    title: options.title,
    resolve: () => {},
  });
}

export function appConfirm(
  message: string,
  options: { title?: string } = {}
): Promise<boolean> {
  return enqueue({
    kind: "confirm",
    message,
    title: options.title,
    resolve: () => {},
  });
}

export function DialogHost() {
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (current?.kind === "prompt") {
      setInputValue(current.defaultValue ?? "");
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [current?.id]);

  if (!current) return null;

  const closeWith = (value: any) => {
    const req = queue.shift();
    notify();
    req?.resolve(value);
  };

  const onCancel = () => {
    if (current.kind === "prompt") closeWith(null);
    else if (current.kind === "confirm") closeWith(false);
    else closeWith(undefined);
  };

  const onOk = () => {
    if (current.kind === "prompt") closeWith(inputValue);
    else if (current.kind === "confirm") closeWith(true);
    else closeWith(undefined);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOk();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const showCancel = current.kind !== "alert";
  const titleText =
    current.title ??
    (current.kind === "prompt"
      ? "输入"
      : current.kind === "confirm"
        ? "确认"
        : "提示");

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-[360px] max-w-[90vw]">
        <div className="px-4 py-3 border-b text-sm font-semibold">{titleText}</div>
        <div className="px-4 py-3 text-sm whitespace-pre-wrap text-gray-700">
          {current.message}
        </div>
        {current.kind === "prompt" && (
          <div className="px-4 pb-3">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        )}
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          {showCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
            >
              取消
            </button>
          )}
          <button
            onClick={onOk}
            autoFocus={current.kind !== "prompt"}
            className="px-3 py-1 rounded bg-blue-500 text-white text-sm hover:bg-blue-600"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
