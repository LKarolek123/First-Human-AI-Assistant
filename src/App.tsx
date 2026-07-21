import { type FormEvent, useState } from 'react';
import { requestGptFeedback } from './ai/openaiFeedback';
import { useWhisperTranscription } from './voice/useWhisperTranscription';

const priorities = ['dobro użytkownika', 'prywatność', 'szybkość', 'wygoda', 'automatyzacja', 'wygląd'];

const mvpAreas = [
  { title: 'Desktop', items: ['tray icon', 'global shortcut', 'start z Windowsem'] },
  { title: 'Voice First', items: ['STT po polsku', 'wake word', 'TTS', 'naturalna rozmowa'] },
  { title: 'AI Agent', items: ['streaming', 'function calling', 'planowanie działań'] },
  { title: 'Memory', items: ['SQLite', 'projekty', 'cele', 'transparentny panel pamięci'] },
  { title: 'Computer', items: ['pliki', 'aplikacje', 'terminal za zgodą'] },
  { title: 'Human First', items: ['nastrój', 'refleksje', 'małe kroki', 'wellbeing'] },
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
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'loading'>('idle');

  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';
  const promptText = typedPrompt.trim() || transcript.trim();
  const canAskGpt = promptText.length > 0 && feedbackState !== 'loading';

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!promptText) {
      setFeedbackError('Wpisz pytanie albo użyj transkrypcji z mikrofonu.');
      return;
    }

    setFeedback('');
    setFeedbackError(null);
    setFeedbackState('loading');

    try {
      const nextFeedback = await requestGptFeedback({ input: promptText });
      setFeedback(nextFeedback);
    } catch (feedbackRequestError) {
      setFeedbackError(getFeedbackErrorMessage(feedbackRequestError));
    } finally {
      setFeedbackState('idle');
    }
  }

  function handleUseTranscript() {
    setTypedPrompt(transcript);
    setFeedbackError(null);
  }

  function handleClearPrompt() {
    setTypedPrompt('');
    setFeedback('');
    setFeedbackError(null);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Human First AI</p>
          <h1>XO</h1>
          <p className="lead">
            Desktopowy asystent AI, który ma być spokojnym, lokalnym centrum pracy, pamięci i
            codziennego wsparcia.
          </p>
        </div>

        <div className="statusPanel" aria-label="Status MVP">
          <span className={isRecording ? 'pulse pulseActive' : 'pulse'} />
          <div>
            <strong>{isRecording ? 'Nagrywam po polsku' : 'Typing + GPT'}</strong>
            <p>
              {isRecording
                ? 'XO zapisuje dźwięk lokalnie i przygotuje transkrypcję.'
                : 'Możesz wpisać pytanie ręcznie albo użyć transkrypcji jako promptu.'}
            </p>
          </div>
        </div>
      </section>

      <section className="assistantPanel" aria-labelledby="assistant-heading">
        <div className="assistantHeader">
          <div>
            <p className="eyebrow">AI Agent</p>
            <h2 id="assistant-heading">Feedback GPT</h2>
          </div>
          <span className="languageBadge">typing</span>
        </div>

        <form className="promptForm" onSubmit={handleFeedbackSubmit}>
          <label className="promptLabel" htmlFor="prompt">
            Twoje pytanie
          </label>
          <textarea
            id="prompt"
            className="promptInput"
            value={typedPrompt}
            onChange={(event) => setTypedPrompt(event.target.value)}
            placeholder="Wpisz, nad czym pracujesz albo czego potrzebujesz. Jeśli zostawisz pole puste, XO użyje ostatniej transkrypcji."
            rows={6}
          />
          <div className="promptActions">
            <button className="primaryButton" type="submit" disabled={!canAskGpt}>
              {feedbackState === 'loading' ? 'Pytam GPT' : 'Poproś o feedback'}
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleUseTranscript}
              disabled={!transcript || feedbackState === 'loading'}
            >
              Użyj transkrypcji
            </button>
            <button className="secondaryButton" type="button" onClick={handleClearPrompt}>
              Wyczyść prompt
            </button>
          </div>
        </form>

        {feedbackError && <p className="voiceError">{feedbackError}</p>}

        <div className={feedbackState === 'loading' ? 'feedbackBox feedbackBoxBusy' : 'feedbackBox'} aria-live="polite">
          {feedback ? (
            <p>{feedback}</p>
          ) : (
            <p className="placeholderText">
              Feedback pojawi się tutaj po wysłaniu pytania.
            </p>
          )}
        </div>
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
            {loadState === 'ready' ? 'Model gotowy' : 'Załaduj model'}
          </button>
          <button className="secondaryButton" type="button" onClick={resetTranscript}>
            Wyczyść
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
            Ta przeglądarka nie udostępnia nagrywania audio przez MediaRecorder.
          </p>
        )}

        <p className="voiceNotice">
          Model: {modelId}. Jeśli transkrypcja pokazuje „muzyka”, zwykle oznacza to za cichy głos,
          tło z głośników albo brak wyraźnej mowy w nagraniu.
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

function getVoiceButtonLabel(recordingState: string, loadState: string) {
  if (loadState === 'loading') {
    return 'Ładuję';
  }

  if (recordingState === 'recording') {
    return 'Zatrzymaj';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuję';
  }

  return 'Nagraj';
}

function getTranscriptPlaceholder(recordingState: string, loadState: string) {
  if (loadState === 'loading') {
    return 'Ładuję model Whisper. Pierwszy raz może potrwać dłużej.';
  }

  if (recordingState === 'recording') {
    return 'Mów po polsku. Obserwuj pasek mikrofonu i kliknij „Zatrzymaj”, kiedy skończysz.';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuję nagranie na tekst...';
  }

  return 'Kliknij „Nagraj”, powiedz coś po polsku, a XO przepisze nagranie lokalnym STT.';
}

function getLevelLabel(inputLevel: number, peakInputLevel: number) {
  if (peakInputLevel === 0) {
    return 'czekam';
  }

  if (inputLevel < 0.08 && peakInputLevel < 0.12) {
    return 'za cicho';
  }

  if (inputLevel > 0.85) {
    return 'za głośno';
  }

  return 'OK';
}

function getFeedbackErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Nie udało się pobrać feedbacku z GPT.';
}
