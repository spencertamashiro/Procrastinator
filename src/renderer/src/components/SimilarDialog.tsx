// Confirmation for "Delete all like this": shows what matches before anything is removed.

import type { PlannerItem } from '../../../shared/items';
import type { SimilarPreview } from '../../../shared/types';
import { Modal } from '../ui/controls';

export function SimilarDialog({
  item,
  preview,
  onConfirm,
  onClose,
}: {
  item: PlannerItem;
  preview: SimilarPreview;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const local = item.kind === 'task';
  const noun = item.kind === 'event' ? 'events' : item.kind === 'assignment' ? 'assignments' : 'tasks';
  const scope = preview.rule.scope ? ` in ${preview.rule.scope}` : '';
  const footer = (
    <div className="panel-foot">
      <div className="actions">
        <button type="button" className="pill ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="pill danger" onClick={onConfirm} disabled={preview.total === 0}>
          Delete {preview.total}
        </button>
      </div>
    </div>
  );
  return (
    <Modal title="Delete all like this?" className="dialog" onClose={onClose} footer={footer} initialFocus=".pill.ghost">
      <div className="panel-body">
        <p style={{ margin: 0 }}>
          {preview.total === 1
            ? `Only “${item.title}” matches.`
            : `${preview.total} ${noun}${scope} have the same or a near-identical name as “${item.title}”.`}
        </p>
        <div className="similar-list" role="list">
          {preview.matches.map((m) => (
            <div key={m.key} role="listitem">
              <span>{m.title}</span>
              <span className="when">{m.when}</span>
            </div>
          ))}
          {preview.total > preview.matches.length && <div className="t3">and {preview.total - preview.matches.length} more</div>}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {local
            ? 'Tasks you added are removed for good.'
            : `They are hidden here, and matching ones that arrive in later syncs stay hidden too. Nothing changes in ${
                item.kind === 'assignment' ? 'Canvas' : 'your calendar'
              }. You can bring them back from Settings → Data & storage.`}
        </p>
      </div>
    </Modal>
  );
}
