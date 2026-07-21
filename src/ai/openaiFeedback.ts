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
  last_message: string | null;
};

export type ChatResponse = {
  conversation: ConversationSummary;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
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

export async function createConversation(title?: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ConversationSummary>('create_conversation', { title });
}

export async function getConversationMessages(conversationId: string) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error(getTauriOnlyMessage());
  }

  return invoke<ChatMessage[]>('get_conversation_messages', { conversationId });
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
