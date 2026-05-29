export default function Landing({ onStart }) {
  return (
    <main className="landing-shell">
      <section className="landing-card glass">
        <div className="logo-mark large">FR</div>
        <p className="eyebrow">FocusRoom</p>
        <h1>Рабочие комнаты с задачами, чатом, файлами и таймером.</h1>
        <p className="lead">
          Перед входом можно посмотреть, как работает сайт. Комнаты скрыты от чужих пользователей: каждый видит только свои комнаты и входит в новые по коду.
        </p>
        <div className="landing-actions">
          <button className="primary-btn" onClick={onStart}>Войти или зарегистрироваться</button>
          <a className="secondary-btn" href="#tutorial">Как пользоваться</a>
        </div>
      </section>

      <section className="tutorial-grid" id="tutorial">
        <article className="card"><strong>1</strong><h3>Регистрация</h3><p>Введите логин, email и пароль. Кодовое слово можно придумать по желанию — оно нужно только для восстановления доступа.</p></article>
        <article className="card"><strong>2</strong><h3>Комнаты</h3><p>Создайте комнату или войдите по коду. В списке будут только комнаты, к которым у вас есть доступ.</p></article>
        <article className="card"><strong>3</strong><h3>Работа</h3><p>Добавляйте задачи, запускайте личный таймер и общайтесь в комнате.</p></article>
        <article className="card"><strong>4</strong><h3>Обратная связь</h3><p>Отклики и запросы восстановления пароля попадают в админ-панель.</p></article>
      </section>
    </main>
  );
}
