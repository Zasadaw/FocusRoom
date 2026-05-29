import { Stat } from "./Ui.jsx";

export default function Dashboard({ stats }) {
  return (
    <section className="page-grid">
      <div className="stats-grid">
        <Stat label="Пользователи" value={stats.users || 0} />
        <Stat label="Комнаты" value={stats.rooms || 0} />
        <Stat label="Новые отклики" value={stats.feedback_new || 0} />
        <Stat label="Сессии" value={stats.sessions || 0} />
      </div>
      <div className="card">
        <h2>Управление</h2>
        <p>Верхнее меню закреплено и уменьшается при прокрутке. Переключайтесь между пользователями, комнатами и обратной связью.</p>
      </div>
    </section>
  );
}
