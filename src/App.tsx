const priorities = ['dobro użytkownika', 'prywatność', 'szybkość', 'wygoda', 'automatyzacja', 'wygląd'];

const mvpAreas = [
  { title: 'Desktop', items: ['tray icon', 'global shortcut', 'start z Windowsem'] },
  { title: 'Voice First', items: ['wake word', 'STT', 'TTS', 'naturalna rozmowa'] },
  { title: 'AI Agent', items: ['streaming', 'function calling', 'planowanie działań'] },
  { title: 'Memory', items: ['SQLite', 'projekty', 'cele', 'transparentny panel pamięci'] },
  { title: 'Computer', items: ['pliki', 'aplikacje', 'terminal za zgodą'] },
  { title: 'Human First', items: ['nastrój', 'refleksje', 'małe kroki', 'wellbeing'] },
];

export function App() {
  return (
    <main className="shell">
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Human First AI</p>
          <h1>XO</h1>
          <p className="lead">
            Desktopowy asystent AI, który ma być spokojnym, lokalnym centrum pracy,
            pamięci i codziennego wsparcia.
          </p>
        </div>

        <div className="statusPanel" aria-label="Status MVP">
          <span className="pulse" />
          <div>
            <strong>MVP v1</strong>
            <p>Fundament aplikacji gotowy do rozbudowy modułów.</p>
          </div>
        </div>
      </section>

      <section className="priorityBand" aria-labelledby="priority-heading">
        <h2 id="priority-heading">Priorytet produktu</h2>
        <ol>
          {priorities.map((priority) => (
            <li key={priority}>{priority}</li>
          ))}
        </ol>
      </section>

      <section className="moduleGrid" aria-label="Moduły MVP">
        {mvpAreas.map((area) => (
          <article className="moduleCard" key={area.title}>
            <h2>{area.title}</h2>
            <ul>
              {area.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}

