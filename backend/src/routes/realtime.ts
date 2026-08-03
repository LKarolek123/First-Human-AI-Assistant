import type {
    CreateRealtimeSessionRequest,
    RealtimePromptPreview,
} from '../contracts/realtime';
import { createRealtimeSessionPreview } from '../services/realtimeSessionService';
/** routuje input do createRealtimeSessionPreview w celu stworzenia kompletnego zapytania **/
export function createRealtimePreviewRoute(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return createRealtimeSessionPreview(input);
}