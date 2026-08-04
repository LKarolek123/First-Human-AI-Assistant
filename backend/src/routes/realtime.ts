import type {
    CreateRealtimeSessionRequest,
    RealtimePromptPreview,
    RealtimeCallConfig,
} from '../contracts/realtime';
import { createRealtimeSessionPreview, createRealtimeCallConfig } from '../services/realtimeSessionService';


/** routuje input do createRealtimeSessionPreview w celu stworzenia kompletnego zapytania **/
export function createRealtimePreviewRoute(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return createRealtimeSessionPreview(input);
};

/** routuje do createRealtimeCallConfig  */
export function createRealtimeCallConfigRoute(input: CreateRealtimeSessionRequest): RealtimeCallConfig{
    return createRealtimeCallConfig(input);
}