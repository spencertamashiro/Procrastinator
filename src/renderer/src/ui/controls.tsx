// Small building blocks shared by every screen. Class names come from styles.css.

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name; the visible label sits next to the switch. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentOption<T> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type BaseInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'>;

/**
 * A text input that keeps its own draft and reports the value only when it loses
 * focus or Enter is pressed, so settings are not rewritten on every keystroke.
 * Escape restores the saved value.
 */
export function CommitInput({ value, onCommit, ...rest }: BaseInputProps & { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (draft !== value) onCommit(draft);
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(value);
          e.stopPropagation();
        }
        rest.onKeyDown?.(e);
      }}
    />
  );
}

/** A whole-number input committed on blur and clamped to [min, max]. */
export function NumberInput({
  value,
  min,
  max,
  onCommit,
  ...rest
}: BaseInputProps & { value: number; min: number; max: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(String(value));
          e.stopPropagation();
        }
      }}
    />
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered dialog on a blurred scrim. Escape or a click on the scrim closes it; focus
 * moves into the dialog, stays there while Tab cycles, and returns where it was on close.
 */
export function Modal({
  title,
  className,
  onClose,
  children,
  footer,
  initialFocus,
}: {
  title: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** CSS selector of the element to focus first (defaults to the first field or button). */
  initialFocus?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = panel.current;
    const first = (initialFocus && root?.querySelector<HTMLElement>(initialFocus)) || root?.querySelector<HTMLElement>('input, select, textarea') || root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && root) {
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // Runs once per opening; the latest onClose is read through the ref.
  }, []);

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panel} className={`panel${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="panel-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

/** Labelled form field: a small caps label over its control, with an optional error or hint. */
export function Field({
  label,
  children,
  error,
  hint,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="micro" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

/** Calls `fn` when a click lands outside `ref`, or the window loses focus. */
export function useDismiss(ref: RefObject<HTMLElement | null>, fn: () => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) fnRef.current();
    };
    const onBlur = (): void => fnRef.current();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [ref]);
}
