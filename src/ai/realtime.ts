import { invoke } from "@tauri-apps/api/core";

export type RealtimeConversationMode = 'general' | 'coding' | 'planning';

export type RealtimeModelId = 'gpt-realtime-mini' | 'gpt-realtime';

export type RealtimeEffort = 'low' | 'medium' | 'high';

export type RealtimePromptPreview = {
  model: string;
  instructions: string;
  conversationMode: RealtimeConversationMode;
  dataSourcesUsed: Array<'memory' | 'calendar' | 'gmail'>;
  warnings: string[];
};

export type RealtimeCallConfig = {
  model: RealtimeModelId;
  instructions: string;
  voice: string;
  preview: RealtimePromptPreview;
};

export type GetRealtimeCallConfigRequest = {
    model: RealtimeModelId;
    effort: RealtimeEffort;
    conversationMode?: RealtimeConversationMode;
    userGoal?: string;
};

export type CreateRealtimeCallRequest = GetRealtimeCallConfigRequest & {
    sdpOffer: string;
};

export type CreateRealtimeCallResponse = {
    sdpAnswer: string;
    preview: RealtimePromptPreview;
};

export type ToolPlan = {
    use_gmail: boolean;
    use_calendar: boolean;
    reason: string;
};

/**
 * wywoluje backend aplikacji, przekazuje mu request z model, instructions, voice i preview zapytania.
 *  */
export async function getRealtimeCallConfig (request: GetRealtimeCallConfigRequest) {
    return invoke<RealtimeCallConfig>('get_realtime_call_config', {
        request
    });
};

export async function createRealtimeCall (request: CreateRealtimeCallRequest) {
    return invoke<CreateRealtimeCallResponse>('create_realtime_call', {
        request,
    });
}

