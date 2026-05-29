export function ErrorBox({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <strong>Ошибка:</strong><span>{error}</span>
      {onClose && <button onClick={onClose} className="icon-btn">×</button>}
    </div>
  );
}

export function Stat({ label, value }) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong></div>;
}
