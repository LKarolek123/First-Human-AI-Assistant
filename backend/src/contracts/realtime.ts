
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


