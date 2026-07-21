use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{TimeZone, Utc};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const CHAT_INSTRUCTIONS: &str = "Jestes XO, spokojnym asystentem Human First. Odpowiadaj po polsku, konkretnie i zyczliwie. Masz pamietac wczesniejsze rozmowy uzytkownika, kiedy dostajesz je w kontekscie. Nie udawaj dostepu do narzedzi, ktorych nie masz. Jesli kontekst z poprzednich rozmow pomaga, uzyj go naturalnie i dyskretnie.";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_EVENTS_URL: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GMAIL_MESSAGES_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GOOGLE_CALENDAR_PROVIDER: &str = "google_calendar";
const GMAIL_PROVIDER: &str = "gmail";
const GOOGLE_CALENDAR_SCOPES: &str =
    "openid email profile https://www.googleapis.com/auth/calendar.events.readonly";
const GMAIL_SCOPES: &str = "openid email profile https://www.googleapis.com/auth/gmail.readonly";
const KEYRING_SERVICE: &str = "xo-human-first-agent";
const GOOGLE_CALENDAR_KEYRING_USER: &str = "google-calendar";
const GMAIL_KEYRING_USER: &str = "google-gmail";
const GOOGLE_OAUTH_CLIENT_SECRET_KEYRING_USER: &str = "google-oauth-client-secret";

struct AppState {
    db: Mutex<Connection>,
    pending_google_calendar_oauth: Mutex<Option<PendingGoogleOAuth>>,
}

struct PendingGoogleOAuth {
    verifier: String,
    redirect_uri: String,
    receiver: mpsc::Receiver<Result<String, String>>,
}

#[derive(Serialize)]
struct ConversationSummary {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    last_message: Option<String>,
}

#[derive(Serialize)]
struct ChatMessage {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    created_at: i64,
}

#[derive(Serialize)]
struct ChatResponse {
    conversation: ConversationSummary,
    user_message: ChatMessage,
    assistant_message: ChatMessage,
}

#[derive(Serialize)]
struct PluginConnection {
    provider: String,
    label: String,
    account_email: Option<String>,
    scopes: Vec<String>,
    connected: bool,
    connected_at: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Serialize)]
struct GoogleCalendarConnectStart {
    auth_url: String,
    redirect_uri: String,
    expires_at: i64,
    opened_browser: bool,
    open_error: Option<String>,
}

#[derive(Serialize)]
struct GoogleCalendarConnectProgress {
    status: String,
    connection: Option<PluginConnection>,
}

#[derive(Serialize)]
struct CalendarEventSummary {
    id: String,
    summary: String,
    start: Option<String>,
    end: Option<String>,
    location: Option<String>,
    html_link: Option<String>,
}

#[derive(Serialize)]
struct GmailMessageSummary {
    id: String,
    thread_id: Option<String>,
    from: Option<String>,
    subject: Option<String>,
    date: Option<String>,
    snippet: Option<String>,
    label_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct GoogleStoredTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64,
    scope: Option<String>,
    token_type: Option<String>,
    client_id: Option<String>,
}

#[derive(Serialize)]
struct GoogleCalendarConfig {
    client_id: Option<String>,
    has_client_id: bool,
    has_client_secret: bool,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    token_type: Option<String>,
}

#[derive(Deserialize)]
struct GoogleUserInfoResponse {
    email: Option<String>,
}

#[derive(Deserialize)]
struct GoogleCalendarEventsResponse {
    items: Option<Vec<GoogleCalendarEvent>>,
}

#[derive(Deserialize)]
struct GoogleCalendarEvent {
    id: Option<String>,
    summary: Option<String>,
    start: Option<GoogleCalendarDateTime>,
    end: Option<GoogleCalendarDateTime>,
    location: Option<String>,
    #[serde(rename = "htmlLink")]
    html_link: Option<String>,
}

#[derive(Deserialize)]
struct GoogleCalendarDateTime {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Deserialize)]
struct GmailMessagesListResponse {
    messages: Option<Vec<GmailMessageListItem>>,
}

#[derive(Deserialize)]
struct GmailMessageListItem {
    id: String,
}

#[derive(Deserialize)]
struct GmailMessageResponse {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    #[serde(rename = "labelIds")]
    label_ids: Option<Vec<String>>,
    snippet: Option<String>,
    payload: Option<GmailMessagePayload>,
}

#[derive(Deserialize)]
struct GmailMessagePayload {
    headers: Option<Vec<GmailHeader>>,
}

#[derive(Deserialize)]
struct GmailHeader {
    name: String,
    value: String,
}

#[derive(Default)]
struct ToolContext {
    calendar_events: Option<Vec<CalendarEventSummary>>,
    gmail_messages: Option<Vec<GmailMessageSummary>>,
    notes: Vec<String>,
}

#[derive(Serialize)]
struct OpenAIResponsesRequest<'a> {
    model: &'a str,
    instructions: &'a str,
    input: &'a str,
}

#[derive(Deserialize)]
struct OpenAIResponsesResponse {
    output: Option<Vec<OpenAIOutputItem>>,
    output_text: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIOutputItem {
    content: Option<Vec<OpenAIContentItem>>,
}

#[derive(Deserialize)]
struct OpenAIContentItem {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

#[derive(Deserialize)]
struct OpenAIErrorResponse {
    error: Option<OpenAIError>,
}

#[derive(Deserialize)]
struct OpenAIError {
    message: Option<String>,
}

#[tauri::command]
fn list_conversations(state: State<'_, AppState>) -> Result<Vec<ConversationSummary>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    load_conversations(&db)
}

#[tauri::command]
fn create_conversation(
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<ConversationSummary, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    let now = unix_timestamp();
    let id = create_id("chat");
    let title = normalize_title(title.as_deref().unwrap_or("Nowa rozmowa"));

    db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, title, now, now],
    )
    .map_err(|error| format!("Nie udalo sie utworzyc rozmowy. {error}"))?;

    load_conversation(&db, &id)
}

#[tauri::command]
fn get_conversation_messages(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    load_messages(&db, &conversation_id)
}

#[tauri::command]
async fn send_chat_message(
    conversation_id: Option<String>,
    input: String,
    state: State<'_, AppState>,
) -> Result<ChatResponse, String> {
    let input = input.trim().to_string();

    if input.is_empty() {
        return Err("Wpisz pytanie albo uzyj transkrypcji z mikrofonu.".to_string());
    }

    let (conversation_id, user_message) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let conversation_id = ensure_conversation(&db, conversation_id, &input)?;
        let user_message = insert_message(&db, &conversation_id, "user", &input)?;

        (conversation_id, user_message)
    };
    let tool_context = build_tool_context(&input, &state).await;
    let openai_input = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

        build_openai_input(&db, &conversation_id, &input, &tool_context)?
    };

    let assistant_text = request_openai_chat(&openai_input).await?;

    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    let assistant_message = insert_message(&db, &conversation_id, "assistant", &assistant_text)?;
    touch_conversation(&db, &conversation_id)?;

    Ok(ChatResponse {
        conversation: load_conversation(&db, &conversation_id)?,
        user_message,
        assistant_message,
    })
}

#[tauri::command]
async fn request_gpt_feedback(input: String, state: State<'_, AppState>) -> Result<String, String> {
    let response = send_chat_message(None, input, state).await?;

    Ok(response.assistant_message.content)
}

#[tauri::command]
fn list_plugin_connections(state: State<'_, AppState>) -> Result<Vec<PluginConnection>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    Ok(vec![
        load_plugin_connection(
            &db,
            GOOGLE_CALENDAR_PROVIDER,
            "Google Calendar",
            GOOGLE_CALENDAR_SCOPES,
        )?,
        load_plugin_connection(&db, GMAIL_PROVIDER, "Gmail", GMAIL_SCOPES)?,
    ])
}

#[tauri::command]
fn get_google_calendar_config(state: State<'_, AppState>) -> Result<GoogleCalendarConfig, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    let client_id = load_google_client_id(&db).ok();
    let has_client_secret = load_google_client_secret().is_some();

    Ok(GoogleCalendarConfig {
        has_client_id: client_id.as_ref().is_some_and(|value| !value.trim().is_empty()),
        client_id,
        has_client_secret,
    })
}

#[tauri::command]
fn save_google_calendar_client_id(
    client_id: String,
    client_secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<GoogleCalendarConfig, String> {
    let client_id = client_id.trim().to_string();

    if !is_valid_google_client_id(&client_id) {
        return Err("Wklej poprawny Google OAuth Client ID dla aplikacji Desktop.".to_string());
    }

    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    save_plugin_setting(&db, "google_calendar_client_id", &client_id)?;
    if let Some(client_secret) = client_secret {
        let client_secret = client_secret.trim();

        if !client_secret.is_empty() {
            save_google_client_secret(client_secret)?;
        }
    }

    Ok(GoogleCalendarConfig {
        client_id: Some(client_id),
        has_client_id: true,
        has_client_secret: load_google_client_secret().is_some(),
    })
}

#[tauri::command]
fn begin_google_calendar_connect(
    state: State<'_, AppState>,
) -> Result<GoogleCalendarConnectStart, String> {
    let client_id = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        load_google_client_id(&db)?
    };
    let verifier = random_url_token(96);
    let challenge = pkce_challenge(&verifier);
    let oauth_state = random_url_token(32);
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Nie udalo sie uruchomic lokalnego callbacku OAuth. {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Nie udalo sie odczytac portu callbacku OAuth. {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let (sender, receiver) = mpsc::channel();
    let expected_state = oauth_state.clone();

    thread::spawn(move || {
        let result = wait_for_google_oauth_callback(listener, &expected_state);
        let _ = sender.send(result);
    });

    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        percent_encode(&client_id),
        percent_encode(&redirect_uri),
        percent_encode(GOOGLE_CALENDAR_SCOPES),
        percent_encode(&oauth_state),
        percent_encode(&challenge)
    );

    let mut pending = state
        .pending_google_calendar_oauth
        .lock()
        .map_err(|_| "Nie udalo sie przygotowac logowania Google Calendar.".to_string())?;
    *pending = Some(PendingGoogleOAuth {
        verifier,
        redirect_uri: redirect_uri.clone(),
        receiver,
    });
    let open_error = open_url_in_default_browser(&auth_url).err();
    let opened_browser = open_error.is_none();
    log::info!(
        "Started Google Calendar OAuth. redirect_uri={}, opened_browser={}",
        redirect_uri,
        opened_browser
    );

    Ok(GoogleCalendarConnectStart {
        auth_url,
        redirect_uri,
        expires_at: unix_timestamp() + 600,
        opened_browser,
        open_error,
    })
}

#[tauri::command]
fn begin_gmail_connect(state: State<'_, AppState>) -> Result<GoogleCalendarConnectStart, String> {
    let client_id = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        load_google_client_id(&db)?
    };
    let verifier = random_url_token(96);
    let challenge = pkce_challenge(&verifier);
    let oauth_state = random_url_token(32);
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Nie udalo sie uruchomic lokalnego callbacku OAuth. {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Nie udalo sie odczytac portu callbacku OAuth. {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let (sender, receiver) = mpsc::channel();
    let expected_state = oauth_state.clone();

    thread::spawn(move || {
        let result = wait_for_google_oauth_callback(listener, &expected_state);
        let _ = sender.send(result);
    });

    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        percent_encode(&client_id),
        percent_encode(&redirect_uri),
        percent_encode(GMAIL_SCOPES),
        percent_encode(&oauth_state),
        percent_encode(&challenge)
    );

    let mut pending = state
        .pending_google_calendar_oauth
        .lock()
        .map_err(|_| "Nie udalo sie przygotowac logowania Gmail.".to_string())?;
    *pending = Some(PendingGoogleOAuth {
        verifier,
        redirect_uri: redirect_uri.clone(),
        receiver,
    });
    let open_error = open_url_in_default_browser(&auth_url).err();
    let opened_browser = open_error.is_none();
    log::info!(
        "Started Gmail OAuth. redirect_uri={}, opened_browser={}",
        redirect_uri,
        opened_browser
    );

    Ok(GoogleCalendarConnectStart {
        auth_url,
        redirect_uri,
        expires_at: unix_timestamp() + 600,
        opened_browser,
        open_error,
    })
}

#[tauri::command]
async fn finish_google_calendar_connect(
    state: State<'_, AppState>,
) -> Result<GoogleCalendarConnectProgress, String> {
    let pending = {
        let mut pending_guard = state
            .pending_google_calendar_oauth
            .lock()
            .map_err(|_| "Nie udalo sie sprawdzic logowania Google Calendar.".to_string())?;

        let Some(pending) = pending_guard.take() else {
            return Ok(GoogleCalendarConnectProgress {
                status: "idle".to_string(),
                connection: None,
            });
        };

        match pending.receiver.try_recv() {
            Ok(Ok(code)) => (pending, code),
            Ok(Err(error)) => return Err(error),
            Err(mpsc::TryRecvError::Empty) => {
                *pending_guard = Some(pending);
                return Ok(GoogleCalendarConnectProgress {
                    status: "pending".to_string(),
                    connection: None,
                });
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err("Logowanie Google Calendar zostalo przerwane.".to_string());
            }
        }
    };

    let (pending_oauth, code) = pending;
    let client_id = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        load_google_client_id(&db)?
    };
    let client_secret = load_google_client_secret();
    let tokens = exchange_google_oauth_code(
        &client_id,
        client_secret.as_deref(),
        &code,
        &pending_oauth.verifier,
        &pending_oauth.redirect_uri,
    )
    .await?;
    let email = load_google_account_email(&tokens.access_token).await?;
    save_google_tokens(&tokens)?;

    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    save_plugin_connection(
        &db,
        GOOGLE_CALENDAR_PROVIDER,
        "Google Calendar",
        email.as_deref(),
        GOOGLE_CALENDAR_SCOPES,
    )?;

    Ok(GoogleCalendarConnectProgress {
        status: "connected".to_string(),
        connection: Some(load_plugin_connection(
            &db,
            GOOGLE_CALENDAR_PROVIDER,
            "Google Calendar",
            GOOGLE_CALENDAR_SCOPES,
        )?),
    })
}

#[tauri::command]
async fn finish_gmail_connect(
    state: State<'_, AppState>,
) -> Result<GoogleCalendarConnectProgress, String> {
    let pending = {
        let mut pending_guard = state
            .pending_google_calendar_oauth
            .lock()
            .map_err(|_| "Nie udalo sie sprawdzic logowania Gmail.".to_string())?;

        let Some(pending) = pending_guard.take() else {
            return Ok(GoogleCalendarConnectProgress {
                status: "idle".to_string(),
                connection: None,
            });
        };

        match pending.receiver.try_recv() {
            Ok(Ok(code)) => (pending, code),
            Ok(Err(error)) => return Err(error),
            Err(mpsc::TryRecvError::Empty) => {
                *pending_guard = Some(pending);
                return Ok(GoogleCalendarConnectProgress {
                    status: "pending".to_string(),
                    connection: None,
                });
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err("Logowanie Gmail zostalo przerwane.".to_string());
            }
        }
    };

    let (pending_oauth, code) = pending;
    let client_id = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        load_google_client_id(&db)?
    };
    let client_secret = load_google_client_secret();
    let tokens = exchange_google_oauth_code(
        &client_id,
        client_secret.as_deref(),
        &code,
        &pending_oauth.verifier,
        &pending_oauth.redirect_uri,
    )
    .await?;
    let email = load_google_account_email(&tokens.access_token).await?;
    save_google_tokens_for(&tokens, GMAIL_KEYRING_USER)?;

    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    save_plugin_connection(&db, GMAIL_PROVIDER, "Gmail", email.as_deref(), GMAIL_SCOPES)?;

    Ok(GoogleCalendarConnectProgress {
        status: "connected".to_string(),
        connection: Some(load_plugin_connection(
            &db,
            GMAIL_PROVIDER,
            "Gmail",
            GMAIL_SCOPES,
        )?),
    })
}

#[tauri::command]
fn disconnect_google_calendar(state: State<'_, AppState>) -> Result<PluginConnection, String> {
    let _ = delete_google_tokens();
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    db.execute(
        "DELETE FROM plugin_connections WHERE provider = ?1",
        params![GOOGLE_CALENDAR_PROVIDER],
    )
    .map_err(|error| format!("Nie udalo sie odlaczyc Google Calendar. {error}"))?;

    load_plugin_connection(&db, GOOGLE_CALENDAR_PROVIDER, "Google Calendar", GOOGLE_CALENDAR_SCOPES)
}

#[tauri::command]
fn disconnect_gmail(state: State<'_, AppState>) -> Result<PluginConnection, String> {
    let _ = delete_google_tokens_for(GMAIL_KEYRING_USER);
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    db.execute(
        "DELETE FROM plugin_connections WHERE provider = ?1",
        params![GMAIL_PROVIDER],
    )
    .map_err(|error| format!("Nie udalo sie odlaczyc Gmail. {error}"))?;

    load_plugin_connection(&db, GMAIL_PROVIDER, "Gmail", GMAIL_SCOPES)
}

#[tauri::command]
async fn list_google_calendar_events(
    days_ahead: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<CalendarEventSummary>, String> {
    let has_connection = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        plugin_connection_exists(&db, GOOGLE_CALENDAR_PROVIDER)?
    };

    if !has_connection {
        return Err("Google Calendar nie jest jeszcze polaczony.".to_string());
    }

    load_google_calendar_events(days_ahead.unwrap_or(7)).await
}

#[tauri::command]
async fn list_gmail_recent_messages(
    state: State<'_, AppState>,
) -> Result<Vec<GmailMessageSummary>, String> {
    let has_connection = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        plugin_connection_exists(&db, GMAIL_PROVIDER)?
    };

    if !has_connection {
        return Err("Gmail nie jest jeszcze polaczony.".to_string());
    }

    load_recent_gmail_messages().await
}

async fn load_google_calendar_events(days_ahead: i64) -> Result<Vec<CalendarEventSummary>, String> {
    let access_token = ensure_google_access_token().await?;
    let now = unix_timestamp();
    let days = days_ahead.clamp(1, 31);
    let time_min = rfc3339_from_unix(now);
    let time_max = rfc3339_from_unix(now + days * 24 * 60 * 60);

    let response = reqwest::Client::new()
        .get(GOOGLE_CALENDAR_EVENTS_URL)
        .bearer_auth(access_token)
        .query(&[
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "20"),
            ("timeMin", time_min.as_str()),
            ("timeMax", time_max.as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie pobrac kalendarza Google. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Google Calendar API zwrocilo blad {status}."));
    }

    let payload = response
        .json::<GoogleCalendarEventsResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac wydarzen Google Calendar. {error}"))?;

    Ok(payload
        .items
        .unwrap_or_default()
        .into_iter()
        .map(|event| CalendarEventSummary {
            id: event.id.unwrap_or_else(|| create_id("event")),
            summary: event.summary.unwrap_or_else(|| "Bez tytulu".to_string()),
            start: event.start.and_then(calendar_date_time_to_string),
            end: event.end.and_then(calendar_date_time_to_string),
            location: event.location,
            html_link: event.html_link,
        })
        .collect())
}

async fn load_recent_gmail_messages() -> Result<Vec<GmailMessageSummary>, String> {
    let access_token = ensure_google_access_token_for(
        GMAIL_KEYRING_USER,
        "Brakuje refresh tokena Gmail. Polacz Gmail ponownie.",
    )
    .await?;
    let client = reqwest::Client::new();
    let response = client
        .get(GMAIL_MESSAGES_URL)
        .bearer_auth(&access_token)
        .query(&[
            ("maxResults", "20"),
            ("includeSpamTrash", "true"),
        ])
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie pobrac listy Gmail. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Gmail API zwrocilo blad {status}."));
    }

    let payload = response
        .json::<GmailMessagesListResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac listy Gmail. {error}"))?;
    let mut messages = Vec::new();

    for item in payload.messages.unwrap_or_default().into_iter().take(20) {
        messages.push(load_gmail_message_metadata(&client, &access_token, &item.id).await?);
    }

    Ok(messages)
}

fn init_database(db_path: PathBuf) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Nie udalo sie utworzyc katalogu bazy XO. {error}"))?;
    }

    let db = Connection::open(db_path)
        .map_err(|error| format!("Nie udalo sie otworzyc lokalnej bazy XO. {error}"))?;

    db.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
          ON messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_updated
          ON conversations(updated_at DESC);

        CREATE TABLE IF NOT EXISTS plugin_connections (
          provider TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          account_email TEXT,
          scopes TEXT NOT NULL,
          connected_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugin_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|error| format!("Nie udalo sie przygotowac bazy XO. {error}"))?;

    Ok(db)
}

fn ensure_conversation(
    db: &Connection,
    conversation_id: Option<String>,
    first_input: &str,
) -> Result<String, String> {
    if let Some(conversation_id) = conversation_id {
        let exists = db
            .query_row(
                "SELECT 1 FROM conversations WHERE id = ?1",
                params![conversation_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| format!("Nie udalo sie sprawdzic rozmowy. {error}"))?
            .is_some();

        if exists {
            return Ok(conversation_id);
        }
    }

    let now = unix_timestamp();
    let id = create_id("chat");
    let title = title_from_input(first_input);

    db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, title, now, now],
    )
    .map_err(|error| format!("Nie udalo sie utworzyc rozmowy. {error}"))?;

    Ok(id)
}

fn insert_message(
    db: &Connection,
    conversation_id: &str,
    role: &str,
    content: &str,
) -> Result<ChatMessage, String> {
    let message = ChatMessage {
        id: create_id("msg"),
        conversation_id: conversation_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        created_at: unix_timestamp(),
    };

    db.execute(
        "INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            message.id,
            message.conversation_id,
            message.role,
            message.content,
            message.created_at
        ],
    )
    .map_err(|error| format!("Nie udalo sie zapisac wiadomosci. {error}"))?;

    touch_conversation(db, conversation_id)?;

    Ok(message)
}

fn touch_conversation(db: &Connection, conversation_id: &str) -> Result<(), String> {
    db.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![unix_timestamp(), conversation_id],
    )
    .map_err(|error| format!("Nie udalo sie zaktualizowac rozmowy. {error}"))?;

    Ok(())
}

fn build_openai_input(
    db: &Connection,
    conversation_id: &str,
    current_input: &str,
    tool_context: &ToolContext,
) -> Result<String, String> {
    let memory = load_cross_conversation_memory(db, conversation_id)?;
    let history = load_messages(db, conversation_id)?;
    let mut input = String::new();

    input.push_str("Pamiec z poprzednich rozmow XO:\n");
    if memory.is_empty() {
        input.push_str("- Brak jeszcze zapisanych poprzednich rozmow.\n");
    } else {
        for item in memory {
            input.push_str("- ");
            input.push_str(&item);
            input.push('\n');
        }
    }

    input.push_str("\nHistoria aktualnej rozmowy:\n");
    if history.is_empty() {
        input.push_str("- To poczatek tej rozmowy.\n");
    } else {
        for message in history.iter().rev().take(24).collect::<Vec<_>>().into_iter().rev() {
            input.push_str(match message.role.as_str() {
                "assistant" => "XO: ",
                _ => "Uzytkownik: ",
            });
            input.push_str(&message.content);
            input.push('\n');
        }
    }

    input.push_str("\nDane z narzedzi lokalnych:\n");
    append_tool_context(&mut input, tool_context);

    input.push_str("\nNowa wiadomosc uzytkownika:\n");
    input.push_str(current_input);

    Ok(input)
}

fn load_cross_conversation_memory(
    db: &Connection,
    current_conversation_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = db
        .prepare(
            "
            SELECT c.title, m.role, m.content
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE m.conversation_id != ?1
            ORDER BY m.created_at DESC
            LIMIT 36
            ",
        )
        .map_err(|error| format!("Nie udalo sie odczytac pamieci rozmow. {error}"))?;

    let rows = statement
        .query_map(params![current_conversation_id], |row| {
            let title: String = row.get(0)?;
            let role: String = row.get(1)?;
            let content: String = row.get(2)?;
            let role_label = if role == "assistant" { "XO" } else { "Uzytkownik" };

            Ok(format!(
                "{} / {}: {}",
                title,
                role_label,
                truncate(&content, 260)
            ))
        })
        .map_err(|error| format!("Nie udalo sie odczytac pamieci rozmow. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie odczytac pamieci rozmow. {error}"))
}

async fn build_tool_context(input: &str, state: &State<'_, AppState>) -> ToolContext {
    let mut context = ToolContext::default();

    if should_use_calendar(input) {
        match load_calendar_events_for_chat(state).await {
            Ok(events) => context.calendar_events = Some(events),
            Err(error) => context
                .notes
                .push(format!("Nie udalo sie pobrac Google Calendar: {error}")),
        }
    }

    if should_use_gmail(input) {
        match load_gmail_messages_for_chat(state).await {
            Ok(messages) => context.gmail_messages = Some(messages),
            Err(error) => context
                .notes
                .push(format!("Nie udalo sie pobrac Gmail: {error}")),
        }
    }

    context
}

async fn load_calendar_events_for_chat(
    state: &State<'_, AppState>,
) -> Result<Vec<CalendarEventSummary>, String> {
    let has_connection = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        plugin_connection_exists(&db, GOOGLE_CALENDAR_PROVIDER)?
    };

    if !has_connection {
        return Err("Google Calendar nie jest jeszcze polaczony.".to_string());
    }

    load_google_calendar_events(7).await
}

async fn load_gmail_messages_for_chat(
    state: &State<'_, AppState>,
) -> Result<Vec<GmailMessageSummary>, String> {
    let has_connection = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        plugin_connection_exists(&db, GMAIL_PROVIDER)?
    };

    if !has_connection {
        return Err("Gmail nie jest jeszcze polaczony.".to_string());
    }

    load_recent_gmail_messages().await
}

fn should_use_calendar(input: &str) -> bool {
    contains_any(
        input,
        &[
            "kalendarz",
            "calendar",
            "spotkanie",
            "spotkania",
            "termin",
            "terminy",
            "event",
            "wydarzenie",
            "wydarzenia",
            "plan dnia",
            "dzisiaj w kalendarzu",
            "jutro w kalendarzu",
        ],
    )
}

fn should_use_gmail(input: &str) -> bool {
    contains_any(
        input,
        &[
            "gmail",
            "mail",
            "maile",
            "email",
            "e-mail",
            "poczta",
            "skrzynka",
            "wiadomosci",
            "wiadomości",
            "odebrane",
            "spam",
        ],
    )
}

fn contains_any(input: &str, patterns: &[&str]) -> bool {
    let input = input.to_lowercase();

    patterns.iter().any(|pattern| input.contains(pattern))
}

fn append_tool_context(input: &mut String, tool_context: &ToolContext) {
    let has_any_context = tool_context.calendar_events.is_some()
        || tool_context.gmail_messages.is_some()
        || !tool_context.notes.is_empty();

    if !has_any_context {
        input.push_str("- Brak wywolanych narzedzi dla tej wiadomosci.\n");
        return;
    }

    for note in &tool_context.notes {
        input.push_str("- Uwaga: ");
        input.push_str(note);
        input.push('\n');
    }

    if let Some(events) = &tool_context.calendar_events {
        input.push_str("\nGoogle Calendar, najblizsze wydarzenia:\n");

        if events.is_empty() {
            input.push_str("- Brak wydarzen w najblizszych 7 dniach.\n");
        } else {
            for event in events.iter().take(20) {
                input.push_str("- ");
                input.push_str(&event.summary);
                input.push_str(" | start: ");
                input.push_str(event.start.as_deref().unwrap_or("brak"));
                input.push_str(" | end: ");
                input.push_str(event.end.as_deref().unwrap_or("brak"));

                if let Some(location) = &event.location {
                    input.push_str(" | location: ");
                    input.push_str(location);
                }

                input.push('\n');
            }
        }
    }

    if let Some(messages) = &tool_context.gmail_messages {
        input.push_str("\nGmail, 20 ostatnich wiadomosci z metadanymi i snippetem:\n");

        if messages.is_empty() {
            input.push_str("- Brak wiadomosci do pokazania.\n");
        } else {
            for message in messages.iter().take(20) {
                input.push_str("- from: ");
                input.push_str(message.from.as_deref().unwrap_or("brak"));
                input.push_str(" | subject: ");
                input.push_str(message.subject.as_deref().unwrap_or("Bez tematu"));
                input.push_str(" | date: ");
                input.push_str(message.date.as_deref().unwrap_or("brak"));
                input.push_str(" | labels: ");
                input.push_str(&message.label_ids.join(","));

                if let Some(snippet) = &message.snippet {
                    input.push_str(" | snippet: ");
                    input.push_str(&truncate(snippet, 220));
                }

                input.push('\n');
            }
        }
    }
}

fn load_conversations(db: &Connection) -> Result<Vec<ConversationSummary>, String> {
    let mut statement = db
        .prepare(
            "
            SELECT
              c.id,
              c.title,
              c.created_at,
              c.updated_at,
              (
                SELECT content
                FROM messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS last_message
            FROM conversations c
            ORDER BY c.updated_at DESC
            ",
        )
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))?;

    let rows = statement
        .query_map([], map_conversation_summary)
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))
}

fn load_conversation(db: &Connection, conversation_id: &str) -> Result<ConversationSummary, String> {
    db.query_row(
        "
        SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          (
            SELECT content
            FROM messages
            WHERE conversation_id = c.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS last_message
        FROM conversations c
        WHERE c.id = ?1
        ",
        params![conversation_id],
        map_conversation_summary,
    )
    .map_err(|error| format!("Nie udalo sie pobrac rozmowy. {error}"))
}

fn load_messages(db: &Connection, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
    let mut statement = db
        .prepare(
            "
            SELECT id, conversation_id, role, content, created_at
            FROM messages
            WHERE conversation_id = ?1
            ORDER BY created_at ASC
            ",
        )
        .map_err(|error| format!("Nie udalo sie pobrac wiadomosci. {error}"))?;

    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| format!("Nie udalo sie pobrac wiadomosci. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie pobrac wiadomosci. {error}"))
}

fn map_conversation_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationSummary> {
    Ok(ConversationSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        last_message: row.get(4)?,
    })
}

fn load_plugin_connection(
    db: &Connection,
    provider: &str,
    label: &str,
    default_scopes: &str,
) -> Result<PluginConnection, String> {
    let row = db
        .query_row(
            "SELECT account_email, scopes, connected_at, updated_at
             FROM plugin_connections
             WHERE provider = ?1",
            params![provider],
            |row| {
                let scopes: String = row.get(1)?;
                Ok(PluginConnection {
                    provider: provider.to_string(),
                    label: label.to_string(),
                    account_email: row.get(0)?,
                    scopes: scopes.split_whitespace().map(str::to_string).collect(),
                    connected: true,
                    connected_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Nie udalo sie odczytac statusu wtyczki. {error}"))?;

    Ok(row.unwrap_or_else(|| PluginConnection {
        provider: provider.to_string(),
        label: label.to_string(),
        account_email: None,
        scopes: default_scopes.split_whitespace().map(str::to_string).collect(),
        connected: false,
        connected_at: None,
        updated_at: None,
    }))
}

fn save_plugin_connection(
    db: &Connection,
    provider: &str,
    label: &str,
    account_email: Option<&str>,
    scopes: &str,
) -> Result<(), String> {
    let now = unix_timestamp();

    db.execute(
        "
        INSERT INTO plugin_connections (provider, label, account_email, scopes, connected_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(provider) DO UPDATE SET
          label = excluded.label,
          account_email = excluded.account_email,
          scopes = excluded.scopes,
          updated_at = excluded.updated_at
        ",
        params![provider, label, account_email, scopes, now, now],
    )
    .map_err(|error| format!("Nie udalo sie zapisac statusu wtyczki. {error}"))?;

    Ok(())
}

fn plugin_connection_exists(db: &Connection, provider: &str) -> Result<bool, String> {
    db.query_row(
        "SELECT 1 FROM plugin_connections WHERE provider = ?1",
        params![provider],
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
        .map_err(|error| format!("Nie udalo sie sprawdzic statusu wtyczki. {error}"))
}

fn save_plugin_setting(db: &Connection, key: &str, value: &str) -> Result<(), String> {
    db.execute(
        "
        INSERT INTO plugin_settings (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        ",
        params![key, value, unix_timestamp()],
    )
    .map_err(|error| format!("Nie udalo sie zapisac ustawienia wtyczki. {error}"))?;

    Ok(())
}

fn load_plugin_setting(db: &Connection, key: &str) -> Result<Option<String>, String> {
    db.query_row(
        "SELECT value FROM plugin_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| format!("Nie udalo sie odczytac ustawienia wtyczki. {error}"))
}

fn load_google_client_id(db: &Connection) -> Result<String, String> {
    let configured = load_plugin_setting(db, "google_calendar_client_id")?
        .or_else(|| std::env::var("GOOGLE_OAUTH_CLIENT_ID").ok())
        .unwrap_or_default()
        .trim()
        .to_string();

    if is_valid_google_client_id(&configured) {
        Ok(configured)
    } else {
        Err("Brakuje Google OAuth Client ID. Wklej go w panelu wtyczki Google Calendar.".to_string())
    }
}

fn save_google_client_secret(client_secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, GOOGLE_OAUTH_CLIENT_SECRET_KEYRING_USER)
        .map_err(|error| format!("Nie udalo sie otworzyc systemowego sejfu. {error}"))?;

    entry
        .set_password(client_secret)
        .map_err(|error| format!("Nie udalo sie zapisac Google OAuth Client Secret. {error}"))
}

fn load_google_client_secret() -> Option<String> {
    if let Ok(client_secret) = std::env::var("GOOGLE_OAUTH_CLIENT_SECRET") {
        let client_secret = client_secret.trim().to_string();

        if !client_secret.is_empty() {
            return Some(client_secret);
        }
    }

    keyring::Entry::new(KEYRING_SERVICE, GOOGLE_OAUTH_CLIENT_SECRET_KEYRING_USER)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(|client_secret| client_secret.trim().to_string())
        .filter(|client_secret| !client_secret.is_empty())
}

fn is_valid_google_client_id(client_id: &str) -> bool {
    let client_id = client_id.trim();

    client_id.ends_with(".apps.googleusercontent.com") && client_id.len() > 30
}

fn format_google_oauth_error(status: u16, phase: &str, error_body: &str) -> String {
    if error_body.contains("client_secret is missing") {
        return format!(
            "Google OAuth zwrocil blad {status} podczas {phase}. Uzyty OAuth Client ID wyglada na typ Web application. XO uzywa desktopowego OAuth z PKCE, wiec w Google Cloud utworz Credentials -> OAuth client ID -> Desktop app i wklej Client ID z tego klienta. Szczegoly Google: {}",
            truncate(error_body, 500)
        );
    }

    format!(
        "Google OAuth zwrocil blad {status} podczas {phase}. Szczegoly: {}",
        truncate(error_body, 600)
    )
}

async fn exchange_google_oauth_code(
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<GoogleStoredTokens, String> {
    let mut form = vec![
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ];

    if let Some(client_secret) = client_secret {
        form.push(("client_secret", client_secret));
    }

    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie wymienic kodu Google OAuth. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Nie udalo sie odczytac tresci bledu Google OAuth.".to_string());
        log::warn!("Google OAuth token exchange failed: status={status}, body={error_body}");

        return Err(format_google_oauth_error(status.as_u16(), "laczenia", &error_body));
    }

    let payload = response
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac tokenow Google OAuth. {error}"))?;

    Ok(GoogleStoredTokens {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: unix_timestamp() + payload.expires_in.unwrap_or(3600),
        scope: payload.scope,
        token_type: payload.token_type,
        client_id: Some(client_id.to_string()),
    })
}

async fn load_google_account_email(access_token: &str) -> Result<Option<String>, String> {
    let response = reqwest::Client::new()
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie pobrac emaila Google. {error}"))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let payload = response
        .json::<GoogleUserInfoResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac emaila Google. {error}"))?;

    Ok(payload.email)
}

async fn ensure_google_access_token() -> Result<String, String> {
    ensure_google_access_token_for(
        GOOGLE_CALENDAR_KEYRING_USER,
        "Brakuje refresh tokena Google. Polacz Google Calendar ponownie.",
    )
    .await
}

async fn ensure_google_access_token_for(
    keyring_user: &str,
    missing_refresh_message: &str,
) -> Result<String, String> {
    let mut tokens = load_google_tokens_for(keyring_user)?;

    if tokens.expires_at > unix_timestamp() + 90 {
        return Ok(tokens.access_token);
    }

    let Some(refresh_token) = tokens.refresh_token.clone() else {
        return Err(missing_refresh_message.to_string());
    };

    let client_id = tokens
        .client_id
        .clone()
        .or_else(|| std::env::var("GOOGLE_OAUTH_CLIENT_ID").ok())
        .ok_or_else(|| "Brakuje Google OAuth Client ID. Wklej go w panelu wtyczki.".to_string())?;
    let client_secret = load_google_client_secret();
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];

    if let Some(client_secret) = client_secret.as_deref() {
        form.push(("client_secret", client_secret));
    }

    let response = reqwest::Client::new()
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie odswiezyc tokena Google. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Nie udalo sie odczytac tresci bledu Google OAuth.".to_string());
        log::warn!("Google OAuth refresh failed: status={status}, body={error_body}");

        return Err(format_google_oauth_error(status.as_u16(), "odswiezania", &error_body));
    }

    let payload = response
        .json::<GoogleTokenResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac odswiezonego tokena Google. {error}"))?;

    tokens.access_token = payload.access_token;
    tokens.expires_at = unix_timestamp() + payload.expires_in.unwrap_or(3600);
    tokens.scope = payload.scope.or(tokens.scope);
    tokens.token_type = payload.token_type.or(tokens.token_type);
    save_google_tokens_for(&tokens, keyring_user)?;

    Ok(tokens.access_token)
}

fn save_google_tokens(tokens: &GoogleStoredTokens) -> Result<(), String> {
    save_google_tokens_for(tokens, GOOGLE_CALENDAR_KEYRING_USER)
}

fn save_google_tokens_for(tokens: &GoogleStoredTokens, keyring_user: &str) -> Result<(), String> {
    let serialized = serde_json::to_string(tokens)
        .map_err(|error| format!("Nie udalo sie przygotowac tokenow Google. {error}"))?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, keyring_user)
        .map_err(|error| format!("Nie udalo sie otworzyc systemowego sejfu. {error}"))?;

    entry
        .set_password(&serialized)
        .map_err(|error| format!("Nie udalo sie zapisac tokenow w systemowym sejfie. {error}"))
}

fn load_google_tokens_for(keyring_user: &str) -> Result<GoogleStoredTokens, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, keyring_user)
        .map_err(|error| format!("Nie udalo sie otworzyc systemowego sejfu. {error}"))?;
    let serialized = entry
        .get_password()
        .map_err(|_| "Google Calendar nie jest jeszcze polaczony.".to_string())?;

    serde_json::from_str(&serialized)
        .map_err(|error| format!("Nie udalo sie odczytac tokenow Google. {error}"))
}

fn delete_google_tokens() -> Result<(), String> {
    delete_google_tokens_for(GOOGLE_CALENDAR_KEYRING_USER)
}

fn delete_google_tokens_for(keyring_user: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, keyring_user)
        .map_err(|error| format!("Nie udalo sie otworzyc systemowego sejfu. {error}"))?;

    entry
        .delete_credential()
        .map_err(|error| format!("Nie udalo sie usunac tokenow Google. {error}"))
}

async fn load_gmail_message_metadata(
    client: &reqwest::Client,
    access_token: &str,
    message_id: &str,
) -> Result<GmailMessageSummary, String> {
    let response = client
        .get(format!("{GMAIL_MESSAGES_URL}/{message_id}"))
        .bearer_auth(access_token)
        .query(&[
            ("format", "metadata"),
            ("metadataHeaders", "From"),
            ("metadataHeaders", "Subject"),
            ("metadataHeaders", "Date"),
        ])
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie pobrac metadanych Gmail. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Gmail API zwrocilo blad {status} przy wiadomosci."));
    }

    let payload = response
        .json::<GmailMessageResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac metadanych Gmail. {error}"))?;
    let headers = payload
        .payload
        .and_then(|payload| payload.headers)
        .unwrap_or_default();

    Ok(GmailMessageSummary {
        id: payload.id,
        thread_id: payload.thread_id,
        from: header_value(&headers, "From"),
        subject: header_value(&headers, "Subject"),
        date: header_value(&headers, "Date"),
        snippet: payload.snippet,
        label_ids: payload.label_ids.unwrap_or_default(),
    })
}

fn header_value(headers: &[GmailHeader], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|header| header.name.eq_ignore_ascii_case(name))
        .map(|header| header.value.clone())
}

fn wait_for_google_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    let (mut stream, _) = listener
        .accept()
        .map_err(|error| format!("Nie udalo sie odebrac callbacku Google OAuth. {error}"))?;
    let mut buffer = [0_u8; 4096];
    let size = stream
        .read(&mut buffer)
        .map_err(|error| format!("Nie udalo sie odczytac callbacku Google OAuth. {error}"))?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let first_line = request.lines().next().unwrap_or_default();
    let path = first_line.split_whitespace().nth(1).unwrap_or_default();
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or_default();
    let code = query_param(query, "code");
    let state = query_param(query, "state");
    let error = query_param(query, "error");

    if let Some(error) = error {
        write_oauth_response(&mut stream, false)?;
        return Err(format!("Google OAuth przerwal logowanie: {error}"));
    }

    if state.as_deref() != Some(expected_state) {
        write_oauth_response(&mut stream, false)?;
        return Err("Google OAuth zwrocil nieprawidlowy state.".to_string());
    }

    let Some(code) = code else {
        write_oauth_response(&mut stream, false)?;
        return Err("Google OAuth nie zwrocil kodu autoryzacji.".to_string());
    };

    write_oauth_response(&mut stream, true)?;
    Ok(code)
}

fn write_oauth_response(stream: &mut TcpStream, success: bool) -> Result<(), String> {
    let body = if success {
        "XO odebral zgode Google. Mozesz wrocic do aplikacji."
    } else {
        "XO nie mogl odebrac zgody Google. Wroc do aplikacji i sprobuj ponownie."
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );

    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("Nie udalo sie odpowiedziec na callback OAuth. {error}"))
}

fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    if !url.starts_with(GOOGLE_AUTH_URL) {
        return Err("XO moze otwierac tylko przygotowany link Google OAuth.".to_string());
    }

    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .status()
        .map_err(|error| format!("Nie udalo sie otworzyc przegladarki. {error}"))?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("Nie udalo sie otworzyc przegladarki. {error}"))?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(url)
        .status()
        .map_err(|error| format!("Nie udalo sie otworzyc przegladarki. {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("System nie otworzyl przegladarki. Status: {status}"))
    }
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|part| {
        let (part_key, value) = part.split_once('=')?;

        (part_key == key).then(|| percent_decode(value))
    })
}

fn random_url_token(byte_len: usize) -> String {
    let mut bytes = vec![0_u8; byte_len];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());

    URL_SAFE_NO_PAD.encode(digest)
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }

        output.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }

    String::from_utf8_lossy(&output).to_string()
}

fn calendar_date_time_to_string(value: GoogleCalendarDateTime) -> Option<String> {
    value.date_time.or(value.date)
}

fn rfc3339_from_unix(timestamp: i64) -> String {
    Utc.timestamp_opt(timestamp, 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

async fn request_openai_chat(input: &str) -> Result<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "Brakuje OPENAI_API_KEY w konfiguracji srodowiska.".to_string())?;
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    let request = OpenAIResponsesRequest {
        model: &model,
        instructions: CHAT_INSTRUCTIONS,
        input,
    };

    let response = reqwest::Client::new()
        .post(OPENAI_API_URL)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie polaczyc z OpenAI API. {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let fallback = format!("OpenAI API zwrocilo blad {status}.");
        let error_message = response
            .json::<OpenAIErrorResponse>()
            .await
            .ok()
            .and_then(|payload| payload.error)
            .and_then(|error| error.message)
            .unwrap_or(fallback);

        return Err(error_message);
    }

    let payload = response
        .json::<OpenAIResponsesResponse>()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac odpowiedzi OpenAI API. {error}"))?;

    extract_response_text(payload)
        .ok_or_else(|| "Model nie zwrocil tekstowej odpowiedzi.".to_string())
}

fn extract_response_text(payload: OpenAIResponsesResponse) -> Option<String> {
    if let Some(output_text) = payload.output_text {
        let output_text = output_text.trim().to_string();

        if !output_text.is_empty() {
            return Some(output_text);
        }
    }

    let output = payload.output?;
    let text = output
        .into_iter()
        .filter_map(|item| item.content)
        .flatten()
        .filter(|content| content.content_type == "output_text")
        .filter_map(|content| content.text)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    (!text.is_empty()).then_some(text)
}

fn title_from_input(input: &str) -> String {
    let title = input.lines().next().unwrap_or("Nowa rozmowa");

    normalize_title(title)
}

fn normalize_title(title: &str) -> String {
    let title = truncate(title.trim(), 48);

    if title.is_empty() {
        "Nowa rozmowa".to_string()
    } else {
        title
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut output = value.chars().take(max_chars).collect::<String>();

    if value.chars().count() > max_chars {
        output.push_str("...");
    }

    output
}

fn create_id(prefix: &str) -> String {
    format!("{prefix}_{}_{}", unix_timestamp(), monotonic_nanos())
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn monotonic_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn load_local_environment() {
    let _ = dotenvy::from_filename("../.env.local");
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            load_local_environment();

            let db_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("xo-memory.sqlite3");
            let db = init_database(db_path)?;

            app.manage(AppState {
                db: Mutex::new(db),
                pending_google_calendar_oauth: Mutex::new(None),
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_conversations,
            create_conversation,
            get_conversation_messages,
            send_chat_message,
            request_gpt_feedback,
            list_plugin_connections,
            get_google_calendar_config,
            save_google_calendar_client_id,
            begin_google_calendar_connect,
            finish_google_calendar_connect,
            disconnect_google_calendar,
            list_google_calendar_events,
            begin_gmail_connect,
            finish_gmail_connect,
            disconnect_gmail,
            list_gmail_recent_messages
        ])
        .run(tauri::generate_context!())
        .expect("error while running XO application");
}
