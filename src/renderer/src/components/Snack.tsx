import { X } from 'lucide-react';
import { useEffect } from 'react';

export interface SnackMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/** A short message at the bottom of the window, with an optional Undo. */
export function Snack({ message, onDismiss }: { message: SnackMessage; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, message.action ? 8000 : 4500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <div className="snack" role="status" aria-live="polite">
      <span>{message.text}</span>
      {message.action && (
        <button
          type="button"
          onClick={() => {
            message.action!.run();
            onDismiss();
          }}
        >
          {message.action.label}
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onDismiss} style={{ width: 24, height: 24, padding: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
}
