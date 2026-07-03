"use client";

/**
 * Minimal toast system for the console. No dependencies — a context, a
 * fixed stack in the corner, auto-dismiss. Used for "shipment created" and
 * other one-shot confirmations that shouldn't steal focus.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "mint" | "amber" | "red";

interface Toast {
  id: number;
  title: string;
  detail?: ReactNode;
  tone: ToastTone;
}

interface ToastApi {
  toast: (t: { title: string; detail?: ReactNode; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const TONE: Record<ToastTone, string> = {
  mint: "var(--mint)",
  amber: "var(--amber)",
  red: "var(--red)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastApi["toast"]>(
    ({ title, detail, tone = "mint" }) => {
      const id = nextId.current++;
      setToasts((cur) => [...cur, { id, title, detail, tone }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed z-50 bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 sm:w-96 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="card p-4 shadow-xl pointer-events-auto demo-fade-up"
            style={{
              borderColor: `color-mix(in srgb, ${TONE[t.tone]} 45%, transparent)`,
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.45)",
            }}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: TONE[t.tone] }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold" style={{ color: TONE[t.tone] }}>
                  {t.title}
                </p>
                {t.detail && (
                  <div
                    className="text-xs mt-1 break-words"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {t.detail}
                  </div>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="text-xs px-1.5 min-h-[24px] rounded hover:text-white"
                style={{ color: "var(--text-faint)" }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
