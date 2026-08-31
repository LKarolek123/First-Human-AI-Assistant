import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraRecordingState = 'idle' | 'starting' | 'recording' | 'ready' | 'error';

const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    frameRate: { ideal: 24, max: 30 },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

// Zarządza lokalnym nagrywaniem kamery bez wysyłania obrazu do backendu ani AI.
export function useCameraRecording() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingUrlRef = useRef<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [recordingState, setRecordingState] = useState<CameraRecordingState>('idle');
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingMimeType, setRecordingMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(
      typeof navigator.mediaDevices?.getUserMedia === 'function' && 'MediaRecorder' in window,
    );
  }, []);

  // Zwalnia poprzedni lokalny URL, żeby nagrania nie zostawały niepotrzebnie w pamięci procesu.
  const revokeRecordingUrl = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }

    setRecordingUrl(null);
  }, []);

  // Zatrzymuje fizyczny stream kamery i gasi diodę/permission usage po stronie systemu.
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Uruchamia kamerę i zaczyna lokalne nagrywanie do pamięci przeglądarki.
  const startCameraRecording = useCallback(async () => {
    if (!isSupported) {
      setRecordingState('error');
      setError('Kamera nie jest dostępna w tej przeglądarce.');
      return;
    }

    if (recorderRef.current?.state === 'recording') {
      return;
    }

    setRecordingState('starting');
    setError(null);
    revokeRecordingUrl();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
      const supportedMimeType = getSupportedVideoMimeType();
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 2_500_000,
      };

      if (supportedMimeType) {
        recorderOptions.mimeType = supportedMimeType;
      }

      const recorder = new MediaRecorder(stream, {
        ...recorderOptions,
      });

      streamRef.current = stream;
      recorderRef.current = recorder;
      setRecordingMimeType(recorder.mimeType);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const videoBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'video/webm',
        });
        const nextRecordingUrl = URL.createObjectURL(videoBlob);

        recordingUrlRef.current = nextRecordingUrl;
        setRecordingUrl(nextRecordingUrl);
        setRecordingState('ready');
        stopStream();
      };

      recorder.start(1000);
      setRecordingState('recording');
    } catch (cameraError) {
      stopStream();
      recorderRef.current = null;
      setRecordingState('error');
      setError(getCameraErrorMessage(cameraError));
    }
  }, [isSupported, revokeRecordingUrl, stopStream]);

  // Kończy bieżące nagrywanie; gotowy plik zostaje jako lokalny URL do podglądu i pobrania.
  const stopCameraRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (recorder?.state === 'recording') {
      recorder.stop();
      return;
    }

    stopStream();
  }, [stopStream]);

  useEffect(
    () => () => {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }

      stopStream();
      revokeRecordingUrl();
    },
    [revokeRecordingUrl, stopStream],
  );

  return {
    error,
    isSupported,
    recordingMimeType,
    recordingState,
    recordingUrl,
    startCameraRecording,
    stopCameraRecording,
  };
}

function getSupportedVideoMimeType() {
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Brak zgody na kamerę. Sprawdź uprawnienia tej aplikacji.';
  }

  if (error instanceof Error) {
    return `Nie udało się uruchomić kamery. ${error.message}`;
  }

  return 'Nie udało się uruchomić kamery.';
}
