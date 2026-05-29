import { useState } from "react";
import { api } from "../api.js";
import { ErrorBox } from "./Ui.jsx";

export default function AuthPanel({ onSuccess }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loginForm, setLoginForm] = useState({ login: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", email: "", password: "", recovery_word: "" });
  const [forgotForm, setForgotForm] = useState({ login: "", recovery_word: "", message: "" });

  const run = async (fn) => {
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitLogin = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await api("/api/auth/login", { method: "POST", body: loginForm });
      onSuccess(data.user);
    });
  };

  const submitRegister = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await api("/api/auth/register", { method: "POST", body: registerForm });
      onSuccess(data.user);
    });
  };

  const submitForgot = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await api("/api/auth/forgot-password", { method: "POST", body: forgotForm });
      setMessage(data.message || "Запрос отправлен");
      setForgotForm({ login: "", recovery_word: "", message: "" });
    });
  };

  return (
    <main className="auth-shell">
      <section className="auth-card glass">
        <div className="auth-head">
          <div className="logo-mark">FR</div>
          <div><p className="eyebrow">FocusRoom</p><h1>Вход в приложение</h1></div>
        </div>
        <div className="tabs compact">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button>
          <button className={mode === "forgot" ? "active" : ""} onClick={() => setMode("forgot")}>Забыли пароль?</button>
        </div>
        <ErrorBox error={error} onClose={() => setError("")} />
        {message && <div className="success-box">{message}</div>}

        {mode === "login" && (
          <form className="form" onSubmit={submitLogin}>
            <label><span>Логин или email</span><input value={loginForm.login} onChange={(e) => setLoginForm({ ...loginForm, login: e.target.value })} required /></label>
            <label><span>Пароль</span><input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required /></label>
            <button className="primary-btn" type="submit">Войти</button>
            <button className="link-like" type="button" onClick={() => setMode("forgot")}>Забыли пароль?</button>
          </form>
        )}

        {mode === "register" && (
          <form className="form" onSubmit={submitRegister}>
            <label><span>Имя пользователя</span><input value={registerForm.username} onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })} required /></label>
            <label><span>Email</span><input type="email" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} required /></label>
            <label><span>Пароль</span><input type="password" value={registerForm.password} onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })} minLength={6} required /></label>
            <label><span>Кодовое слово для восстановления <small className="muted">необязательно</small></span><input value={registerForm.recovery_word} onChange={(e) => setRegisterForm({ ...registerForm, recovery_word: e.target.value })} placeholder="Придумайте любое слово или фразу" /></label>
            <p className="form-hint">Это слово не нужно для регистрации. Оно понадобится только администратору, если вы забудете пароль.</p>
            <button className="primary-btn" type="submit">Создать аккаунт</button>
          </form>
        )}

        {mode === "forgot" && (
          <form className="form" onSubmit={submitForgot}>
            <label><span>Логин или email</span><input value={forgotForm.login} onChange={(e) => setForgotForm({ ...forgotForm, login: e.target.value })} required /></label>
            <label><span>Кодовое слово восстановления <small className="muted">если задавали</small></span><input value={forgotForm.recovery_word} onChange={(e) => setForgotForm({ ...forgotForm, recovery_word: e.target.value })} placeholder="Необязательно, но ускорит восстановление" /></label>
            <label><span>Комментарий</span><textarea value={forgotForm.message} onChange={(e) => setForgotForm({ ...forgotForm, message: e.target.value })} placeholder="Что написать администратору" /></label>
            <button className="primary-btn" type="submit">Отправить запрос</button>
          </form>
        )}
      </section>
    </main>
  );
}
