export const API_BASE = import.meta.env.VITE_API_BASE || window.__FOCUSROOM_API_BASE__ || "http://127.0.0.1:8000";
export const WS_BASE = import.meta.env.VITE_WS_BASE || window.__FOCUSROOM_WS_BASE__ || "";

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

  if (options.body instanceof FormData) {
    config.body = options.body;
  } else if (options.body !== undefined) {
    config.headers["Content-Type"] = "application/json";
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE}${path}`, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(errorText(data, `Ошибка ${response.status}`));
  }
  return data;
}

export function buildWsUrl(path) {
  if (WS_BASE) return `${WS_BASE}${path}`;
  const apiUrl = new URL(API_BASE, window.location.href);
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  apiUrl.pathname = path;
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString();
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

export function formatSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

export function bytesToSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

export function resolveUrl(path) {
  if (!path) return "#";
  return `${API_BASE}${path}`;
}
