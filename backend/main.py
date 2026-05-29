import asyncio
import hashlib
import mimetypes
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, create_engine, func, inspect, or_, text
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DB_PATH = BASE_DIR / "focusroom.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
DATABASE_URL = f"sqlite:///{DB_PATH}"

ADMIN_LOGIN = os.getenv("ADMIN_LOGIN", "root")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "root")
SESSION_SECRET = os.getenv("SESSION_SECRET", "focusroom-change-this-secret")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    recovery_word_hash = Column(String(255), nullable=True)
    is_blocked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
    owned_rooms = relationship("Room", back_populates="owner", cascade="all, delete-orphan")
    sessions = relationship("FocusSession", back_populates="user", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(150), nullable=False)
    description = Column(Text, default="")
    status = Column(String(20), default="todo")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="tasks")
    sessions = relationship("FocusSession", back_populates="task")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(100), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invite_code = Column(String(50), unique=True, nullable=False, index=True)
    is_private = Column(Boolean, default=True)
    password_hash = Column(String(255), nullable=True)
    open_minutes = Column(Integer, default=25)
    logo_text = Column(String(20), default="FR")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="owned_rooms")
    members = relationship("RoomMember", back_populates="room", cascade="all, delete-orphan")
    sessions = relationship("FocusSession", back_populates="room")
    timer = relationship("RoomTimer", back_populates="room", uselist=False, cascade="all, delete-orphan")
    messages = relationship("ChatMessage", back_populates="room", cascade="all, delete-orphan")
    files = relationship("RoomFile", back_populates="room", cascade="all, delete-orphan")


class RoomMember(Base):
    __tablename__ = "room_members"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    joined_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    role = Column(String(20), default="member")
    last_activity_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    warning_sent_at = Column(DateTime, nullable=True)

    room = relationship("Room", back_populates="members")


class FocusSession(Base):
    __tablename__ = "focus_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    session_type = Column(String(20), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    is_completed = Column(Boolean, default=False)

    user = relationship("User", back_populates="sessions")
    room = relationship("Room", back_populates="sessions")
    task = relationship("Task", back_populates="sessions")


class RoomTimer(Base):
    __tablename__ = "room_timers"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), unique=True, nullable=False)
    started_by_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    duration_minutes = Column(Integer, default=25)
    started_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    is_running = Column(Boolean, default=False)

    room = relationship("Room", back_populates="timer")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username_snapshot = Column(String(50), nullable=False)
    message = Column(Text, nullable=False)
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    room = relationship("Room", back_populates="messages")


class RoomFile(Base):
    __tablename__ = "room_files"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    uploader_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    original_name = Column(String(255), nullable=False)
    stored_name = Column(String(255), nullable=False, unique=True)
    content_type = Column(String(120), nullable=True)
    size_bytes = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    room = relationship("Room", back_populates="files")


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), default="")
    email = Column(String(150), default="")
    subject = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(30), default="feedback")
    status = Column(String(30), default="new")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)


Base.metadata.create_all(bind=engine)


def migrate_db() -> None:
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    def cols(table: str) -> set[str]:
        if table not in tables:
            return set()
        return {col["name"] for col in inspector.get_columns(table)}

    with engine.begin() as conn:
        if "users" in tables:
            user_cols = cols("users")
            if "is_blocked" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT 0 NOT NULL"))
            if "recovery_word_hash" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN recovery_word_hash VARCHAR(255)"))
        if "rooms" in tables:
            room_cols = cols("rooms")
            if "password_hash" not in room_cols:
                conn.execute(text("ALTER TABLE rooms ADD COLUMN password_hash VARCHAR(255)"))
            if "open_minutes" not in room_cols:
                conn.execute(text("ALTER TABLE rooms ADD COLUMN open_minutes INTEGER DEFAULT 25"))
            if "logo_text" not in room_cols:
                conn.execute(text("ALTER TABLE rooms ADD COLUMN logo_text VARCHAR(20) DEFAULT 'FR'"))
            if "is_private" not in room_cols:
                conn.execute(text("ALTER TABLE rooms ADD COLUMN is_private BOOLEAN DEFAULT 1"))
            conn.execute(text("UPDATE rooms SET open_minutes = COALESCE(open_minutes, 25)"))
            conn.execute(text("UPDATE rooms SET logo_text = COALESCE(logo_text, 'FR')"))
        if "room_members" in tables:
            member_cols = cols("room_members")
            if "last_activity_at" not in member_cols:
                conn.execute(text("ALTER TABLE room_members ADD COLUMN last_activity_at DATETIME"))
            if "warning_sent_at" not in member_cols:
                conn.execute(text("ALTER TABLE room_members ADD COLUMN warning_sent_at DATETIME"))
            conn.execute(text("UPDATE room_members SET last_activity_at = COALESCE(last_activity_at, joined_at, CURRENT_TIMESTAMP)"))


migrate_db()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="FocusRoom")

origins_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8001,http://127.0.0.1:8001",
)
origins = [item.strip() for item in origins_raw.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=60 * 60 * 24 * 30, same_site="lax")

FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


class RegisterIn(BaseModel):
    username: str
    email: EmailStr
    password: str
    recovery_word: Optional[str] = ""


class LoginIn(BaseModel):
    login: str
    password: str


class ForgotPasswordIn(BaseModel):
    login: str
    recovery_word: Optional[str] = ""
    message: Optional[str] = ""


class TaskCreateIn(BaseModel):
    title: str
    description: Optional[str] = ""


class TaskUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class RoomCreateIn(BaseModel):
    title: str
    is_private: bool = True
    password: Optional[str] = ""
    open_minutes: int = 25
    logo_text: Optional[str] = "FR"


class RoomJoinIn(BaseModel):
    invite_code: str
    password: Optional[str] = ""


class RoomUpdateIn(BaseModel):
    title: Optional[str] = None
    open_minutes: Optional[int] = None
    logo_text: Optional[str] = None
    password: Optional[str] = None
    clear_password: bool = False


class RoomRoleIn(BaseModel):
    role: str


class ChatIn(BaseModel):
    message: str


class SessionStartIn(BaseModel):
    task_id: Optional[int] = None
    room_id: Optional[int] = None
    session_type: str = "focus"
    duration_minutes: int = 25


class SessionFinishIn(BaseModel):
    session_id: int
    is_completed: bool = True


class RoomTimerStartIn(BaseModel):
    duration_minutes: int = 25


class FeedbackIn(BaseModel):
    subject: str
    message: str


class AdminLoginIn(BaseModel):
    login: str
    password: str


class AdminUserCreateIn(BaseModel):
    username: str
    email: EmailStr
    password: str
    recovery_word: Optional[str] = ""


class AdminUserUpdateIn(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_blocked: Optional[bool] = None


class AdminFeedbackUpdateIn(BaseModel):
    status: str


VALID_TASK_STATUSES = {"todo", "in_progress", "done"}
VALID_SESSION_TYPES = {"focus", "short_break", "long_break"}
VALID_ROOM_ROLES = {"member", "admin", "owner"}
VALID_FEEDBACK_STATUSES = {"new", "in_progress", "done", "closed"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_dt(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored:
        return False
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    new_digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return secrets.compare_digest(new_digest, digest)


def room_code() -> str:
    return secrets.token_hex(4).upper()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session) -> Optional[User]:
    user_id = request.session.get("user_id")
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.is_blocked:
        request.session.pop("user_id", None)
        return None
    return user


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = get_current_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Необходим вход в систему")
    return user


def require_admin(request: Request) -> bool:
    if not request.session.get("admin_logged_in"):
        raise HTTPException(status_code=401, detail="Нужен вход в админ-панель")
    return True


def ensure_room_member(db: Session, room_id: int, user_id: int) -> RoomMember:
    member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа к этой комнате")
    member.last_activity_at = utcnow()
    db.commit()
    return member


def ensure_owner_or_admin(db: Session, room_id: int, user_id: int) -> RoomMember:
    member = ensure_room_member(db, room_id, user_id)
    if member.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Нужны права владельца или администратора комнаты")
    return member


def ensure_owner(db: Session, room_id: int, user_id: int) -> RoomMember:
    member = ensure_room_member(db, room_id, user_id)
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Действие доступно только владельцу комнаты")
    return member


def get_or_create_room_timer(db: Session, room_id: int) -> RoomTimer:
    timer = db.query(RoomTimer).filter(RoomTimer.room_id == room_id).first()
    if not timer:
        timer = RoomTimer(room_id=room_id, duration_minutes=25, is_running=False)
        db.add(timer)
        db.commit()
        db.refresh(timer)
    return timer


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_blocked": bool(user.is_blocked),
        "has_recovery_word": bool(user.recovery_word_hash),
        "created_at": normalize_dt(user.created_at).isoformat() if user.created_at else None,
    }


def serialize_task(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description or "",
        "status": task.status,
        "created_at": normalize_dt(task.created_at).isoformat() if task.created_at else None,
        "completed_at": normalize_dt(task.completed_at).isoformat() if task.completed_at else None,
    }


def serialize_room(room: Room, current_user_id: Optional[int] = None) -> dict:
    current_member = None
    for item in room.members:
        if current_user_id and item.user_id == current_user_id:
            current_member = item
            break
    return {
        "id": room.id,
        "title": room.title,
        "invite_code": room.invite_code,
        "is_private": bool(room.is_private),
        "has_password": bool(room.password_hash),
        "open_minutes": room.open_minutes or 25,
        "logo_text": room.logo_text or "FR",
        "created_at": normalize_dt(room.created_at).isoformat() if room.created_at else None,
        "owner": room.owner.username if room.owner else None,
        "viewer_role": current_member.role if current_member else None,
        "is_owner": bool(current_member and current_member.role == "owner"),
        "can_manage": bool(current_member and current_member.role in {"owner", "admin"}),
        "members_count": len(room.members),
        "online_count": len(manager.online_user_ids(room.id)) if "manager" in globals() else 0,
    }


def serialize_member(db: Session, member: RoomMember) -> dict:
    user = db.query(User).filter(User.id == member.user_id).first()
    return {
        "user_id": member.user_id,
        "username": user.username if user else "Пользователь",
        "email": user.email if user else "",
        "role": member.role,
        "joined_at": normalize_dt(member.joined_at).isoformat() if member.joined_at else None,
        "last_activity_at": normalize_dt(member.last_activity_at).isoformat() if member.last_activity_at else None,
    }


def serialize_session(item: FocusSession) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "username": item.user.username if item.user else None,
        "task_id": item.task_id,
        "task_title": item.task.title if item.task else None,
        "room_id": item.room_id,
        "room_title": item.room.title if item.room else None,
        "session_type": item.session_type,
        "duration_minutes": item.duration_minutes,
        "started_at": normalize_dt(item.started_at).isoformat() if item.started_at else None,
        "ended_at": normalize_dt(item.ended_at).isoformat() if item.ended_at else None,
        "is_completed": item.is_completed,
    }


def serialize_timer(timer: Optional[RoomTimer]) -> dict:
    if not timer:
        return {"is_running": False, "duration_minutes": 25, "started_at": None, "ends_at": None, "started_by_user_id": None}
    return {
        "is_running": bool(timer.is_running),
        "duration_minutes": timer.duration_minutes or 25,
        "started_at": normalize_dt(timer.started_at).isoformat() if timer.started_at else None,
        "ends_at": normalize_dt(timer.ends_at).isoformat() if timer.ends_at else None,
        "started_by_user_id": timer.started_by_user_id,
    }


def serialize_message(message: ChatMessage) -> dict:
    return {
        "id": message.id,
        "room_id": message.room_id,
        "user_id": message.user_id,
        "username": message.username_snapshot,
        "message": message.message,
        "is_system": bool(message.is_system),
        "created_at": normalize_dt(message.created_at).isoformat() if message.created_at else None,
    }


def serialize_file(item: RoomFile, uploader_name: Optional[str] = None) -> dict:
    return {
        "id": item.id,
        "room_id": item.room_id,
        "uploader_user_id": item.uploader_user_id,
        "uploader_name": uploader_name,
        "original_name": item.original_name,
        "content_type": item.content_type,
        "size_bytes": item.size_bytes,
        "created_at": normalize_dt(item.created_at).isoformat() if item.created_at else None,
        "download_url": f"/api/files/{item.id}/download",
    }


def serialize_feedback(item: Feedback) -> dict:
    return {
        "id": item.id,
        "user_id": item.user_id,
        "name": item.name,
        "email": item.email,
        "subject": item.subject,
        "message": item.message,
        "type": item.type,
        "status": item.status,
        "created_at": normalize_dt(item.created_at).isoformat() if item.created_at else None,
    }


def log_system_message(db: Session, room_id: int, text_value: str) -> ChatMessage:
    msg = ChatMessage(room_id=room_id, user_id=None, username_snapshot="Система", message=text_value, is_system=True)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


class RoomSocketManager:
    def __init__(self):
        self.room_connections: dict[int, dict[int, WebSocket]] = {}
        self.call_participants: dict[int, set[int]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, room_id: int, user_id: int, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            self.room_connections.setdefault(room_id, {})[user_id] = websocket
            self.call_participants.setdefault(room_id, set())

    async def disconnect(self, room_id: int, user_id: int):
        async with self.lock:
            room_map = self.room_connections.get(room_id, {})
            room_map.pop(user_id, None)
            if not room_map:
                self.room_connections.pop(room_id, None)

            call_users = self.call_participants.get(room_id)
            if call_users is not None:
                call_users.discard(user_id)
                if not call_users:
                    self.call_participants.pop(room_id, None)

    async def broadcast_room(self, room_id: int, payload: dict):
        sockets = list(self.room_connections.get(room_id, {}).items())
        for user_id, ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                await self.disconnect(room_id, user_id)

    async def send_to_user(self, room_id: int, user_id: int, payload: dict):
        ws = self.room_connections.get(room_id, {}).get(user_id)
        if not ws:
            return
        try:
            await ws.send_json(payload)
        except Exception:
            await self.disconnect(room_id, user_id)

    async def add_call_participant(self, room_id: int, user_id: int):
        async with self.lock:
            self.call_participants.setdefault(room_id, set()).add(user_id)

    async def remove_call_participant(self, room_id: int, user_id: int):
        async with self.lock:
            call_users = self.call_participants.get(room_id)
            if call_users is not None:
                call_users.discard(user_id)
                if not call_users:
                    self.call_participants.pop(room_id, None)

    def online_user_ids(self, room_id: int) -> list[int]:
        return list(self.room_connections.get(room_id, {}).keys())

    def get_call_participants(self, room_id: int) -> list[int]:
        return sorted(self.call_participants.get(room_id, set()))


manager = RoomSocketManager()
app.state.ws_tokens = {}


def create_ws_token(user_id: int) -> str:
    token = secrets.token_urlsafe(24)
    app.state.ws_tokens[token] = {"user_id": user_id, "expires_at": utcnow() + timedelta(minutes=15)}
    return token


def consume_ws_token(token: str) -> Optional[int]:
    info = app.state.ws_tokens.pop(token, None)
    if not info:
        return None
    if normalize_dt(info["expires_at"]) < utcnow():
        return None
    return info["user_id"]


@app.get("/api/health")
def health():
    return {"ok": True, "time": utcnow().isoformat()}


@app.post("/api/auth/register")
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Логин должен быть не короче 3 символов")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не короче 6 символов")
    exists = db.query(User).filter(or_(User.username == username, User.email == email)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Пользователь с таким логином или email уже существует")
    recovery_word = (payload.recovery_word or "").strip()
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(payload.password),
        recovery_word_hash=hash_password(recovery_word) if recovery_word else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    request.session["user_id"] = user.id
    return {"user": serialize_user(user), "message": "Регистрация выполнена"}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    login_value = payload.login.strip().lower()
    user = db.query(User).filter(or_(func.lower(User.username) == login_value, func.lower(User.email) == login_value)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if user.is_blocked:
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован администратором")
    request.session["user_id"] = user.id
    return {"user": serialize_user(user), "message": "Вход выполнен"}


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.pop("user_id", None)
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = get_current_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Не выполнен вход")
    return {"user": serialize_user(user)}


@app.post("/api/auth/forgot-password")
def forgot_password(payload: ForgotPasswordIn, db: Session = Depends(get_db)):
    login_value = payload.login.strip()
    if not login_value:
        raise HTTPException(status_code=400, detail="Укажите логин или email")
    user = db.query(User).filter(or_(func.lower(User.username) == login_value.lower(), func.lower(User.email) == login_value.lower())).first()
    recovery_word = (payload.recovery_word or "").strip()
    if user and user.recovery_word_hash:
        recovery_status = "кодовое слово подтверждено" if recovery_word and verify_password(recovery_word, user.recovery_word_hash) else "кодовое слово не указано или не совпало"
    elif user:
        recovery_status = "кодовое слово не задано в аккаунте"
    else:
        recovery_status = "аккаунт не найден автоматически"
    user_message = (payload.message or "").strip()
    full_message = f"Пользователь указал: {login_value}. Статус восстановления: {recovery_status}."
    if user_message:
        full_message += f"\nКомментарий: {user_message}"
    fb = Feedback(
        user_id=user.id if user else None,
        name=user.username if user else login_value,
        email=user.email if user else "",
        type="password_reset",
        subject="Запрос восстановления пароля",
        message=full_message,
    )
    db.add(fb)
    db.commit()
    return {"message": "Запрос отправлен администратору"}


@app.get("/api/ws-token")
def ws_token(user: User = Depends(require_user)):
    return {"token": create_ws_token(user.id)}


@app.get("/api/waiting-room")
def waiting_room(user: User = Depends(require_user), db: Session = Depends(get_db)):
    active_session = (
        db.query(FocusSession)
        .filter(FocusSession.user_id == user.id, FocusSession.ended_at.is_(None))
        .order_by(FocusSession.started_at.desc())
        .first()
    )
    rooms = db.query(Room).join(RoomMember).filter(RoomMember.user_id == user.id).order_by(Room.created_at.desc()).limit(6).all()
    return {
        "message": "Готово",
        "rooms": [serialize_room(room, user.id) for room in rooms],
        "active_session": serialize_session(active_session) if active_session else None,
    }


@app.get("/api/tasks")
def get_tasks(user: User = Depends(require_user), db: Session = Depends(get_db)):
    tasks = db.query(Task).filter(Task.user_id == user.id).order_by(Task.created_at.desc()).all()
    return {"tasks": [serialize_task(task) for task in tasks]}


@app.post("/api/tasks")
def create_task(payload: TaskCreateIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Название задачи обязательно")
    task = Task(user_id=user.id, title=title, description=(payload.description or "").strip())
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"task": serialize_task(task)}


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdateIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Название задачи не может быть пустым")
        task.title = title
    if payload.description is not None:
        task.description = payload.description.strip()
    if payload.status is not None:
        if payload.status not in VALID_TASK_STATUSES:
            raise HTTPException(status_code=400, detail="Неверный статус задачи")
        task.status = payload.status
        task.completed_at = utcnow() if payload.status == "done" else None
    db.commit()
    db.refresh(task)
    return {"task": serialize_task(task)}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    db.delete(task)
    db.commit()
    return {"ok": True}


@app.get("/api/rooms")
def get_rooms(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rooms = db.query(Room).join(RoomMember).filter(RoomMember.user_id == user.id).order_by(Room.created_at.desc()).all()
    return {"rooms": [serialize_room(room, user.id) for room in rooms]}


@app.post("/api/rooms")
def create_room(payload: RoomCreateIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Название комнаты обязательно")
    code = room_code()
    while db.query(Room).filter(Room.invite_code == code).first():
        code = room_code()
    room = Room(
        title=title,
        owner_id=user.id,
        invite_code=code,
        is_private=bool(payload.is_private),
        password_hash=hash_password(payload.password) if payload.password else None,
        open_minutes=max(1, min(int(payload.open_minutes or 25), 300)),
        logo_text=(payload.logo_text or "FR").strip()[:20] or "FR",
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    member = RoomMember(room_id=room.id, user_id=user.id, role="owner")
    db.add(member)
    timer = RoomTimer(room_id=room.id, duration_minutes=room.open_minutes, is_running=False)
    db.add(timer)
    db.commit()
    db.refresh(room)
    log_system_message(db, room.id, f"Комната создана пользователем {user.username}")
    return {"room": serialize_room(room, user.id)}


@app.post("/api/rooms/join")
def join_room(payload: RoomJoinIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    code = payload.invite_code.strip().upper()
    room = db.query(Room).filter(Room.invite_code == code).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната с таким кодом не найдена")
    existing = db.query(RoomMember).filter(RoomMember.room_id == room.id, RoomMember.user_id == user.id).first()
    if existing:
        return {"room": serialize_room(room, user.id), "message": "Вы уже в этой комнате"}
    if room.password_hash and not verify_password(payload.password or "", room.password_hash):
        raise HTTPException(status_code=403, detail="Неверный пароль комнаты")
    member = RoomMember(room_id=room.id, user_id=user.id, role="member")
    db.add(member)
    db.commit()
    log_system_message(db, room.id, f"{user.username} вошёл в комнату")
    return {"room": serialize_room(room, user.id)}


@app.get("/api/rooms/{room_id}")
def get_room(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_room_member(db, room_id, user.id)
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    messages = db.query(ChatMessage).filter(ChatMessage.room_id == room_id).order_by(ChatMessage.created_at.asc()).limit(150).all()
    files = db.query(RoomFile).filter(RoomFile.room_id == room_id).order_by(RoomFile.created_at.desc()).all()
    members = db.query(RoomMember).filter(RoomMember.room_id == room_id).order_by(RoomMember.joined_at.asc()).all()
    active_sessions = (
        db.query(FocusSession)
        .filter(FocusSession.room_id == room_id, FocusSession.ended_at.is_(None))
        .order_by(FocusSession.started_at.desc())
        .all()
    )
    task_rows = (
        db.query(Task, User)
        .join(User, Task.user_id == User.id)
        .join(RoomMember, RoomMember.user_id == User.id)
        .filter(RoomMember.room_id == room_id, Task.status != "done")
        .order_by(Task.created_at.desc())
        .limit(30)
        .all()
    )
    return {
        "room": serialize_room(room, user.id),
        "viewer_role": db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user.id).first().role,
        "members": [serialize_member(db, member) for member in members],
        "messages": [serialize_message(item) for item in messages],
        "files": [serialize_file(item, db.query(User).filter(User.id == item.uploader_user_id).first().username if item.uploader_user_id and db.query(User).filter(User.id == item.uploader_user_id).first() else None) for item in files],
        "room_timer": serialize_timer(get_or_create_room_timer(db, room_id)),
        "online_user_ids": manager.online_user_ids(room_id),
        "call_participants": manager.get_call_participants(room_id),
        "active_sessions": [serialize_session(item) for item in active_sessions],
        "room_tasks": [dict(serialize_task(task), username=task_user.username) for task, task_user in task_rows],
    }


@app.patch("/api/rooms/{room_id}")
async def update_room(room_id: int, payload: RoomUpdateIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner_or_admin(db, room_id, user.id)
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Название комнаты не может быть пустым")
        room.title = title
    if payload.open_minutes is not None:
        room.open_minutes = max(1, min(int(payload.open_minutes), 300))
    if payload.logo_text is not None:
        room.logo_text = payload.logo_text.strip()[:20] or "FR"
    if payload.clear_password:
        room.password_hash = None
    elif payload.password:
        room.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(room)
    msg = log_system_message(db, room.id, f"Комната обновлена пользователем {user.username}")
    await manager.broadcast_room(room_id, {"type": "room_updated", "room": serialize_room(room, user.id), "message": serialize_message(msg)})
    return {"room": serialize_room(room, user.id)}


@app.post("/api/rooms/{room_id}/leave")
async def leave_room(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    member = ensure_room_member(db, room_id, user.id)
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Владелец не может выйти. Передайте роль или удалите комнату")
    db.delete(member)
    db.commit()
    msg = log_system_message(db, room_id, f"{user.username} вышел из комнаты")
    await manager.broadcast_room(room_id, {"type": "member_left", "user_id": user.id, "message": serialize_message(msg)})
    return {"ok": True}


@app.delete("/api/rooms/{room_id}")
async def delete_room(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner(db, room_id, user.id)
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    db.delete(room)
    db.commit()
    await manager.broadcast_room(room_id, {"type": "room_deleted", "room_id": room_id})
    return {"ok": True}


@app.post("/api/rooms/{room_id}/members/{member_user_id}/role")
async def set_member_role(room_id: int, member_user_id: int, payload: RoomRoleIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner(db, room_id, user.id)
    if payload.role not in {"member", "admin"}:
        raise HTTPException(status_code=400, detail="Можно назначить только member или admin")
    member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == member_user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Участник не найден")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Нельзя изменить роль владельца")
    member.role = payload.role
    db.commit()
    await manager.broadcast_room(room_id, {"type": "member_role_changed", "user_id": member_user_id, "role": payload.role})
    return {"ok": True}


@app.delete("/api/rooms/{room_id}/members/{member_user_id}")
async def remove_member(room_id: int, member_user_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner_or_admin(db, room_id, user.id)
    member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == member_user_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Участник не найден")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Нельзя исключить владельца")
    db.delete(member)
    db.commit()
    await manager.broadcast_room(room_id, {"type": "member_removed", "user_id": member_user_id})
    return {"ok": True}


@app.get("/api/rooms/{room_id}/messages")
def get_messages(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_room_member(db, room_id, user.id)
    messages = db.query(ChatMessage).filter(ChatMessage.room_id == room_id).order_by(ChatMessage.created_at.asc()).limit(200).all()
    return {"messages": [serialize_message(item) for item in messages]}


@app.post("/api/rooms/{room_id}/messages")
async def create_message(room_id: int, payload: ChatIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_room_member(db, room_id, user.id)
    text_value = payload.message.strip()
    if not text_value:
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")
    msg = ChatMessage(room_id=room_id, user_id=user.id, username_snapshot=user.username, message=text_value, is_system=False)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    data = serialize_message(msg)
    await manager.broadcast_room(room_id, {"type": "chat_message", "message": data})
    return {"message": data}


@app.get("/api/rooms/{room_id}/files")
def get_files(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_room_member(db, room_id, user.id)
    files = db.query(RoomFile).filter(RoomFile.room_id == room_id).order_by(RoomFile.created_at.desc()).all()
    result = []
    for item in files:
        uploader = db.query(User).filter(User.id == item.uploader_user_id).first() if item.uploader_user_id else None
        result.append(serialize_file(item, uploader.username if uploader else None))
    return {"files": result}


@app.post("/api/rooms/{room_id}/files")
async def upload_file(room_id: int, file: UploadFile = File(...), user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_room_member(db, room_id, user.id)
    original_name = Path(file.filename or "file").name
    suffix = Path(original_name).suffix
    stored_name = f"{room_id}_{secrets.token_hex(16)}{suffix}"
    path = UPLOAD_DIR / stored_name
    size = 0
    with path.open("wb") as output:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            output.write(chunk)
    item = RoomFile(
        room_id=room_id,
        uploader_user_id=user.id,
        original_name=original_name,
        stored_name=stored_name,
        content_type=file.content_type or mimetypes.guess_type(original_name)[0],
        size_bytes=size,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    data = serialize_file(item, user.username)
    await manager.broadcast_room(room_id, {"type": "file_uploaded", "file": data})
    return {"file": data}


@app.delete("/api/rooms/{room_id}/files/{file_id}")
async def delete_file(room_id: int, file_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    member = ensure_room_member(db, room_id, user.id)
    item = db.query(RoomFile).filter(RoomFile.id == file_id, RoomFile.room_id == room_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if item.uploader_user_id != user.id and member.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Нет прав на удаление файла")
    path = UPLOAD_DIR / item.stored_name
    if path.exists():
        path.unlink()
    db.delete(item)
    db.commit()
    await manager.broadcast_room(room_id, {"type": "file_deleted", "file_id": file_id})
    return {"ok": True}


@app.get("/api/files/{file_id}/download")
def download_file(file_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    item = db.query(RoomFile).filter(RoomFile.id == file_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Файл не найден")
    ensure_room_member(db, item.room_id, user.id)
    path = UPLOAD_DIR / item.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл отсутствует на диске")
    return FileResponse(path, media_type=item.content_type or "application/octet-stream", filename=item.original_name)


@app.post("/api/sessions/start")
def start_session(payload: SessionStartIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if payload.session_type not in VALID_SESSION_TYPES:
        raise HTTPException(status_code=400, detail="Неверный тип сессии")
    if payload.room_id:
        ensure_room_member(db, payload.room_id, user.id)
    if payload.task_id:
        task = db.query(Task).filter(Task.id == payload.task_id, Task.user_id == user.id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Задача не найдена")
    active = db.query(FocusSession).filter(FocusSession.user_id == user.id, FocusSession.ended_at.is_(None)).first()
    if active:
        raise HTTPException(status_code=400, detail="У вас уже есть активная сессия")
    session = FocusSession(
        user_id=user.id,
        task_id=payload.task_id,
        room_id=payload.room_id,
        session_type=payload.session_type,
        duration_minutes=max(1, min(int(payload.duration_minutes or 25), 300)),
        started_at=utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session": serialize_session(session)}


@app.post("/api/sessions/finish")
def finish_session(payload: SessionFinishIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    session = db.query(FocusSession).filter(FocusSession.id == payload.session_id, FocusSession.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    session.ended_at = utcnow()
    session.is_completed = bool(payload.is_completed)
    db.commit()
    db.refresh(session)
    return {"session": serialize_session(session)}


@app.get("/api/sessions/history")
def session_history(user: User = Depends(require_user), db: Session = Depends(get_db)):
    sessions = db.query(FocusSession).filter(FocusSession.user_id == user.id).order_by(FocusSession.started_at.desc()).limit(100).all()
    return {"sessions": [serialize_session(item) for item in sessions]}


@app.get("/api/profile")
def profile(user: User = Depends(require_user), db: Session = Depends(get_db)):
    sessions = db.query(FocusSession).filter(FocusSession.user_id == user.id).all()
    completed = [item for item in sessions if item.is_completed]
    focus_minutes = sum(item.duration_minutes for item in completed if item.session_type == "focus")
    done_tasks = db.query(func.count(Task.id)).filter(Task.user_id == user.id, Task.status == "done").scalar() or 0
    rooms_joined = db.query(func.count(RoomMember.id)).filter(RoomMember.user_id == user.id).scalar() or 0
    active_session = db.query(FocusSession).filter(FocusSession.user_id == user.id, FocusSession.ended_at.is_(None)).order_by(FocusSession.started_at.desc()).first()
    return {
        "user": serialize_user(user),
        "stats": {
            "focus_minutes": int(focus_minutes),
            "sessions_count": len(sessions),
            "completed_sessions": len(completed),
            "done_tasks": int(done_tasks),
            "rooms_joined": int(rooms_joined),
        },
        "active_session": serialize_session(active_session) if active_session else None,
        "recent_sessions": [serialize_session(item) for item in sessions[-20:]],
    }


@app.post("/api/rooms/{room_id}/timer/start")
async def start_room_timer(room_id: int, payload: RoomTimerStartIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner_or_admin(db, room_id, user.id)
    timer = get_or_create_room_timer(db, room_id)
    duration = max(1, min(int(payload.duration_minutes or 25), 300))
    timer.duration_minutes = duration
    timer.started_by_user_id = user.id
    timer.started_at = utcnow()
    timer.ends_at = timer.started_at + timedelta(minutes=duration)
    timer.is_running = True
    db.commit()
    db.refresh(timer)
    await manager.broadcast_room(room_id, {"type": "room_timer_updated", "room_timer": serialize_timer(timer)})
    return {"room_timer": serialize_timer(timer)}


@app.post("/api/rooms/{room_id}/timer/stop")
async def stop_room_timer(room_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    ensure_owner_or_admin(db, room_id, user.id)
    timer = get_or_create_room_timer(db, room_id)
    timer.is_running = False
    timer.ends_at = None
    db.commit()
    db.refresh(timer)
    await manager.broadcast_room(room_id, {"type": "room_timer_updated", "room_timer": serialize_timer(timer)})
    return {"room_timer": serialize_timer(timer)}


@app.post("/api/feedback")
def create_feedback(payload: FeedbackIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    subject = payload.subject.strip()
    message = payload.message.strip()
    if not subject or not message:
        raise HTTPException(status_code=400, detail="Заполните тему и сообщение")
    item = Feedback(user_id=user.id, name=user.username, email=user.email, subject=subject, message=message, type="feedback")
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"feedback": serialize_feedback(item), "message": "Обратная связь отправлена"}


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginIn, request: Request):
    if payload.login != ADMIN_LOGIN or payload.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль админ-панели")
    request.session["admin_logged_in"] = True
    return {"admin": {"login": ADMIN_LOGIN}}


@app.post("/api/admin/logout")
def admin_logout(request: Request):
    request.session.pop("admin_logged_in", None)
    return {"ok": True}


@app.get("/api/admin/me")
def admin_me(_: bool = Depends(require_admin)):
    return {"admin": {"login": ADMIN_LOGIN}}


@app.get("/api/admin/stats")
def admin_stats(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    return {
        "users": db.query(func.count(User.id)).scalar() or 0,
        "rooms": db.query(func.count(Room.id)).scalar() or 0,
        "feedback_new": db.query(func.count(Feedback.id)).filter(Feedback.status == "new").scalar() or 0,
        "sessions": db.query(func.count(FocusSession.id)).scalar() or 0,
    }


@app.get("/api/admin/users")
def admin_users(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return {"users": [serialize_user(user) for user in users]}


@app.post("/api/admin/users")
def admin_create_user(payload: AdminUserCreateIn, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Логин должен быть не короче 3 символов")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не короче 6 символов")
    if db.query(User).filter(or_(User.username == username, User.email == email)).first():
        raise HTTPException(status_code=400, detail="Такой пользователь уже существует")
    recovery_word = (payload.recovery_word or "").strip()
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(payload.password),
        recovery_word_hash=hash_password(recovery_word) if recovery_word else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user": serialize_user(user)}


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: AdminUserUpdateIn, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if payload.username is not None:
        username = payload.username.strip()
        if len(username) < 3:
            raise HTTPException(status_code=400, detail="Логин должен быть не короче 3 символов")
        duplicate = db.query(User).filter(User.username == username, User.id != user_id).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Такой логин уже занят")
        user.username = username
    if payload.email is not None:
        email = payload.email.strip().lower()
        duplicate = db.query(User).filter(User.email == email, User.id != user_id).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Такой email уже занят")
        user.email = email
    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="Пароль должен быть не короче 6 символов")
        user.password_hash = hash_password(payload.password)
    if payload.is_blocked is not None:
        user.is_blocked = bool(payload.is_blocked)
    db.commit()
    db.refresh(user)
    return {"user": serialize_user(user)}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    db.delete(user)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/rooms")
def admin_rooms(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    rooms = db.query(Room).order_by(Room.created_at.desc()).all()
    return {"rooms": [serialize_room(room, None) for room in rooms]}


@app.delete("/api/admin/rooms/{room_id}")
def admin_delete_room(room_id: int, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    db.delete(room)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/feedback")
def admin_feedback(_: bool = Depends(require_admin), db: Session = Depends(get_db)):
    items = db.query(Feedback).order_by(Feedback.created_at.desc()).all()
    return {"feedback": [serialize_feedback(item) for item in items]}


@app.patch("/api/admin/feedback/{feedback_id}")
def admin_update_feedback(feedback_id: int, payload: AdminFeedbackUpdateIn, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    if payload.status not in VALID_FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Неверный статус")
    item = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Запись обратной связи не найдена")
    item.status = payload.status
    db.commit()
    db.refresh(item)
    return {"feedback": serialize_feedback(item)}


@app.delete("/api/admin/feedback/{feedback_id}")
def admin_delete_feedback(feedback_id: int, _: bool = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Запись обратной связи не найдена")
    db.delete(item)
    db.commit()
    return {"ok": True}


@app.websocket("/ws/rooms/{room_id}")
async def room_ws(websocket: WebSocket, room_id: int, token: str):
    user_id = consume_ws_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    db = SessionLocal()
    try:
        member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
        if not member:
            await websocket.close(code=4403)
            return
        await manager.connect(room_id, user_id, websocket)
        await manager.broadcast_room(room_id, {
            "type": "presence",
            "online_user_ids": manager.online_user_ids(room_id),
            "call_participants": manager.get_call_participants(room_id),
        })
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            if event_type == "heartbeat":
                member = db.query(RoomMember).filter(RoomMember.room_id == room_id, RoomMember.user_id == user_id).first()
                if member:
                    member.last_activity_at = utcnow()
                    db.commit()
            elif event_type == "chat_message":
                user = db.query(User).filter(User.id == user_id).first()
                text_value = str(data.get("message") or "").strip()
                if user and text_value:
                    msg = ChatMessage(room_id=room_id, user_id=user.id, username_snapshot=user.username, message=text_value)
                    db.add(msg)
                    db.commit()
                    db.refresh(msg)
                    await manager.broadcast_room(room_id, {"type": "chat_message", "message": serialize_message(msg)})
            elif event_type == "call_join":
                await manager.add_call_participant(room_id, user_id)
                await manager.broadcast_room(room_id, {
                    "type": "call_join",
                    "user_id": user_id,
                    "call_participants": manager.get_call_participants(room_id),
                })
            elif event_type == "call_leave":
                await manager.remove_call_participant(room_id, user_id)
                await manager.broadcast_room(room_id, {
                    "type": "call_leave",
                    "user_id": user_id,
                    "call_participants": manager.get_call_participants(room_id),
                })
            elif event_type == "signal":
                target_user_id = int(data.get("target_user_id") or 0)
                payload = data.get("data") or {}
                if target_user_id and target_user_id != user_id:
                    await manager.send_to_user(room_id, target_user_id, {
                        "type": "signal",
                        "from_user_id": user_id,
                        "data": payload,
                    })
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(room_id, user_id)
        await manager.broadcast_room(room_id, {
            "type": "presence",
            "online_user_ids": manager.online_user_ids(room_id),
            "call_participants": manager.get_call_participants(room_id),
        })
        await manager.broadcast_room(room_id, {
            "type": "call_leave",
            "user_id": user_id,
            "call_participants": manager.get_call_participants(room_id),
        })
        db.close()


@app.get("/")
def spa_index():
    index_path = FRONTEND_DIST / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"message": "FocusRoom API работает. Для React-сайта запустите frontend на порту 5173 или выполните npm run build."})


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    index_path = FRONTEND_DIST / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Файл не найден")


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=False)
