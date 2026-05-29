import { useState } from "react";
import { api, formatDate } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

const statuses = ["new", "in_progress", "done", "closed"];

export default function FeedbackView({ feedback, refresh }) {
  const [error, setError] = useState("");

  const run = async (fn) => {
    setError("");
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const updateStatus = (item, status) => run(async () => {
    await api(`/api/admin/feedback/${item.id}`, { method: "PATCH", body: { status } });
    await refresh();
  });

  const deleteItem = (item) => run(async () => {
    await api(`/api/admin/feedback/${item.id}`, { method: "DELETE" });
    await refresh();
  });

  return (
    <section className="page-grid">
      <div className="card">
        <h2>Обратная связь</h2>
        <ErrorBox error={error} onClose={() => setError("")} />
        <div className="feedback-grid">
          {feedback.map((item) => (
            <article className="feedback-card" key={item.id}>
              <div className="feedback-head"><span className={`badge ${item.type}`}>{item.type === "password_reset" ? "пароль" : "отклик"}</span><small>{formatDate(item.created_at)}</small></div>
              <h3>{item.subject}</h3>
              <p>{item.message}</p>
              <div className="meta-line"><span>{item.name || "Без имени"}</span><span>{item.email || "email не указан"}</span></div>
              <div className="row-actions">
                <select value={item.status} onChange={(e) => updateStatus(item, e.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>
                <button className="danger-btn" onClick={() => deleteItem(item)}>Удалить</button>
              </div>
            </article>
          ))}
          {!feedback.length && <p>Сообщений пока нет.</p>}
        </div>
      </div>
    </section>
  );
}
