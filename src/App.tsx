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

type ChatMemorySuggestion = MemorySuggestion & {
  draftCategory: MemorySuggestion['category'];
  draftContent: string;
  isEditing: boolean;
  status: 'pending' | 'saving' | 'saved';
  error: string | null;
};

type ChatInputMode = 'voice' | 'voiceText';
type RealtimeModelId = (typeof realtimeModelOptions)[number]['value'];
type RealtimeEffort = (typeof realtimeEffortOptions)[number]['value'];
type VoiceCallStatus = 'idle' |'connecting' |'calling' | 'saving';
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
  const [activeChatMode, setActiveChatMode] = useState<ChatInputMode>('voiceText');
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

  const realtimeOfferRef = useRef<RealtimeOffer | null>(null);
  const realtimeRemoteAudioRef = useRef<HTMLAudioElement | null>(null);


  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';
  const promptText = typedPrompt.trim();
  const canSend = promptText.length > 0 && chatState !== 'loading';

  const hasVoiceCallHistory = voiceCallTranscriptLines.some(
    (line) => line.speaker === 'user' || line.speaker === 'assistant',
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
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

  function handleVoiceCallDisconnect() {
    realtimeOfferRef.current?.localStream.getTracks().forEach((track) => track.stop());
    realtimeOfferRef.current?.peerConnection.close();
    realtimeOfferRef.current = null;

    if (realtimeRemoteAudioRef.current) {
      realtimeRemoteAudioRef.current.pause();
      realtimeRemoteAudioRef.current.srcObject = null;
    }

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

    console.log('Realtime call config', config);

    const offer = await createRealtimeOffer();

    offer.dataChannel.onmessage = (event) => {
      const realtimeEvent = JSON.parse(event.data);
      if (realtimeEvent.type === 'conversation.item.input_audio_transcription.completed') {
        // console.log('User transcript', realtimeEvent.transcript);
        const transcript = realtimeEvent.transcript?.trim();
        if (!transcript) {
          return;
        }

        setVoiceCallTranscriptLines((currentLines) => [...currentLines, 
          {
            id: crypto.randomUUID(),
            speaker: 'user',
            text: transcript,
          },
        ]);

        return;
      }


      if (realtimeEvent.type === 'response.audio_transcript.delta') {
        // console.log('AI message transcript', realtimeEvent.transcript);
        const delta = realtimeEvent.delta;

        if (!delta){
          return;
        }

        setVoiceCallTranscriptLines((currentLines) => {
          const lastLine = currentLines[currentLines.length - 1];

          if (lastLine?.speaker === 'assistant') {
            // tu zaczniemy prace w domu
          }
        })
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
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Human First AI</p>
          <h1>XO</h1>
          <p className="lead">
            Lokalny asystent z rozmowami, pamiecia miedzy watkami i spokojnym rytmem pracy.
          </p>
        </div>

        <div className="statusPanel" aria-label="Status MVP">
          <span className={isRecording ? 'pulse pulseActive' : 'pulse'} />
          <div>
            <strong>{isRecording ? 'Nagrywam po polsku' : 'Chat + pamiec'}</strong>
            <p>
              {isRecording
                ? 'XO zapisuje dzwiek lokalnie i przygotuje transkrypcje.'
                : 'Rozmowy sa zapisywane lokalnie w SQLite i dokladane do kontekstu modelu.'}
            </p>
          </div>
        </div>
      </section>

      <section className="chatPanel" aria-labelledby="assistant-heading">
        <aside className="conversationRail" aria-label="Rozmowy">
          <div className="pluginsPanel" aria-label="Wtyczki">
            <div className="railHeader">
              <div>
                <p className="eyebrow">Integracje</p>
                <h2>Wtyczki</h2>
              </div>
            </div>

            <article className="pluginCard">
              <div>
                <strong>Google Calendar</strong>
                <p>
                  {googleCalendarConnection?.connected
                    ? googleCalendarConnection.account_email ?? 'Polaczono konto Google'
                    : 'Najpierw wklej Desktop OAuth Client ID, potem zaloguj sie przez Google.'}
                </p>
              </div>

              {!googleCalendarConnection?.connected && (
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
              )}

              {!googleCalendarConnection?.connected && (
                <label className="pluginConfigField">
                  <span>Desktop Client Secret</span>
                  <input
                    value={googleClientSecret}
                    onChange={(event) => setGoogleClientSecret(event.target.value)}
                    placeholder={hasGoogleClientSecret ? 'zapisany w systemowym sejfie' : 'wklej z Google Cloud / JSON'}
                    type="password"
                  />
                  <small>
                    {hasGoogleClientSecret
                      ? 'Client Secret jest juz zapisany lokalnie.'
                      : 'Nie trafia do frontendu po zapisaniu; backend trzyma go w systemowym sejfie.'}
                  </small>
                </label>
              )}

              <div className="pluginActions">
                {googleCalendarConnection?.connected ? (
                  <>
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={handleLoadCalendarEvents}
                      disabled={pluginState !== 'idle'}
                    >
                      {pluginState === 'loadingEvents' ? 'Czytam' : 'Sprawdz'}
                    </button>
                    <button className="secondaryButton" type="button" onClick={handleDisconnectGoogleCalendar}>
                      Odlacz
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={handleSaveGoogleCalendarClientId}
                      disabled={pluginState !== 'idle' || !googleClientId.trim()}
                    >
                      {pluginState === 'savingConfig' ? 'Zapisuje' : 'Zapisz'}
                    </button>
                    <button
                      className="primaryButton"
                      type="button"
                      onClick={handleConnectGoogleCalendar}
                      disabled={pluginState !== 'idle' || !hasGoogleClientId}
                    >
                      {pluginState === 'connecting' && connectingPlugin === 'calendar' ? 'Lacze' : 'Polacz'}
                    </button>
                  </>
                )}
              </div>

              {calendarEvents.length > 0 && (
                <div className="pluginEvents">
                  {calendarEvents.slice(0, 3).map((event) => (
                    <p key={event.id}>
                      <strong>{event.summary}</strong>
                      <span>{event.start ?? 'bez daty'}</span>
                    </p>
                  ))}
                </div>
              )}
            </article>

            <article className="pluginCard">
              <div>
                <strong>Gmail</strong>
                <p>
                  {gmailConnection?.connected
                    ? gmailConnection.account_email ?? 'Polaczono Gmail'
                    : hasGoogleClientId
                      ? 'Odczyt 20 ostatnich wiadomosci, wlacznie ze spamem i koszem.'
                      : 'Najpierw zapisz Google OAuth Client ID w karcie Calendar.'}
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
                      {pluginState === 'loadingMail' ? 'Czytam' : 'Sprawdz'}
                    </button>
                    <button className="secondaryButton" type="button" onClick={handleDisconnectGmail}>
                      Odlacz
                    </button>
                  </>
                ) : (
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={handleConnectGmail}
                    disabled={pluginState !== 'idle' || !hasGoogleClientId}
                  >
                    {pluginState === 'connecting' && connectingPlugin === 'gmail' ? 'Lacze' : 'Polacz'}
                  </button>
                )}
              </div>

              {gmailMessages.length > 0 && (
                <div className="pluginEvents">
                  {gmailMessages.slice(0, 4).map((message) => (
                    <p key={message.id}>
                      <strong>{message.subject ?? 'Bez tematu'}</strong>
                      <span>{message.from ?? 'nieznany nadawca'}</span>
                    </p>
                  ))}
                </div>
              )}
            </article>

            {(pluginNotice || lastAuthUrl) && (
              <div className="pluginNotice">
                {pluginNotice && <p>{pluginNotice}</p>}
                {lastAuthUrl && (
                  <div className="pluginActions">
                    <a href={lastAuthUrl} target="_blank" rel="noreferrer">
                      Otworz logowanie
                    </a>
                    <button className="secondaryButton" type="button" onClick={handleCopyAuthUrl}>
                      Kopiuj link
                    </button>
                  </div>
                )}
              </div>
            )}

            {pluginError && <p className="pluginError">{pluginError}</p>}
          </div>

          <div className="railHeader">
            <div>
              <p className="eyebrow">AI Agent</p>
              <h2 id="assistant-heading">Obszar pracy</h2>
            </div>
            <button className="iconButton" type="button" onClick={handleNewConversation} title="Nowy chat">
              +
            </button>
          </div>

          <div className="workspaceTabs" aria-label="Widoki">
            <button
              className={activeWorkspaceView === 'chat' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
              type="button"
              onClick={() => setActiveWorkspaceView('chat')}
            >
              Chaty
            </button>
            <button
              className={activeWorkspaceView === 'memory' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
              type="button"
              onClick={() => setActiveWorkspaceView('memory')}
            >
              Pamiec
            </button>
          </div>

          {activeWorkspaceView === 'chat' && (
            <>
              <button
                className={!activeConversationId ? 'conversationItem conversationItemActive' : 'conversationItem'}
                type="button"
                onClick={handleNewConversation}
              >
                <span>Nowa rozmowa</span>
                <small>Pierwsza wiadomosc utworzy chat</small>
              </button>

              <div className="conversationList">
                {conversations.map((conversation) => (
                  <button
                    className={
                      conversation.id === activeConversationId
                        ? 'conversationItem conversationItemActive'
                        : 'conversationItem'
                    }
                    key={conversation.id}
                    type="button"
                    onClick={() => setActiveConversationId(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    <small>{conversation.last_message ?? 'Brak wiadomosci'}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        {activeWorkspaceView === 'chat' ? (
          <section className="assistantPanel" aria-label="Aktywna rozmowa">
          <div className="assistantHeader">
            <div>
              <p className="eyebrow">AI Agent</p>
              <h2>{activeConversation?.title ?? 'Nowa rozmowa'}</h2>
            </div>
            <span className="languageBadge">{chatState === 'loading' ? 'typing' : 'memory on'}</span>
          </div>

          <div className="workspaceTabs chatModeTabs" aria-label="Tryb chatu">
            <button
              className={activeChatMode === 'voice' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
              type="button"
              onClick={() => setActiveChatMode('voice')}
            >
              Glos
            </button>
            <button
              className={activeChatMode === 'voiceText' ? 'workspaceTab workspaceTabActive' : 'workspaceTab'}
              type="button"
              onClick={() => setActiveChatMode('voiceText')}
            >
              Glos + tekst
            </button>
          </div>

          <div className="messageList" aria-live="polite">
            {messages.length > 0 ? (
              messages.map((message) => (
                <div className="messageGroup" key={message.id}>
                  <article
                    className={message.role === 'user' ? 'messageBubble messageBubbleUser' : 'messageBubble'}
                  >
                    <strong>{message.role === 'user' ? 'Ty' : 'XO'}</strong>
                    <p>{message.content}</p>
                  </article>

                  {message.role === 'assistant' &&
                    (chatMemorySuggestions[message.id] ?? []).length > 0 && (
                      <div className="memorySuggestions" aria-label="Sugestie pamieci">
                        <strong>XO moze zapamietac</strong>
                        {(chatMemorySuggestions[message.id] ?? []).map((suggestion) => (
                          <article className="memorySuggestion" key={suggestion.id}>
                            {suggestion.isEditing ? (
                              <div className="memorySuggestionEditor">
                                <label className="memoryField">
                                  <span>Kategoria</span>
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
                                    {memoryCategories
                                      .filter((category) => category.value !== 'tool_note')
                                      .map((category) => (
                                        <option key={category.value} value={category.value}>
                                          {category.label}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                                <label className="memoryField">
                                  <span>Tresc</span>
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
                                  ? 'Zapisuje'
                                  : suggestion.status === 'saved'
                                    ? 'Zapisano'
                                    : 'Zapisz'}
                              </button>
                              {!suggestion.isEditing && suggestion.status !== 'saved' && (
                                <button
                                  className="secondaryButton"
                                  type="button"
                                  onClick={() => handleEditMemorySuggestion(message.id, suggestion.id)}
                                >
                                  Edytuj
                                </button>
                              )}
                              {suggestion.status !== 'saved' && (
                                <button
                                  className="secondaryButton"
                                  type="button"
                                  onClick={() => handleRejectMemorySuggestion(message.id, suggestion.id)}
                                  disabled={suggestion.status === 'saving'}
                                >
                                  Odrzuc
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
                <strong>Nowy chat jest gotowy.</strong>
                <p>Zapytaj o cos, a XO zapisze rozmowe i bedzie ja pamietal w kolejnych watkach.</p>
              </div>
            )}

            {chatState === 'loading' && (
              <article className="messageBubble messageBubbleBusy">
                <strong>XO</strong>
                <p>mysle...</p>
              </article>
            )}
          </div>

          {chatError && <p className="voiceError">{chatError}</p>}

          <form className="promptForm" onSubmit={handleChatSubmit}>
            {activeChatMode === 'voice' ? (
              <section className="voiceCallPanel" aria-label="Chat glosowy">
                <div>
                  <p className="eyebrow">Realtime voice</p>
                  <h3>Chat glosowy</h3>
                  <p>Wybierz ustawienia i otworz male okienko rozmowy.</p>
                </div>

                <div className="voiceCallPreview" aria-hidden="true">
                  <span className="voiceMiniOrb" />
                  <div>
                    <strong>{voiceCallStatus === 'saving' ? 'Zapisuje rozmowe' : 'Gotowy'}</strong>
                    <span>Status: {voiceCallStatus === 'saving' ? 'zapisywanie' : 'bez polaczenia'}</span>
                  </div>
                </div>

                <div className="voiceCallSettings">
                  <label className="voiceModelField">
                    <span>Model</span>
                    <select
                      value={realtimeModelId}
                      onChange={(event) => setRealtimeModelId(event.target.value as RealtimeModelId)}
                      disabled={voiceCallStatus === 'calling'}
                    >
                      {realtimeModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="voiceModelField">
                    <span>Effort</span>
                    <select
                      value={realtimeEffort}
                      onChange={(event) => setRealtimeEffort(event.target.value as RealtimeEffort)}
                      disabled={voiceCallStatus === 'calling'}
                    >
                      {realtimeEffortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="voiceCallActions">
                  <button
                    className={
                      voiceCallStatus !== 'idle'
                        ? 'voiceButton voiceButtonActive'
                        : 'voiceButton'
                    }
                    type="button"
                    onClick={handleVoiceCallToggle}
                    disabled={voiceCallStatus === 'saving'}
                    aria-pressed={voiceCallStatus !== 'idle'}
                  >
                    <span className="micIcon" aria-hidden="true" />
                    {voiceCallStatus === 'saving' ? 'Zapisuje' : 'Zadzwon'}
                  </button>
                  <span className="voiceCallStatus">
                    Backend Realtime nie jest jeszcze podlaczony.
                  </span>
                </div>
              </section>
            ) : (
              <>
                <label className="promptLabel" htmlFor="prompt">
                  Twoja wiadomosc
                </label>
                <textarea
                  id="prompt"
                  className="promptInput"
                  value={typedPrompt}
                  onChange={(event) => setTypedPrompt(event.target.value)}
                  placeholder="Napisz do XO albo uzyj nagrywania glosu, ktore wysle wiadomosc automatycznie po pauzie."
                  rows={5}
                />

                <div className="inlineVoicePanel" aria-label="Glosowe wejscie czatu">
                  <div className="inlineVoiceHeader">
                    <div>
                      <strong>{getVoiceButtonLabel(recordingState, loadState)}</strong>
                      <p>{getTranscriptPlaceholder(recordingState, loadState)}</p>
                    </div>
                    <span className="languageBadge">{modelId}</span>
                  </div>

                  <label className="voiceModelField">
                    <span>Model glosowy</span>
                    <select
                      value={modelId}
                      onChange={(event) => setModelId(event.target.value as WhisperModelId)}
                      disabled={isRecording || isTranscribing || loadState === 'loading'}
                    >
                      {whisperModelOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label} - {option.description}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="voiceControls">
                    <button
                      className={isRecording ? 'voiceButton voiceButtonActive' : 'voiceButton'}
                      type="button"
                      onClick={handleVoiceButton}
                      disabled={!isSupported || isTranscribing || loadState === 'loading' || chatState === 'loading'}
                      aria-pressed={isRecording}
                    >
                      <span className="micIcon" aria-hidden="true" />
                      {isRecording ? 'Zatrzymaj' : 'Dyktuj'}
                    </button>
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={loadModel}
                      disabled={!isSupported || loadState === 'loading' || loadState === 'ready'}
                    >
                      {loadState === 'ready' ? 'Model gotowy' : 'Zaladuj model'}
                    </button>
                    <button className="secondaryButton" type="button" onClick={handleResetTranscript}>
                      Wyczysc glos
                    </button>
                  </div>

                  <div className="meterPanel" aria-label="Poziom mikrofonu">
                    <div className="meterHeader">
                      <span>Poziom mikrofonu</span>
                      <span>{getLevelLabel(inputLevel, peakInputLevel)}</span>
                    </div>
                    <div className="meterTrack">
                      <span className="meterFill" style={{ width: `${Math.round(inputLevel * 100)}%` }} />
                    </div>
                  </div>

                  {!isSupported && (
                    <p className="voiceNotice">
                      Ta przegladarka nie udostepnia nagrywania audio przez MediaRecorder.
                    </p>
                  )}

                  {error && <p className="voiceError">{error}</p>}

                  {(transcript || isBusy) && (
                    <div className={isBusy ? 'transcriptBox transcriptBoxBusy' : 'transcriptBox'} aria-live="polite">
                      {transcript ? (
                        <p>{transcript}</p>
                      ) : (
                        <p className="placeholderText">{getTranscriptPlaceholder(recordingState, loadState)}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="promptActions">
                  <button className="primaryButton" type="submit" disabled={!canSend}>
                    {chatState === 'loading' ? 'Wysylam' : 'Wyslij'}
                  </button>
                  <button className="secondaryButton" type="button" onClick={handleClearPrompt}>
                    Wyczysc prompt
                  </button>
                </div>
              </>
            )}
          </form>
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
          </section>
        ) : (
          <section className="assistantPanel" aria-label="Pamiec XO">
            <div className="assistantHeader">
              <div>
                <p className="eyebrow">Memory</p>
                <h2>Pamiec XO</h2>
              </div>
              <span className="languageBadge">{memoryRecords.length} wpisow</span>
            </div>

            <div className="memoryPanel">
              <form className="memoryEditor" onSubmit={handleMemorySubmit}>
                <label className="memoryField">
                  <span>Kategoria</span>
                  <select
                    value={memoryCategory}
                    onChange={(event) => setMemoryCategory(event.target.value as MemoryCategory)}
                  >
                    {memoryCategories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="memoryField">
                  <span>Co XO ma pamietac</span>
                  <textarea
                    value={memoryContent}
                    onChange={(event) => setMemoryContent(event.target.value)}
                    placeholder="Np. Uzytkownik woli konkretne odpowiedzi po polsku i chce aktualizacji Features.md przy zmianach funkcji."
                    rows={4}
                  />
                </label>

                <div className="promptActions">
                  <button className="primaryButton" type="submit" disabled={memoryState !== 'idle'}>
                    {memoryState === 'saving'
                      ? 'Zapisuje'
                      : editingMemoryId
                        ? 'Zapisz zmiany'
                        : 'Dodaj pamiec'}
                  </button>
                  {editingMemoryId && (
                    <button className="secondaryButton" type="button" onClick={resetMemoryForm}>
                      Anuluj edycje
                    </button>
                  )}
                </div>
              </form>

              {memoryNotice && <p className="memoryNotice">{memoryNotice}</p>}
              {memoryError && <p className="voiceError">{memoryError}</p>}

              <div className="memoryList" aria-live="polite">
                {memoryRecords.length > 0 ? (
                  memoryRecords.map((record) => (
                    <article className="memoryRecord" key={record.id}>
                      <div>
                        <strong>{getMemoryCategoryLabel(record.category)}</strong>
                        <p>{record.content}</p>
                        <small>
                          {getMemorySourceLabel(record)} | aktualizacja: {formatDateTime(record.updated_at)}
                        </small>
                      </div>
                      <div className="memoryRecordActions">
                        <button
                          className="secondaryButton"
                          type="button"
                          onClick={() => handleEditMemoryRecord(record)}
                          disabled={memoryState !== 'idle'}
                        >
                          Edytuj
                        </button>
                        <button
                          className="secondaryButton dangerButton"
                          type="button"
                          onClick={() => handleDeleteMemoryRecord(record.id)}
                          disabled={memoryState !== 'idle'}
                        >
                          Usun
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="emptyChat">
                    <strong>Brak jawnych wpisow pamieci.</strong>
                    <p>Dodaj pierwsza rzecz, ktora XO ma stabilnie pamietac w kolejnych rozmowach.</p>
                  </div>
                )}
              </div>

              {memoryAspects.map((aspect) => (
                <article className="memorySection" key={aspect.title}>
                  <h3>{aspect.title}</h3>
                  <ul>
                    {aspect.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

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

function getTranscriptPlaceholder(recordingState: string, loadState: string) {
  if (loadState === 'loading') {
    return 'Laduje model Whisper. Pierwszy raz moze potrwac dluzej.';
  }

  if (recordingState === 'recording') {
    return 'Mow po polsku. Po 3 sekundach ciszy XO sam zakonczy nagranie i wysle wiadomosc.';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuje nagranie i przygotowuje automatyczna wysylke...';
  }

  return 'Kliknij Nagraj, powiedz cos po polsku, a XO wysle wiadomosc po wykryciu pauzy.';
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
