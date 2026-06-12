import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

// App-wide toast notifications, replacing the legacy showNotification() helpers.
const ToastContext = createContext(null);

const TYPE_STYLES = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-primary",
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((message, type = "info", duration = 3000) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed top-5 right-5 z-[2000] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${TYPE_STYLES[toast.type] || TYPE_STYLES.info} animate-toast-in rounded-lg px-5 py-3.5 font-medium text-white shadow-lg`}
          >
            {toast.message}
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
