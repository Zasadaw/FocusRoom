import { useState } from "react";
import { api } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function AdminLogin({ onLogin }) {
  const [form, setForm] = useState({ login: "root", password: "root" });
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/admin/login", { method: "POST", body: form });
      onLogin(data.admin);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card glass">
        <div className="logo-mark">FR</div>
        <p className="eyebrow">FocusRoom Admin</p>
        <h1>Админ-панель</h1>
        <ErrorBox error={error} onClose={() => setError("")} />
        <form className="form" onSubmit={submit}>
          <label><span>Логин</span><input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required /></label>
          <label><span>Пароль</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
          <button className="primary-btn">Войти</button>
        </form>
      </section>
    </main>
  );
}
