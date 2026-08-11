import { useEffect, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useMaterialOutline } from "../../hooks/useMaterials";

// Read the outline a material was summarized into, and correct it. Editing is
// deterministic and free, where regenerating is neither — so an instructor who
// spots a wrong topic should fix it rather than reroll.
export default function OutlineModal({
  material,
  onClose,
  onGenerate,
  onSave,
  generating,
  saving,
}) {
  const { outlineData, isPending, isError } = useMaterialOutline(
    material?.sourceId,
    true
  );
  const [editing, setEditing] = useState(false);
  const [topics, setTopics] = useState([]);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTopics(outlineData?.outline?.topics || []);
    setEditing(false);
    setConfirmRegenerate(false);
    setConfirmClose(false);
    setDirty(false);
  }, [outlineData]);

  const missing = isError || (!isPending && !outlineData);
  const edited = outlineData?.source === "edited";
  const busy = saving || generating;

  const updateTopic = (index, patch) => {
    setDirty(true);
    setConfirmRegenerate(false);
    setConfirmClose(false);
    setTopics((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const requestRegenerate = () => {
    if ((edited || dirty) && !confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);
    onGenerate(material.sourceId);
  };

  const requestClose = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    setConfirmClose(false);
    onClose();
  };

  return (
    <Modal
      open
      onClose={generating || saving ? () => {} : requestClose}
      title={`Outline — ${material?.documentTitle || "Untitled"}`}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
          {!missing && !editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmRegenerate(false);
                setEditing(true);
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
            >
              <i className="fas fa-pen mr-2" /> Edit
            </button>
          )}
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave({ sourceId: material.sourceId, outline: { topics } })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={requestRegenerate}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {generating ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Generating...
              </>
            ) : (
              <>
                <i className="fas fa-magic" /> {missing ? "Generate outline" : "Regenerate"}
              </>
            )}
          </button>
        </>
      }
    >
      {isPending && (
        <p className="py-6 text-center text-muted">
          <i className="fas fa-spinner fa-spin mr-2" /> Loading outline...
        </p>
      )}

      {missing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">No outline yet</p>
          <p className="mt-1">
            Learning objectives for this material will be generated from a content
            search instead, which covers it less evenly. Generate an outline to
            improve them.
          </p>
        </div>
      )}

      {confirmRegenerate && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          This outline has changes that regenerating will discard. Press Regenerate again to continue.
        </div>
      )}

      {confirmClose && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          You have unsaved edits that closing will discard. Press Close again to continue.
        </div>
      )}

      {!missing && !isPending && (
        <>
          {edited && (
            <p className="mb-3 text-xs font-semibold text-primary">
              <i className="fas fa-pen mr-1" /> Edited by an instructor
            </p>
          )}
          {outlineData?.stale && (
            <p className="mb-3 text-xs text-muted">
              Generated with an earlier model or prompt — regenerate to refresh it.
            </p>
          )}

          <div className="space-y-4">
            {topics.map((topic, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-3">
                {editing ? (
                  <input
                    type="text"
                    value={topic.title}
                    onChange={(event) => updateTopic(index, { title: event.target.value })}
                    className="mb-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-semibold focus:border-primary focus:outline-none"
                  />
                ) : (
                  <h4 className="mb-2 font-semibold text-ink">{topic.title}</h4>
                )}

                {editing ? (
                  <textarea
                    rows={Math.max(2, (topic.keyPoints || []).length)}
                    value={(topic.keyPoints || []).join("\n")}
                    onChange={(event) =>
                      updateTopic(index, {
                        keyPoints: event.target.value.split("\n").filter((line) => line.trim()),
                      })
                    }
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                  />
                ) : (
                  <ul className="space-y-1">
                    {(topic.keyPoints || []).map((point, pointIndex) => (
                      <li key={pointIndex} className="flex gap-2 text-sm text-gray-600">
                        <span className="text-gray-400">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setDirty(true);
                      setConfirmRegenerate(false);
                      setConfirmClose(false);
                      setTopics((prev) => prev.filter((_, i) => i !== index));
                    }}
                    className="mt-2 text-xs text-danger underline"
                  >
                    Remove topic
                  </button>
                )}
              </div>
            ))}
          </div>

          {editing && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDirty(true);
                  setConfirmRegenerate(false);
                  setConfirmClose(false);
                  setTopics((prev) => [...prev, { title: "", keyPoints: [] }]);
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-primary bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
              >
                <i className="fas fa-plus" /> Add topic
              </button>
              <p className="mt-3 text-xs text-muted">
                One key point per line. Outlines describe the material's current
                content — editing the material itself clears this outline.
              </p>
            </>
          )}

          {outlineData?.outline?.notes && (
            <p className="mt-4 rounded-md bg-page p-3 text-xs text-muted">
              <span className="font-semibold">Notes:</span> {outlineData.outline.notes}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
