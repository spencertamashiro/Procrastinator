// Add or edit a task. Four things are required (name, rough duration, when you would
// like to be done, the hard deadline); everything else lives under "More details".

import { CalendarClock, ChevronDown, Link, MapPin, Repeat, Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FREQS, validateTask, type TaskErrors } from '../../../shared/tasks';
import { addDays, atMinutes, DAY, fromLocalInput, startOfDay, toLocalInput } from '../../../shared/time';
import type { RecurrenceFreq, Task, TaskInput } from '../../../shared/types';
import { Field, Modal } from '../ui/controls';

const PRESETS = [15, 30, 60, 120, 180];
const FREQ_LABEL: Record<RecurrenceFreq, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
};

const presetLabel = (m: number): string => (m < 60 ? `${m} m` : `${m / 60} h`);

export interface TaskDraft {
  task?: Task;
  important?: boolean;
  /** Preferred due time for a new task (e.g. from double-clicking the grid). */
  dueAt?: number;
  expanded?: boolean;
}

/** 5 PM today, or tomorrow when it is already late in the afternoon. */
function defaultDue(now: number): number {
  const today = atMinutes(startOfDay(now), 17 * 60);
  return now < today - 2 * 3_600_000 ? today : addDays(today, 1);
}

export function TaskDialog({
  draft,
  categories,
  now,
  onClose,
  onSaved,
}: {
  draft: TaskDraft;
  categories: string[];
  now: number;
  onClose: () => void;
  onSaved: (title: string, created: boolean) => void;
}) {
  const t = draft.task;
  const initialDue = t ? Date.parse(t.preferredDue) : (draft.dueAt ?? defaultDue(now));
  const [title, setTitle] = useState(t?.title ?? '');
  const [duration, setDuration] = useState<number | null>(t?.durationMin ?? 60);
  const [custom, setCustom] = useState(t ? !PRESETS.includes(t.durationMin) : false);
  const [due, setDue] = useState(toLocalInput(initialDue));
  const [deadline, setDeadline] = useState(toLocalInput(t ? Date.parse(t.finalDeadline) : initialDue + DAY));
  const [deadlineTouched, setDeadlineTouched] = useState(!!t);
  const [open, setOpen] = useState(draft.expanded ?? !!(t && (t.category || t.recurrence || t.location || t.url || t.notes)));
  const [category, setCategory] = useState(t?.category ?? '');
  const [freq, setFreq] = useState<RecurrenceFreq | ''>(t?.recurrence?.freq ?? '');
  const [until, setUntil] = useState(t?.recurrence?.until ?? '');
  const [location, setLocation] = useState(t?.location ?? '');
  const [url, setUrl] = useState(t?.url ?? '');
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [important, setImportant] = useState(!!draft.important);
  const [errors, setErrors] = useState<TaskErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allCategories = category && !categories.includes(category) ? [...categories, category] : categories;

  const onDueChange = (value: string): void => {
    setDue(value);
    const ms = fromLocalInput(value);
    // Until the deadline is set by hand it follows the preferred due date, a day later.
    if (!deadlineTouched && Number.isFinite(ms)) setDeadline(toLocalInput(ms + DAY));
  };

  const build = (): TaskInput => {
    const dueMs = fromLocalInput(due);
    const deadlineMs = fromLocalInput(deadline);
    return {
      id: t?.id,
      title,
      durationMin: duration ?? NaN,
      preferredDue: Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : '',
      finalDeadline: Number.isFinite(deadlineMs) ? new Date(deadlineMs).toISOString() : '',
      category: category || undefined,
      recurrence: freq ? (until ? { freq, until } : { freq }) : undefined,
      location: location || undefined,
      url: url || undefined,
      notes: notes || undefined,
      important,
    };
  };

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (saving) return;
    const input = build();
    const found = validateTask(input);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.url) setOpen(true);
      return;
    }
    setSaving(true);
    const res = await window.api.saveTask(input);
    setSaving(false);
    if (!res.ok) {
      setFailure(res.message ?? 'The task could not be saved.');
      return;
    }
    onSaved(input.title.trim(), !t);
  };

  const footer = (
    <div className="panel-foot">
      <button type="button" className={`pill${important ? ' active' : ''}`} aria-pressed={important} onClick={() => setImportant(!important)}>
        <Star size={13} fill={important ? 'currentColor' : 'none'} />
        Important
      </button>
      <div className="actions">
        <button type="button" className="pill ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" form="task-form" className="pill primary flat" disabled={saving}>
          {t ? 'Save' : 'Add task'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal title={t ? 'Edit task' : 'New task'} className="dialog" onClose={onClose} footer={footer} initialFocus="#task-name">
      <form id="task-form" className="panel-body" onSubmit={submit} noValidate>
        <Field label="Name" error={errors.title} htmlFor="task-name">
          <div className={`input${errors.title ? ' invalid' : ''}`}>
            <input id="task-name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={200} autoComplete="off" />
          </div>
        </Field>

        <Field label="Approx. duration" error={errors.durationMin}>
          <div className="presets" role="group" aria-label="Approximate duration">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className={`pill${!custom && duration === m ? ' active' : ''}`}
                aria-pressed={!custom && duration === m}
                onClick={() => {
                  setCustom(false);
                  setDuration(m);
                }}
              >
                {presetLabel(m)}
              </button>
            ))}
            {custom ? (
              <div className={`input${errors.durationMin ? ' invalid' : ''}`} style={{ minHeight: 28, paddingRight: 10 }}>
                <input
                  type="number"
                  min={5}
                  max={10080}
                  step={5}
                  aria-label="Duration in minutes"
                  value={duration ?? ''}
                  onChange={(e) => setDuration(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ padding: '4px 0' }}
                  autoFocus
                />
                <span className="small t3">min</span>
              </div>
            ) : (
              <button type="button" className="pill" onClick={() => setCustom(true)}>
                Custom…
              </button>
            )}
          </div>
        </Field>

        <div className="row">
          <Field label="Preferred due" error={errors.preferredDue} htmlFor="task-due">
            <div className={`input${errors.preferredDue ? ' invalid' : ''}`}>
              <CalendarClock size={15} />
              <input id="task-due" type="datetime-local" value={due} onChange={(e) => onDueChange(e.target.value)} />
            </div>
          </Field>
          <Field label="Final deadline" error={errors.finalDeadline} htmlFor="task-deadline">
            <div className={`input${errors.finalDeadline ? ' invalid' : ''}`}>
              <CalendarClock size={15} />
              <input
                id="task-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  setDeadlineTouched(true);
                }}
              />
            </div>
          </Field>
        </div>

        <button type="button" className="disclosure" aria-expanded={open} aria-controls="task-more" onClick={() => setOpen(!open)}>
          <ChevronDown size={14} />
          More details
        </button>

        {open && (
          <div id="task-more" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="row">
              <Field label="Category" htmlFor="task-category">
                <div className="input">
                  <select id="task-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">None</option>
                    {allCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </Field>
              <Field label="Repeats" htmlFor="task-repeat">
                <div className="input">
                  <Repeat size={15} />
                  <select id="task-repeat" value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq | '')}>
                    <option value="">Does not repeat</option>
                    {FREQS.map((f) => (
                      <option key={f} value={f}>
                        {FREQ_LABEL[f]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </Field>
            </div>
            {freq && (
              <Field label="Repeat until (optional)" htmlFor="task-until" hint="Leave empty to keep repeating.">
                <div className="input">
                  <input id="task-until" type="date" value={until} min={due.slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
                </div>
              </Field>
            )}
            <Field label="Location" htmlFor="task-location">
              <div className="input">
                <MapPin size={15} />
                <input id="task-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where" maxLength={200} />
              </div>
            </Field>
            <Field label="Website link" error={errors.url} htmlFor="task-url">
              <div className={`input${errors.url ? ' invalid' : ''}`}>
                <Link size={15} />
                <input id="task-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="canvas.school.edu/courses/…" spellCheck={false} />
              </div>
            </Field>
            <Field label="Notes" htmlFor="task-notes">
              <div className="input">
                <textarea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
              </div>
            </Field>
          </div>
        )}
        {failure && (
          <div className="error" role="alert">
            {failure}
          </div>
        )}
      </form>
    </Modal>
  );
}
