import { formatDate } from "../api.js";

export default function ProfilePage({ profile, sessions }) {
  const stats = profile?.stats || {};
  return (
    <section className="page-grid">
      <div className="stats-grid">
        <div className="stat-card"><span>Фокус-минут</span><strong>{stats.focus_minutes || 0}</strong></div>
        <div className="stat-card"><span>Сессий</span><strong>{stats.sessions_count || 0}</strong></div>
        <div className="stat-card"><span>Задач готово</span><strong>{stats.done_tasks || 0}</strong></div>
        <div className="stat-card"><span>Комнат</span><strong>{stats.rooms_joined || 0}</strong></div>
      </div>
      <div className="card">
        <h2>История сессий</h2>
        <div className="list">
          {sessions.map((item) => (
            <article className="list-row" key={item.id}>
              <div><h3>{item.session_type}</h3><p>{item.task_title || item.room_title || "Без привязки"}</p></div>
              <div><strong>{item.duration_minutes} мин</strong><small>{formatDate(item.started_at)}</small></div>
            </article>
          ))}
          {!sessions.length && <p className="muted">Истории пока нет.</p>}
        </div>
      </div>
    </section>
  );
}
