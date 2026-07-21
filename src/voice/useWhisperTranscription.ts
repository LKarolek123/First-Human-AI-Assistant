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
const LOW_INPUT_LEVEL = 0.08;

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const peakInputLevelRef = useRef(0);
  const [isSupported, setIsSupported] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcript, setTranscript] = useState('');
  const [inputLevel, setInputLevel] = useState(0);
  const [peakInputLevel, setPeakInputLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(
      typeof navigator.mediaDevices?.getUserMedia === 'function' && 'MediaRecorder' in window,
    );
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setInputLevel(0);
  }, []);

  const startAudioMeter = useCallback(
    (stream: MediaStream) => {
      stopAudioMeter();

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const samples = new Float32Array(analyser.fftSize);

      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      peakInputLevelRef.current = 0;
      setPeakInputLevel(0);

      const tick = () => {
        analyser.getFloatTimeDomainData(samples);

        const level = getLevel(samples);
        peakInputLevelRef.current = Math.max(peakInputLevelRef.current, level);
        setInputLevel(level);
        setPeakInputLevel(peakInputLevelRef.current);

        animationFrameRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    },
    [stopAudioMeter],
  );

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
    stopAudioMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopAudioMeter]);

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

        if (isNonSpeechText(text)) {
          setError(getNoSpeechMessage(peakInputLevelRef.current));
          return;
        }

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
    peakInputLevelRef.current = 0;
    setPeakInputLevel(0);

    try {
      if (loadState !== 'ready') {
        await loadModel();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      streamRef.current = stream;
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;
      startAudioMeter(stream);

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
  }, [isSupported, loadModel, loadState, startAudioMeter, stopStream, transcribe]);

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
    inputLevel,
    isSupported,
    loadModel,
    loadState,
    modelId: MODEL_ID,
    peakInputLevel,
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

function getLevel(samples: Float32Array) {
  let squareSum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    squareSum += samples[index] * samples[index];
  }

  const rms = Math.sqrt(squareSum / samples.length);

  return Math.min(1, rms * 8);
}

function isNonSpeechText(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(/[()[\].,!?]/g, '')
    .trim();

  return (
    !normalized ||
    normalized === 'muzyka' ||
    normalized === 'music' ||
    normalized === 'szum' ||
    normalized === 'noise'
  );
}

function getNoSpeechMessage(peakLevel: number) {
  if (peakLevel < LOW_INPUT_LEVEL) {
    return 'Sygnał z mikrofonu jest bardzo cichy. Przysuń mikrofon albo zwiększ jego głośność w systemie.';
  }

  return 'XO usłyszał dźwięk, ale Whisper nie rozpoznał mowy. Spróbuj mówić bliżej mikrofonu i bez dźwięku z głośników.';
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

