
export type RealtimeConversationMode = 'general' | 'coding' | 'planning';

export type CreateRealtimeSessionRequest = {
    model: 'gpt-realtime-mini' | 'gpt-realtime';
    effort: 'low' | 'medium' | 'high';
    conversationMode?: RealtimeConversationMode;
    userGoal?: string;
};

export type RealtimePromptPreview = {
    model: string;
    instructions: string;
    conversationMode: RealtimeConversationMode;
    dataSourcesUsed: Array<'memory' | 'calendar' | 'gmail'>;
    warnings: string[];
};

export type CreateRealtimeSessionResponse = {
    sdpAnswer: string;
    preview: RealtimePromptPreview;
};

// nizej funkcje do chatu glosowego realtime 

export type RealtimeVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';

export type RealtimeCallConfigRequest = CreateRealtimeSessionRequest;

export type RealtimeCallConfig = {
    model: CreateRealtimeSessionRequest['model'];
    instructions: string;
    voice: RealtimeVoice;
    preview: RealtimePromptPreview;
};

