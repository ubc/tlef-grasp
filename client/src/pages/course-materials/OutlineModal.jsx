import Modal from "../../components/ui/Modal";
import { useMaterialOutline } from "../../hooks/useMaterials";

// Read the outline a material was summarized into. An outline is model output
// describing the material's current text, not a document — it cannot be edited,
// only regenerated. If a topic is wrong, fix the material and regenerate.
export default function OutlineModal({
  material,
  onClose,
  onGenerate,
  generating,
}) {
  const { outlineData, isPending, isError } = useMaterialOutline(
    material?.sourceId,
    true
  );

  const missing = isError || (!isPending && !outlineData);
  const topics = outlineData?.outline?.topics || [];

  return (
    <Modal
      open
      onClose={generating ? () => {} : onClose}
      title={`Outline — ${material?.documentTitle || "Untitled"}`}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={() => onGenerate(material.sourceId)}
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

      {!missing && !isPending && (
        <>
          <div className="space-y-4">
            {topics.map((topic, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-3">
                <h4 className="mb-2 font-semibold text-ink">{topic.title}</h4>
                <ul className="space-y-1">
                  {(topic.keyPoints || []).map((point, pointIndex) => (
                    <li key={pointIndex} className="flex gap-2 text-sm text-gray-600">
                      <span className="text-gray-400">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted">
            This outline describes the material's current content. Editing the
            material clears it; regenerate to summarize the new text.
          </p>

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
