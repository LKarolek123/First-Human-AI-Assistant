import { invoke } from '@tauri-apps/api/core';

export type ChatMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
};

export type ConversationSummary = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  status: 'creating' | 'active' | 'archived';
  message_count: number;
  last_message: string | null;
};

export type ChatResponse = {
  conversation: ConversationSummary;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  memory_suggestions: MemorySuggestion[];
  memory_suggestion_analysis: MemorySuggestionAnalysis;
  restored_from_archive: boolean;
};

export type VoiceCallHistoryLine = {
  role: 'user' | 'assistant';
  content: string;
};

export type VoiceCallHistoryResponse = {
  conversation: ConversationSummary;
  messages: ChatMessage[];
};

export type MemoryCategory =
  | 'user_fact'
  | 'preference'
  | 'project'
  | 'decision'
  | 'tool_note'
  | 'privacy';

export type MemoryRecord = {
  id: string;
  category: MemoryCategory;
  content: string;
  source_kind: 'user' | 'gmail' | 'calendar' | 'conversation';
  source_conversation_id: string | null;
  created_at: number;
  updated_at: number;
};

export type MemorySuggestion = {
  id: string;
  category: Exclude<MemoryCategory, 'tool_note'>;
  content: string;
  reason: string;
};

export type MemorySuggestionAnalysis = {
  status: 'found' | 'empty' | 'error';
  message: string;
};

export type SendChatMessageRequest = {
  conversationId: string | null;
  input: string;
};

export async function listConversations() {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary[]>('list_conversations');
}

export async function listArchivedConversations() {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary[]>('list_archived_conversations');
}

export async function createConversation(title?: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary>('create_conversation', { title });
}

export async function archiveConversation(conversationId: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary>('archive_conversation', { conversationId });
}

export async function restoreConversation(conversationId: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary>('restore_conversation', { conversationId });
}

export async function deleteConversation(conversationId: string, deleteLinkedMemory: boolean) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<void>('delete_conversation', {
    conversationId,
    deleteLinkedMemory,
  });
}

export async function getConversationMessages(conversationId: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ChatMessage[]>('get_conversation_messages', { conversationId });
}

export async function saveVoiceCallHistory(lines: VoiceCallHistoryLine[]) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<VoiceCallHistoryResponse>('save_voice_call_history', { lines });
}

export async function listMemoryRecords() {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<MemoryRecord[]>('list_memory_records');
}

export async function createMemoryRecord(
  category: MemoryCategory,
  content: string,
) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<MemoryRecord>('create_memory_record', {
    category,
    content,
  });
}

export async function saveMemorySuggestion(
  category: MemorySuggestion['category'],
  content: string,
  sourceConversationId: string,
) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<MemoryRecord>('save_memory_suggestion', {
    category,
    content,
    sourceConversationId,
  });
}

export async function updateMemoryRecord(
  id: string,
  category: MemoryCategory,
  content: string,
) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<MemoryRecord>('update_memory_record', {
    id,
    category,
    content,
  });
}

export async function deleteMemoryRecord(id: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<void>('delete_memory_record', { id });
}

export async function sendChatMessage({ conversationId, input }: SendChatMessageRequest) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ChatResponse>('send_chat_message', { conversationId, input });
}

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function getTauriOnlyMessage() {
  return 'Chat XO dziala tylko w aplikacji Tauri. Uruchom projekt przez `npm run tauri dev`, nie samo `npm run dev`.';
}
