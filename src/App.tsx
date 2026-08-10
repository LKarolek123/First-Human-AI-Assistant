import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatMessage,
  type ConversationSummary,
  type MemoryCategory,
  type MemoryRecord,
  type MemorySuggestion,
  type MemorySuggestionAnalysis,
  createMemoryRecord,
  deleteMemoryRecord,
  getConversationMessages,
  listConversations,
  listMemoryRecords,
  saveMemorySuggestion,
  saveVoiceCallHistory,
  sendChatMessage,
  updateMemoryRecord,
} from './ai/openaiFeedback';
import {
  type CalendarEventSummary,
  type GmailMessageSummary,
  type PluginConnection,
  beginGmailConnect,
  beginGoogleCalendarConnect,
  disconnectGmail,
  disconnectGoogleCalendar,
  finishGmailConnect,
  finishGoogleCalendarConnect,
  getGoogleCalendarConfig,
  listGmailRecentMessages,
  listGoogleCalendarEvents,
  listPluginConnections,
  saveGoogleCalendarClientId,
} from './integrations/plugins';
import {
  type WhisperModelId,
  useWhisperTranscription,
  whisperModelOptions,
} from './voice/useWhisperTranscription';
import { createRealtimeCall, getRealtimeCallConfig } from './ai/realtime';
import { createRealtimeOffer, RealtimeOffer } from './voice/realtimeConnection';
import { Memory } from './Memory';
import { ChatInput } from './ChatInput';
import { LandingPage } from './LandingPage';
import { SidePanel } from './SidePanel';
import { ChatSection } from './ChatSection';

const memoryAspects = [
  {
    title: 'Fakty o uzytkowniku',
    items: [
      'stale preferencje i zasady pracy',
      'projekty, role i dlugoterminowe cele',
      'osoby, organizacje i wazne relacje',
    ],
  },
  {
    title: 'Pamiec rozmow',
    items: [
      'najwazniejsze ustalenia z poprzednich chatow',
      'decyzje, ktore maja wplyw na kolejne rozmowy',
      'kontekst, ktory warto streszczac zamiast trzymac w surowej historii',
    ],
  },
  {
    title: 'Pamiec z narzedzi',
    items: [
      'wnioski z kalendarza, nie pelna kopia wydarzen',
      'priorytety z Gmaila, nie cala skrzynka',
      'alerty i rekomendacje z jasnym zrodlem',
    ],
  },
  {
    title: 'Kontrola i prywatnosc',
    items: [
      'kazdy zapis pamieci powinien byc widoczny i edytowalny',
      'uzytkownik powinien moc podejrzec, edytowac i usunac wpis',
      'dane wrazliwe wymagaja ostrozniejszych kategorii i zgody',
    ],
  },
];

const memoryCategories: Array<{ value: MemoryCategory; label: string }> = [
  { value: 'user_fact', label: 'Fakt o uzytkowniku' },
  { value: 'preference', label: 'Preferencja' },
  { value: 'project', label: 'Projekt' },
  { value: 'decision', label: 'Decyzja' },
  { value: 'tool_note', label: 'Wniosek z narzedzia' },
  { value: 'privacy', label: 'Prywatnosc' },
];

const realtimeModelOptions = [
  { value: 'gpt-realtime-mini', label: 'gpt-realtime-mini' },
  { value: 'gpt-realtime', label: 'gpt-realtime' },
] as const;

const realtimeEffortOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

type UiLanguage = 'pl' | 'en';

const uiCopy = {
  pl: {
    plugins: 'Wtyczki',
    memory: 'Pamięć',
    chats: 'Chaty',
    newChat: 'Nowy chat',
    chat: 'Czat',
    newConversation: 'Nowa rozmowa',
    incognito: 'Incognito',
    normalMode: 'Normalny',
    languageButton: 'English',
    localAccount: 'konto lokalne',
    profile: 'Profil',
    settings: 'Ustawienia',
    privacy: 'Prywatność',
    userLabel: 'Ty',
    assistantLabel: 'Assistant',
    emptyChatTitle: 'Nowa rozmowa jest gotowa.',
    emptyChatBody: 'Wyślij wiadomość, aby rozpocząć.',
    thinking: 'myślę...',
    composerFooter: 'Dyktafon zamieni głos na tekst. Calling uruchamia rozmowę realtime.',
    activeVoiceCall: 'Aktywne połączenie głosowe',
    realtimeVoice: 'Głos realtime',
    callingStatus: 'Dzwonienie...',
    disconnect: 'Rozłącz',
    saveHistoryQuestion: 'Czy zapisać historię chatu?',
    no: 'Nie',
    yes: 'Tak',
    saving: 'Zapisuję',
    voiceTranscript: 'Transkrypcja chatu głosowego',
    liveTranscript: 'Transkrypcja live',
    conversationTranscript: 'Transkrypcja rozmowy',
    preview: 'podgląd',
    addContext: 'Dodaj kontekst',
    file: 'Plik',
    calendar: 'Kalendarz',
    messagePlaceholder: 'Napisz wiadomość...',
    send: 'Wyślij',
    messageTools: 'Narzędzia wiadomości',
    stopDictation: 'Zatrzymaj dyktafon',
    dictation: 'Dyktafon',
    calling: 'Calling',
    unsupportedBrowser: 'Ta przeglądarka nie udostępnia nagrywania audio przez MediaRecorder.',
    loadingWhisperPlaceholder: 'Ładuję model Whisper. Pierwszy raz może potrwać dłużej.',
    recordingPlaceholder: 'Mów po polsku. Po 3 sekundach ciszy XO sam zakończy nagranie i wyśle wiadomość.',
    transcribingPlaceholder: 'Przepisuję nagranie i przygotowuję automatyczną wysyłkę...',
    idleTranscriptPlaceholder: 'Kliknij Nagraj, powiedz coś po polsku, a XO wyśle wiadomość po wykryciu pauzy.',
    memoryPanelLabel: 'Pamięć Assistant',
    memoryTitle: 'Pamięć Assistant',
    memoryEntrySingular: 'wpis',
    memoryEntryPlural: 'wpisów',
    category: 'Kategoria',
    content: 'Treść',
    memoryContentLabel: 'Co Assistant ma pamiętać',
    memoryPlaceholder: 'Np. Użytkownik woli konkretne odpowiedzi i małe kroki implementacji.',
    addMemory: 'Dodaj pamięć',
    saveChanges: 'Zapisz zmiany',
    cancelEdit: 'Anuluj edycję',
    edit: 'Edytuj',
    delete: 'Usuń',
    updatedAt: 'aktualizacja',
    emptyMemoryTitle: 'Brak jawnych wpisów pamięci.',
    emptyMemoryBody: 'Dodaj pierwszą rzecz, którą Assistant ma stabilnie pamiętać w kolejnych rozmowach.',
    memorySuggestionsLabel: 'Sugestie pamięci',
    assistantCanRemember: 'Assistant może zapamiętać',
    saved: 'Zapisano',
    save: 'Zapisz',
    reject: 'Odrzuć',
    pluginDrawerLabel: 'Wtyczki',
    integrations: 'Integracje',
    closePlugins: 'Zamknij wtyczki',
    pluginTabsLabel: 'Zakładki wtyczek',
    connectedGoogleAccount: 'Połączono konto Google',
    connectCalendarDescription: 'Połącz kalendarz, aby Assistant mógł prosić Rust o dozwolone informacje z wydarzeń.',
    connectedGmailAccount: 'Połączono Gmail',
    connectGmailDescription: 'Połącz Gmail, aby Assistant mógł prosić Rust o dozwolone podsumowania poczty.',
    read: 'Czytam',
    check: 'Sprawdź',
    disconnectPlugin: 'Odłącz',
    connect: 'Połącz',
    connecting: 'Łączę',
    noDate: 'bez daty',
    noSubject: 'Bez tematu',
    unknownSender: 'nieznany nadawca',
    openLogin: 'Otwórz logowanie',
    copyLink: 'Kopiuj link',
    pluginSettingsLabel: 'Ustawienia wtyczki',
    savedClientSecret: 'zapisany w systemowym sejfie',
    pasteGoogleSecret: 'wklej z Google Cloud / JSON',
    clientSecretStored: 'Client Secret jest już zapisany lokalnie.',
    backendKeepsSecret: 'Po zapisaniu backend trzyma sekret w systemowym sejfie.',
    saveSettings: 'Zapisz ustawienia',
    memoryCategory_user_fact: 'Fakt o użytkowniku',
    memoryCategory_preference: 'Preferencja',
    memoryCategory_project: 'Projekt',
    memoryCategory_decision: 'Decyzja',
    memoryCategory_tool_note: 'Wniosek z narzędzia',
    memoryCategory_privacy: 'Prywatność',
    memoryAspectUserFactsTitle: 'Fakty o użytkowniku',
    memoryAspectUserFactsItem1: 'stałe preferencje i zasady pracy',
    memoryAspectUserFactsItem2: 'projekty, role i długoterminowe cele',
    memoryAspectUserFactsItem3: 'osoby, organizacje i ważne relacje',
    memoryAspectConversationsTitle: 'Pamięć rozmów',
    memoryAspectConversationsItem1: 'najważniejsze ustalenia z poprzednich chatów',
    memoryAspectConversationsItem2: 'decyzje, które mają wpływ na kolejne rozmowy',
    memoryAspectConversationsItem3: 'kontekst, który warto streszczać zamiast trzymać w surowej historii',
    memoryAspectToolsTitle: 'Pamięć z narzędzi',
    memoryAspectToolsItem1: 'wnioski z kalendarza, nie pełna kopia wydarzeń',
    memoryAspectToolsItem2: 'priorytety z Gmaila, nie cała skrzynka',
    memoryAspectToolsItem3: 'alerty i rekomendacje z jasnym źródłem',
    memoryAspectPrivacyTitle: 'Kontrola i prywatność',
    memoryAspectPrivacyItem1: 'każdy zapis pamięci powinien być widoczny i edytowalny',
    memoryAspectPrivacyItem2: 'użytkownik powinien móc podejrzeć, edytować i usunąć wpis',
    memoryAspectPrivacyItem3: 'dane wrażliwe wymagają ostrożniejszych kategorii i zgody',
    whisperTiny: 'Szybki',
    whisperBase: 'Zbalansowany',
    whisperSmall: 'Dokładny',
  },
  en: {
    plugins: 'Plugins',
    memory: 'Memory',
    chats: 'Chats',
    newChat: 'New chat',
    chat: 'Chat',
    newConversation: 'New conversation',
    incognito: 'Incognito',
    normalMode: 'Normal mode',
    languageButton: 'Polski',
    localAccount: 'local account',
    profile: 'Profile',
    settings: 'Settings',
    privacy: 'Privacy',
    userLabel: 'You',
    assistantLabel: 'Assistant',
    emptyChatTitle: 'New conversation is ready.',
    emptyChatBody: 'Send a message to start.',
    thinking: 'thinking...',
    composerFooter: 'Dictation turns voice into text. Calling starts a realtime conversation.',
    activeVoiceCall: 'Active voice connection',
    realtimeVoice: 'Realtime voice',
    callingStatus: 'Calling...',
    disconnect: 'Disconnect',
    saveHistoryQuestion: 'Save chat history?',
    no: 'No',
    yes: 'Yes',
    saving: 'Saving',
    voiceTranscript: 'Voice chat transcript',
    liveTranscript: 'Live transcript',
    conversationTranscript: 'Conversation transcript',
    preview: 'preview',
    addContext: 'Add context',
    file: 'File',
    calendar: 'Calendar',
    messagePlaceholder: 'Send a message...',
    send: 'Send',
    messageTools: 'Message tools',
    stopDictation: 'Stop dictation',
    dictation: 'Dictation',
    calling: 'Calling',
    unsupportedBrowser: 'This browser does not expose audio recording through MediaRecorder.',
    loadingWhisperPlaceholder: 'Loading the Whisper model. The first run may take longer.',
    recordingPlaceholder: 'Speak in English. After 3 seconds of silence XO will finish recording and send the message.',
    transcribingPlaceholder: 'Transcribing the recording and preparing automatic send...',
    idleTranscriptPlaceholder: 'Click Record, speak, and XO will send the message after detecting a pause.',
    memoryPanelLabel: 'Assistant memory',
    memoryTitle: 'Assistant Memory',
    memoryEntrySingular: 'entry',
    memoryEntryPlural: 'entries',
    category: 'Category',
    content: 'Content',
    memoryContentLabel: 'What Assistant should remember',
    memoryPlaceholder: 'E.g. The user prefers concise answers and small implementation steps.',
    addMemory: 'Add memory',
    saveChanges: 'Save changes',
    cancelEdit: 'Cancel edit',
    edit: 'Edit',
    delete: 'Delete',
    updatedAt: 'updated',
    emptyMemoryTitle: 'No explicit memory entries.',
    emptyMemoryBody: 'Add the first stable thing Assistant should remember in future conversations.',
    memorySuggestionsLabel: 'Memory suggestions',
    assistantCanRemember: 'Assistant can remember',
    saved: 'Saved',
    save: 'Save',
    reject: 'Reject',
    pluginDrawerLabel: 'Plugins',
    integrations: 'Integrations',
    closePlugins: 'Close plugins',
    pluginTabsLabel: 'Plugin tabs',
    connectedGoogleAccount: 'Google account connected',
    connectCalendarDescription: 'Connect Calendar so Assistant can ask Rust for allowed event information.',
    connectedGmailAccount: 'Gmail connected',
    connectGmailDescription: 'Connect Gmail so Assistant can ask Rust for allowed email summaries.',
    read: 'Reading',
    check: 'Check',
    disconnectPlugin: 'Disconnect',
    connect: 'Connect',
    connecting: 'Connecting',
    noDate: 'no date',
    noSubject: 'No subject',
    unknownSender: 'unknown sender',
    openLogin: 'Open login',
    copyLink: 'Copy link',
    pluginSettingsLabel: 'Plugin settings',
    savedClientSecret: 'saved in the system vault',
    pasteGoogleSecret: 'paste from Google Cloud / JSON',
    clientSecretStored: 'Client Secret is already stored locally.',
    backendKeepsSecret: 'After saving, the backend keeps the secret in the system vault.',
    saveSettings: 'Save settings',
    memoryCategory_user_fact: 'User fact',
    memoryCategory_preference: 'Preference',
    memoryCategory_project: 'Project',
    memoryCategory_decision: 'Decision',
    memoryCategory_tool_note: 'Tool insight',
    memoryCategory_privacy: 'Privacy',
    memoryAspectUserFactsTitle: 'User facts',
    memoryAspectUserFactsItem1: 'stable preferences and work rules',
    memoryAspectUserFactsItem2: 'projects, roles, and long-term goals',
    memoryAspectUserFactsItem3: 'people, organizations, and important relationships',
    memoryAspectConversationsTitle: 'Conversation memory',
    memoryAspectConversationsItem1: 'key decisions from previous chats',
    memoryAspectConversationsItem2: 'decisions that affect future conversations',
    memoryAspectConversationsItem3: 'context worth summarizing instead of keeping as raw history',
    memoryAspectToolsTitle: 'Tool memory',
    memoryAspectToolsItem1: 'calendar insights, not full event copies',
    memoryAspectToolsItem2: 'Gmail priorities, not the whole inbox',
    memoryAspectToolsItem3: 'alerts and recommendations with clear source',
    memoryAspectPrivacyTitle: 'Control and privacy',
    memoryAspectPrivacyItem1: 'every memory entry should be visible and editable',
    memoryAspectPrivacyItem2: 'the user should be able to view, edit, and delete entries',
    memoryAspectPrivacyItem3: 'sensitive data requires stricter categories and consent',
    whisperTiny: 'Fast',
    whisperBase: 'Balanced',
    whisperSmall: 'Accurate',
  },
} satisfies Record<UiLanguage, Record<string, string>>;

type ChatMemorySuggestion = MemorySuggestion & {
  draftCategory: MemorySuggestion['category'];
  draftContent: string;
  isEditing: boolean;
  status: 'pending' | 'saving' | 'saved';
  error: string | null;
};

type RealtimeModelId = (typeof realtimeModelOptions)[number]['value'];
type RealtimeEffort = (typeof realtimeEffortOptions)[number]['value'];
type VoiceCallStatus = 'idle' |'connecting' |'calling' | 'saving' | 'failed';
type VoiceCallTranscriptLine = {
  id: string;
  speaker: 'system' | 'user' | 'assistant';
  text: string;
};

export function App() {
  const {
    error,
    inputLevel,
    isSupported,
    loadModel,
    loadState,
    modelId,
    peakInputLevel,
    recordingState,
    resetTranscript,
    setModelId,
    startRecording,
    stopRecording,
    transcript,
  } = useWhisperTranscription();

  const [typedPrompt, setTypedPrompt] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatState, setChatState] = useState<'idle' | 'loading'>('idle');
  const [pluginConnections, setPluginConnections] = useState<PluginConnection[]>([]);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginState, setPluginState] = useState<'idle' | 'savingConfig' | 'connecting' | 'loadingEvents' | 'loadingMail'>('idle');
  const [connectingPlugin, setConnectingPlugin] = useState<'calendar' | 'gmail' | null>(null);
  const [pluginNotice, setPluginNotice] = useState<string | null>(null);
  const [lastAuthUrl, setLastAuthUrl] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [hasGoogleClientId, setHasGoogleClientId] = useState(false);
  const [hasGoogleClientSecret, setHasGoogleClientSecret] = useState(false);
  const [activeWorkspaceView, setActiveWorkspaceView] = useState<'chat' | 'memory'>('chat');
  const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false);
  const [activePluginMenuTab, setActivePluginMenuTab] = useState<'calendar' | 'gmail'>('calendar');
  const [isPluginSettingsOpen, setIsPluginSettingsOpen] = useState(false);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isVoiceModelMenuOpen, setIsVoiceModelMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isIncognitoMode, setIsIncognitoMode] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('pl');
  const [voiceCallStatus, setVoiceCallStatus] = useState<VoiceCallStatus>('idle');
  const [realtimeModelId, setRealtimeModelId] = useState<RealtimeModelId>('gpt-realtime-mini');
  const [realtimeEffort, setRealtimeEffort] = useState<RealtimeEffort>('medium');
  const [voiceCallTranscriptLines, setVoiceCallTranscriptLines] = useState<
    VoiceCallTranscriptLine[]
  >([]);
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>('preference');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [memoryState, setMemoryState] = useState<'idle' | 'saving' | 'deleting'>('idle');
  const [chatMemorySuggestions, setChatMemorySuggestions] = useState<
    Record<string, ChatMemorySuggestion[]>
  >({});
  const [chatMemorySuggestionAnalyses, setChatMemorySuggestionAnalyses] = useState<
    Record<string, MemorySuggestionAnalysis>
  >({});

  const [shouldAskToSaveVoiceCall, setShouldAskToSaveVoiceCall] = useState(false);
  const autoSubmittedTranscriptRef = useRef('');

  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const voiceModelMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const realtimeOfferRef = useRef<RealtimeOffer | null>(null);
  const realtimeRemoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeAssistantLineIdsRef = useRef<Record<string, string>>({});

  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';
  const promptText = typedPrompt.trim();
  const canSend = promptText.length > 0 && chatState !== 'loading';
  const copy = uiCopy[uiLanguage];
  const localizedMemoryCategories = useMemo(
    () =>
      memoryCategories.map((category) => ({
        ...category,
        label: copy[`memoryCategory_${category.value}`] ?? category.label,
      })),
    [copy],
  );
  const localizedMemoryAspects = useMemo(
    () => [
      {
        title: copy.memoryAspectUserFactsTitle,
        items: [
          copy.memoryAspectUserFactsItem1,
          copy.memoryAspectUserFactsItem2,
          copy.memoryAspectUserFactsItem3,
        ],
      },
      {
        title: copy.memoryAspectConversationsTitle,
        items: [
          copy.memoryAspectConversationsItem1,
          copy.memoryAspectConversationsItem2,
          copy.memoryAspectConversationsItem3,
        ],
      },
      {
        title: copy.memoryAspectToolsTitle,
        items: [copy.memoryAspectToolsItem1, copy.memoryAspectToolsItem2, copy.memoryAspectToolsItem3],
      },
      {
        title: copy.memoryAspectPrivacyTitle,
        items: [
          copy.memoryAspectPrivacyItem1,
          copy.memoryAspectPrivacyItem2,
          copy.memoryAspectPrivacyItem3,
        ],
      },
    ],
    [copy],
  );
  const localizedWhisperModelOptions = useMemo(
    () =>
      whisperModelOptions.map((option) => ({
        ...option,
        label:
          option.id === 'Xenova/whisper-tiny'
            ? copy.whisperTiny
            : option.id === 'Xenova/whisper-small'
              ? copy.whisperSmall
              : copy.whisperBase,
      })),
    [copy],
  );

  const hasVoiceCallHistory = voiceCallTranscriptLines.some(
    (line) => line.speaker === 'user' || line.speaker === 'assistant',
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const activeWhisperModel = useMemo(
    () => localizedWhisperModelOptions.find((option) => option.id === modelId) ?? localizedWhisperModelOptions[0],
    [localizedWhisperModelOptions, modelId],
  );
  const googleCalendarConnection = useMemo(
    () => pluginConnections.find((connection) => connection.provider === 'google_calendar') ?? null,
    [pluginConnections],
  );
  const gmailConnection = useMemo(
    () => pluginConnections.find((connection) => connection.provider === 'gmail') ?? null,
    [pluginConnections],
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (isContextMenuOpen && !contextMenuRef.current?.contains(target)) {
        setIsContextMenuOpen(false);
      }

      if (isVoiceModelMenuOpen && !voiceModelMenuRef.current?.contains(target)) {
        setIsVoiceModelMenuOpen(false);
      }

      if (isAccountMenuOpen && !accountMenuRef.current?.contains(target)) {
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isAccountMenuOpen, isContextMenuOpen, isVoiceModelMenuOpen]);

  useEffect(() => {
    let isMounted = true;

    listPluginConnections()
      .then((connections) => {
        if (isMounted) {
          setPluginConnections(connections);
        }
      })
      .catch((loadError) => setPluginError(getErrorMessage(loadError)));

    getGoogleCalendarConfig()
      .then((config) => {
        if (!isMounted) {
          return;
        }

        setGoogleClientId(config.client_id ?? '');
        setHasGoogleClientId(config.has_client_id);
        setHasGoogleClientSecret(config.has_client_secret);
      })
      .catch((loadError) => setPluginError(getErrorMessage(loadError)));

    listConversations()
      .then((nextConversations) => {
        if (!isMounted) {
          return;
        }

        setConversations(nextConversations);

        if (nextConversations[0]) {
          setActiveConversationId(nextConversations[0].id);
        }
      })
      .catch((loadError) => setChatError(getErrorMessage(loadError)));

    listMemoryRecords()
      .then((nextMemoryRecords) => {
        if (isMounted) {
          setMemoryRecords(nextMemoryRecords);
        }
      })
      .catch((loadError) => setMemoryError(getErrorMessage(loadError)));

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (pluginState !== 'connecting' || !connectingPlugin) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const finishConnect =
        connectingPlugin === 'gmail' ? finishGmailConnect : finishGoogleCalendarConnect;

      finishConnect()
        .then((progress) => {
          if (progress.status !== 'connected' || !progress.connection) {
            return;
          }

          const connection = progress.connection;
          setPluginConnections((connections) => upsertPluginConnection(connections, connection));
          setPluginError(null);
          setPluginNotice('Polaczenie zakonczone.');
          setLastAuthUrl(null);
          setPluginState('idle');
          setConnectingPlugin(null);
          window.clearInterval(intervalId);
        })
        .catch((connectError) => {
          setPluginError(getErrorMessage(connectError));
          setPluginState('idle');
          setConnectingPlugin(null);
          window.clearInterval(intervalId);
        });
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [connectingPlugin, pluginState]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    let isMounted = true;

    getConversationMessages(activeConversationId)
      .then((nextMessages) => {
        if (isMounted) {
          setMessages(nextMessages);
        }
      })
      .catch((loadError) => setChatError(getErrorMessage(loadError)));

    return () => {
      isMounted = false;
    };
  }, [activeConversationId]);

  const submitChatInput = useCallback(async (input: string, restoreOnError = true) => {
    setTypedPrompt('');
    setChatError(null);
    setChatState('loading');

    try {
      const response = await sendChatMessage({
        conversationId: activeConversationId,
        input,
      });

      setActiveConversationId(response.conversation.id);
      setMessages((currentMessages) => [
        ...currentMessages,
        response.user_message,
        response.assistant_message,
      ]);
      setChatMemorySuggestions((currentSuggestions) => ({
        ...currentSuggestions,
        [response.assistant_message.id]: response.memory_suggestions.map((suggestion) => ({
          ...suggestion,
          draftCategory: suggestion.category,
          draftContent: suggestion.content,
          isEditing: false,
          status: 'pending',
          error: null,
        })),
      }));
      setChatMemorySuggestionAnalyses((currentAnalyses) => ({
        ...currentAnalyses,
        [response.assistant_message.id]: response.memory_suggestion_analysis,
      }));
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, response.conversation),
      );

      return true;
    } catch (sendError) {
      if (restoreOnError) {
        setTypedPrompt(input);
      }
      setChatError(getErrorMessage(sendError));

      return false;
    } finally {
      setChatState('idle');
    }
  }, [activeConversationId]);

  useEffect(() => {
    const voiceInput = transcript.trim();

    if (!voiceInput || recordingState !== 'idle' || chatState !== 'idle') {
      return;
    }

    if (autoSubmittedTranscriptRef.current === voiceInput) {
      return;
    }

    autoSubmittedTranscriptRef.current = voiceInput;
    void submitChatInput(voiceInput, false).then((wasSent) => {
      if (wasSent) {
        resetTranscript();
      }
    });
  }, [chatState, recordingState, resetTranscript, submitChatInput, transcript]);

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!promptText) {
      setChatError('Wpisz wiadomosc.');
      return;
    }

    await submitChatInput(promptText);
  }

  function handleNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setTypedPrompt('');
    setChatError(null);
  }

  function handleClearPrompt() {
    setTypedPrompt('');
    resetTranscript();
    setChatError(null);
  }

  function handleVoiceButton() {
    if (isRecording) {
      stopRecording();
      return;
    }

    autoSubmittedTranscriptRef.current = '';
    void startRecording();
  }

  function handleResetTranscript() {
    autoSubmittedTranscriptRef.current = '';
    resetTranscript();
  }

  function handlePromptInputChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setTypedPrompt(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
  }

  function handleVoiceCallDisconnect() {
    realtimeOfferRef.current?.localStream.getTracks().forEach((track) => track.stop());
    realtimeOfferRef.current?.peerConnection.close();
    realtimeOfferRef.current = null;

    if (realtimeRemoteAudioRef.current) {
      realtimeRemoteAudioRef.current.pause();
      realtimeRemoteAudioRef.current.srcObject = null;
    }

    realtimeAssistantLineIdsRef.current = {};

    if (!hasVoiceCallHistory) {
      setVoiceCallStatus('idle');
      setVoiceCallTranscriptLines([]);
      setShouldAskToSaveVoiceCall(false);
      return;
    }

    setShouldAskToSaveVoiceCall(true);
  }

  async function handleSaveVoiceCallHistory() {
    setVoiceCallStatus('saving');

    try {
      const historyLines = voiceCallTranscriptLines
        .filter((line) => line.speaker === 'user' || line.speaker === 'assistant')
        .map((line) => ({
          role: line.speaker as 'user' | 'assistant',
          content: line.text,
        }));
      const response = await saveVoiceCallHistory(historyLines);

      setConversations((currentConversations) =>
        upsertConversation(currentConversations, response.conversation),
      );
      setActiveConversationId(response.conversation.id);
      setMessages(response.messages);
      setChatError(null);
      setShouldAskToSaveVoiceCall(false);
      setVoiceCallTranscriptLines([]);
      setVoiceCallStatus('idle');
      console.log('Voice history lines to save', historyLines);
      // to linijki z naszym chatem
      
    } catch (saveError) {
      setChatError(getErrorMessage(saveError));
      setVoiceCallStatus('calling');
      console.log(saveError);
    }
  }

  function handleDiscardVoiceCallHistory() {
    setShouldAskToSaveVoiceCall(false);
    setVoiceCallStatus('idle');
    setVoiceCallTranscriptLines([]);
  }

  async function handleVoiceCallToggle() {
    if (voiceCallStatus === 'calling') {
      handleVoiceCallDisconnect();
      return;
    }

    setShouldAskToSaveVoiceCall(false);
    setVoiceCallStatus('calling');
    console.log("Dzwonienie ===================================");
    realtimeAssistantLineIdsRef.current = {};
    setVoiceCallTranscriptLines([
      {
        id: crypto.randomUUID(),
        speaker: 'system',
        text: 'Dzwonienie. Transkrypcja live pojawi sie tutaj po podlaczeniu Realtime.',
      },
    ]);
    const config = await getRealtimeCallConfig({
      model: realtimeModelId,
      effort: realtimeEffort,
      conversationMode: 'coding',
    });

    // console.log('Realtime call config', config);

    const offer = await createRealtimeOffer();

    offer.dataChannel.onmessage = (event) => {
      const realtimeEvent = JSON.parse(event.data);


      // if (
      //   realtimeEvent.type.includes('transcript') ||
      //   realtimeEvent.type.includes('response.output')
      // ) {
      //   // console.log('Realtime transcript candidate', realtimeEvent);
      // }


      if (realtimeEvent.type === 'conversation.item.input_audio_transcription.completed') {
        // console.log('User transcript', realtimeEvent.transcript);
        const transcript = realtimeEvent.transcript?.trim();
        if (!transcript) {
          return;
        }

        setVoiceCallTranscriptLines((currentLines) => {
          const userLine = {
            id: crypto.randomUUID(),
            speaker: 'user' as const,
            text: transcript,
          };

          const lastLine = currentLines[currentLines.length - 1];

          if (lastLine?.speaker === 'assistant') {
            return [
              ...currentLines.slice(0, -1),
              userLine,
              lastLine,
            ];
          }

          return [
            ...currentLines,
            userLine,
          ];
        });

        return;
      };


      if (realtimeEvent.type === 'response.output_audio_transcript.delta') {
        // console.log('AI message transcript', realtimeEvent.transcript);
        const delta = realtimeEvent.delta;
        const itemId = realtimeEvent.item_id;
        // console.log('AI delta fields', {
        //  delta,
        //  itemId,
        // });
        
        if (!delta || !itemId){
          return;
        }

        setVoiceCallTranscriptLines((currentLines) => {

          // console.log('Before assistant state update', {
          //   currentLines,
          //   delta,
          //   itemId,
          //   existingLineId: realtimeAssistantLineIdsRef.current[itemId],
          // });

          // const lastLine = currentLines[currentLines.length - 1];

          // if (lastLine?.speaker === 'assistant') {
          //   return currentLines.map((line, index) => 
          //     index === currentLines.length - 1
          //     ? {...line, text: line.text + delta}
          //     : line
          //   );
          // }

          const existingLineId =realtimeAssistantLineIdsRef.current[itemId];

          if (existingLineId && currentLines.some((line) => line.id === existingLineId)) {
            // console.log('Updating assistant line', {
            //   existingLineId,
            //   delta,
            // });
            return currentLines.map((line) =>
              line.id === existingLineId
              ? {...line, text: line.text + delta}
              : line,
            );
          }
          const lineId = crypto.randomUUID();
          realtimeAssistantLineIdsRef.current[itemId] = lineId;

          //  console.log('Creating assistant line', {
          //     lineId,
          //     delta,
          //  });

          return [
            ...currentLines, 
            {
              id: lineId,
              speaker: 'assistant',
              text: delta,
            },
          ];
        });
      return;
      };

      // console.log('Realtime event type', realtimeEvent.type);
      // if (
      //   realtimeEvent.type.includes('transcript') ||
      //   realtimeEvent.type.includes('response.output')
      // ) {
      //   // console.log('Realtime transcript candidate', realtimeEvent);
      // }

      if (realtimeEvent.type === 'response.output_audio_transcript.done') {
        const transcript = realtimeEvent.transcript?.trim();
        const itemId = realtimeEvent.item_id;

        if (!transcript || !itemId) {
          return;
        }

        const existingLine = realtimeAssistantLineIdsRef.current[itemId];

        if (!existingLine) {
          return;
        }

        setVoiceCallTranscriptLines((currentLines) => 
          currentLines.map((line) =>
            line.id === existingLine ? {...line, text: transcript}
            : line,
          ),
        );
        return;
      }
  };

    offer.peerConnection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      const audioElement = realtimeRemoteAudioRef.current;

      if (!remoteStream || !audioElement){
        return;
      }
      audioElement.srcObject = remoteStream;

      void audioElement.play().catch((playError) => {
        console.log('Realtime audio playback failed', playError);
      });
    };

    offer.peerConnection.onconnectionstatechange = () => {
      console.log('Realtime connection state', offer.peerConnection.connectionState);
    };

    

    try {
      const response = await createRealtimeCall({
        model: realtimeModelId,
        effort: realtimeEffort,
        conversationMode: 'coding',
        sdpOffer: offer.sdpOffer,
      });

      await offer.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: response.sdpAnswer,
      });
      console.log('Realtime WebRTC connected with preview', response.preview);
      realtimeOfferRef.current = offer;
    } catch {
      setVoiceCallStatus('failed');
      console.log(voiceCallStatus);
      offer.localStream.getTracks().forEach((track) => track.stop());
    }
    
    
    // offer.localStream.getTracks().forEach((track) => track.stop());
    // offer.peerConnection.close();

  }

  async function handleConnectGoogleCalendar() {
    setPluginError(null);
    setPluginNotice(null);
    setLastAuthUrl(null);
    setPluginState('connecting');
    setConnectingPlugin('calendar');

    try {
      const start = await beginGoogleCalendarConnect();
      setLastAuthUrl(start.auth_url);
      setPluginNotice(
        start.opened_browser
          ? 'Otworzylem logowanie Google w przegladarce. Po zgodzie wroc do XO.'
          : `Nie udalo sie automatycznie otworzyc przegladarki: ${start.open_error ?? 'brak szczegolow'}`,
      );
    } catch (connectError) {
      setPluginError(getErrorMessage(connectError));
      setPluginState('idle');
      setConnectingPlugin(null);
    }
  }

  async function handleConnectGmail() {
    setPluginError(null);
    setPluginNotice(null);
    setLastAuthUrl(null);
    setPluginState('connecting');
    setConnectingPlugin('gmail');

    try {
      const start = await beginGmailConnect();
      setLastAuthUrl(start.auth_url);
      setPluginNotice(
        start.opened_browser
          ? 'Otworzylem logowanie Google w przegladarce. Po zgodzie wroc do XO.'
          : `Nie udalo sie automatycznie otworzyc przegladarki: ${start.open_error ?? 'brak szczegolow'}`,
      );
    } catch (connectError) {
      setPluginError(getErrorMessage(connectError));
      setPluginState('idle');
      setConnectingPlugin(null);
    }
  }

  async function handleSaveGoogleCalendarClientId() {
    setPluginError(null);
    setPluginNotice(null);
    setPluginState('savingConfig');

    try {
      const config = await saveGoogleCalendarClientId(googleClientId, googleClientSecret);
      setGoogleClientId(config.client_id ?? '');
      setGoogleClientSecret('');
      setHasGoogleClientId(config.has_client_id);
      setHasGoogleClientSecret(config.has_client_secret);
      setPluginNotice(
        config.has_client_secret
          ? 'Zapisalem Desktop Client ID i Client Secret.'
          : 'Zapisalem Desktop Client ID. Jesli Google nadal zwroci client_secret is missing, wklej tez Desktop Client Secret.',
      );
    } catch (saveError) {
      setPluginError(getErrorMessage(saveError));
    } finally {
      setPluginState('idle');
    }
  }

  async function handleCopyAuthUrl() {
    if (!lastAuthUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(lastAuthUrl);
      setPluginNotice('Skopiowalem link logowania. Wklej go w przegladarce.');
    } catch {
      setPluginError('Nie udalo sie skopiowac linku logowania.');
    }
  }

  async function handleDisconnectGoogleCalendar() {
    setPluginError(null);

    try {
      const connection = await disconnectGoogleCalendar();
      setPluginConnections((connections) => upsertPluginConnection(connections, connection));
      setCalendarEvents([]);
    } catch (disconnectError) {
      setPluginError(getErrorMessage(disconnectError));
    }
  }

  async function handleDisconnectGmail() {
    setPluginError(null);

    try {
      const connection = await disconnectGmail();
      setPluginConnections((connections) => upsertPluginConnection(connections, connection));
      setGmailMessages([]);
    } catch (disconnectError) {
      setPluginError(getErrorMessage(disconnectError));
    }
  }

  async function handleLoadCalendarEvents() {
    setPluginError(null);
    setPluginState('loadingEvents');

    try {
      const events = await listGoogleCalendarEvents(7);
      setCalendarEvents(events);
    } catch (loadError) {
      setPluginError(getErrorMessage(loadError));
    } finally {
      setPluginState('idle');
    }
  }

  async function handleLoadGmailMessages() {
    setPluginError(null);
    setPluginState('loadingMail');

    try {
      const messages = await listGmailRecentMessages();
      setGmailMessages(messages);
    } catch (loadError) {
      setPluginError(getErrorMessage(loadError));
    } finally {
      setPluginState('idle');
    }
  }

  async function handleMemorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!memoryContent.trim()) {
      setMemoryError('Wpis pamieci nie moze byc pusty.');
      return;
    }

    setMemoryError(null);
    setMemoryNotice(null);
    setMemoryState('saving');

    try {
      const savedRecord = editingMemoryId
        ? await updateMemoryRecord(editingMemoryId, memoryCategory, memoryContent)
        : await createMemoryRecord(memoryCategory, memoryContent);

      setMemoryRecords((records) => upsertMemoryRecord(records, savedRecord));
      resetMemoryForm();
      setMemoryNotice(editingMemoryId ? 'Zaktualizowalem wpis pamieci.' : 'Dodano wpis pamieci.');
    } catch (saveError) {
      setMemoryError(getErrorMessage(saveError));
    } finally {
      setMemoryState('idle');
    }
  }

  async function handleDeleteMemoryRecord(id: string) {
    setMemoryError(null);
    setMemoryNotice(null);
    setMemoryState('deleting');

    try {
      await deleteMemoryRecord(id);
      setMemoryRecords((records) => records.filter((record) => record.id !== id));

      if (editingMemoryId === id) {
        resetMemoryForm();
      }

      setMemoryNotice('Usunieto wpis pamieci.');
    } catch (deleteError) {
      setMemoryError(getErrorMessage(deleteError));
    } finally {
      setMemoryState('idle');
    }
  }

  function handleEditMemoryRecord(record: MemoryRecord) {
    setEditingMemoryId(record.id);
    setMemoryCategory(record.category);
    setMemoryContent(record.content);
    setMemoryError(null);
    setMemoryNotice(null);
  }

  function handleEditMemorySuggestion(messageId: string, suggestionId: string) {
    setChatMemorySuggestions((currentSuggestions) =>
      updateChatMemorySuggestion(currentSuggestions, messageId, suggestionId, {
        isEditing: true,
        error: null,
      }),
    );
  }

  function handleRejectMemorySuggestion(messageId: string, suggestionId: string) {
    setChatMemorySuggestions((currentSuggestions) => ({
      ...currentSuggestions,
      [messageId]: (currentSuggestions[messageId] ?? []).filter(
        (suggestion) => suggestion.id !== suggestionId,
      ),
    }));
  }

  function handleChangeMemorySuggestionCategory(
    messageId: string,
    suggestionId: string,
    draftCategory: MemorySuggestion['category'],
  ) {
    setChatMemorySuggestions((currentSuggestions) =>
      updateChatMemorySuggestion(currentSuggestions, messageId, suggestionId, {
        draftCategory,
        error: null,
      }),
    );
  }

  function handleChangeMemorySuggestionContent(
    messageId: string,
    suggestionId: string,
    draftContent: string,
  ) {
    setChatMemorySuggestions((currentSuggestions) =>
      updateChatMemorySuggestion(currentSuggestions, messageId, suggestionId, {
        draftContent,
        error: null,
      }),
    );
  }

  async function handleSaveMemorySuggestion(message: ChatMessage, suggestionId: string) {
    const suggestion = chatMemorySuggestions[message.id]?.find(
      (item) => item.id === suggestionId,
    );

    if (!suggestion) {
      return;
    }

    if (!suggestion.draftContent.trim()) {
      setChatMemorySuggestions((currentSuggestions) =>
        updateChatMemorySuggestion(currentSuggestions, message.id, suggestionId, {
          error: 'Wpis pamieci nie moze byc pusty.',
        }),
      );
      return;
    }

    setChatMemorySuggestions((currentSuggestions) =>
      updateChatMemorySuggestion(currentSuggestions, message.id, suggestionId, {
        status: 'saving',
        error: null,
      }),
    );

    try {
      const savedRecord = await saveMemorySuggestion(
        suggestion.draftCategory,
        suggestion.draftContent,
        message.conversation_id,
      );

      setMemoryRecords((records) => upsertMemoryRecord(records, savedRecord));
      setChatMemorySuggestions((currentSuggestions) =>
        updateChatMemorySuggestion(currentSuggestions, message.id, suggestionId, {
          category: savedRecord.category as MemorySuggestion['category'],
          content: savedRecord.content,
          draftCategory: savedRecord.category as MemorySuggestion['category'],
          draftContent: savedRecord.content,
          isEditing: false,
          status: 'saved',
          error: null,
        }),
      );
      setMemoryNotice('Dodano wpis pamieci z rozmowy.');
    } catch (saveError) {
      setChatMemorySuggestions((currentSuggestions) =>
        updateChatMemorySuggestion(currentSuggestions, message.id, suggestionId, {
          status: 'pending',
          error: getErrorMessage(saveError),
        }),
      );
    }
  }

  function resetMemoryForm() {
    setEditingMemoryId(null);
    setMemoryCategory('preference');
    setMemoryContent('');
  }

  return (
    <main className="shell">
      <section className="chatPanel" aria-labelledby="assistant-heading">
        <SidePanel
          copy={copy}
          activeWorkspaceView={activeWorkspaceView}
          conversations={conversations}
          activeConversationId={activeConversationId}
          isAccountMenuOpen={isAccountMenuOpen}
          accountMenuRef={accountMenuRef}
          onBrandClick={() => {
            setActiveWorkspaceView('chat');
            setActiveConversationId(null);
            setMessages([]);
          }}
          onNewConversation={handleNewConversation}
          onOpenPlugins={() => setIsPluginMenuOpen(true)}
          onWorkspaceViewChange={setActiveWorkspaceView}
          onConversationSelect={setActiveConversationId}
          onAccountToggle={() => setIsAccountMenuOpen((current) => !current)}
        />

        {activeWorkspaceView === 'chat' ? (
          <ChatSection
            eyebrow={copy.chat}
            title={activeConversation?.title ?? copy.newConversation}
            actions={
              <div className="assistantHeaderActions">
                <button
                  className="languageToggle"
                  type="button"
                  onClick={() => setUiLanguage((current) => (current === 'pl' ? 'en' : 'pl'))}
                >
                  <span aria-hidden="true">🇺🇸</span>
                  {copy.languageButton}
                </button>
                <button
                  className={isIncognitoMode ? 'incognitoToggle incognitoToggleActive' : 'incognitoToggle'}
                  type="button"
                  onClick={() => setIsIncognitoMode((current) => !current)}
                  aria-pressed={isIncognitoMode}
                >
                  <span className="incognitoIconWrap" aria-hidden="true">
                    <svg className="incognitoIcon" viewBox="0 0 24 24">
                      <path d="M4 10h16" />
                      <path d="M7 10 9 5h6l2 5" />
                      <circle cx="8" cy="14" r="3" />
                      <circle cx="16" cy="14" r="3" />
                      <path d="M11 14h2" />
                    </svg>
                    {isIncognitoMode && <span className="incognitoSlash" />}
                  </span>
                  {isIncognitoMode ? copy.normalMode : copy.incognito}
                </button>
              </div>
            }
          >

          <div className="messageList" aria-live="polite">
            {!activeConversationId ? (
              <LandingPage language={uiLanguage} />
            ) : messages.length > 0 ? (
              messages.map((message) => (
                <div className="messageGroup" key={message.id}>
                  <article
                    className={message.role === 'user' ? 'messageBubble messageBubbleUser' : 'messageBubble'}
                  >
                    <div className="messageBubbleMeta">
                      <strong>{message.role === 'user' ? 'Ty' : 'Assistant'}</strong>
                      <time dateTime="00:00">00:00</time>
                    </div>
                    <p>{message.content}</p>
                  </article>

                  {message.role === 'assistant' &&
                    (chatMemorySuggestions[message.id] ?? []).length > 0 && (
                      <div className="memorySuggestions" aria-label={copy.memorySuggestionsLabel}>
                        <strong>{copy.assistantCanRemember}</strong>
                        {(chatMemorySuggestions[message.id] ?? []).map((suggestion) => (
                          <article className="memorySuggestion" key={suggestion.id}>
                            {suggestion.isEditing ? (
                              <div className="memorySuggestionEditor">
                                <label className="memoryField">
                                  <span>{copy.category}</span>
                                  <select
                                    value={suggestion.draftCategory}
                                    onChange={(event) =>
                                      handleChangeMemorySuggestionCategory(
                                        message.id,
                                        suggestion.id,
                                        event.target.value as MemorySuggestion['category'],
                                      )
                                    }
                                    disabled={suggestion.status === 'saving'}
                                  >
                                    {localizedMemoryCategories
                                      .filter((category) => category.value !== 'tool_note')
                                      .map((category) => (
                                        <option key={category.value} value={category.value}>
                                          {category.label}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <label className="memoryField">
                                  <span>{copy.content}</span>
                                  <textarea
                                    value={suggestion.draftContent}
                                    onChange={(event) =>
                                      handleChangeMemorySuggestionContent(
                                        message.id,
                                        suggestion.id,
                                        event.target.value,
                                      )
                                    }
                                    disabled={suggestion.status === 'saving'}
                                    rows={3}
                                  />
                                </label>
                              </div>
                            ) : (
                              <div>
                                <small>{getMemoryCategoryLabel(suggestion.category)}</small>
                                <p>{suggestion.content}</p>
                                {suggestion.reason && <span>{suggestion.reason}</span>}
                              </div>
                            )}

                            {suggestion.error && <p className="memorySuggestionError">{suggestion.error}</p>}

                            <div className="memorySuggestionActions">
                              <button
                                className="primaryButton"
                                type="button"
                                onClick={() => handleSaveMemorySuggestion(message, suggestion.id)}
                                disabled={suggestion.status === 'saving' || suggestion.status === 'saved'}
                              >
                                {suggestion.status === 'saving'
                                  ? copy.saving
                                  : suggestion.status === 'saved'
                                    ? copy.saved
                                    : copy.save}
                              </button>
                              {!suggestion.isEditing && suggestion.status !== 'saved' && (
                                <button
                                  className="secondaryButton"
                                  type="button"
                                  onClick={() => handleEditMemorySuggestion(message.id, suggestion.id)}
                                >
                                  {copy.edit}
                                </button>
                              )}
                              {suggestion.status !== 'saved' && (
                                <button
                                  className="secondaryButton"
                                  type="button"
                                  onClick={() => handleRejectMemorySuggestion(message.id, suggestion.id)}
                                  disabled={suggestion.status === 'saving'}
                                >
                                  {copy.reject}
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  {message.role === 'assistant' &&
                    (chatMemorySuggestions[message.id] ?? []).length === 0 &&
                    chatMemorySuggestionAnalyses[message.id] &&
                    chatMemorySuggestionAnalyses[message.id].status !== 'found' && (
                      <div
                        className={
                          chatMemorySuggestionAnalyses[message.id].status === 'error'
                            ? 'memorySuggestionStatus memorySuggestionStatusError'
                            : 'memorySuggestionStatus'
                        }
                      >
                        {chatMemorySuggestionAnalyses[message.id].message}
                      </div>
                    )}
                </div>
              ))
            ) : (
              <div className="emptyChat">
                <strong>Nowa rozmowa jest gotowa.</strong>
                <p>Wyślij wiadomość, aby rozpocząć.</p>
              </div>
            )}

            {chatState === 'loading' && (
              <article className="messageBubble messageBubbleBusy">
                <strong>Assistant</strong>
                <p>mysle...</p>
              </article>
            )}
          </div>

          {chatError && <p className="voiceError">{chatError}</p>}

          <ChatInput
            copy={copy}
            typedPrompt={typedPrompt}
            canSend={canSend}
            chatState={chatState}
            isContextMenuOpen={isContextMenuOpen}
            contextMenuRef={contextMenuRef}
            onContextMenuToggle={() => setIsContextMenuOpen((current) => !current)}
            onPromptInputChange={handlePromptInputChange}
            onSubmit={handleChatSubmit}
            isRecording={isRecording}
            isSupported={isSupported}
            isTranscribing={isTranscribing}
            isBusy={isBusy}
            loadState={loadState}
            error={error}
            transcript={transcript}
            activeWhisperModel={activeWhisperModel}
            whisperModelOptions={localizedWhisperModelOptions}
            modelId={modelId}
            onModelIdChange={setModelId}
            isVoiceModelMenuOpen={isVoiceModelMenuOpen}
            voiceModelMenuRef={voiceModelMenuRef}
            onVoiceModelMenuToggle={() => setIsVoiceModelMenuOpen((current) => !current)}
            onVoiceModelMenuClose={() => setIsVoiceModelMenuOpen(false)}
            onVoiceButton={handleVoiceButton}
            voiceCallStatus={voiceCallStatus}
            onVoiceCallToggle={handleVoiceCallToggle}
            footerText={copy.composerFooter}
            transcriptPlaceholder={getTranscriptPlaceholder(recordingState, loadState, copy)}
          />
            <audio ref={realtimeRemoteAudioRef} autoPlay />
          {voiceCallStatus !== 'idle' && (
            <div className="voiceCallOverlay" role="dialog" aria-modal="true" aria-label="Aktywne polaczenie glosowe">
              <div className="voiceCallDock">
                <section className="voiceModelWindow" aria-label="Model glosowy">
                  <div className="voiceOrb voiceOrbActive" aria-hidden="true">
                    <span className="voiceOrbMist voiceOrbMistOne" />
                    <span className="voiceOrbMist voiceOrbMistTwo" />
                    <span className="voiceOrbCore" />
                  </div>

                  <div className="voiceCallModalCopy">
                    <p className="eyebrow">Realtime voice</p>
                    <h3>Dzwonienie...</h3>
                    <p>
                      {realtimeModelId} | effort {realtimeEffort}
                    </p>
                  </div>
                  {!shouldAskToSaveVoiceCall ? (
                   <button
                     className="voiceButton voiceButtonActive"
                     type="button"
                    onClick={handleVoiceCallToggle}
                     aria-pressed="true"
                   >
                     Rozlacz
                   </button>
                  ) : (
                    <div className="voiceSavePrompt">
                      <p>Czy zapisac historie chatu?</p>
                      <div className="voiceSaveActions">
                        <button
                          className="voiceSaveButton voiceSaveButtonNo"
                          type="button"
                          onClick={handleDiscardVoiceCallHistory}
                          disabled={voiceCallStatus === 'saving'}
                        >
                          Nie
                        </button>
                        <button
                          className="voiceSaveButton voiceSaveButtonYes"
                          type="button"
                          onClick={() => void handleSaveVoiceCallHistory()}
                          disabled={voiceCallStatus === 'saving'}
                        >
                          {voiceCallStatus === 'saving' ? 'Zapisuje' : 'Tak'}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                <section className="voiceTranscriptWindow" aria-label="Transkrypcja chatu glosowego">
                  <div>
                    <p className="eyebrow">Live transcript</p>
                    <h3>Transkrypcja rozmowy</h3>
                  </div>

                  <div className="voiceCallTranscript" aria-live="polite">
                    <div className="voiceCallTranscriptHeader">
                      <strong>Transkrypcja live</strong>
                      <span>preview</span>
                    </div>
                    <div className="voiceCallTranscriptLines">
                      {voiceCallTranscriptLines.map((line) => (
                        <p className={`voiceTranscriptLine voiceTranscriptLine-${line.speaker}`} key={line.id}>
                          <strong>{getVoiceTranscriptSpeakerLabel(line.speaker)}</strong>
                          <span>{line.text}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
          </ChatSection>
        ) : (
          <Memory
            copy={copy}
            memoryAspects={localizedMemoryAspects}
            memoryCategories={localizedMemoryCategories}
            memoryRecords={memoryRecords}
            memoryCategory={memoryCategory}
            memoryContent={memoryContent}
            editingMemoryId={editingMemoryId}
            memoryError={memoryError}
            memoryNotice={memoryNotice}
            memoryState={memoryState}
            onMemorySubmit={handleMemorySubmit}
            onMemoryCategoryChange={setMemoryCategory}
            onMemoryContentChange={setMemoryContent}
            onResetMemoryForm={resetMemoryForm}
            onEditMemoryRecord={handleEditMemoryRecord}
            onDeleteMemoryRecord={handleDeleteMemoryRecord}
            getMemoryCategoryLabel={(category) =>
              localizedMemoryCategories.find((item) => item.value === category)?.label ?? copy.memory
            }
            getMemorySourceLabel={getMemorySourceLabel}
            formatDateTime={formatDateTime}
          />
        )}
      </section>

      {isPluginMenuOpen && (
        <div className="pluginDrawerOverlay" role="dialog" aria-modal="true" aria-label={copy.pluginDrawerLabel}>
          <section className="pluginDrawer">
            <div className="pluginDrawerHeader">
              <div>
                <p className="eyebrow">{copy.plugins}</p>
                <h2>{copy.integrations}</h2>
              </div>
              <button
                className="iconButton"
                type="button"
                onClick={() => setIsPluginMenuOpen(false)}
                title={copy.closePlugins}
              >
                x
              </button>
            </div>

            <div className="pluginDrawerLayout">
              <div className="pluginDrawerMain">
                <div className="workspaceTabs" aria-label={copy.pluginTabsLabel}>
                  <button
                    className={activePluginMenuTab === 'calendar' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
                    type="button"
                    onClick={() => setActivePluginMenuTab('calendar')}
                  >
                    Google Calendar
                  </button>
                  <button
                    className={activePluginMenuTab === 'gmail' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
                    type="button"
                    onClick={() => setActivePluginMenuTab('gmail')}
                  >
                    Gmail
                  </button>
                </div>

                {activePluginMenuTab === 'calendar' ? (
                  <article className="pluginCard">
                    <div>
                      <strong>Google Calendar</strong>
                      <p>
                        {googleCalendarConnection?.connected
                          ? googleCalendarConnection.account_email ?? copy.connectedGoogleAccount
                          : copy.connectCalendarDescription}
                      </p>
                    </div>

                    <div className="pluginActions">
                      {googleCalendarConnection?.connected ? (
                        <>
                          <button
                            className="secondaryButton"
                            type="button"
                            onClick={handleLoadCalendarEvents}
                            disabled={pluginState !== 'idle'}
                          >
                            {pluginState === 'loadingEvents' ? copy.read : copy.check}
                          </button>
                          <button className="secondaryButton" type="button" onClick={handleDisconnectGoogleCalendar}>
                            {copy.disconnectPlugin}
                          </button>
                        </>
                      ) : (
                        <button
                          className="primaryButton"
                          type="button"
                          onClick={handleConnectGoogleCalendar}
                          disabled={pluginState !== 'idle' || !hasGoogleClientId}
                        >
                          {pluginState === 'connecting' && connectingPlugin === 'calendar' ? copy.connecting : copy.connect}
                        </button>
                      )}
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={() => setIsPluginSettingsOpen((current) => !current)}
                      >
                        {copy.settings}
                      </button>
                    </div>

                    {calendarEvents.length > 0 && (
                      <div className="pluginEvents">
                        {calendarEvents.slice(0, 3).map((event) => (
                          <p key={event.id}>
                            <strong>{event.summary}</strong>
                            <span>{event.start ?? copy.noDate}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                ) : (
                  <article className="pluginCard">
                    <div>
                      <strong>Gmail</strong>
                      <p>
                        {gmailConnection?.connected
                          ? gmailConnection.account_email ?? copy.connectedGmailAccount
                          : copy.connectGmailDescription}
                      </p>
                    </div>

                    <div className="pluginActions">
                      {gmailConnection?.connected ? (
                        <>
                          <button
                            className="secondaryButton"
                            type="button"
                            onClick={handleLoadGmailMessages}
                            disabled={pluginState !== 'idle'}
                          >
                            {pluginState === 'loadingMail' ? copy.read : copy.check}
                          </button>
                          <button className="secondaryButton" type="button" onClick={handleDisconnectGmail}>
                            {copy.disconnectPlugin}
                          </button>
                        </>
                      ) : (
                        <button
                          className="primaryButton"
                          type="button"
                          onClick={handleConnectGmail}
                          disabled={pluginState !== 'idle' || !hasGoogleClientId}
                        >
                          {pluginState === 'connecting' && connectingPlugin === 'gmail' ? copy.connecting : copy.connect}
                        </button>
                      )}
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={() => setIsPluginSettingsOpen((current) => !current)}
                      >
                        {copy.settings}
                      </button>
                    </div>

                    {gmailMessages.length > 0 && (
                      <div className="pluginEvents">
                        {gmailMessages.slice(0, 4).map((message) => (
                          <p key={message.id}>
                            <strong>{message.subject ?? copy.noSubject}</strong>
                            <span>{message.from ?? copy.unknownSender}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                )}

                {(pluginNotice || lastAuthUrl) && (
                  <div className="pluginNotice">
                    {pluginNotice && <p>{pluginNotice}</p>}
                    {lastAuthUrl && (
                      <div className="pluginActions">
                        <a href={lastAuthUrl} target="_blank" rel="noreferrer">
                          {copy.openLogin}
                        </a>
                        <button className="secondaryButton" type="button" onClick={handleCopyAuthUrl}>
                          {copy.copyLink}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {pluginError && <p className="pluginError">{pluginError}</p>}
              </div>

              {isPluginSettingsOpen && (
                <aside className="pluginSettingsPanel" aria-label={copy.pluginSettingsLabel}>
                  <div>
                    <p className="eyebrow">{copy.settings}</p>
                    <h3>Google OAuth</h3>
                  </div>

                  <label className="pluginConfigField">
                    <span>Desktop OAuth Client ID</span>
                    <input
                      value={googleClientId}
                      onChange={(event) => {
                        setGoogleClientId(event.target.value);
                        setHasGoogleClientId(false);
                      }}
                      placeholder="...apps.googleusercontent.com"
                    />
                  </label>

                  <label className="pluginConfigField">
                    <span>Desktop Client Secret</span>
                    <input
                      value={googleClientSecret}
                      onChange={(event) => setGoogleClientSecret(event.target.value)}
                      placeholder={hasGoogleClientSecret ? copy.savedClientSecret : copy.pasteGoogleSecret}
                      type="password"
                    />
                    <small>
                      {hasGoogleClientSecret
                        ? copy.clientSecretStored
                        : copy.backendKeepsSecret}
                    </small>
                  </label>

                  <button
                    className="primaryButton"
                    type="button"
                    onClick={handleSaveGoogleCalendarClientId}
                    disabled={pluginState !== 'idle' || !googleClientId.trim()}
                  >
                    {pluginState === 'savingConfig' ? copy.saving : copy.saveSettings}
                  </button>
                </aside>
              )}
            </div>
          </section>
        </div>
      )}

    </main>
  );
}

function upsertConversation(
  conversations: ConversationSummary[],
  nextConversation: ConversationSummary,
) {
  const withoutCurrent = conversations.filter((conversation) => conversation.id !== nextConversation.id);

  return [nextConversation, ...withoutCurrent].sort(
    (left, right) => right.updated_at - left.updated_at,
  );
}

function upsertPluginConnection(
  connections: PluginConnection[],
  nextConnection: PluginConnection,
) {
  const withoutCurrent = connections.filter((connection) => connection.provider !== nextConnection.provider);

  return [nextConnection, ...withoutCurrent];
}

function upsertMemoryRecord(records: MemoryRecord[], nextRecord: MemoryRecord) {
  const withoutCurrent = records.filter((record) => record.id !== nextRecord.id);

  return [nextRecord, ...withoutCurrent].sort((left, right) => right.updated_at - left.updated_at);
}

function updateChatMemorySuggestion(
  suggestionsByMessage: Record<string, ChatMemorySuggestion[]>,
  messageId: string,
  suggestionId: string,
  updates: Partial<ChatMemorySuggestion>,
) {
  return {
    ...suggestionsByMessage,
    [messageId]: (suggestionsByMessage[messageId] ?? []).map((suggestion) =>
      suggestion.id === suggestionId ? { ...suggestion, ...updates } : suggestion,
    ),
  };
}

function getMemoryCategoryLabel(category: MemoryCategory) {
  return memoryCategories.find((item) => item.value === category)?.label ?? 'Pamiec';
}

function getMemorySourceLabel(record: MemoryRecord) {
  if (record.source_kind === 'gmail') {
    return 'Gmail';
  }

  if (record.source_kind === 'calendar') {
    return 'Kalendarz';
  }

  if (record.source_kind === 'conversation') {
    return record.source_conversation_id
      ? `Rozmowa: ${record.source_conversation_id}`
      : 'Rozmowa';
  }

  return 'Dodane przez uzytkownika';
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000));
}

function getVoiceButtonLabel(recordingState: string, loadState: string) {
  if (loadState === 'loading') {
    return 'Laduje';
  }

  if (recordingState === 'recording') {
    return 'Zatrzymaj';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuje';
  }

  return 'Nagraj';
}

function getTranscriptPlaceholder(recordingState: string, loadState: string, copy: Record<string, string>) {
  if (loadState === 'loading') {
    return copy.loadingWhisperPlaceholder;
  }

  if (recordingState === 'recording') {
    return copy.recordingPlaceholder;
  }

  if (recordingState === 'transcribing') {
    return copy.transcribingPlaceholder;
  }

  return copy.idleTranscriptPlaceholder;
}

function getLevelLabel(inputLevel: number, peakInputLevel: number) {
  if (peakInputLevel === 0) {
    return 'czekam';
  }

  if (inputLevel < 0.08 && peakInputLevel < 0.12) {
    return 'za cicho';
  }

  if (inputLevel > 0.85) {
    return 'za glosno';
  }

  return 'OK';
}

function getVoiceTranscriptSpeakerLabel(speaker: VoiceCallTranscriptLine['speaker']) {
  if (speaker === 'user') {
    return 'Ty';
  }

  if (speaker === 'assistant') {
    return 'XO';
  }

  return 'System';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Cos poszlo nie tak.';
}



