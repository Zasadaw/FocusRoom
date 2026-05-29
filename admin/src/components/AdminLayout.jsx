import { useEffect, useState } from "react";

const tabs = [
  ["dashboard", "Главная"],
  ["users", "Пользователи"],
  ["rooms", "Комнаты"],
  ["feedback", "Обратная связь"]
];

export default function AdminLayout({ admin, activeTab, setActiveTab, onLogout, children }) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const handler = () => setCompact(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="admin-shell">
      <header className={`admin-top glass ${compact ? "compact" : ""}`}>
        <div className="brand-row">
          <div className="logo-mark">FR</div>
          <div><strong>Админ-панель</strong><span>{admin.login}</span></div>
        </div>
        <nav className="top-tabs">
          {tabs.map(([key, label]) => <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}
        </nav>
        <button className="secondary-btn" onClick={onLogout}>Выйти</button>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
