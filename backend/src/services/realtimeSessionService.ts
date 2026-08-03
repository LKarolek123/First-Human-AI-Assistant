import type { CreateRealtimeSessionRequest, RealtimePromptPreview } from "../contracts/realtime"
import { buildRealtimePromptPreview} from "./realtimePromptBuilder"
/** odsyla zapytanie do buildRealtimePromptPreview w celu zrobienia kompletnego zapytania **/
export function createRealtimeSessionPreview(input: CreateRealtimeSessionRequest): RealtimePromptPreview {
    return buildRealtimePromptPreview(input);
    
}