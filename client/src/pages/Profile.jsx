import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../components/ui/Toast";

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function getInitials(name = "") {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "U";
}

function formatRole(role) {
  if (!role) return "—";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function Profile() {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading } = useCurrentUser();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || "");
    setEmail(user.email || "");
  }, [user]);

  const initials = useMemo(() => getInitials(displayName || user?.email), [displayName, user?.email]);

  const updateMutation = useMutation({
    mutationFn: (profile) => api.put("/api/profile", profile),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.currentUser, data);
      showToast("Profile updated successfully", "success");
    },
    onError: (error) => {
      showToast(error.message || "Failed to update profile", "error");
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    updateMutation.mutate({ displayName, email });
  };

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted">
        <i className="fas fa-spinner fa-spin mr-3 text-xl text-primary" />
        Loading profile...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-6">
        <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-primary">
          Account
        </p>
        <h1 className="text-2xl font-bold text-ink">Your profile</h1>
        <p className="mt-1 text-sm text-muted">
          Update the personal information displayed throughout GRASP.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Personal information</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            These changes apply only to your GRASP profile. Your UBC account credentials
            and permissions are managed by IAM.
          </p>

          <div className="space-y-5">
            <div>
              <label htmlFor="profile-display-name" className="mb-2 block text-sm font-semibold text-ink">
                Display name
              </label>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={100}
                autoComplete="name"
                className={inputClass}
                required
              />
              <p className="mt-1 text-xs text-muted">This is the name other GRASP users will see.</p>
            </div>

            <div>
              <label htmlFor="profile-email" className="mb-2 block text-sm font-semibold text-ink">
                Email address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                autoComplete="email"
                className={inputClass}
                required
              />
              <p className="mt-1 text-xs text-muted">Used for your GRASP profile and notifications.</p>
            </div>
          </div>

          <div className="mt-7 flex justify-end border-t border-gray-100 pt-5">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {updateMutation.isPending ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Saving...
                </>
              ) : (
                <>
                  <i className="fas fa-save" /> Save profile
                </>
              )}
            </button>
          </div>
        </form>

        <aside className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div
              aria-hidden="true"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white shadow-sm"
            >
              {initials}
            </div>
            <h2 className="mt-4 break-words text-lg font-semibold text-ink">
              {displayName || "Your profile"}
            </h2>
            <p className="mt-1 break-all text-sm text-muted">{email}</p>
          </div>

          <dl className="mt-6 space-y-4 border-t border-gray-100 pt-5 text-sm">
            <div>
              <dt className="font-semibold text-ink">Role</dt>
              <dd className="mt-1 text-muted">{formatRole(user.role)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">UBC identifier</dt>
              <dd className="mt-1 break-all font-mono text-xs text-muted">{user.puid || "—"}</dd>
            </div>
          </dl>

          <p className="mt-5 flex items-start gap-2 text-xs text-muted">
            <i className="fas fa-lock mt-0.5 text-primary" />
            Role and identity details are managed by UBC IAM.
          </p>
        </aside>
      </div>
    </div>
  );
}
