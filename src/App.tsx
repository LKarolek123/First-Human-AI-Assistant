import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  type ChatMessage,
  type ConversationSummary,
  getConversationMessages,
  listConversations,
  sendChatMessage,
} from './ai/openaiFeedback';
import { useWhisperTranscription } from './voice/useWhisperTranscription';

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

  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';
  const promptText = typedPrompt.trim() || transcript.trim();
  const canSend = promptText.length > 0 && chatState !== 'loading';
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  useEffect(() => {
    let isMounted = true;

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

    return () => {
      isMounted = false;
    };
  }, []);

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
          <div className="railHeader">
            <div>
              <p className="eyebrow">AI Agent</p>
              <h2 id="assistant-heading">Chaty</h2>
            </div>
            <button className="iconButton" type="button" onClick={handleNewConversation} title="Nowy chat">
              +
            </button>
          </div>

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
        </aside>

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
