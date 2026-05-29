import { useEffect, useState } from "react";
import { api } from "./api.js";
import AdminLogin from "./components/AdminLogin.jsx";
import AdminLayout from "./components/AdminLayout.jsx";
import Dashboard from "./components/Dashboard.jsx";
import UsersView from "./components/UsersView.jsx";
import RoomsView from "./components/RoomsView.jsx";
import FeedbackView from "./components/FeedbackView.jsx";

export default function AdminApp() {
  const [booting, setBooting] = useState(true);
  const [admin, setAdmin] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [data, setData] = useState({ stats: {}, users: [], rooms: [], feedback: [] });

  const loadData = async () => {
    const [stats, users, rooms, feedback] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/rooms"),
      api("/api/admin/feedback"),
    ]);
    setData({ stats, users: users.users || [], rooms: rooms.rooms || [], feedback: feedback.feedback || [] });
  };

  useEffect(() => {
    const init = async () => {
      try {
        const me = await api("/api/admin/me");
        setAdmin(me.admin);
        await loadData();
      } catch {
        setAdmin(null);
      } finally {
        setBooting(false);
      }
    };
    init();
  }, []);

  const onLogin = async (nextAdmin) => {
    setAdmin(nextAdmin);
    await loadData();
  };

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    setAdmin(null);
  };

  if (booting) return <div className="boot-screen">Загрузка…</div>;
  if (!admin) return <AdminLogin onLogin={onLogin} />;

  return (
    <AdminLayout admin={admin} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={logout}>
      {activeTab === "dashboard" && <Dashboard stats={data.stats} />}
      {activeTab === "users" && <UsersView users={data.users} refresh={loadData} />}
      {activeTab === "rooms" && <RoomsView rooms={data.rooms} refresh={loadData} />}
      {activeTab === "feedback" && <FeedbackView feedback={data.feedback} refresh={loadData} />}
    </AdminLayout>
  );
}
