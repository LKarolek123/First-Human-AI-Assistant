import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AutomaticSpeechRecognitionOutput,
  AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import { audioBlobToMono16k } from './audio';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type RecordingState = 'idle' | 'recording' | 'transcribing';
type AutomaticSpeechRecognitionPipelineFactory = (
  task: 'automatic-speech-recognition',
  model: string,
) => Promise<AutomaticSpeechRecognitionPipeline>;

const MODEL_ID = 'Xenova/whisper-tiny';
const LANGUAGE = 'polish';

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber() {
  transcriberPromise ??= import('@huggingface/transformers').then((transformers) => {
    const createPipeline = transformers.pipeline as AutomaticSpeechRecognitionPipelineFactory;
    return createPipeline('automatic-speech-recognition', MODEL_ID);
  });
  return transcriberPromise;
}

export function useWhisperTranscription() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [isSupported, setIsSupported] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(
      typeof navigator.mediaDevices?.getUserMedia === 'function' && 'MediaRecorder' in window,
    );
  }, []);

  const loadModel = useCallback(async () => {
    setError(null);
    setLoadState('loading');

    try {
      await getTranscriber();
      setLoadState('ready');
    } catch (loadError) {
      setLoadState('error');
      setError(getErrorMessage(loadError, 'Nie udało się załadować modelu Whisper.'));
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(
    async (audioBlob: Blob) => {
      setRecordingState('transcribing');
      setError(null);

      try {
        const transcriber = await getTranscriber();
        const audio = await audioBlobToMono16k(audioBlob);
        const output = await transcriber(audio, {
          chunk_length_s: 30,
          language: LANGUAGE,
          task: 'transcribe',
        });
        const text = getTranscriptionText(output);

        setTranscript((current) => `${current} ${text}`.trim());
        setLoadState('ready');
      } catch (transcriptionError) {
        setError(getErrorMessage(transcriptionError, 'Nie udało się przepisać nagrania.'));
      } finally {
        setRecordingState('idle');
        stopStream();
      }
    },
    [stopStream],
  );

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Nagrywanie audio nie jest dostępne w tej przeglądarce.');
      return;
    }

    setError(null);
    setTranscript('');

    try {
      if (loadState !== 'ready') {
        await loadModel();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      streamRef.current = stream;
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType });
        void transcribe(audioBlob);
      };

      recorder.start();
      setRecordingState('recording');
    } catch (recordingError) {
      setRecordingState('idle');
      stopStream();
      setError(getErrorMessage(recordingError, 'Nie udało się uruchomić mikrofonu.'));
    }
  }, [isSupported, loadModel, loadState, stopStream, transcribe]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;

    if (recorder?.state === 'recording') {
      recorder.stop();
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  useEffect(
    () => () => {
      mediaRecorderRef.current?.stop();
      stopStream();
    },
    [stopStream],
  );

  return {
    error,
    isSupported,
    loadModel,
    loadState,
    modelId: MODEL_ID,
    recordingState,
    resetTranscript,
    startRecording,
    stopRecording,
    transcript,
  };
}

function getTranscriptionText(
  output: AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[],
) {
  return Array.isArray(output) ? output.map((item) => item.text).join(' ') : output.text;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Brak zgody na mikrofon. Sprawdź uprawnienia tej strony.';
  }

  if (error instanceof Error) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}
