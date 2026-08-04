import { buildRealtimePromptPreview} from "./realtimePromptBuilder"
import type { RealtimeCallConfig, RealtimeCallConfigRequest, CreateRealtimeSessionRequest, RealtimePromptPreview, RealtimeVoice} from "../contracts/realtime";


const DEFAULT_REALTIME_VOICE: RealtimeVoice  = 'alloy';


/** odsyla zapytanie do buildRealtimePromptPreview w celu zrobienia kompletnego zapytania **/
export function createRealtimeSessionPreview(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return buildRealtimePromptPreview(input);
}

/** Bierze config i tworzy dane do polaczenia glosowego (model, instructions, voice i reszte) **/
export function createRealtimeCallConfig(input: RealtimeCallConfigRequest) : RealtimeCallConfig {
    const preview = buildRealtimePromptPreview(input);
    
    return {
        model: input.model,
        instructions: preview.instructions,
        voice: DEFAULT_REALTIME_VOICE,
        preview,
    };
}
