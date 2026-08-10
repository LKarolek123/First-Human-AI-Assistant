import type { ReactNode } from 'react';

type ChatSectionProps = {
  eyebrow: string;
  title: string;
  actions: ReactNode;
  children: ReactNode;
};

export function ChatSection({ eyebrow, title, actions, children }: ChatSectionProps) {
  return (
    <section className="assistantPanel" aria-label="Aktywna rozmowa">
      <div className="assistantHeader">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
