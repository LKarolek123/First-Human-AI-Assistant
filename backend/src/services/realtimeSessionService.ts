import type { CreateRealtimeSessionRequest, RealtimePromptPreview } from "../contracts/realtime"
import { buildRealtimePromptPreview} from "./realtimePromptBuilder"

export function createRealtimeSessionPreview(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return buildRealtimePromptPreview(input);
    
}