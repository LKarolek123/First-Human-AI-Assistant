import type { ChangeEvent, FormEvent, RefObject } from 'react';
import type { WhisperModelId } from './voice/useWhisperTranscription';

type WhisperOption = {
  id: WhisperModelId;
  label: string;
  description: string;
};

type ActiveWhisperModel = {
  id: WhisperModelId;
  label: string;
  description: string;
};

type ChatInputProps = {
  copy: Record<string, string>;
  typedPrompt: string;
  canSend: boolean;
  chatState: 'idle' | 'loading';
  isContextMenuOpen: boolean;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  onContextMenuToggle: () => void;
  onPromptInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isRecording: boolean;
  isSupported: boolean;
  isTranscribing: boolean;
  isBusy: boolean;
  loadState: string;
  error: string | null;
  transcript: string;
  activeWhisperModel: ActiveWhisperModel;
  whisperModelOptions: WhisperOption[];
  modelId: WhisperModelId;
  onModelIdChange: (modelId: WhisperModelId) => void;
  isVoiceModelMenuOpen: boolean;
  voiceModelMenuRef: RefObject<HTMLDivElement | null>;
  onVoiceModelMenuToggle: () => void;
  onVoiceModelMenuClose: () => void;
  onVoiceButton: () => void;
  cameraError: string | null;
  cameraRecordingState: 'idle' | 'starting' | 'recording' | 'ready' | 'error';
  cameraRecordingUrl: string | null;
  isCameraSupported: boolean;
  onCameraButton: () => void;
  voiceCallStatus: string;
  onVoiceCallToggle: () => void;
  footerText: string;
  transcriptPlaceholder: string;
};

export function ChatInput({
  copy,
  typedPrompt,
  canSend,
  chatState,
  isContextMenuOpen,
  contextMenuRef,
  onContextMenuToggle,
  onPromptInputChange,
  onSubmit,
  isRecording,
  isSupported,
  isTranscribing,
  isBusy,
  loadState,
  error,
  transcript,
  activeWhisperModel,
  whisperModelOptions,
  modelId,
  onModelIdChange,
  isVoiceModelMenuOpen,
  voiceModelMenuRef,
  onVoiceModelMenuToggle,
  onVoiceModelMenuClose,
  onVoiceButton,
  cameraError,
  cameraRecordingState,
  cameraRecordingUrl,
  isCameraSupported,
  onCameraButton,
  voiceCallStatus,
  onVoiceCallToggle,
  footerText,
  transcriptPlaceholder,
}: ChatInputProps) {
  return (
    <form className="promptForm" onSubmit={onSubmit}>
      <div className="composerShell">
        <div className="composerInputRow">
          <div className="contextMenuWrap" ref={contextMenuRef}>
            <button
              className="composerIconButton"
              type="button"
              onClick={onContextMenuToggle}
              title={copy.addContext}
            >
              <span aria-hidden="true">+</span>
            </button>
            {isContextMenuOpen && (
              <div className="contextMenu" aria-label={copy.addContext}>
                <button type="button">{copy.file}</button>
                <button type="button">{copy.calendar}</button>
                <button type="button">Gmail</button>
              </div>
            )}
          </div>

          <textarea
            id="prompt"
            className="promptInput"
            value={typedPrompt}
            onChange={onPromptInputChange}
            placeholder={copy.messagePlaceholder}
            rows={1}
          />

          <button className="sendButton" type="submit" disabled={!canSend} title={copy.send}>
            {chatState === 'loading' ? '...' : '>'}
          </button>
        </div>

        <div className="composerTools" aria-label={copy.messageTools}>
          <button
            className={isRecording ? 'toolIconButton toolIconButtonActive' : 'toolIconButton'}
            type="button"
            onClick={onVoiceButton}
            disabled={!isSupported || isTranscribing || loadState === 'loading' || chatState === 'loading'}
            aria-pressed={isRecording}
            title={isRecording ? copy.stopDictation : copy.dictation}
          >
            <svg className="micSvgIcon" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
              <path d="M8 21h8" />
            </svg>
          </button>

          <div className="compactModelPicker" ref={voiceModelMenuRef}>
            <button
              className="modelMenuButton"
              type="button"
              onClick={onVoiceModelMenuToggle}
              disabled={isRecording || isTranscribing || loadState === 'loading'}
            >
              {activeWhisperModel.label}
            </button>
            {isVoiceModelMenuOpen && (
              <div className="modelMenu" aria-label="Model voice-to-text">
                {whisperModelOptions.map((option) => (
                  <button
                    className={option.id === modelId ? 'modelMenuItem modelMenuItemActive' : 'modelMenuItem'}
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onModelIdChange(option.id);
                      onVoiceModelMenuClose();
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className={
              cameraRecordingState === 'recording' || cameraRecordingState === 'starting'
                ? 'toolIconButton toolIconButtonActive'
                : 'toolIconButton'
            }
            type="button"
            onClick={onCameraButton}
            disabled={!isCameraSupported || cameraRecordingState === 'starting'}
            aria-pressed={cameraRecordingState === 'recording'}
            title={
              cameraRecordingState === 'recording' || cameraRecordingState === 'starting'
                ? copy.stopCamera
                : copy.camera
            }
          >
            <svg className="cameraSvgIcon" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
              <path d="m17 10 5-3v10l-5-3" />
              <path d="M7 7l1.2-2h3.6L13 7" />
            </svg>
          </button>

          <button
            className={voiceCallStatus !== 'idle' ? 'toolPill toolPillActive' : 'toolPill'}
            type="button"
            onClick={onVoiceCallToggle}
            disabled={voiceCallStatus === 'saving'}
            aria-pressed={voiceCallStatus !== 'idle'}
          >
            <svg className="callSvgIcon" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M8 5c.6 5.2 5.8 10.4 11 11" />
              <path d="M6.2 3.2 8.8 6c.5.5.5 1.2.1 1.8l-1 1.4c1.2 2.4 3.1 4.3 5.5 5.5l1.4-1c.6-.4 1.3-.3 1.8.1l2.8 2.6c.6.5.7 1.4.2 2l-1.2 1.7c-.5.7-1.4 1-2.3.8C9.4 19.5 4.5 14.6 3.1 7.9c-.2-.9.1-1.8.8-2.3l1.7-1.2c.6-.5 1.5-.4 2 .2Z" />
              <path d="M15 4.5c2.3.5 4 2.2 4.5 4.5" />
              <path d="M15.5 1.5c3.6.7 6.3 3.4 7 7" />
            </svg>
            {copy.calling}
          </button>
        </div>

        <div className="composerMeta">
          <span>{footerText}</span>
        </div>

        {!isSupported && (
          <p className="voiceNotice">
            {copy.unsupportedBrowser}
          </p>
        )}

        {error && <p className="voiceError">{error}</p>}
        {!isCameraSupported && <p className="voiceNotice">{copy.cameraUnsupported}</p>}
        {cameraError && <p className="voiceError">{cameraError}</p>}

        {(cameraRecordingState === 'recording' ||
          cameraRecordingState === 'starting' ||
          cameraRecordingUrl) && (
          <div className="cameraRecordingPanel" aria-live="polite">
            <div>
              <strong>
                {cameraRecordingState === 'recording' || cameraRecordingState === 'starting'
                  ? copy.cameraRecording
                  : copy.cameraReady}
              </strong>
              <span>
                {cameraRecordingState === 'recording' || cameraRecordingState === 'starting'
                  ? copy.stopCamera
                  : copy.cameraDownload}
              </span>
            </div>
            {cameraRecordingUrl && (
              <div className="cameraRecordingActions">
                <a href={cameraRecordingUrl} download="xo-camera-recording.webm">
                  {copy.cameraDownload}
                </a>
              </div>
            )}
          </div>
        )}

        {(transcript || isBusy) && (
          <div className={isBusy ? 'transcriptBox transcriptBoxBusy' : 'transcriptBox'} aria-live="polite">
            {transcript ? (
              <p>{transcript}</p>
            ) : (
              <p className="placeholderText">{transcriptPlaceholder}</p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
