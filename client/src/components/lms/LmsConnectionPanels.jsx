import { useState } from "react";
import {
  useDisconnectCanvas,
} from "../../hooks/useCanvasIntegration";
import {
  useConnectMoodle,
  useDisconnectMoodle,
} from "../../hooks/useMoodleIntegration";
import { useToast } from "../ui/Toast";

const secondaryBtnClass =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";

export function CanvasConnectionPanel({ status, returnState }) {
  const showToast = useToast();
  const disconnectMutation = useDisconnectCanvas({
    onSuccess: () => showToast("Canvas disconnected", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to disconnect Canvas", "error"),
  });

  return (
    <ConnectionShell
      title="Canvas connection"
      description="Connect your own UBC Canvas account. GRASP stores this connection per instructor and never shares your Canvas credentials with another user. After connecting, link each section you manage from My Sections."
      connected={status.connected}
    >
      {returnState === "error" ? (
        <ErrorBox message="Canvas could not complete the connection. Please try again or confirm that the configured callback URI matches the Canvas Developer Key." />
      ) : null}

      {status.isError ? (
        <ErrorBox
          message={status.error?.message || "Canvas connection status is unavailable."}
        />
      ) : status.isPending ? (
        <LoadingLine label="Checking Canvas connection…" />
      ) : status.connected ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {status.canvasDomain ? (
            <span className="text-sm text-muted">
              Connected to {status.canvasDomain}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className={`${secondaryBtnClass} border-danger/40 text-danger hover:bg-danger/5`}
          >
            {disconnectMutation.isPending ? (
              <><i className="fas fa-spinner fa-spin" /> Disconnecting…</>
            ) : (
              <><i className="fas fa-unlink" /> Disconnect Canvas</>
            )}
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <a
            href={`/api/lms/canvas/auth/login?returnTo=${encodeURIComponent("/settings?canvas=connected")}`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-link" /> Connect Canvas
          </a>
        </div>
      )}
    </ConnectionShell>
  );
}

export function MoodleConnectionPanel({ status }) {
  const showToast = useToast();
  const [token, setToken] = useState("");
  const connectMutation = useConnectMoodle({
    onSuccess: (data) => {
      setToken("");
      showToast(
        data?.sitename ? `Connected to ${data.sitename}` : "Moodle connected",
        "success"
      );
    },
    onError: (error) =>
      showToast(error.message || "Failed to connect Moodle", "error"),
  });
  const disconnectMutation = useDisconnectMoodle({
    onSuccess: () => showToast("Moodle disconnected", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to disconnect Moodle", "error"),
  });

  const submitToken = (event) => {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (trimmedToken) connectMutation.mutate(trimmedToken);
  };

  return (
    <ConnectionShell
      title="Moodle connection"
      description="Connect your own Moodle account using a personal web-service token. GRASP stores the token per instructor. After connecting, link each section you manage to a Moodle course and group from My Sections."
      connected={status.connected}
    >
      {status.isError ? (
        <ErrorBox
          message={status.error?.message || "Moodle connection status is unavailable."}
        />
      ) : status.isPending ? (
        <LoadingLine label="Checking Moodle connection…" />
      ) : status.connected ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {status.moodleDomain ? (
              <span className="text-sm text-muted">
                Connected to {status.moodleDomain}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className={`${secondaryBtnClass} border-danger/40 text-danger hover:bg-danger/5`}
            >
              {disconnectMutation.isPending ? (
                <><i className="fas fa-spinner fa-spin" /> Disconnecting…</>
              ) : (
                <><i className="fas fa-unlink" /> Disconnect Moodle</>
              )}
            </button>
          </div>
          <p className="text-xs text-muted">
            Disconnecting removes the token from GRASP. Revoke it separately in
            Moodle if you also want to invalidate it on the Moodle server.
          </p>
        </div>
      ) : (
        <form onSubmit={submitToken} className="mt-5 max-w-xl space-y-3">
          <div>
            <label
              htmlFor="moodle-web-service-token"
              className="mb-1.5 block text-sm font-semibold text-ink"
            >
              Moodle web-service token
            </label>
            <input
              id="moodle-web-service-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              placeholder="Paste your Moodle token"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-ink focus:border-primary focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-muted">
              Generate this from Moodle’s Security keys page. Submit it only over
              HTTPS outside local development.
            </p>
          </div>
          <button
            type="submit"
            disabled={!token.trim() || connectMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {connectMutation.isPending ? (
              <><i className="fas fa-spinner fa-spin" /> Connecting…</>
            ) : (
              <><i className="fas fa-link" /> Connect Moodle</>
            )}
          </button>
          {connectMutation.isError ? (
            <ErrorBox message={connectMutation.error?.message} />
          ) : null}
        </form>
      )}
    </ConnectionShell>
  );
}

function ConnectionShell({ title, description, connected, children }) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        {connected ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
            <i className="fas fa-check-circle" /> Connected
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
      {message}
    </div>
  );
}

function LoadingLine({ label }) {
  return (
    <p className="mt-5 text-sm text-muted">
      <i className="fas fa-spinner fa-spin mr-2" /> {label}
    </p>
  );
}
