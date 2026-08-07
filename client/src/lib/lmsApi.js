import { ApiError } from "./api";

export async function parseLmsResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? response.json().catch(() => null)
    : response.text().catch(() => null);
}

export async function lmsRequest(path, options = {}) {
  const response = await fetch(path, options);
  const data = await parseLmsResponse(response);

  if (!response.ok) {
    if (response.status === 401 && data?.authenticated === false) {
      if (window.location.pathname !== "/") window.location.href = "/";
    }
    const message =
      (data && (data.error || data.message)) ||
      `LMS request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }
  return data;
}
