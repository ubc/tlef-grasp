import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

// App-wide toast notifications, replacing the legacy showNotification() helpers.
const ToastContext = createContext(null);

const TYPE_STYLES = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-primary",
};

const DEFAULT_DURATION_MS = 3000;

// showToast(message, type, options). `options` is a duration in ms, as before,
// or { duration, sticky }. A sticky toast has no timer: it stays until the user
// closes it with its × button or leaves the page, for messages that need time
// to read (an import that refused some questions, say).
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const { pathname } = useLocation();

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message, type = "info", options) => {
      const { duration = DEFAULT_DURATION_MS, sticky = false } =
        typeof options === "number" ? { duration: options } : options || {};
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type, sticky }]);
      if (!sticky) setTimeout(() => dismissToast(id), duration);
    },
    [dismissToast]
  );

  // A sticky toast belongs to the page it was raised on.
  useEffect(() => {
    setToasts((prev) => prev.filter((toast) => !toast.sticky));
  }, [pathname]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed top-5 right-5 z-[2000] flex max-w-md flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            // Announced to screen readers, since it is waiting on the user.
            role={toast.sticky ? "alert" : undefined}
            className={`${TYPE_STYLES[toast.type] || TYPE_STYLES.info} animate-toast-in flex items-start gap-3 rounded-lg px-5 py-3.5 font-medium text-white shadow-lg`}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.sticky && (
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="-mr-2 -mt-1 rounded px-2 text-xl leading-none text-white/90 hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return showToast;
}
