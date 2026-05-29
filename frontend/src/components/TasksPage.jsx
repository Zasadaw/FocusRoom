import { useState } from "react";
import { api, formatDate } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

const statuses = [
  ["todo", "Новая"],
  ["in_progress", "В работе"],
  ["done", "Готово"]
];

export default function TasksPage({ tasks, refresh }) {
  const [form, setForm] = useState({ title: "", description: "" });
  const [error, setError] = useState("");

  const run = async (fn) => {
    setError("");
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const createTask = (event) => {
    event.preventDefault();
    run(async () => {
      await api("/api/tasks", { method: "POST", body: form });
      setForm({ title: "", description: "" });
      await refresh();
    });
  };

  const updateTask = (task, patch) => run(async () => {
    await api(`/api/tasks/${task.id}`, { method: "PATCH", body: patch });
    await refresh();
  });

  const deleteTask = (task) => run(async () => {
    await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    await refresh();
  });

  return (
    <section className="page-grid two">
      <div className="card">
        <h2>Новая задача</h2>
        <ErrorBox error={error} onClose={() => setError("")} />
        <form className="form" onSubmit={createTask}>
          <label><span>Название</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label><span>Описание</span><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <button className="primary-btn">Добавить</button>
        </form>
      </div>
      <div className="card">
        <h2>Мои задачи</h2>
        <div className="list">
          {tasks.map((task) => (
            <article className="list-row" key={task.id}>
              <div>
                <h3>{task.title}</h3>
                {task.description && <p>{task.description}</p>}
                <small>{formatDate(task.created_at)}</small>
              </div>
              <div className="row-actions">
                <select value={task.status} onChange={(e) => updateTask(task, { status: e.target.value })}>
                  {statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button className="danger-btn" onClick={() => deleteTask(task)}>Удалить</button>
              </div>
            </article>
          ))}
          {!tasks.length && <p className="muted">Задач пока нет.</p>}
        </div>
      </div>
    </section>
  );
}
