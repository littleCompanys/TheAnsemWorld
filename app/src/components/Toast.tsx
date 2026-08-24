import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastFn = (msg: string, isError?: boolean) => void;
const Ctx = createContext<ToastFn>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState(false);
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback<ToastFn>((message, isError = false) => {
    setMsg(message);
    setErr(isError);
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(false), 5000);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={`toast${show ? " show" : ""}${err ? " err" : ""}`}>{msg}</div>
    </Ctx.Provider>
  );
}

/**
 * Anchor buries the useful part of a failure in a long log dump.
 * Surfacing the program's own error name is what actually tells a
 * user why their transaction was rejected.
 */
export const readableError = (e: unknown): string => {
  const s = String((e as any)?.message ?? e);
  const named = s.match(/Error Message: ([^.\n]+)/);
  if (named) return named[1];
  const code = s.match(/custom program error: 0x([0-9a-f]+)/i);
  if (code) return `Program rejected the transaction (0x${code[1]})`;
  if (s.includes("User rejected")) return "Transaction cancelled in the wallet.";
  if (s.includes("insufficient")) return "Not enough balance for this action.";
  if (s.includes("Transaction too large") || s.includes("too large"))
    return "Transaction too large for Solana — try a smaller quantity.";
  if (s.includes("block height exceeded") || s.includes("has expired"))
    return "That took too long to approve and the transaction expired — it probably didn't go through. Please try again.";
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
};
