export function ErrorBox({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <strong>Ошибка:</strong>
      <span>{error}</span>
      {onClose && <button className="icon-btn" onClick={onClose} type="button">×</button>}
    </div>
  );
}

export function Toast({ message }) {
  return <div className={`toast ${message ? "show" : ""}`}>{message}</div>;
}

export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <div className="logo-mark large">FR</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

export function Pill({ children }) {
  return <span className="pill">{children}</span>;
}
