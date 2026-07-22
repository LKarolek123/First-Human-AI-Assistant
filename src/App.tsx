import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  type ChatMessage,
  type ConversationSummary,
  type MemoryCategory,
  type MemoryRecord,
  createMemoryRecord,
  deleteMemoryRecord,
  getConversationMessages,
  listConversations,
  listMemoryRecords,
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
import { useWhisperTranscription } from './voice/useWhisperTranscription';

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
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>('preference');
  const [memoryContent, setMemoryContent] = useState('');
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [memoryState, setMemoryState] = useState<'idle' | 'saving' | 'deleting'>('idle');

  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';
  const promptText = typedPrompt.trim() || transcript.trim();
  const canSend = promptText.length > 0 && chatState !== 'loading';
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

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!promptText) {
      setChatError('Wpisz wiadomosc albo uzyj transkrypcji z mikrofonu.');
      return;
    }

    const input = promptText;

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
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, response.conversation),
      );
    } catch (sendError) {
      setTypedPrompt(input);
      setChatError(getErrorMessage(sendError));
    } finally {
      setChatState('idle');
    }
  }

  function handleNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setTypedPrompt('');
    setChatError(null);
  }

  function handleUseTranscript() {
    setTypedPrompt(transcript);
    setChatError(null);
  }

  function handleClearPrompt() {
    setTypedPrompt('');
    setChatError(null);
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

          <div className="messageList" aria-live="polite">
            {messages.length > 0 ? (
              messages.map((message) => (
                <article
                  className={message.role === 'user' ? 'messageBubble messageBubbleUser' : 'messageBubble'}
                  key={message.id}
                >
                  <strong>{message.role === 'user' ? 'Ty' : 'XO'}</strong>
                  <p>{message.content}</p>
                </article>
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
            <label className="promptLabel" htmlFor="prompt">
              Twoja wiadomosc
            </label>
            <textarea
              id="prompt"
              className="promptInput"
              value={typedPrompt}
              onChange={(event) => setTypedPrompt(event.target.value)}
              placeholder="Napisz do XO albo zostaw pole puste, zeby wyslac ostatnia transkrypcje."
              rows={5}
            />
            <div className="promptActions">
              <button className="primaryButton" type="submit" disabled={!canSend}>
                {chatState === 'loading' ? 'Wysylam' : 'Wyslij'}
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={handleUseTranscript}
                disabled={!transcript || chatState === 'loading'}
              >
                Uzyj transkrypcji
              </button>
              <button className="secondaryButton" type="button" onClick={handleClearPrompt}>
                Wyczysc prompt
              </button>
            </div>
          </form>
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

      <section className="voicePanel" aria-labelledby="voice-heading">
        <div className="voiceHeader">
          <div>
            <p className="eyebrow">Voice First</p>
            <h2 id="voice-heading">Lokalne STT</h2>
          </div>
          <span className="languageBadge">pl-PL</span>
        </div>

        <div className="voiceControls">
          <button
            className={isRecording ? 'voiceButton voiceButtonActive' : 'voiceButton'}
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isSupported || isTranscribing || loadState === 'loading'}
            aria-pressed={isRecording}
          >
            <span className="micIcon" aria-hidden="true" />
            {getVoiceButtonLabel(recordingState, loadState)}
          </button>
          <button
            className="secondaryButton"
            type="button"
            onClick={loadModel}
            disabled={!isSupported || loadState === 'loading' || loadState === 'ready'}
          >
            {loadState === 'ready' ? 'Model gotowy' : 'Zaladuj model'}
          </button>
          <button className="secondaryButton" type="button" onClick={resetTranscript}>
            Wyczysc
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

        <p className="voiceNotice">
          Model: {modelId}. Jesli transkrypcja pokazuje przypadkowy tekst, zwykle oznacza to za
          cichy glos, tlo z glosnikow albo brak wyraznej mowy w nagraniu.
        </p>

        {error && <p className="voiceError">{error}</p>}

        <div className={isBusy ? 'transcriptBox transcriptBoxBusy' : 'transcriptBox'} aria-live="polite">
          {transcript ? (
            <p>{transcript}</p>
          ) : (
            <p className="placeholderText">{getTranscriptPlaceholder(recordingState, loadState)}</p>
          )}
        </div>
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
    return 'Mow po polsku. Obserwuj pasek mikrofonu i kliknij Zatrzymaj, kiedy skonczysz.';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuje nagranie na tekst...';
  }

  return 'Kliknij Nagraj, powiedz cos po polsku, a XO przepisze nagranie lokalnym STT.';
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Cos poszlo nie tak.';
}
