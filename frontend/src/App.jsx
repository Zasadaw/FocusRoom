import { useEffect, useState } from "react";
import { api } from "./api.js";
import Landing from "./components/Landing.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import Layout from "./components/Layout.jsx";
import RoomsPage from "./components/RoomsPage.jsx";
import TasksPage from "./components/TasksPage.jsx";
import TimerPage from "./components/TimerPage.jsx";
import ProfilePage from "./components/ProfilePage.jsx";
import FeedbackPage from "./components/FeedbackPage.jsx";
import TutorialPage from "./components/TutorialPage.jsx";
import { Toast } from "./components/Ui.jsx";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [showAuth, setShowAuth] = useState(() => localStorage.getItem("focusroom-seen-preview") === "yes");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("rooms");
  const [toast, setToast] = useState("");
  const [data, setData] = useState({ rooms: [], tasks: [], sessions: [], profile: { stats: {}, active_session: null } });

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2600);
  };

  const loadData = async () => {
    const [rooms, tasks, sessions, profile] = await Promise.all([
      api("/api/rooms"),
      api("/api/tasks"),
      api("/api/sessions/history"),
      api("/api/profile"),
    ]);
    setData({ rooms: rooms.rooms || [], tasks: tasks.tasks || [], sessions: sessions.sessions || [], profile });
  };

  useEffect(() => {
    const init = async () => {
      try {
        const me = await api("/api/auth/me");
        setUser(me.user);
        await loadData();
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    };
    init();
  }, []);

  const onStart = () => {
    localStorage.setItem("focusroom-seen-preview", "yes");
    setShowAuth(true);
  };

  const onAuthSuccess = async (nextUser) => {
    setUser(nextUser);
    await loadData();
    setActiveTab("rooms");
    showToast("Готово");
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setData({ rooms: [], tasks: [], sessions: [], profile: { stats: {}, active_session: null } });
  };

  if (booting) return <div className="boot-screen">Загрузка…</div>;
  if (!user && !showAuth) return <Landing onStart={onStart} />;
  if (!user) return <AuthPanel onSuccess={onAuthSuccess} />;

  return (
    <>
      <Layout user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={logout}>
        {activeTab === "rooms" && <RoomsPage rooms={data.rooms} refresh={loadData} user={user} />}
        {activeTab === "tasks" && <TasksPage tasks={data.tasks} refresh={loadData} />}
        {activeTab === "timer" && <TimerPage tasks={data.tasks} rooms={data.rooms} profile={data.profile} refresh={loadData} />}
        {activeTab === "profile" && <ProfilePage profile={data.profile} sessions={data.sessions} />}
        {activeTab === "tutorial" && <TutorialPage />}
        {activeTab === "feedback" && <FeedbackPage />}
      </Layout>
      <Toast message={toast} />
    </>
  );
}
