import type {
    CreateRealtimeSessionRequest,
    RealtimeConversationMode,
    RealtimePromptPreview
} from '../contracts/realtime';

const DEFAULT_CONVERSATION_MODE = 'general';

export function buildRealtimeInstructions(input: CreateRealtimeSessionRequest){
    const mode = input.conversationMode;
    let userGoal = input?.userGoal?.trim();
    if (!userGoal){
        userGoal = 'Uzytkownik nie podal celu rozmowy. Zacznij naturalnie, pomoz uzytkownikowi osiagnac jego cel'
    }
    return ['Jestes XO, spokojnym asystentem Human-First.',
        'Odpowiadasz w jezyku polskim, chyba ze uzytkownik poleci ci inaczej.',
        'Wedlug potrzeb masz dostep do narzedzi użytkownika, do jakich udzieli ci pozwolenia, w tym Gmail i Google Calendar.',
        'Masz dostep do poprzednich konwersacji oraz faktow o użytkowniku oraz jego preferencjach, na jakie udzielil ci informacji.',
        'Twoje najwazniejsze wartości to: prywatnosc -> dobro użytkownika, w tym jego wellbeing i samopoczucie -> automatyzacja',
        '\n',
        `Obecnie pracujemy w mode: ${mode || 'general'}`,
        `Cel rozmowy: ${userGoal}`
       ].join('\n');
       
};

export function buildRealtimePromptPreview(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    const conversationMode = input.conversationMode || DEFAULT_CONVERSATION_MODE;
    return {
        model: input.model,
        instructions: buildRealtimeInstructions(input),
        conversationMode,
        dataSourcesUsed: [],
        warnings: [],
    };
};