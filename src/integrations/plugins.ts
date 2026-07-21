import { invoke } from '@tauri-apps/api/core';

export type PluginConnection = {
  provider: string;
  label: string;
  account_email: string | null;
  scopes: string[];
  connected: boolean;
  connected_at: number | null;
  updated_at: number | null;
};

export type GoogleCalendarConnectStart = {
  auth_url: string;
  redirect_uri: string;
  expires_at: number;
  opened_browser: boolean;
  open_error: string | null;
};

export type GoogleCalendarConfig = {
  client_id: string | null;
  has_client_id: boolean;
  has_client_secret: boolean;
};

export type GoogleCalendarConnectProgress = {
  status: 'idle' | 'pending' | 'connected';
  connection: PluginConnection | null;
};

export type CalendarEventSummary = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  html_link: string | null;
};

export type GmailMessageSummary = {
  id: string;
  thread_id: string | null;
  from: string | null;
  subject: string | null;
  date: string | null;
  snippet: string | null;
  label_ids: string[];
};

export async function listPluginConnections() {
  assertTauriRuntime();

  return invoke<PluginConnection[]>('list_plugin_connections');
}

export async function getGoogleCalendarConfig() {
  assertTauriRuntime();

  return invoke<GoogleCalendarConfig>('get_google_calendar_config');
}

export async function saveGoogleCalendarClientId(clientId: string, clientSecret?: string) {
  assertTauriRuntime();

  return invoke<GoogleCalendarConfig>('save_google_calendar_client_id', {
    clientId,
    clientSecret: clientSecret?.trim() ? clientSecret : null,
  });
}

export async function beginGoogleCalendarConnect() {
  assertTauriRuntime();

  return invoke<GoogleCalendarConnectStart>('begin_google_calendar_connect');
}

export async function beginGmailConnect() {
  assertTauriRuntime();

  return invoke<GoogleCalendarConnectStart>('begin_gmail_connect');
}

export async function finishGoogleCalendarConnect() {
  assertTauriRuntime();

  return invoke<GoogleCalendarConnectProgress>('finish_google_calendar_connect');
}

export async function finishGmailConnect() {
  assertTauriRuntime();

  return invoke<GoogleCalendarConnectProgress>('finish_gmail_connect');
}

export async function disconnectGoogleCalendar() {
  assertTauriRuntime();

  return invoke<PluginConnection>('disconnect_google_calendar');
}

export async function disconnectGmail() {
  assertTauriRuntime();

  return invoke<PluginConnection>('disconnect_gmail');
}

export async function listGoogleCalendarEvents(daysAhead = 7) {
  assertTauriRuntime();

  return invoke<CalendarEventSummary[]>('list_google_calendar_events', { daysAhead });
}

export async function listGmailRecentMessages() {
  assertTauriRuntime();

  return invoke<GmailMessageSummary[]>('list_gmail_recent_messages');
}

function assertTauriRuntime() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error('Wtyczki XO dzialaja tylko w aplikacji Tauri.');
  }
}
