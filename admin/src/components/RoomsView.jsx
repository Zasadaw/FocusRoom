import { useState } from "react";
import { api, formatDate } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function RoomsView({ rooms, refresh }) {
  const [error, setError] = useState("");

  const deleteRoom = async (room) => {
    setError("");
    try {
      if (!confirm(`Удалить комнату ${room.title}?`)) return;
      await api(`/api/admin/rooms/${room.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="card table-card">
      <h2>Комнаты</h2>
      <ErrorBox error={error} onClose={() => setError("")} />
      <div className="responsive-table">
        <table>
          <thead><tr><th>ID</th><th>Название</th><th>Код</th><th>Владелец</th><th>Участников</th><th>Создана</th><th></th></tr></thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td>{room.id}</td>
                <td>{room.title}</td>
                <td>{room.invite_code}</td>
                <td>{room.owner || "—"}</td>
                <td>{room.members_count}</td>
                <td>{formatDate(room.created_at)}</td>
                <td><button className="danger-btn" onClick={() => deleteRoom(room)}>Удалить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
