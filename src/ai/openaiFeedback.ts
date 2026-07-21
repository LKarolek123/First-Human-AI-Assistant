import { invoke } from '@tauri-apps/api/core';

export type FeedbackRequest = {
  input: string;
};

export async function requestGptFeedback({ input }: FeedbackRequest) {
  return invoke<string>('request_gpt_feedback', { input });
}
