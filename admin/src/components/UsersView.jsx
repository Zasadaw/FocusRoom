import { useState } from "react";
import { api, formatDate } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function UsersView({ users, refresh }) {
  const [error, setError] = useState("");
  const [createForm, setCreateForm] = useState({ username: "", email: "", password: "" });
  const [edits, setEdits] = useState({});

  const run = async (fn) => {
    setError("");
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const createUser = (event) => {
    event.preventDefault();
    run(async () => {
      await api("/api/admin/users", { method: "POST", body: createForm });
      setCreateForm({ username: "", email: "", password: "" });
      await refresh();
    });
  };

  const editValue = (user, key, fallback) => edits[user.id]?.[key] ?? fallback;
  const setEdit = (user, key, value) => setEdits((prev) => ({ ...prev, [user.id]: { ...(prev[user.id] || {}), [key]: value } }));

  const saveUser = (user) => run(async () => {
    const patch = edits[user.id] || {};
    await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: patch });
    setEdits((prev) => ({ ...prev, [user.id]: {} }));
    await refresh();
  });

  const deleteUser = (user) => run(async () => {
    if (!confirm(`Удалить пользователя ${user.username}?`)) return;
    await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
    await refresh();
  });

  return (
    <section className="page-grid">
      <div className="card">
        <h2>Создать пользователя</h2>
        <ErrorBox error={error} onClose={() => setError("")} />
        <form className="inline-form" onSubmit={createUser}>
          <input placeholder="Логин" value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} required />
          <input placeholder="Email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} required />
          <input placeholder="Пароль" type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} required />
          <button className="primary-btn">Создать</button>
        </form>
      </div>

      <div className="card table-card">
        <h2>Пользователи</h2>
        <div className="responsive-table">
          <table>
            <thead><tr><th>ID</th><th>Логин</th><th>Email</th><th>Пароль</th><th>Блокировка</th><th>Создан</th><th></th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td><input value={editValue(user, "username", user.username)} onChange={(e) => setEdit(user, "username", e.target.value)} /></td>
                  <td><input type="email" value={editValue(user, "email", user.email)} onChange={(e) => setEdit(user, "email", e.target.value)} /></td>
                  <td><input type="password" placeholder="Новый пароль" value={editValue(user, "password", "")} onChange={(e) => setEdit(user, "password", e.target.value)} /></td>
                  <td><label className="switch-row"><input type="checkbox" checked={Boolean(editValue(user, "is_blocked", user.is_blocked))} onChange={(e) => setEdit(user, "is_blocked", e.target.checked)} /> заблокирован</label></td>
                  <td>{formatDate(user.created_at)}</td>
                  <td className="actions-cell"><button className="primary-btn" onClick={() => saveUser(user)}>Сохранить</button><button className="danger-btn" onClick={() => deleteUser(user)}>Удалить</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
