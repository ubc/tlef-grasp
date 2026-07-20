import { useEffect, useId, useState } from "react";
import Modal from "../../components/ui/Modal";
import {
  TA_PERMISSIONS,
  TA_PERMISSION_PRESETS,
} from "../../lib/permissions";

const fullMap = (value) =>
  TA_PERMISSIONS.reduce((map, perm) => ({ ...map, [perm.key]: value }), {});

// Instructor-facing editor for one TA's per-course permission map. Presets
// fill the checkboxes; individual toggles fine-tune. Saving replaces the whole
// map via PUT /api/users/course/:courseId/ta-permissions.
export default function TaPermissionsModal({ open, ta, onClose, onSave, saving }) {
  const legendId = useId();
  // Effective map from the roster row; missing keys default to allowed.
  const [draft, setDraft] = useState(fullMap(true));

  useEffect(() => {
    if (open) {
      setDraft({ ...fullMap(true), ...(ta?.taPermissions || {}) });
    }
  }, [open, ta]);

  const matchesPreset = (preset) =>
    TA_PERMISSIONS.every((perm) => draft[perm.key] === preset.permissions[perm.key]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`TA Permissions — ${ta?.displayName || "TA"}`}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Choose what this TA can see and do in this course. Changes apply
        immediately. Course settings and user management actions always stay
        instructor-only.
      </p>

      <div className="mb-5" role="group" aria-label="Permission presets">
        <p className="mb-2 text-sm font-semibold text-ink">Presets</p>
        <div className="flex flex-wrap gap-2">
          {TA_PERMISSION_PRESETS.map((preset) => {
            const active = matchesPreset(preset);
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                title={preset.description}
                onClick={() => setDraft({ ...preset.permissions })}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-white"
                    : "border-gray-300 bg-white text-ink hover:bg-gray-50"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <fieldset>
        <legend id={legendId} className="mb-2 text-sm font-semibold text-ink">
          Individual permissions
        </legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {TA_PERMISSIONS.map((perm) => {
            const inputId = `ta-perm-${perm.key}`;
            return (
              <li
                key={perm.key}
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={draft[perm.key]}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [perm.key]: event.target.checked }))
                  }
                  className="mt-1 h-4 w-4 accent-primary"
                  aria-describedby={`${inputId}-desc`}
                />
                <label htmlFor={inputId} className="cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <i className={`fas ${perm.icon} w-4 text-center text-muted`} />
                    {perm.label}
                  </span>
                  <span id={`${inputId}-desc`} className="mt-0.5 block text-xs text-muted">
                    {perm.description}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </Modal>
  );
}
