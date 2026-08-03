import type {
    CreateRealtimeSessionRequest,
    RealtimePromptPreview,
} from '../contracts/realtime';
import { createRealtimeSessionPreview } from '../services/realtimeSessionService';

export function createRealtimePreviewRoute(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return createRealtimeSessionPreview(input);
}