import { useEffect, useMemo, useRef, useState } from "react";
import { api, buildWsUrl, bytesToSize, formatDate, formatSeconds, resolveUrl } from "../api.js";
import { EmptyState, ErrorBox } from "./Ui.jsx";

const roleLabels = { owner: "владелец", admin: "админ", member: "участник" };

function VideoTile({ label, stream, muted = false, soundOff = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream || null;
    videoRef.current.muted = muted || soundOff;
  }, [stream, muted, soundOff]);

  return (
    <div className="video-tile">
      <video ref={videoRef} autoPlay playsInline muted={muted || soundOff} />
      <span>{label}</span>
    </div>
  );
}

export default function RoomsPage({ rooms, refresh, user }) {
  const [error, setError] = useState("");
  const [currentRoom, setCurrentRoom] = useState(null);
  const [createForm, setCreateForm] = useState({ title: "", logo_text: "FR", open_minutes: 25, password: "", is_private: true });
  const [joinForm, setJoinForm] = useState({ invite_code: "", password: "" });
  const [settings, setSettings] = useState({ title: "", logo_text: "FR", open_minutes: 25, password: "", clear_password: false });
  const [messageText, setMessageText] = useState("");
  const [tick, setTick] = useState(Date.now());

  const [socketStatus, setSocketStatus] = useState("offline");
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [callParticipants, setCallParticipants] = useState([]);
  const [devices, setDevices] = useState({ audioInputs: [], videoInputs: [] });
  const [selectedDevices, setSelectedDevices] = useState({ audioInputId: "", videoInputId: "" });
  const [callState, setCallState] = useState({ inCall: false, muted: false, cameraOff: false, soundOff: false });
  const [localVideoStream, setLocalVideoStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);

  const wsRef = useRef(null);
  const currentRoomRef = useRef(null);
  const userRef = useRef(user);
  const callStateRef = useRef(callState);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const activityRef = useRef(0);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
    setOnlineUserIds(currentRoom?.online_user_ids || []);
    setCallParticipants(currentRoom?.call_participants || []);
  }, [currentRoom]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentRoom?.room) return;
    setSettings({
      title: currentRoom.room.title || "",
      logo_text: currentRoom.room.logo_text || "FR",
      open_minutes: currentRoom.room.open_minutes || 25,
      password: "",
      clear_password: false,
    });
  }, [currentRoom?.room?.id]);

  useEffect(() => {
    const roomId = currentRoom?.room?.id;
    if (!roomId) {
      cleanupSocket();
      leaveCall(false);
      return;
    }
    connectRoomSocket(roomId);
    return () => {
      cleanupSocket();
      leaveCall(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoom?.room?.id]);

  useEffect(() => {
    if (!currentRoom?.room?.id) return;
    const ping = setInterval(() => sendWs({ type: "heartbeat" }), 25000);
    return () => clearInterval(ping);
  }, [currentRoom?.room?.id]);

  useEffect(() => {
    refreshMediaDevices().catch(() => {});
    if (!navigator.mediaDevices?.addEventListener) return;
    const handler = () => refreshMediaDevices().catch(() => {});
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, []);

  const roomTimerRemaining = useMemo(() => {
    const timer = currentRoom?.room_timer;
    if (!timer?.is_running || !timer?.ends_at) return (timer?.duration_minutes || currentRoom?.room?.open_minutes || 25) * 60;
    return Math.max(0, Math.floor((new Date(timer.ends_at).getTime() - tick) / 1000));
  }, [currentRoom, tick]);

  const run = async (fn) => {
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Неизвестная ошибка");
    }
  };

  async function loadRoom(id) {
    const data = await api(`/api/rooms/${id}`);
    setCurrentRoom(data);
  }

  async function reloadAll(roomId = currentRoomRef.current?.room?.id) {
    await refresh();
    if (roomId) await loadRoom(roomId);
  }

  function updateCurrentRoom(updater) {
    setCurrentRoom((prev) => {
      if (!prev) return prev;
      return updater(prev);
    });
  }

  function addMessage(message) {
    if (!message?.id) return;
    updateCurrentRoom((prev) => {
      if ((prev.messages || []).some((item) => item.id === message.id)) return prev;
      return { ...prev, messages: [...(prev.messages || []), message] };
    });
  }

  function cleanupSocket() {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
    }
    wsRef.current = null;
    setSocketStatus("offline");
  }

  function sendWs(payload) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(payload));
    return true;
  }

  async function connectRoomSocket(roomId) {
    cleanupSocket();
    setSocketStatus("connecting");
    const tokenData = await api("/api/ws-token");
    const socket = new WebSocket(buildWsUrl(`/ws/rooms/${roomId}?token=${encodeURIComponent(tokenData.token)}`));
    wsRef.current = socket;

    socket.onopen = () => {
      setSocketStatus("online");
      sendWs({ type: "heartbeat" });
    };

    socket.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        await handleWsMessage(payload);
      } catch {
        // ignore broken realtime event
      }
    };

    socket.onclose = () => {
      if (wsRef.current === socket) {
        wsRef.current = null;
        setSocketStatus("offline");
      }
    };

    socket.onerror = () => setSocketStatus("offline");
  }

  async function handleWsMessage(data) {
    if (!currentRoomRef.current) return;
    switch (data.type) {
      case "presence":
        setOnlineUserIds(data.online_user_ids || []);
        setCallParticipants(data.call_participants || []);
        break;
      case "chat_message":
        addMessage(data.message);
        break;
      case "file_uploaded":
        updateCurrentRoom((prev) => {
          if ((prev.files || []).some((item) => item.id === data.file?.id)) return prev;
          return { ...prev, files: [data.file, ...(prev.files || [])] };
        });
        break;
      case "file_deleted":
        updateCurrentRoom((prev) => ({ ...prev, files: (prev.files || []).filter((item) => item.id !== data.file_id) }));
        break;
      case "room_timer_updated":
        updateCurrentRoom((prev) => ({
          ...prev,
          room_timer: data.room_timer,
          messages: data.message && !(prev.messages || []).some((item) => item.id === data.message.id)
            ? [...(prev.messages || []), data.message]
            : prev.messages,
        }));
        break;
      case "room_updated":
      case "member_role_changed":
      case "member_removed":
      case "member_left":
        await reloadAll(currentRoomRef.current.room.id);
        break;
      case "room_deleted":
        setCurrentRoom(null);
        await refresh();
        break;
      case "call_join":
        setCallParticipants(data.call_participants || []);
        if (callStateRef.current.inCall && data.user_id !== userRef.current?.id) {
          await createPeerConnection(data.user_id, true);
        }
        break;
      case "call_leave":
        setCallParticipants(data.call_participants || []);
        removePeerConnection(data.user_id);
        break;
      case "signal":
        await handleSignal(data.from_user_id, data.data);
        break;
      default:
        break;
    }
  }

  async function refreshMediaDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = list.filter((item) => item.kind === "audioinput");
    const videoInputs = list.filter((item) => item.kind === "videoinput");
    setDevices({ audioInputs, videoInputs });
    setSelectedDevices((prev) => ({
      audioInputId: prev.audioInputId || audioInputs[0]?.deviceId || "",
      videoInputId: prev.videoInputId || videoInputs[0]?.deviceId || "",
    }));
  }

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Браузер не поддерживает микрофон и камеру. Используйте Chrome, Safari или Firefox по HTTPS/localhost.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedDevices.audioInputId ? { deviceId: { exact: selectedDevices.audioInputId } } : true,
      video: selectedDevices.videoInputId ? { deviceId: { exact: selectedDevices.videoInputId } } : true,
    });
    localStreamRef.current = stream;
    setLocalVideoStream(stream);
    await refreshMediaDevices().catch(() => {});
    return stream;
  }

  function stopLocalStream() {
    if (!localStreamRef.current) return;
    localStreamRef.current.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalVideoStream(null);
  }

  function cleanupPeerConnections() {
    Object.values(peerConnectionsRef.current).forEach((pc) => {
      try { pc.close(); } catch { /* ignore */ }
    });
    peerConnectionsRef.current = {};
    setRemoteStreams([]);
  }

  function removePeerConnection(userId) {
    const key = String(userId);
    const pc = peerConnectionsRef.current[key];
    if (pc) {
      try { pc.close(); } catch { /* ignore */ }
      delete peerConnectionsRef.current[key];
    }
    setRemoteStreams((prev) => prev.filter((item) => item.userId !== key));
  }

  async function createPeerConnection(userId, initiateOffer = false) {
    const key = String(userId);
    if (peerConnectionsRef.current[key]) return peerConnectionsRef.current[key];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerConnectionsRef.current[key] = pc;

    const stream = await ensureLocalStream();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWs({ type: "signal", target_user_id: Number(userId), data: { kind: "candidate", candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      const streamItem = event.streams?.[0];
      if (!streamItem) return;
      setRemoteStreams((prev) => {
        const exists = prev.some((item) => item.userId === key && item.stream.id === streamItem.id);
        if (exists) return prev;
        return [...prev.filter((item) => item.userId !== key), { userId: key, stream: streamItem }];
      });
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        removePeerConnection(key);
      }
    };

    if (initiateOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendWs({ type: "signal", target_user_id: Number(userId), data: { kind: "offer", sdp: offer } });
    }

    return pc;
  }

  async function handleSignal(fromUserId, data) {
    if (!fromUserId || !data?.kind) return;
    if (!callStateRef.current.inCall && data.kind === "offer") {
      await joinCall();
    }
    const pc = await createPeerConnection(fromUserId, false);
    if (data.kind === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWs({ type: "signal", target_user_id: Number(fromUserId), data: { kind: "answer", sdp: answer } });
    } else if (data.kind === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.kind === "candidate" && data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        // ignore stale ICE candidate
      }
    }
  }

  async function joinCall() {
    if (!currentRoomRef.current?.room?.id) {
      throw new Error("Сначала выберите комнату");
    }
    if (!sendWs({ type: "heartbeat" })) {
      throw new Error("Нет соединения с комнатой. Перезайдите в комнату или обновите страницу.");
    }
    await ensureLocalStream();
    setCallState((prev) => ({ ...prev, inCall: true }));
    callStateRef.current = { ...callStateRef.current, inCall: true };
    sendWs({ type: "call_join" });
  }

  function leaveCall(sendSignal = true) {
    if (sendSignal && callStateRef.current.inCall) {
      sendWs({ type: "call_leave" });
    }
    cleanupPeerConnections();
    stopLocalStream();
    setCallState({ inCall: false, muted: false, cameraOff: false, soundOff: false });
    callStateRef.current = { inCall: false, muted: false, cameraOff: false, soundOff: false };
  }

  function toggleMic() {
    if (!localStreamRef.current) return;
    const nextMuted = !callStateRef.current.muted;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setCallState((prev) => ({ ...prev, muted: nextMuted }));
  }

  function toggleCamera() {
    if (!localStreamRef.current) return;
    const nextCameraOff = !callStateRef.current.cameraOff;
    localStreamRef.current.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setCallState((prev) => ({ ...prev, cameraOff: nextCameraOff }));
  }

  function toggleSound() {
    setCallState((prev) => ({ ...prev, soundOff: !prev.soundOff }));
  }

  function touchActivity() {
    const now = Date.now();
    if (now - activityRef.current < 12000) return;
    activityRef.current = now;
    sendWs({ type: "heartbeat" });
  }

  const createRoom = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await api("/api/rooms", { method: "POST", body: createForm });
      setCreateForm({ title: "", logo_text: "FR", open_minutes: 25, password: "", is_private: true });
      await refresh();
      await loadRoom(data.room.id);
    });
  };

  const joinRoom = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await api("/api/rooms/join", { method: "POST", body: joinForm });
      setJoinForm({ invite_code: "", password: "" });
      await refresh();
      await loadRoom(data.room.id);
    });
  };

  const saveSettings = (event) => {
    event.preventDefault();
    run(async () => {
      await api(`/api/rooms/${currentRoom.room.id}`, { method: "PATCH", body: settings });
      await reloadAll(currentRoom.room.id);
    });
  };

  const leaveRoom = () => run(async () => {
    leaveCall(true);
    await api(`/api/rooms/${currentRoom.room.id}/leave`, { method: "POST" });
    setCurrentRoom(null);
    await refresh();
  });

  const deleteRoom = () => run(async () => {
    if (!confirm("Удалить комнату без восстановления?")) return;
    leaveCall(true);
    await api(`/api/rooms/${currentRoom.room.id}`, { method: "DELETE" });
    setCurrentRoom(null);
    await refresh();
  });

  const setRole = (member, role) => run(async () => {
    await api(`/api/rooms/${currentRoom.room.id}/members/${member.user_id}/role`, { method: "POST", body: { role } });
    await reloadAll(currentRoom.room.id);
  });

  const removeMember = (member) => run(async () => {
    await api(`/api/rooms/${currentRoom.room.id}/members/${member.user_id}`, { method: "DELETE" });
    await reloadAll(currentRoom.room.id);
  });

  const sendMessage = (event) => {
    event.preventDefault();
    run(async () => {
      const text = messageText.trim();
      if (!text) return;
      if (sendWs({ type: "chat_message", message: text })) {
        setMessageText("");
      } else {
        await api(`/api/rooms/${currentRoom.room.id}/messages`, { method: "POST", body: { message: text } });
        setMessageText("");
        await loadRoom(currentRoom.room.id);
      }
      touchActivity();
    });
  };

  const uploadFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    run(async () => {
      const formData = new FormData();
      formData.append("file", file);
      await api(`/api/rooms/${currentRoom.room.id}/files`, { method: "POST", body: formData });
      await loadRoom(currentRoom.room.id);
    });
  };

  const deleteFile = (file) => run(async () => {
    await api(`/api/rooms/${currentRoom.room.id}/files/${file.id}`, { method: "DELETE" });
    await loadRoom(currentRoom.room.id);
  });

  const startTimer = () => run(async () => {
    await api(`/api/rooms/${currentRoom.room.id}/timer/start`, { method: "POST", body: { duration_minutes: settings.open_minutes || currentRoom.room.open_minutes } });
    await loadRoom(currentRoom.room.id);
  });

  const stopTimer = () => run(async () => {
    await api(`/api/rooms/${currentRoom.room.id}/timer/stop`, { method: "POST" });
    await loadRoom(currentRoom.room.id);
  });

  const canManage = currentRoom?.room?.can_manage;
  const isOwner = currentRoom?.viewer_role === "owner";
  const memberNameById = useMemo(() => {
    const map = new Map();
    (currentRoom?.members || []).forEach((member) => map.set(String(member.user_id), member.username));
    return map;
  }, [currentRoom?.members]);

  return (
    <section className="rooms-layout">
      <div className="room-tools">
        <div className="card">
          <h2>Создать комнату</h2>
          <ErrorBox error={error} onClose={() => setError("")} />
          <form className="form" onSubmit={createRoom}>
            <label><span>Название</span><input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} required /></label>
            <label><span>Логотип</span><input maxLength={20} value={createForm.logo_text} onChange={(e) => setCreateForm({ ...createForm, logo_text: e.target.value })} /></label>
            <label><span>Минуты</span><input type="number" min="1" max="300" value={createForm.open_minutes} onChange={(e) => setCreateForm({ ...createForm, open_minutes: Number(e.target.value) })} /></label>
            <label><span>Пароль</span><input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} /></label>
            <label className="checkbox-row"><input type="checkbox" checked={createForm.is_private} onChange={(e) => setCreateForm({ ...createForm, is_private: e.target.checked })} />Приватная комната</label>
            <button className="primary-btn">Создать</button>
          </form>
        </div>

        <div className="card">
          <h2>Войти по коду</h2>
          <form className="form" onSubmit={joinRoom}>
            <label><span>Код комнаты</span><input value={joinForm.invite_code} onChange={(e) => setJoinForm({ ...joinForm, invite_code: e.target.value.toUpperCase() })} required /></label>
            <label><span>Пароль комнаты</span><input type="password" value={joinForm.password} onChange={(e) => setJoinForm({ ...joinForm, password: e.target.value })} /></label>
            <button className="primary-btn">Войти</button>
          </form>
        </div>

        <div className="card">
          <h2>Мои комнаты</h2>
          <div className="list">
            {rooms.map((room) => (
              <button className="room-button" key={room.id} onClick={() => run(() => loadRoom(room.id))}>
                <strong>{room.title}</strong>
                <span>{roleLabels[room.viewer_role] || room.viewer_role} · {room.members_count} чел.</span>
              </button>
            ))}
            {!rooms.length && <p className="muted">Нет доступных комнат. Создайте комнату или войдите по коду.</p>}
          </div>
        </div>
      </div>

      <div className="room-main card">
        {!currentRoom?.room ? (
          <EmptyState title="Выберите комнату" text="После выбора здесь появятся чат, участники, файлы, звонок и настройки." />
        ) : (
          <>
            <div className="room-header">
              <div>
                <p className="eyebrow">Комната</p>
                <h1>{currentRoom.room.title}</h1>
                <div className="meta-line">
                  <span>Код: {currentRoom.room.invite_code}</span>
                  <span>Роль: {roleLabels[currentRoom.viewer_role] || currentRoom.viewer_role}</span>
                  <span>Таймер: {formatSeconds(roomTimerRemaining)}</span>
                  <span>Связь: {socketStatus === "online" ? "онлайн" : socketStatus === "connecting" ? "подключение" : "нет"}</span>
                </div>
              </div>
              <div className="row-actions">
                {canManage && <button className="primary-btn" onClick={startTimer}>Старт таймера</button>}
                {canManage && <button className="secondary-btn" onClick={stopTimer}>Стоп</button>}
                {!isOwner && <button className="secondary-btn" onClick={leaveRoom}>Выйти</button>}
                {isOwner && <button className="danger-btn" onClick={deleteRoom}>Удалить</button>}
              </div>
            </div>

            {canManage && (
              <form className="settings-grid" onSubmit={saveSettings}>
                <label><span>Название</span><input value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} /></label>
                <label><span>Логотип</span><input value={settings.logo_text} onChange={(e) => setSettings({ ...settings, logo_text: e.target.value })} /></label>
                <label><span>Минуты</span><input type="number" value={settings.open_minutes} onChange={(e) => setSettings({ ...settings, open_minutes: Number(e.target.value) })} /></label>
                <label><span>Новый пароль</span><input type="password" value={settings.password} onChange={(e) => setSettings({ ...settings, password: e.target.value })} /></label>
                <label className="checkbox-row"><input type="checkbox" checked={settings.clear_password} onChange={(e) => setSettings({ ...settings, clear_password: e.target.checked })} />Убрать пароль</label>
                <button className="primary-btn">Сохранить</button>
              </form>
            )}

            <div className="subcard call-panel">
              <div className="section-head">
                <div>
                  <h2>Голос и видео</h2>
                  <p className="muted small">Работает на localhost или на сайте с HTTPS. Для сложных сетей позже можно добавить TURN-сервер.</p>
                </div>
                <div className="row-actions">
                  {!callState.inCall ? (
                    <button className="primary-btn" onClick={() => run(joinCall)}>Подключиться</button>
                  ) : (
                    <button className="danger-btn" onClick={() => leaveCall(true)}>Отключиться</button>
                  )}
                  <button className="secondary-btn" disabled={!callState.inCall} onClick={toggleMic}>{callState.muted ? "Вкл. микрофон" : "Выкл. микрофон"}</button>
                  <button className="secondary-btn" disabled={!callState.inCall} onClick={toggleCamera}>{callState.cameraOff ? "Вкл. камеру" : "Выкл. камеру"}</button>
                  <button className="secondary-btn" disabled={!callState.inCall} onClick={toggleSound}>{callState.soundOff ? "Вкл. звук" : "Выкл. звук"}</button>
                </div>
              </div>

              <div className="device-grid">
                <label>
                  <span>Микрофон</span>
                  <select value={selectedDevices.audioInputId} onChange={(e) => setSelectedDevices({ ...selectedDevices, audioInputId: e.target.value })} disabled={callState.inCall}>
                    <option value="">По умолчанию</option>
                    {devices.audioInputs.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}
                  </select>
                </label>
                <label>
                  <span>Камера</span>
                  <select value={selectedDevices.videoInputId} onChange={(e) => setSelectedDevices({ ...selectedDevices, videoInputId: e.target.value })} disabled={callState.inCall}>
                    <option value="">По умолчанию</option>
                    {devices.videoInputs.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Камера ${index + 1}`}</option>)}
                  </select>
                </label>
              </div>

              <div className="video-grid">
                {localVideoStream && <VideoTile label={`${user?.username || "Я"} · я`} stream={localVideoStream} muted />}
                {remoteStreams.map((item) => (
                  <VideoTile key={`${item.userId}-${item.stream.id}`} label={memberNameById.get(String(item.userId)) || `Участник ${item.userId}`} stream={item.stream} soundOff={callState.soundOff} />
                ))}
                {!callState.inCall && <p className="muted">Нажмите «Подключиться», разрешите микрофон и камеру, затем другие участники смогут присоединиться.</p>}
                {callState.inCall && remoteStreams.length === 0 && <p className="muted">Вы в звонке. Ожидание других участников…</p>}
              </div>
            </div>

            <div className="room-columns">
              <div className="subcard">
                <h2>Чат</h2>
                <div className="chat-box">
                  {(currentRoom.messages || []).map((message) => (
                    <div className={`message ${message.is_system ? "system" : ""}`} key={message.id}>
                      <div><strong>{message.username}</strong><small>{formatDate(message.created_at)}</small></div>
                      <p>{message.message}</p>
                    </div>
                  ))}
                </div>
                <form className="chat-form" onSubmit={sendMessage}>
                  <input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Сообщение" />
                  <button className="primary-btn">Отправить</button>
                </form>
              </div>

              <div className="subcard">
                <h2>Участники</h2>
                <div className="list compact-list">
                  {(currentRoom.members || []).map((member) => {
                    const isOnline = onlineUserIds.map(String).includes(String(member.user_id));
                    const inCall = callParticipants.map(String).includes(String(member.user_id));
                    return (
                      <article className="list-row" key={member.user_id}>
                        <div><h3>{member.username}</h3><small>{roleLabels[member.role] || member.role} · {isOnline ? "онлайн" : "не в сети"}{inCall ? " · в звонке" : ""}</small></div>
                        {isOwner && member.role !== "owner" && (
                          <div className="row-actions">
                            <button className="secondary-btn" onClick={() => setRole(member, member.role === "admin" ? "member" : "admin")}>{member.role === "admin" ? "Снять admin" : "Сделать admin"}</button>
                            <button className="danger-btn" onClick={() => removeMember(member)}>Исключить</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="room-columns">
              <div className="subcard">
                <div className="section-head"><h2>Файлы</h2><label className="primary-btn upload-label">Загрузить<input type="file" hidden onChange={uploadFile} /></label></div>
                <div className="list compact-list">
                  {(currentRoom.files || []).map((file) => (
                    <article className="list-row" key={file.id}>
                      <div><h3>{file.original_name}</h3><small>{file.uploader_name || "Пользователь"} · {bytesToSize(file.size_bytes)}</small></div>
                      <div className="row-actions">
                        <a className="secondary-btn" href={resolveUrl(file.download_url)} target="_blank" rel="noreferrer">Скачать</a>
                        {(canManage || file.uploader_user_id === user?.id) && <button className="danger-btn" onClick={() => deleteFile(file)}>Удалить</button>}
                      </div>
                    </article>
                  ))}
                  {!currentRoom.files?.length && <p className="muted">Файлов пока нет.</p>}
                </div>
              </div>

              <div className="subcard">
                <h2>Активность</h2>
                <div className="stats-grid small-stats">
                  <div className="stat-card"><span>Участники</span><strong>{currentRoom.members.length}</strong></div>
                  <div className="stat-card"><span>Файлы</span><strong>{currentRoom.files.length}</strong></div>
                  <div className="stat-card"><span>Задачи</span><strong>{currentRoom.room_tasks.length}</strong></div>
                </div>
                <div className="list compact-list">
                  {(currentRoom.room_tasks || []).slice(0, 8).map((task) => (
                    <article className="list-row" key={task.id}><div><h3>{task.title}</h3><small>{task.username}</small></div><span className="pill">{task.status}</span></article>
                  ))}
                  {!currentRoom.room_tasks?.length && <p className="muted">Активных задач нет.</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
