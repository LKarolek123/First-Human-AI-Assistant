type LandingPageProps = {
  language: 'pl' | 'en';
};

const landingCopy = {
  pl: {
    title: 'Co chciałbyś dzisiaj stworzyć?',
    subtitle: 'albo wyślij wiadomość, aby zacząć',
    cards: ['Coding', 'Create an Image', 'Quick Voice Chat', 'Plan'],
  },
  en: {
    title: 'What would you like to create today?',
    subtitle: 'or send me a message to start',
    cards: ['Coding', 'Create an Image', 'Quick Voice Chat', 'Plan'],
  },
};

export function LandingPage({ language }: LandingPageProps) {
  const copy = landingCopy[language];

  return (
    <section className="landingPage" aria-label={copy.title}>
      <h2>{copy.title}</h2>
      <div className="landingCards">
        {copy.cards.map((card) => (
          <button className="landingCard" key={card} type="button">
            {card}
          </button>
        ))}
      </div>
      <p>{copy.subtitle}</p>
    </section>
  );
}
