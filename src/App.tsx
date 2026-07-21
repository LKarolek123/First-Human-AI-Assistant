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
    isSupported,
    loadModel,
    loadState,
    modelId,
    recordingState,
    resetTranscript,
    startRecording,
    stopRecording,
    transcript,
  } = useWhisperTranscription();

  const isRecording = recordingState === 'recording';
  const isTranscribing = recordingState === 'transcribing';
  const isBusy = isRecording || isTranscribing || loadState === 'loading';

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
            <strong>{isRecording ? 'Nagrywam po polsku' : 'MVP v1'}</strong>
            <p>
              {isRecording
                ? 'XO zapisuje dźwięk lokalnie i przygotuje transkrypcję.'
                : 'Fundament aplikacji gotowy do rozbudowy modułów.'}
            </p>
          </div>
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

        {!isSupported && (
          <p className="voiceNotice">
            Ta przeglądarka nie udostępnia nagrywania audio przez MediaRecorder.
          </p>
        )}

        <p className="voiceNotice">
          Model: {modelId}. Używa dokładniejszego trybu STT, redukcji echa, tłumienia szumu i
          normalizacji głosu. Pierwsze ładowanie może potrwać dłużej.
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
    return 'Ładuję dokładniejszy model Whisper. Pierwszy raz może potrwać dłużej.';
  }

  if (recordingState === 'recording') {
    return 'Mów po polsku. Kliknij „Zatrzymaj”, kiedy skończysz.';
  }

  if (recordingState === 'transcribing') {
    return 'Przepisuję nagranie na tekst...';
  }

  return 'Kliknij „Nagraj”, powiedz coś po polsku, a XO przepisze nagranie dokładniejszym lokalnym STT.';
}

