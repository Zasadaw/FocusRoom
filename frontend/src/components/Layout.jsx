const tabs = [
  ["rooms", "Комнаты"],
  ["tasks", "Задачи"],
  ["timer", "Таймер"],
  ["profile", "Профиль"],
  ["tutorial", "Обучение"],
  ["feedback", "Обратная связь"]
];

export default function Layout({ user, activeTab, setActiveTab, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar glass">
        <div className="brand-row">
          <div className="logo-mark">FR</div>
          <div><strong>FocusRoom</strong><span>{user.username}</span></div>
        </div>
        <nav className="nav-list">
          {tabs.map(([key, label]) => (
            <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </nav>
        <button className="secondary-btn" onClick={onLogout}>Выйти</button>
      </aside>
      <main className="main-area">{children}</main>
    </div>
  );
}
