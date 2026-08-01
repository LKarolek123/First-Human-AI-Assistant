import { describe, expect, it } from 'vitest';
import { buildRealtimeInstructions } from '../src/services/realtimePromptBuilder';

describe('buildRealtimeInstructions', () => {
  it('builds a general realtime prompt without requiring a user goal', () => {
    const instructions = buildRealtimeInstructions();

    expect(instructions).toContain('Jestes XO');
    expect(instructions).toContain('Uzytkownik nie podal celu rozmowy');
    expect(instructions).toContain('Jawna pamiec realtime: brak dodatkowych wpisow.');
  });

  it('includes the trimmed user goal when one is provided', () => {
    const instructions = buildRealtimeInstructions({
      userGoal: '  pomoz mi zaplanowac dzien  ',
    });

    expect(instructions).toContain('Cel rozmowy: pomoz mi zaplanowac dzien');
  });

  it('adds mode-specific guidance for coding conversations', () => {
    const instructions = buildRealtimeInstructions({
      conversationMode: 'coding',
    });

    expect(instructions).toContain('tlumacz przeplyw danych');
    expect(instructions).toContain('male, testowalne kroki');
  });

  it('adds only non-empty memory summary items', () => {
    const instructions = buildRealtimeInstructions({
      memorySummary: ['Uzytkownik uczy sie full stacku.', '   ', 'Preferuje male etapy.'],
    });

    expect(instructions).toContain('- Uzytkownik uczy sie full stacku.');
    expect(instructions).toContain('- Preferuje male etapy.');
    expect(instructions).not.toContain('-    ');
  });
});
