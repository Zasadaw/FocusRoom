import { useEffect, useMemo, useState } from "react";
import { api, formatSeconds } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function TimerPage({ tasks, rooms, profile, refresh }) {
  const active = profile?.active_session;
  const [form, setForm] = useState({ duration_minutes: 25, task_id: "", room_id: "", session_type: "focus" });
  const [error, setError] = useState("");
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = useMemo(() => {
    if (!active) return Number(form.duration_minutes || 25) * 60;
    const end = new Date(active.started_at).getTime() + active.duration_minutes * 60 * 1000;
    return Math.max(0, Math.floor((end - tick) / 1000));
  }, [active, form.duration_minutes, tick]);

  const run = async (fn) => {
    setError("");
    try { await fn(); } catch (err) { setError(err.message); }
  };

  const start = (event) => {
    event.preventDefault();
    run(async () => {
      await api("/api/sessions/start", {
        method: "POST",
        body: {
          ...form,
          task_id: form.task_id ? Number(form.task_id) : null,
          room_id: form.room_id ? Number(form.room_id) : null,
          duration_minutes: Number(form.duration_minutes),
        },
      });
      await refresh();
    });
  };

  const finish = (complete) => run(async () => {
    await api("/api/sessions/finish", { method: "POST", body: { session_id: active.id, is_completed: complete } });
    await refresh();
  });

  return (
    <section className="card narrow timer-card">
      <h2>Личный таймер</h2>
      <div className="timer-face">{formatSeconds(remaining)}</div>
      <ErrorBox error={error} onClose={() => setError("")} />
      {active ? (
        <div className="row-actions center">
          <button className="primary-btn" onClick={() => finish(true)}>Завершить</button>
          <button className="secondary-btn" onClick={() => finish(false)}>Остановить</button>
        </div>
      ) : (
        <form className="form" onSubmit={start}>
          <label><span>Минуты</span><input type="number" min="1" max="300" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></label>
          <label><span>Тип</span><select value={form.session_type} onChange={(e) => setForm({ ...form, session_type: e.target.value })}><option value="focus">Фокус</option><option value="short_break">Короткий перерыв</option><option value="long_break">Длинный перерыв</option></select></label>
          <label><span>Задача</span><select value={form.task_id} onChange={(e) => setForm({ ...form, task_id: e.target.value })}><option value="">Без задачи</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
          <label><span>Комната</span><select value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}><option value="">Без комнаты</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.title}</option>)}</select></label>
          <button className="primary-btn">Старт</button>
        </form>
      )}
    </section>
  );
}
