import { getMaterialTypeMeta } from "../../lib/materials";
import { formatFileSize } from "../../lib/format";

export default function MaterialCard({ material, onEdit, onRefetch, onDelete }) {
  const fileType = material.fileType || "";
  const meta = getMaterialTypeMeta(fileType);
  const isText = fileType.includes("text");
  const isPdf = fileType.includes("pdf");
  const isLink = fileType === "link";
  const editKind = isText ? "text-edit" : isPdf ? "pdf-edit" : "link-edit";

  return (
    <div className="flex flex-col rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${meta.badgeClasses}`}
        >
          <i className={`fas ${meta.icon} text-xl`} />
        </div>
        <div className="min-w-0">
          <h3
            className="truncate font-semibold text-ink"
            title={material.documentTitle || "Untitled"}
          >
            {material.documentTitle || "Untitled"}
          </h3>
          <p className="text-sm text-muted">{meta.label}</p>
          <p className="text-xs text-muted">Size: {formatFileSize(material.fileSize)}</p>
          <p className="text-xs text-muted">
            Uploaded on {new Date(material.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {material.sourceId && (
        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
          <div className="flex gap-2">
            {(isText || isPdf || isLink) && (
              <button
                type="button"
                onClick={() => onEdit(editKind, material)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
              >
                Edit
              </button>
            )}
            {isLink && (
              <button
                type="button"
                title="Refetch content"
                onClick={() => onRefetch(material)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-gray-50"
              >
                <i className="fas fa-sync-alt" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDelete(material)}
            className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
