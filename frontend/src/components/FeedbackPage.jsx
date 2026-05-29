import { useState } from "react";
import { api } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function FeedbackPage() {
  const [form, setForm] = useState({ subject: "", message: "" });
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSent("");
    try {
      const data = await api("/api/feedback", { method: "POST", body: form });
      setSent(data.message || "Отправлено");
      setForm({ subject: "", message: "" });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card narrow">
      <h2>Обратная связь</h2>
      <p className="muted">Сообщение появится в админ-панели в разделе «Обратная связь».</p>
      <ErrorBox error={error} onClose={() => setError("")} />
      {sent && <div className="success-box">{sent}</div>}
      <form className="form" onSubmit={submit}>
        <label><span>Тема</span><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required /></label>
        <label><span>Сообщение</span><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required /></label>
        <button className="primary-btn">Отправить</button>
      </form>
    </section>
  );
}
