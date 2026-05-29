export const API_BASE = import.meta.env.VITE_API_BASE || window.__FOCUSROOM_API_BASE__ || "http://127.0.0.1:8000";

function errorText(data, fallback) {
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail)) return data.detail.map((item) => item.msg || JSON.stringify(item)).join("; ");
  if (typeof data?.message === "string") return data.message;
  return fallback || "Ошибка запроса";
}

export async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: {},
    credentials: "include"
  };
  if (options.body !== undefined) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API_BASE}${path}`, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(data, `Ошибка ${response.status}`));
  return data;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}
