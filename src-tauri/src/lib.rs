use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{TimeZone, Utc};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_REALTIME_CALLS_URL: &str = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const OPENAI_REQUEST_TIMEOUT_SECONDS: u64 = 90;

const CHAT_INSTRUCTIONS: &str = "Jestes XO, spokojnym asystentem Human First. Odpowiadaj po polsku, konkretnie i zyczliwie. 
Odpowiadaj na pytania w jezyku polskim, chyba ze uzytkownik rozpocznie z toba konwersacje w jezyku angielskim - wtedy odpowiadaj po angielsku. 
Masz pamietac wczesniejsze rozmowy uzytkownika, kiedy dostajesz je w kontekscie. 
Jawna pamiec ustawiona przez uzytkownika ma pierwszenstwo przed surowa historia rozmow. 
Nie udawaj dostepu do narzedzi, ktorych nie masz. Jesli kontekst z poprzednich rozmow pomaga, uzyj go naturalnie i dyskretnie.";

const MEMORY_SUGGESTION_INSTRUCTIONS: &str = "Analizujesz tylko najnowsza wiadomosc uzytkownika, najnowsza odpowiedz XO 
i istniejace jawne wpisy pamieci. Nie uzywaj ani nie zakladaj zadnej innej historii. 
Zaproponuj maksymalnie 3 stabilne i przydatne wpisy pamieci na przyszle rozmowy: preferencje, decyzje, fakty projektowe, fakty o uzytkowniku 
lub stale ograniczenia pracy. Nie mogą być to dane chwilowe, które nie mają żadnego wpływu na użytkownika.
Nie proponuj sekretow, hasel, tokenow, kluczy API, ani prywatnych/wrazliwych danych o osobach trzecich. 
Zwracaj uwagę na samopoczucie użytkownika i problemy, o których do ciebie mówi.
Nie proponuj informacji chwilowych, oczywistych, niepewnych ani duplikatow istniejacej pamieci. 
Nie proponuj wpisow pamieci dotyczacych preferowanego jezyka odpowiedzi, np. ze uzytkownik chce odpowiedzi po polsku albo po angielsku. 
Zwroc wylacznie poprawny JSON w formacie {\"suggestions\":[{\"content\":\"...\",\"category\":\"preference\",\"reason\":\"...\"}]}. 
Dozwolone category: user_fact, preference, project, decision, privacy.";

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

const VOICE_MEMORY_SUGGESTION_INSTRUCTIONS: &str = "Analizujesz cala zapisana rozmowe glosowa uzytkownika z XO 
i istniejace jawne wpisy pamieci. Nie uzywaj ani nie zakladaj zadnej innej historii. 
Zaproponuj maksymalnie 3 stabilne i przydatne wpisy pamieci na przyszle rozmowy: 
preferencje, decyzje, fakty projektowe, fakty o uzytkowniku lub stale ograniczenia pracy. 
Nie proponuj sekretow, hasel, tokenow, kluczy API, danych zdrowotnych ani prywatnych/wrazliwych 
 danych o osobach trzecich. Nie proponuj informacji chwilowych, oczywistych, 
 niepewnych ani duplikatow istniejacej pamieci. Nie proponuj wpisow pamieci dotyczacych preferowanego jezyka odpowiedzi, np. ze uzytkownik chce odpowiedzi po polsku albo po angielsku. Zwroc wylacznie poprawny JSON w formacie 
{\"suggestions\":[{\"content\":\"...\",\"category\":\"preference\"}]}. 
Nie dodawaj pola reason. Dozwolone category: user_fact, preference, project, decision, privacy.
";

const TOOL_PLANNER_INSTRUCTIONS: &str = include_str!("prompts/tool_planner.md");
const CODE_PATCH_PROPOSAL_INSTRUCTIONS: &str = "Jestes lokalnym coding agentem XO w trybie proposal-only. \
Czytasz tylko dostarczone wycinki kodu i przygotowujesz propozycje zmian. \
Nie twierdz, ze zapisales pliki, uruchomiles testy albo zastosowales patch. \
Nie pros o sekrety i nie sugeruj logowania tokenow, hasel ani kluczy API. \
Jesli brakuje kontekstu, napisz jakie pliki trzeba sprawdzic. \
Odpowiedz po polsku. Zwroc: krotki plan, ryzyka, proponowany unified diff w bloku ```diff oraz testy do uruchomienia.";
const CODE_PATCH_REPAIR_INSTRUCTIONS: &str = "Jestes lokalnym coding agentem XO naprawiajacym uszkodzony unified diff. \
Dostajesz zadanie uzytkownika, aktualny kod, patch odrzucony przez git apply oraz blad Gita. \
Nie zmieniaj zakresu zadania i nie dodawaj nowych decyzji. \
Zwroc wylacznie poprawny unified diff w formacie git, zaczynajacy sie od linii diff --git a/sciezka b/sciezka. \
Nie opakowuj odpowiedzi w markdown i nie dodawaj komentarza poza diffem. \
Patch musi dotyczyc tylko plikow widocznych w dostarczonym kontekście kodu. \
Nie modyfikuj sekretow, plikow .env, .git, build outputow ani zaleznosci.";
const CODE_AGENT_INSTRUCTIONS: &str = "Jestes lokalnym agentem kodujacym XO sterowanym przez bezpieczne akcje JSON. \
Nie pisz zwyklej odpowiedzi. W kazdym kroku zwroc wylacznie poprawny JSON z jedna akcja. \
Dostepne akcje: \
{\"action\":\"read_file\",\"path\":\"src/App.tsx\",\"reason\":\"dlaczego ten plik\"}, \
{\"action\":\"apply_patch\",\"patch\":\"unified diff\",\"reason\":\"co zmienia patch\"}, \
{\"action\":\"run_build\",\"reason\":\"dlaczego trzeba uruchomic build\"}, \
{\"action\":\"clarify\",\"message\":\"pytanie do uzytkownika\"}, \
{\"action\":\"finish\",\"message\":\"podsumowanie dla uzytkownika\"}. \
Czytaj pliki iteracyjnie i pros tylko o pliki z indeksu projektu. \
Patch musi byc poprawnym unified diffem w formacie git i dotyczyc tylko przeczytanych plikow. \
Uzywaj clarify tylko wtedy, gdy bez odpowiedzi uzytkownika nie da sie bezpiecznie okreslic zachowania funkcji, zakresu danych, skutkow ubocznych, prywatnosci albo operacji destrukcyjnej. \
Nie pytaj o drobne decyzje implementacyjne ani UI, takie jak polozenie przycisku, wariant tekstu, nazwy zmiennych, prosty layout czy styl, jesli mozna zastosowac spojny wzorzec z istniejacej aplikacji. \
Gdy zadanie jest jasne, wybierz najprostsze rozwiazanie zgodne z istniejacym kodem i kontynuuj bez clarify. \
Jesli polityka pytania przed zmiana jest wlaczona, clarify nadal jest wyjatkiem dla naprawde koniecznych pytan funkcjonalnych. \
Nie modyfikuj sekretow, plikow .env, .git, build outputow ani zaleznosci. \
Nie uruchamiaj dowolnych komend; jedyna dozwolona akcja testowa to run_build.";

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
    status: String,
    kind: String,
    message_count: i64,
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
    memory_suggestions: Vec<MemorySuggestion>,
    memory_suggestion_analysis: MemorySuggestionAnalysis,
    restored_from_archive: bool,
}

#[derive(Serialize)]
struct CodePatchProposal {
    task: String,
    proposal: String,
    inspected_files: Vec<String>,
    created_at: i64,
}

#[derive(Serialize)]
struct CodePatchApplyResult {
    task: String,
    patch: String,
    inspected_files: Vec<String>,
    changed_files: Vec<String>,
    agent_steps: Vec<DeveloperAgentStep>,
    needs_clarification: bool,
    clarification_question: Option<String>,
    created_at: i64,
}

#[derive(Clone, Serialize)]
struct DeveloperAgentStep {
    step: i64,
    action: String,
    reason: Option<String>,
    result: String,
}

#[derive(Clone, Serialize)]
struct DeveloperAgentStepEvent {
    run_id: String,
    step: DeveloperAgentStep,
}

#[derive(Serialize)]
struct DeveloperCommandResult {
    command: String,
    success: bool,
    stdout: String,
    stderr: String,
    created_at: i64,
}

#[derive(Deserialize)]
struct VoiceCallHistoryLine {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct VoiceCallHistoryResponse {
    conversation: ConversationSummary,
    messages: Vec<ChatMessage>,
    memory_suggestions: Vec<MemorySuggestion>,
    memory_suggestion_analysis: MemorySuggestionAnalysis,
}

#[derive(Serialize, Deserialize)]
struct RealtimePromptPreview {
    model: String,
    instructions: String,
    #[serde(rename = "conversationMode")]
    conversation_mode: String,
    #[serde(rename = "dataSourcesUsed")]
    data_sources_used: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Deserialize, Serialize)]
struct RealtimeCallConfigRequest {
    model: String,
    effort: String,
    #[serde(rename = "conversationMode")]
    conversation_mode: Option<String>,
    #[serde(rename = "userGoal")]
    user_goal: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ToolPlan {
    use_memory: bool,
    #[serde(default)]
    inspect_code: bool,
    check_email: bool,
    check_calendar: bool,
    modify_calendar: bool,
    send_email: bool,
    needs_clarification: bool,
    clarification_question: Option<String>,
    reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct RealtimeCallConfig {
    model: String,
    instructions: String,
    voice: String,
    preview: RealtimePromptPreview,
}

#[derive(Deserialize)]
struct CreateRealtimeCallRequest {
    model: String,
    effort: String,
    #[serde(rename = "conversationMode")]
    conversation_mode: Option<String>,
    #[serde(rename = "userGoal")]
    user_goal: Option<String>,
    #[serde(rename = "sdpOffer")]
    sdp_offer: String,
}

#[derive(Serialize)]
struct CreateRealtimeCallResponse {
    #[serde(rename = "sdpAnswer")]
    sdp_answer: String,
    preview: RealtimePromptPreview,
}

#[derive(Serialize)]
struct OpenAIRealtimeSessionPayload {
    #[serde(rename = "type")]
    session_type: String,
    model: String,
    instructions: String,
    audio: OpenAIRealtimeAudioConfig,
}

#[derive(Serialize)]
struct OpenAIRealtimeAudioConfig {
    input: OpenAIRealtimeAudioInputConfig,
    output: OpenAIRealtimeAudioOutputConfig,
}

#[derive(Serialize)]
struct OpenAIRealtimeAudioOutputConfig {
    voice: String,
}

#[derive(Serialize)]
struct OpenAIRealtimeAudioInputTranscriptionConfig {
    model: String,
}

#[derive(Serialize)]
struct OpenAIRealtimeAudioInputConfig {
    transcription: OpenAIRealtimeAudioInputTranscriptionConfig,
}

#[derive(Serialize, Default, Debug)]
struct MemoryRecord {
    id: String,
    category: String,
    content: String,
    source_kind: String,
    source_conversation_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Clone)]
struct MemorySuggestion {
    id: String,
    category: String,
    content: String,
    reason: String,
}

#[derive(Serialize)]
struct MemorySuggestionAnalysis {
    status: String,
    message: String,
}

#[derive(Deserialize)]
struct MemorySuggestionEnvelope {
    suggestions: Vec<RawMemorySuggestion>,
}

#[derive(Deserialize)]
struct RawMemorySuggestion {
    content: Option<String>,
    category: Option<String>,
    reason: Option<String>,
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

#[derive(Serialize, Default, Debug)]
struct CalendarEventSummary {
    id: String,
    summary: String,
    start: Option<String>,
    end: Option<String>,
    location: Option<String>,
    html_link: Option<String>,
}

#[derive(Serialize, Default, Debug)]
struct GmailMessageSummary {
    id: String,
    thread_id: Option<String>,
    from: Option<String>,
    subject: Option<String>,
    date: Option<String>,
    snippet: Option<String>,
    label_ids: Vec<String>,
}

#[derive(Default, Debug)]
struct CodeFileContext {
    path: String,
    excerpt: String,
}

#[derive(Default)]
struct DeveloperPatchContext {
    conversation_history: Vec<ChatMessage>,
    developer_preferences: Vec<MemoryRecord>,
}

#[derive(Deserialize)]
struct DeveloperAgentAction {
    action: String,
    path: Option<String>,
    patch: Option<String>,
    message: Option<String>,
    reason: Option<String>,
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

#[derive(Default, Debug)]
struct ToolContext {
    calendar_events: Option<Vec<CalendarEventSummary>>,
    gmail_messages: Option<Vec<GmailMessageSummary>>,
    memory_records: Option<Vec<MemoryRecord>>,
    conversation_memory: Option<Vec<String>>,
    code_files: Option<Vec<CodeFileContext>>,
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

    cleanup_empty_conversations(&db)?;
    archive_stale_conversations(&db)?;
    load_conversations(&db)
}

#[tauri::command]
fn list_archived_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<ConversationSummary>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    archive_stale_conversations(&db)?;
    load_archived_conversations(&db)
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
    cleanup_empty_conversations(&db)?;
    archive_stale_conversations(&db)?;
    if let Some(empty_conversation) = load_empty_active_conversation(&db, "chat")? {
        return Ok(empty_conversation);
    }

    let now = unix_timestamp();
    let id = create_id("chat");
    let title = normalize_title(title.as_deref().unwrap_or("Nowa rozmowa"));

    db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at, status, kind) VALUES (?1, ?2, ?3, ?4, 'active', 'chat')",
        params![id, title, now, now],
    )
    .map_err(|error| format!("Nie udalo sie utworzyc rozmowy. {error}"))?;

    load_conversation(&db, &id)
}

/// Tworzy albo zwraca pusty aktywny developer-chat, aby praca nad kodem miala osobna historie.
#[tauri::command]
fn create_developer_conversation(
    state: State<'_, AppState>,
) -> Result<ConversationSummary, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
    cleanup_empty_conversations(&db)?;
    archive_stale_conversations(&db)?;
    if let Some(empty_conversation) = load_empty_active_conversation(&db, "developer")? {
        return Ok(empty_conversation);
    }

    let now = unix_timestamp();
    let id = create_id("devchat");
    let title = normalize_title("Developer chat");

    db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at, status, kind) VALUES (?1, ?2, ?3, ?4, 'active', 'developer')",
        params![id, title, now, now],
    )
    .map_err(|error| format!("Nie udalo sie utworzyc rozmowy developerskiej. {error}"))?;

    load_conversation(&db, &id)
}

#[tauri::command]
fn archive_conversation(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<ConversationSummary, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    set_conversation_status(&db, &conversation_id, "archived")?;
    load_conversation(&db, &conversation_id)
}

#[tauri::command]
fn restore_conversation(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<ConversationSummary, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    set_conversation_status(&db, &conversation_id, "active")?;
    load_conversation(&db, &conversation_id)
}

#[tauri::command]
fn delete_conversation(
    conversation_id: String,
    delete_linked_memory: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    delete_conversation_with_memory_choice(&db, &conversation_id, delete_linked_memory)
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

async fn build_memory_suggestions(
    messages: &[ChatMessage],
    conversation_id: &str,
    existing_memory: &[MemoryRecord],
) -> Result<Vec<MemorySuggestion>, String> {
    let voice_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .map(|message| {
            serde_json::json!({
                "role": &message.role,
                "content": truncate(&message.content, 2000),
            })
        })
        .collect();

    if voice_messages.is_empty() {
        return Ok(Vec::new());
    }

    let existing_memory_json = serde_json::to_string_pretty(
        &existing_memory
            .iter()
            .take(40)
            .map(|item| {
                serde_json::json!({
                    "category": &item.category,
                    "content": truncate(&item.content, 360),
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|error| format!("Nie udalo sie przygotowac pamieci do analizy. {error}"))?;

    let conversation_json = serde_json::to_string_pretty(&voice_messages).map_err(|error| {
        format!("Nie udalo sie przygotowac rozmowy glosowej do analizy. {error}")
    })?;

    let input = format!(
        r#"Istniejace wpisy pamieci:
{}

Rozmowa glosowa jako JSON:
{}
"#,
        existing_memory_json, conversation_json,
    );

    let response_text = request_openai_text(VOICE_MEMORY_SUGGESTION_INSTRUCTIONS, &input).await?;
    let raw_suggestions = parse_memory_suggestions(&response_text)?;

    let mut suggestions = Vec::new();
    let reason = format!("voice chat: {conversation_id}");

    for raw in raw_suggestions {
        let Some(content) = raw.content.as_deref() else {
            continue;
        };

        let Some(category) = raw.category.as_deref() else {
            continue;
        };

        let suggestion = match validate_memory_suggestion(category, content, &reason) {
            Ok(suggestion) => suggestion,
            Err(_) => continue,
        };

        if is_duplicate_memory_suggestion(&suggestion.content, existing_memory, &suggestions) {
            continue;
        }

        suggestions.push(suggestion);

        if suggestions.len() == 3 {
            break;
        }
    }

    Ok(suggestions)
}

#[tauri::command]
async fn save_voice_call_history(
    lines: Vec<VoiceCallHistoryLine>,
    state: State<'_, AppState>,
) -> Result<VoiceCallHistoryResponse, String> {
    let sanitized_lines: Vec<(String, String)> = lines
        .into_iter()
        .filter_map(|line| {
            let role = line.role.trim();
            let content = line.content.trim();

            if content.is_empty() || (role != "user" && role != "assistant") {
                return None;
            }

            Some((role.to_string(), content.to_string()))
        })
        .collect();

    if sanitized_lines.is_empty() {
        return Err("Brak tresci rozmowy glosowej do zapisania.".to_string());
    }

    let (conversation, messages, existing_memory) = {
        let now = unix_timestamp();
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

        let conversation_id = create_id("chat");
        let title = normalize_title("Rozmowa glosowa");

        db.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, status, kind) VALUES (?1, ?2, ?3, ?4, 'active', 'chat')",
            params![conversation_id, title, now, now],
        )
        .map_err(|error| format!("Nie udalo sie utworzyc rozmowy glosowej. {error}"))?;

        let mut messages = Vec::new();

        for (role, content) in sanitized_lines {
            messages.push(insert_message(&db, &conversation_id, &role, &content)?);
        }

        let existing_memory = load_memory_records(&db)?;
        let conversation = load_conversation(&db, &conversation_id)?;

        (conversation, messages, existing_memory)
    };

    let memory_suggestions =
        build_memory_suggestions(&messages, &conversation.id, &existing_memory).await?;

    let memory_suggestion_analysis = if memory_suggestions.is_empty() {
        MemorySuggestionAnalysis {
            status: "empty".to_string(),
            message: "XO nie znalazl w tej rozmowie nic stabilnego do zapamietania.".to_string(),
        }
    } else {
        MemorySuggestionAnalysis {
            status: "found".to_string(),
            message: format!(
                "XO znalazl {} sugestie pamieci do zatwierdzenia.",
                memory_suggestions.len()
            ),
        }
    };

    Ok(VoiceCallHistoryResponse {
        conversation: conversation,
        messages,
        memory_suggestions,
        memory_suggestion_analysis,
    })
}

#[tauri::command]
async fn get_realtime_call_config(
    request: RealtimeCallConfigRequest,
) -> Result<RealtimeCallConfig, String> {
    let response = reqwest::Client::new()
        .post("http://127.0.0.1:4317/realtime/call-config")
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie polaczyc z backendem JS). {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Nie udalo sie odczytac bledu backendu JS".to_string());

        return Err(format!(
            "Backend JS zwrocil blad {}. {}",
            status.as_u16(),
            error_body
        ));
    }

    response
        .json::<RealtimeCallConfig>()
        .await
        .map_err(|error| {
            format!("Nie udalo sie odczytac konfiguracji realtime z backendu JS. {error} ")
        })
}

async fn request_openai_realtime_call(
    api_key: &str,
    sdp_offer: &str,
    config: &RealtimeCallConfig,
) -> Result<String, String> {
    let session = OpenAIRealtimeSessionPayload {
        session_type: "realtime".to_string(),
        model: config.model.clone(),
        instructions: config.instructions.clone(),
        audio: OpenAIRealtimeAudioConfig {
            input: OpenAIRealtimeAudioInputConfig {
                transcription: OpenAIRealtimeAudioInputTranscriptionConfig {
                    model: "gpt-4o-mini-transcribe".to_string(),
                },
            },
            output: OpenAIRealtimeAudioOutputConfig {
                voice: config.voice.clone(),
            },
        },
    };

    let session_json = serde_json::to_string(&session)
        .map_err(|error| format!("Nie udalo sie przygotowac konfiguracji realtime. {error}"))?;
    let form = reqwest::multipart::Form::new()
        .part(
            "sdp",
            reqwest::multipart::Part::text(sdp_offer.to_string())
                .mime_str("application/sdp")
                .map_err(|error| format!("Nie udalo sie przygotowac SDP offer. {error}"))?,
        )
        .part(
            "session",
            reqwest::multipart::Part::text(session_json)
                .mime_str("application/json")
                .map_err(|error| format!("NIe udalo sie przygotowac sesji realtime. {error}"))?,
        );

    let response = reqwest::Client::new()
        .post(OPENAI_REALTIME_CALLS_URL)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie polaczyc z OpenAI Realtime. {error}"))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Nie udalo sie odczytac odpowiedzi OpenAI. {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenAI Realtime API zwrocilo blad {}. {}",
            status.as_u16(),
            response_text,
        ));
    }

    Ok(response_text)
}

#[tauri::command]
async fn create_realtime_call(
    request: CreateRealtimeCallRequest,
) -> Result<CreateRealtimeCallResponse, String> {
    if request.sdp_offer.trim().is_empty() {
        return Err("Brakuje SDP offer dla polaczenia realtime.".to_string());
    }
    let config = get_realtime_call_config(RealtimeCallConfigRequest {
        model: request.model,
        effort: request.effort,
        conversation_mode: request.conversation_mode,
        user_goal: request.user_goal,
    })
    .await?;

    let api_key = load_openai_api_key()?;

    let sdp_answer = request_openai_realtime_call(&api_key, &request.sdp_offer, &config).await?;

    Ok(CreateRealtimeCallResponse {
        sdp_answer,
        preview: config.preview,
    })
}

#[tauri::command]
fn list_memory_records(state: State<'_, AppState>) -> Result<Vec<MemoryRecord>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    cleanup_expired_camera_memory_records(&db)?;
    load_memory_records(&db)
}

#[tauri::command]
fn create_memory_record(
    category: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<MemoryRecord, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    insert_memory_record(&db, &category, &content)
}

#[tauri::command]
fn save_memory_suggestion(
    category: String,
    content: String,
    source_conversation_id: String,
    state: State<'_, AppState>,
) -> Result<MemoryRecord, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    ensure_conversation_exists(&db, &source_conversation_id)?;
    let suggestion = validate_memory_suggestion(&category, &content, "")?;

    insert_memory_record_with_source(
        &db,
        &suggestion.category,
        &suggestion.content,
        "conversation",
        Some(&source_conversation_id),
    )
}

#[tauri::command]
fn update_memory_record(
    id: String,
    category: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<MemoryRecord, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    edit_memory_record(&db, &id, &category, &content)
}

#[tauri::command]
fn delete_memory_record(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

    remove_memory_record(&db, &id)
}

#[tauri::command]
async fn propose_code_patch(input: String) -> Result<CodePatchProposal, String> {
    let task = input.trim().to_string();

    if task.is_empty() {
        return Err("Opisz zmianę, którą XO ma zaproponować.".to_string());
    }

    let code_files = search_project_code_for_chat(&task)?;
    let inspected_files = code_files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let mut proposal_input = String::new();

    proposal_input.push_str("Zadanie użytkownika:\n");
    proposal_input.push_str(&task);
    proposal_input.push_str("\n\nKontekst kodu projektu XO tylko do odczytu:\n");

    if code_files.is_empty() {
        proposal_input.push_str("- Nie znaleziono pasujących plików. Zaproponuj następne pliki do sprawdzenia zamiast zgadywać pełny patch.\n");
    } else {
        for file in &code_files {
            proposal_input.push_str("\n--- ");
            proposal_input.push_str(&file.path);
            proposal_input.push_str(" ---\n");
            proposal_input.push_str(&file.excerpt);
            proposal_input.push('\n');
        }
    }

    let proposal = request_openai_text(CODE_PATCH_PROPOSAL_INSTRUCTIONS, &proposal_input).await?;

    Ok(CodePatchProposal {
        task,
        proposal,
        inspected_files,
        created_at: unix_timestamp(),
    })
}

#[tauri::command]
async fn apply_code_patch(
    input: String,
    ask_before_change: Option<bool>,
    question_preference: Option<String>,
    developer_run_id: Option<String>,
    app: AppHandle,
) -> Result<CodePatchApplyResult, String> {
    let task = input.trim().to_string();
    let ask_before_change = ask_before_change.unwrap_or(false);
    let question_preference = question_preference
        .map(|preference| truncate(preference.trim(), 500))
        .filter(|preference| !preference.is_empty());

    if task.is_empty() {
        return Err("Opisz zmianę, którą XO ma wprowadzić w kodzie.".to_string());
    }

    build_and_apply_code_patch(
        task,
        ask_before_change,
        question_preference,
        None,
        developer_run_id,
        Some(&app),
    )
    .await
}

/// Buduje prompt do zmiany kodu, pozwala modelowi zapytać o doprecyzowanie i nakłada zwalidowany patch.
async fn build_and_apply_code_patch(
    task: String,
    ask_before_change: bool,
    question_preference: Option<String>,
    developer_context: Option<&DeveloperPatchContext>,
    developer_run_id: Option<String>,
    app: Option<&AppHandle>,
) -> Result<CodePatchApplyResult, String> {
    run_codex_api_agent(
        task,
        ask_before_change,
        question_preference,
        developer_context,
        developer_run_id,
        app,
    )
    .await
}

/// Obsługuje wiadomość w developer-chacie: zapisuje rozmowę, wykonuje próbę zmiany kodu i zapisuje wynik jako odpowiedź.
#[tauri::command]
async fn send_developer_chat_message(
    conversation_id: Option<String>,
    input: String,
    ask_before_change: Option<bool>,
    question_preference: Option<String>,
    developer_run_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ChatResponse, String> {
    let input = input.trim().to_string();

    if input.is_empty() {
        return Err("Opisz zmianę, którą XO ma wprowadzić w kodzie.".to_string());
    }

    let (conversation_id, user_message, restored_from_archive) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let conversation_id =
            ensure_conversation_of_kind(&db, conversation_id, &input, "developer")?;
        let restored_from_archive = conversation_status(&db, &conversation_id)? == "archived";
        let user_message = insert_message(&db, &conversation_id, "user", &input)?;

        (conversation_id, user_message, restored_from_archive)
    };
    let developer_context = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

        load_developer_patch_context(&db, &conversation_id)?
    };

    let apply_result = build_and_apply_code_patch(
        input.clone(),
        ask_before_change.unwrap_or(true),
        question_preference
            .map(|preference| truncate(preference.trim(), 500))
            .filter(|preference| !preference.is_empty()),
        Some(&developer_context),
        developer_run_id,
        Some(&app),
    )
    .await;
    let assistant_text = developer_chat_response_text(&apply_result);

    let (assistant_message, conversation) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let assistant_message =
            insert_message(&db, &conversation_id, "assistant", &assistant_text)?;

        (assistant_message, load_conversation(&db, &conversation_id)?)
    };

    Ok(ChatResponse {
        conversation,
        user_message,
        assistant_message,
        memory_suggestions: Vec::new(),
        memory_suggestion_analysis: MemorySuggestionAnalysis {
            status: "empty".to_string(),
            message: "Developer-chat nie proponuje wpisów pamięci po zmianach kodu.".to_string(),
        },
        restored_from_archive,
    })
}

/// Zamienia wynik próby zmiany kodu na czytelną wiadomość asystenta w developer-chacie.
fn developer_chat_response_text(result: &Result<CodePatchApplyResult, String>) -> String {
    match result {
        Ok(result) if result.needs_clarification => {
            let agent_log = format_developer_agent_steps(&result.agent_steps);
            format!(
                "Potrzebuję doprecyzowania zanim zmienię kod:\n\n{}\n\n{}",
                result
                    .clarification_question
                    .as_deref()
                    .unwrap_or("Doprecyzuj oczekiwane działanie."),
                agent_log,
            )
        }
        Ok(result) => {
            let changed_files = if result.changed_files.is_empty() {
                "brak".to_string()
            } else {
                result
                    .changed_files
                    .iter()
                    .map(|file| format!("- {file}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let agent_log = format_developer_agent_steps(&result.agent_steps);

            format!(
                "Wprowadziłem zmianę w kodzie.\n\nZmienione pliki:\n{changed_files}\n\nPatch czeka w working tree na Twój werdykt.\n\n{agent_log}"
            )
        }
        Err(error) => developer_chat_error_text(error),
    }
}

/// Dobiera komunikat błędu developer-chatu do faktycznego miejsca awarii: API, model albo patch.
fn developer_chat_error_text(error: &str) -> String {
    if is_openai_request_error(error) {
        return format!(
            "Nie udało mi się połączyć z modelem kodującym.\n\n{error}\n\nKod nie powinien zostać zmieniony, bo błąd wystąpił przed zastosowaniem patcha."
        );
    }

    if is_patch_application_error(error) {
        return format!(
            "Nie udało mi się wprowadzić zmiany w kodzie.\n\n{error}\n\nPatch nie został zaakceptowany przez git apply. Sprawdź working tree przed kolejną próbą."
        );
    }

    format!(
        "Nie udało mi się wprowadzić zmiany w kodzie.\n\n{error}\n\nKod nie powinien zostać zmieniony, jeśli błąd wystąpił przed zastosowaniem patcha."
    )
}

/// Rozpoznaje błędy połączenia lub konfiguracji OpenAI, żeby nie mylić ich z błędami git apply.
fn is_openai_request_error(error: &str) -> bool {
    let normalized = error.to_lowercase();

    normalized.contains("openai")
        || normalized.contains("model")
        || normalized.contains("api_key")
        || normalized.contains("api key")
        || normalized.contains("sending request")
        || normalized.contains("request timed out")
        || normalized.contains("timeout")
        || normalized.contains("connection")
        || normalized.contains("dns")
}

/// Rozpoznaje błędy nakładania patcha, dla których komunikat o git apply jest naprawdę trafny.
fn is_patch_application_error(error: &str) -> bool {
    let normalized = error.to_lowercase();

    normalized.contains("git apply")
        || normalized.contains("patch")
        || normalized.contains("unified diff")
        || normalized.contains("working tree")
}

/// Formatuje jawny przebieg pracy agenta do zapisania w wiadomości developer-chatu.
fn format_developer_agent_steps(agent_steps: &[DeveloperAgentStep]) -> String {
    if agent_steps.is_empty() {
        return "Przebieg pracy agenta:\n- Brak zarejestrowanych kroków.".to_string();
    }

    let mut output = "Przebieg pracy agenta:\n".to_string();

    for step in agent_steps {
        output.push_str(&format!("{}. {}\n", step.step, step.action));

        if let Some(reason) = &step.reason {
            output.push_str("   Powód: ");
            output.push_str(reason);
            output.push('\n');
        }

        output.push_str("   Wynik: ");
        output.push_str(&truncate(&step.result.replace('\n', " "), 500));
        output.push('\n');
    }

    output
}

#[tauri::command]
fn run_developer_build() -> Result<DeveloperCommandResult, String> {
    let project_root = project_root_path()?;
    let output = Command::new(npm_command_name())
        .arg("run")
        .arg("build")
        .current_dir(project_root)
        .output()
        .map_err(|error| format!("Nie udało się uruchomić builda. {error}"))?;

    Ok(DeveloperCommandResult {
        command: "npm run build".to_string(),
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        created_at: unix_timestamp(),
    })
}

#[tauri::command]
fn revert_code_patch(patch: String) -> Result<DeveloperCommandResult, String> {
    let project_root = project_root_path()?;
    let patch = patch.trim().to_string();

    if patch.is_empty() {
        return Err("Brak patcha do odrzucenia.".to_string());
    }

    validate_unified_diff_paths(&patch)?;
    let output = apply_unified_diff_with_args(&project_root, &patch, &["--reverse"])?;

    Ok(DeveloperCommandResult {
        command: "git apply --reverse".to_string(),
        success: true,
        stdout: output,
        stderr: String::new(),
        created_at: unix_timestamp(),
    })
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

    let (conversation_id, user_message, restored_from_archive) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let conversation_id = ensure_conversation(&db, conversation_id, &input)?;
        let restored_from_archive = conversation_status(&db, &conversation_id)? == "archived";
        let user_message = insert_message(&db, &conversation_id, "user", &input)?;

        (conversation_id, user_message, restored_from_archive)
    };
    let tool_plan = plan_tools_for_input(&input).await?;
    let tool_context = build_tool_context(&input, &tool_plan, &conversation_id, &state).await;
    let openai_input = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;

        build_openai_input(&db, &conversation_id, &input, &tool_context)?
    };

    let assistant_text = request_openai_chat(&openai_input).await?;

    let (assistant_message, conversation, existing_memory) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let assistant_message =
            insert_message(&db, &conversation_id, "assistant", &assistant_text)?;
        touch_conversation(&db, &conversation_id)?;

        (
            assistant_message,
            load_conversation(&db, &conversation_id)?,
            load_memory_records(&db)?,
        )
    };
    log::info!(
        "Starting memory suggestion analysis. conversation_id={}, user_chars={}, assistant_chars={}, existing_memory_count={}",
        conversation_id,
        input.chars().count(),
        assistant_text.chars().count(),
        existing_memory.len()
    );
    let (memory_suggestions, memory_suggestion_analysis) = match request_memory_suggestions(
        &input,
        &assistant_text,
        &existing_memory,
    )
    .await
    {
        Ok(suggestions) => {
            let analysis = if suggestions.is_empty() {
                MemorySuggestionAnalysis {
                    status: "empty".to_string(),
                    message: "XO nie znalazl w tej odpowiedzi nic stabilnego do zapamietania."
                        .to_string(),
                }
            } else {
                MemorySuggestionAnalysis {
                    status: "found".to_string(),
                    message: format!(
                        "XO znalazl {} sugestie pamieci do zatwierdzenia.",
                        suggestions.len()
                    ),
                }
            };

            log::info!(
                    "Memory suggestion analysis completed. conversation_id={}, status={}, suggestions={}",
                    conversation_id,
                    analysis.status,
                    suggestions.len()
                );

            (suggestions, analysis)
        }
        Err(error) => {
            log::warn!(
                "Memory suggestion analysis failed. conversation_id={}, error={error}",
                conversation_id
            );

            (
                Vec::new(),
                MemorySuggestionAnalysis {
                    status: "error".to_string(),
                    message: "XO nie mogl sprawdzic sugestii pamieci dla tej odpowiedzi."
                        .to_string(),
                },
            )
        }
    };

    Ok(ChatResponse {
        conversation,
        user_message,
        assistant_message,
        memory_suggestions,
        memory_suggestion_analysis,
        restored_from_archive,
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
        has_client_id: client_id
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty()),
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

    load_plugin_connection(
        &db,
        GOOGLE_CALENDAR_PROVIDER,
        "Google Calendar",
        GOOGLE_CALENDAR_SCOPES,
    )
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
        let error_body = response.text().await.unwrap_or_else(|_| {
            "Nie udalo sie odczytac tresci bledu Google Calendar API.".to_string()
        });
        log::warn!("Google Calendar API failed: status={status}, body={error_body}");

        return Err(format_google_api_error(
            "Google Calendar API",
            status.as_u16(),
            &error_body,
        ));
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
        .query(&[("maxResults", "20"), ("includeSpamTrash", "true")])
        .send()
        .await
        .map_err(|error| format!("Nie udalo sie pobrac listy Gmail. {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Nie udalo sie odczytac tresci bledu Gmail API.".to_string());
        log::warn!("Gmail API messages.list failed: status={status}, body={error_body}");

        return Err(format_google_api_error(
            "Gmail API",
            status.as_u16(),
            &error_body,
        ));
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
          updated_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
          kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat', 'developer'))
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

        CREATE TABLE IF NOT EXISTS memory_records (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          source_kind TEXT NOT NULL DEFAULT 'user',
          source_conversation_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_memory_records_updated
          ON memory_records(updated_at DESC);
        ",
    )
    .map_err(|error| format!("Nie udalo sie przygotowac bazy XO. {error}"))?;
    ensure_conversation_status_column(&db)?;
    ensure_conversation_kind_column(&db)?;
    ensure_memory_source_columns(&db)?;
    cleanup_expired_camera_memory_records(&db)?;

    Ok(db)
}

/// Dodaje kolumne statusu rozmowy w istniejacych bazach, bez dotykania tresci rozmow.
fn ensure_conversation_status_column(db: &Connection) -> Result<(), String> {
    let columns = table_columns(db, "conversations")?;

    if !columns.iter().any(|column| column == "status") {
        db.execute(
            "ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
            [],
        )
        .map_err(|error| format!("Nie udalo sie dodac statusu rozmow. {error}"))?;
    }

    Ok(())
}

/// Dodaje typ rozmowy w istniejacych bazach, aby backend wiedzial, ktory silnik obsluguje chat.
fn ensure_conversation_kind_column(db: &Connection) -> Result<(), String> {
    let columns = table_columns(db, "conversations")?;

    if !columns.iter().any(|column| column == "kind") {
        db.execute(
            "ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'",
            [],
        )
        .map_err(|error| format!("Nie udalo sie dodac typu rozmowy. {error}"))?;
    }

    Ok(())
}

/// Usuwa puste rozmowy, bo nie zawieraja danych uzytkownika ani wpisow historii do ochrony.
fn cleanup_empty_conversations(db: &Connection) -> Result<(), String> {
    db.execute(
        "
        DELETE FROM conversations
        WHERE NOT EXISTS (
          SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id
        )
        ",
        [],
    )
    .map_err(|error| format!("Nie udalo sie usunac pustych rozmow. {error}"))?;

    Ok(())
}

/// Przenosi do archiwum aktywne rozmowy, ktore nie byly aktualizowane od ponad roku.
fn archive_stale_conversations(db: &Connection) -> Result<(), String> {
    let one_year_ago = unix_timestamp() - 365 * 24 * 60 * 60;

    db.execute(
        "UPDATE conversations SET status = 'archived' WHERE status = 'active' AND updated_at < ?1",
        params![one_year_ago],
    )
    .map_err(|error| format!("Nie udalo sie zarchiwizowac starych rozmow. {error}"))?;

    Ok(())
}

/// Usuwa wpisy pamięci powiązane z nagraniami kamery po 30 dniach od ich utworzenia.
fn cleanup_expired_camera_memory_records(db: &Connection) -> Result<(), String> {
    let thirty_days_ago = unix_timestamp() - 30 * 24 * 60 * 60;

    db.execute(
        "DELETE FROM memory_records WHERE source_kind = 'camera_recording' AND created_at < ?1",
        params![thirty_days_ago],
    )
    .map_err(|error| {
        format!("Nie udalo sie usunac starych wpisow pamieci z nagran kamery. {error}")
    })?;

    Ok(())
}

/// Zmienia status pojedynczej rozmowy, zachowujac wiadomosci i powiazane wpisy pamieci.
fn set_conversation_status(
    db: &Connection,
    conversation_id: &str,
    status: &str,
) -> Result<(), String> {
    let changed = db
        .execute(
            "UPDATE conversations SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, unix_timestamp(), conversation_id],
        )
        .map_err(|error| format!("Nie udalo sie zmienic statusu rozmowy. {error}"))?;

    if changed == 0 {
        return Err("Nie znaleziono rozmowy.".to_string());
    }

    Ok(())
}

/// Usuwa rozmowe i zgodnie z wyborem uzytkownika usuwa powiazana pamiec albo odklada ja jako archived.
fn delete_conversation_with_memory_choice(
    db: &Connection,
    conversation_id: &str,
    delete_linked_memory: bool,
) -> Result<(), String> {
    ensure_conversation_exists(db, conversation_id)?;

    if delete_linked_memory {
        db.execute(
            "DELETE FROM memory_records WHERE source_conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| format!("Nie udalo sie usunac pamieci powiazanej z rozmowa. {error}"))?;
    } else {
        db.execute(
            "UPDATE memory_records SET source_conversation_id = 'archived', updated_at = ?1 WHERE source_conversation_id = ?2",
            params![unix_timestamp(), conversation_id],
        )
        .map_err(|error| format!("Nie udalo sie zachowac pamieci po usunieciu rozmowy. {error}"))?;
    }

    db.execute(
        "DELETE FROM conversations WHERE id = ?1",
        params![conversation_id],
    )
    .map_err(|error| format!("Nie udalo sie usunac rozmowy. {error}"))?;

    Ok(())
}

fn ensure_conversation(
    db: &Connection,
    conversation_id: Option<String>,
    first_input: &str,
) -> Result<String, String> {
    ensure_conversation_of_kind(db, conversation_id, first_input, "chat")
}

/// Zapewnia istnienie rozmowy wybranego typu i blokuje mieszanie zwykłego chatu z developer-chatem.
fn ensure_conversation_of_kind(
    db: &Connection,
    conversation_id: Option<String>,
    first_input: &str,
    kind: &str,
) -> Result<String, String> {
    if let Some(conversation_id) = conversation_id {
        let conversation_kind = db
            .query_row(
                "SELECT kind FROM conversations WHERE id = ?1",
                params![conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Nie udalo sie sprawdzic rozmowy. {error}"))?
            .ok_or_else(|| "Nie znaleziono rozmowy.".to_string())?;

        if conversation_kind != kind {
            return Err("Ten typ wiadomości nie pasuje do wybranej rozmowy.".to_string());
        }

        return Ok(conversation_id);
    }

    let now = unix_timestamp();
    let id = create_id(if kind == "developer" {
        "devchat"
    } else {
        "chat"
    });
    let title = if kind == "developer" {
        normalize_title("Developer chat")
    } else {
        title_from_input(first_input)
    };

    db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at, status, kind) VALUES (?1, ?2, ?3, ?4, 'active', ?5)",
        params![id, title, now, now, kind],
    )
    .map_err(|error| format!("Nie udalo sie utworzyc rozmowy. {error}"))?;

    Ok(id)
}

fn ensure_conversation_exists(db: &Connection, conversation_id: &str) -> Result<(), String> {
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
        Ok(())
    } else {
        Err("Nie znaleziono rozmowy zrodlowej dla pamieci XO.".to_string())
    }
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
        "UPDATE conversations SET updated_at = ?1, status = 'active' WHERE id = ?2",
        params![unix_timestamp(), conversation_id],
    )
    .map_err(|error| format!("Nie udalo sie zaktualizowac rozmowy. {error}"))?;

    Ok(())
}

/// Odczytuje status rozmowy przed zapisem, aby wykryc kontynuowanie chatu z archiwum.
fn conversation_status(db: &Connection, conversation_id: &str) -> Result<String, String> {
    db.query_row(
        "SELECT status FROM conversations WHERE id = ?1",
        params![conversation_id],
        |row| row.get(0),
    )
    .map_err(|error| format!("Nie udalo sie odczytac statusu rozmowy. {error}"))
}
/// zwraca input zlozony z historii aktualnej rozmowy i odsyla to append_tool_context(input, ...) w celu zaaplikowania contextu z narzędzi
fn build_openai_input(
    db: &Connection,
    conversation_id: &str,
    current_input: &str,
    tool_context: &ToolContext,
) -> Result<String, String> {
    let history = load_messages(db, conversation_id)?;
    let mut input = String::new();

    input.push_str("\nHistoria aktualnej rozmowy:\n");
    if history.is_empty() {
        input.push_str("- To poczatek tej rozmowy.\n");
    } else {
        for message in history
            .iter()
            .rev()
            .take(24)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
        {
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
            let role_label = if role == "assistant" {
                "XO"
            } else {
                "Uzytkownik"
            };

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

fn load_memory_records(db: &Connection) -> Result<Vec<MemoryRecord>, String> {
    let mut statement = db
        .prepare(
            "
            SELECT id, category, content, source_kind, source_conversation_id, created_at, updated_at
            FROM memory_records
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("Nie udalo sie odczytac pamieci XO. {error}"))?;

    let rows = statement
        .query_map([], map_memory_record)
        .map_err(|error| format!("Nie udalo sie odczytac pamieci XO. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie odczytac pamieci XO. {error}"))
}

fn insert_memory_record(
    db: &Connection,
    category: &str,
    content: &str,
) -> Result<MemoryRecord, String> {
    insert_memory_record_with_source(db, category, content, "user", None)
}

fn insert_memory_record_with_source(
    db: &Connection,
    category: &str,
    content: &str,
    source_kind: &str,
    source_conversation_id: Option<&str>,
) -> Result<MemoryRecord, String> {
    let category = normalize_memory_category(category)?;
    let content = normalize_memory_content(content)?;
    let source_kind = normalize_memory_source_kind(source_kind)?;
    let now = unix_timestamp();
    let id = create_id("mem");

    db.execute(
        "INSERT INTO memory_records
         (id, category, content, source, source_kind, source_conversation_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            category,
            content,
            Option::<String>::None,
            source_kind,
            source_conversation_id,
            now,
            now
        ],
    )
    .map_err(|error| format!("Nie udalo sie zapisac pamieci XO. {error}"))?;

    load_memory_record(db, &id)
}

fn edit_memory_record(
    db: &Connection,
    id: &str,
    category: &str,
    content: &str,
) -> Result<MemoryRecord, String> {
    let category = normalize_memory_category(category)?;
    let content = normalize_memory_content(content)?;
    let changed = db
        .execute(
            "UPDATE memory_records
             SET category = ?1, content = ?2, updated_at = ?3
             WHERE id = ?4",
            params![category, content, unix_timestamp(), id],
        )
        .map_err(|error| format!("Nie udalo sie zaktualizowac pamieci XO. {error}"))?;

    if changed == 0 {
        return Err("Nie znaleziono wpisu pamieci XO.".to_string());
    }

    load_memory_record(db, id)
}

fn remove_memory_record(db: &Connection, id: &str) -> Result<(), String> {
    let changed = db
        .execute("DELETE FROM memory_records WHERE id = ?1", params![id])
        .map_err(|error| format!("Nie udalo sie usunac pamieci XO. {error}"))?;

    if changed == 0 {
        return Err("Nie znaleziono wpisu pamieci XO.".to_string());
    }

    Ok(())
}

fn load_memory_record(db: &Connection, id: &str) -> Result<MemoryRecord, String> {
    db.query_row(
        "
        SELECT id, category, content, source_kind, source_conversation_id, created_at, updated_at
        FROM memory_records
        WHERE id = ?1
        ",
        params![id],
        map_memory_record,
    )
    .map_err(|error| format!("Nie udalo sie odczytac pamieci XO. {error}"))
}

fn map_memory_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRecord> {
    Ok(MemoryRecord {
        id: row.get(0)?,
        category: row.get(1)?,
        content: row.get(2)?,
        source_kind: row.get(3)?,
        source_conversation_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn normalize_memory_category(category: &str) -> Result<String, String> {
    let category = category.trim();
    let allowed = [
        "user_fact",
        "preference",
        "project",
        "decision",
        "tool_note",
        "privacy",
    ];

    if allowed.contains(&category) {
        Ok(category.to_string())
    } else {
        Err("Wybierz poprawna kategorie pamieci.".to_string())
    }
}

fn normalize_memory_content(content: &str) -> Result<String, String> {
    let content = content.trim();

    if content.is_empty() {
        return Err("Wpis pamieci nie moze byc pusty.".to_string());
    }

    Ok(truncate(content, 1200))
}

fn normalize_memory_source_kind(source_kind: &str) -> Result<String, String> {
    let source_kind = source_kind.trim();
    let allowed = [
        "user",
        "gmail",
        "calendar",
        "conversation",
        "camera_recording",
    ];

    if allowed.contains(&source_kind) {
        Ok(source_kind.to_string())
    } else {
        Err("Wybierz poprawne zrodlo pamieci.".to_string())
    }
}

fn validate_memory_suggestion(
    category: &str,
    content: &str,
    reason: &str,
) -> Result<MemorySuggestion, String> {
    let category = normalize_memory_suggestion_category(category)?;
    let content = normalize_memory_content(content)?;
    let reason = truncate(reason.trim(), 220);

    if content.chars().count() < 12 {
        return Err("Sugestia pamieci jest za krotka.".to_string());
    }

    if contains_disallowed_memory_data(&content) {
        return Err("Sugestia zawiera dane, ktorych XO nie powinien zapisywac.".to_string());
    }

    if looks_temporary_memory(&content) {
        return Err("Sugestia wyglada na chwilowa, a nie stabilna pamiec.".to_string());
    }

    Ok(MemorySuggestion {
        id: create_id("mem_sug"),
        category,
        content,
        reason,
    })
}

fn normalize_memory_suggestion_category(category: &str) -> Result<String, String> {
    let category = category.trim();
    let allowed = ["user_fact", "preference", "project", "decision", "privacy"];

    if allowed.contains(&category) {
        Ok(category.to_string())
    } else {
        Err("Sugestia ma niepoprawna kategorie pamieci.".to_string())
    }
}

fn contains_disallowed_memory_data(content: &str) -> bool {
    let normalized = content.to_lowercase();
    let disallowed_terms = [
        "password",
        "haslo",
        "hasło",
        "token",
        "api key",
        "apikey",
        "bearer",
        "oauth",
        "client secret",
        "private key",
        "ssh key",
        "jwt",
        "pin",
        "cvv",
        "nr karty",
        "numer karty",
        "secret",
        "sekret",
        "klucz api",
        "klucz prywatny",
        "zdrowie",
        "health",
        "medical",
        "diagno",
        "chorob",
        "lek ",
        "leki",
        "terapia",
        "therapy",
        "depres",
        "cancer",
        "rak",
        "cukrzyc",
        "diabetes",
        "ciaza",
        "ciąża",
        "psychi",
    ];

    if disallowed_terms
        .iter()
        .any(|term| normalized.contains(term))
    {
        return true;
    }

    let third_party_terms = [
        "zona",
        "żona",
        "maz",
        "mąż",
        "partner",
        "partnerka",
        "dziecko",
        "syn",
        "corka",
        "córka",
        "matka",
        "ojciec",
        "klient",
        "klientka",
        "szef",
        "szefowa",
        "wspolpracownik",
        "współpracownik",
        "kolega",
        "kolezanka",
        "koleżanka",
    ];
    let private_terms = [
        "adres", "email", "telefon", "zarabia", "pensja", "salary", "dlug", "dług", "zwoln",
        "konto", "pesel",
    ];

    third_party_terms
        .iter()
        .any(|term| normalized.contains(term))
        && private_terms.iter().any(|term| normalized.contains(term))
}

fn looks_temporary_memory(content: &str) -> bool {
    let normalized = content.to_lowercase();
    let temporary_terms = [
        "dzisiaj",
        "jutro",
        "wczoraj",
        "teraz",
        "tymczasowo",
        "na razie",
        "this week",
        "today",
        "tomorrow",
        "yesterday",
    ];

    temporary_terms.iter().any(|term| normalized.contains(term))
}

fn memory_category_label(category: &str) -> String {
    match category {
        "user_fact" => "fakt o uzytkowniku",
        "preference" => "preferencja",
        "project" => "projekt",
        "decision" => "decyzja",
        "tool_note" => "wniosek z narzedzia",
        "privacy" => "prywatnosc",
        _ => "inne",
    }
    .to_string()
}

fn memory_source_label(source_kind: &str, source_conversation_id: Option<&str>) -> String {
    match source_kind {
        "user" => "dodane przez uzytkownika".to_string(),
        "gmail" => "Gmail".to_string(),
        "calendar" => "Kalendarz".to_string(),
        "camera_recording" => "nagranie kamery".to_string(),
        "conversation" => source_conversation_id
            .map(|id| format!("rozmowa: {id}"))
            .unwrap_or_else(|| "rozmowa".to_string()),
        _ => "nieznane zrodlo".to_string(),
    }
}

fn ensure_memory_source_columns(db: &Connection) -> Result<(), String> {
    let columns = table_columns(db, "memory_records")?;

    if !columns.iter().any(|column| column == "source_kind") {
        db.execute(
            "ALTER TABLE memory_records ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'user'",
            [],
        )
        .map_err(|error| format!("Nie udalo sie dodac typu zrodla pamieci XO. {error}"))?;
    }

    if !columns
        .iter()
        .any(|column| column == "source_conversation_id")
    {
        db.execute(
            "ALTER TABLE memory_records ADD COLUMN source_conversation_id TEXT",
            [],
        )
        .map_err(|error| format!("Nie udalo sie dodac rozmowy zrodlowej pamieci XO. {error}"))?;
    }

    Ok(())
}

fn table_columns(db: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let mut statement = db
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("Nie udalo sie odczytac schematu bazy XO. {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Nie udalo sie odczytac kolumn bazy XO. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie odczytac kolumn bazy XO. {error}"))
}
/// Wywoluje planner OpenAI i parsuje odpowiedz modelu na ToolPlan.
async fn plan_tools_for_input(input: &str) -> Result<ToolPlan, String> {
    let planner_input = format!("Wiadomosc uzytkownika:\n{}", input);

    let response_text = request_openai_text(TOOL_PLANNER_INSTRUCTIONS, &planner_input).await?;

    let json_text = extract_json_payload(&response_text)
        .ok_or_else(|| "Planner narzedzi nie zwrocil JSON.".to_string())?;

    serde_json::from_str::<ToolPlan>(&json_text)
        .map_err(|error| format!("Nie udało się odczytać planu narzędzi. {error} "))
}

async fn build_tool_context(
    input: &str,
    tool_plan: &ToolPlan,
    conversation_id: &str,
    state: &State<'_, AppState>,
) -> ToolContext {
    let mut context = ToolContext::default();
    log::info!("build_tool_context in progress");
    if tool_plan.check_calendar {
        match load_calendar_events_for_chat(state).await {
            Ok(events) => context.calendar_events = Some(events),
            Err(error) => context
                .notes
                .push(format!("Nie udalo sie pobrac Google Calendar: {error}")),
        }
    }

    if tool_plan.check_email {
        match load_gmail_messages_for_chat(state).await {
            Ok(messages) => context.gmail_messages = Some(messages),
            Err(error) => context
                .notes
                .push(format!("Nie udalo sie pobrac Gmail: {error}")),
        }
    }

    if tool_plan.use_memory {
        match search_memory_for_chat(state, conversation_id, input) {
            Ok((records, conversations)) => {
                context.memory_records = Some(records);
                context.conversation_memory = Some(conversations);
            }
            Err(error) => {
                context
                    .notes
                    .push(format!("Nie udalo sie przeszukac pamieci XO: {error}"));
            }
        }
    }

    if tool_plan.inspect_code {
        match search_project_code_for_chat(input) {
            Ok(files) => context.code_files = Some(files),
            Err(error) => context
                .notes
                .push(format!("Nie udalo sie odczytac kodu projektu XO: {error}")),
        }
    }

    if tool_plan.send_email {
        context.notes.push(
            "Uzytkownik poprosil o wysłanie wiadomości email. XO nie ma jeszcze wykonawcy wysylki, wiec nie wolno twierdzic, ze mail zostal wyslany. Przygotuj szkic i popros o potwierdzenie.".to_string(),
        );
    }

    if tool_plan.modify_calendar {
        context.notes.push(
            "Uzytkownik poprosil o zmiane kalendarza. XO nie ma jeszcze wykonawcy zapisu, wiec nie wolno twierdzic, ze kalendarz zostal zmieniony. Przygotuj propozycje i popros o potwierdzenie.".to_string(),
        );
    }

    log::info!("ToolContenxt: {:?}", context);
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

fn search_memory_for_chat(
    state: &State<'_, AppState>,
    conversation_id: &str,
    input: &str,
) -> Result<(Vec<MemoryRecord>, Vec<String>), String> {
    let keywords = memory_search_keywords(input);

    if keywords.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let db = state
        .db
        .lock()
        .map_err(|_| "Nie udalo sie otworzyc db".to_string())?;

    let memory_records = load_memory_records(&db)?
        .into_iter()
        .filter(|record| text_matches_keywords(&record.content, &keywords))
        .take(12)
        .collect::<Vec<_>>();

    let conversation_memory = load_cross_conversation_memory(&db, conversation_id)?
        .into_iter()
        .filter(|item| text_matches_keywords(item, &keywords))
        .take(12)
        .collect::<Vec<_>>();

    Ok((memory_records, conversation_memory))
}

/// funkcja rozczłonkowuje string na tokeny
fn memory_search_keywords(input: &str) -> Vec<String> {
    input
        .to_lowercase()
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|character: char| !character.is_alphanumeric())
                .to_string()
        })
        .filter(|word| word.chars().count() >= 4)
        .take(12)
        .collect()
}

fn text_matches_keywords(text: &str, keywords: &[String]) -> bool {
    let normalized = text.to_lowercase();

    keywords.iter().any(|keyword| normalized.contains(keyword))
}

/// Uruchamia kontrolowany agent loop przez OpenAI API: model wybiera akcje, a Rust wykonuje tylko dozwolone operacje.
async fn run_codex_api_agent(
    task: String,
    ask_before_change: bool,
    question_preference: Option<String>,
    developer_context: Option<&DeveloperPatchContext>,
    developer_run_id: Option<String>,
    app: Option<&AppHandle>,
) -> Result<CodePatchApplyResult, String> {
    let project_root = project_root_path()?;
    let file_index = project_code_file_index()?;
    let developer_run_id = developer_run_id.unwrap_or_else(|| create_id("devrun"));
    let mut inspected_files = Vec::new();
    let mut read_files = Vec::new();
    let mut transcript = String::new();
    let mut agent_steps = Vec::new();
    let mut applied_patch = String::new();
    let mut changed_files = Vec::new();
    let push_developer_agent_step = |agent_steps: &mut Vec<DeveloperAgentStep>,
                                     step: i64,
                                     action: &str,
                                     reason: Option<String>,
                                     result: String| {
        push_developer_agent_step(agent_steps, step, action, reason, result);

        if let (Some(app), Some(agent_step)) = (app, agent_steps.last()) {
            let event = DeveloperAgentStepEvent {
                run_id: developer_run_id.clone(),
                step: agent_step.clone(),
            };

            if let Err(error) = app.emit("developer-agent-step", event) {
                log::warn!("Nie udalo sie wyslac live logu agenta: {error}");
            }
        }
    };
    push_developer_agent_step(
        &mut agent_steps,
        0,
        "start",
        None,
        "Rozpoczęto pracę agenta kodującego.".to_string(),
    );

    for step in 1..=8 {
        let agent_input = build_codex_agent_input(
            &task,
            ask_before_change,
            &question_preference,
            developer_context,
            &file_index,
            &read_files,
            &transcript,
        );
        let response_text = request_openai_code_text(CODE_AGENT_INSTRUCTIONS, &agent_input).await?;
        let action = parse_developer_agent_action(&response_text)?;
        let action_name = action.action.clone();
        let action_reason = action.reason.clone().map(|reason| truncate(&reason, 500));

        if let Some(reason) = action.reason.as_deref() {
            transcript.push_str(&format!(
                "\nKrok {step}, powod akcji {}: {}\n",
                action.action,
                truncate(reason, 500)
            ));
        }

        match action.action.as_str() {
            "read_file" => {
                let path = action
                    .path
                    .as_deref()
                    .ok_or_else(|| "Akcja read_file nie zawiera path.".to_string())?;
                let file = read_agent_project_file(&project_root, &file_index, path)?;

                if !inspected_files.iter().any(|item| item == &file.path) {
                    inspected_files.push(file.path.clone());
                    read_files.push(file);
                }

                let result = format!(
                    "Wynik read_file: przeczytano {}.\n",
                    inspected_files.last().cloned().unwrap_or_default()
                );
                transcript.push_str(&result);
                push_developer_agent_step(
                    &mut agent_steps,
                    step,
                    &action_name,
                    action_reason,
                    result,
                );
            }
            "apply_patch" => {
                let Some(raw_patch) = action.patch.as_deref() else {
                    let result = "Wynik apply_patch: akcja nie zawiera pola patch. Zwroc poprawny unified diff albo wybierz read_file.\n".to_string();
                    transcript.push_str(&result);
                    push_developer_agent_step(
                        &mut agent_steps,
                        step,
                        &action_name,
                        action_reason.clone(),
                        result,
                    );
                    continue;
                };
                let Some(mut patch) = extract_diff_payload(raw_patch) else {
                    let mut result = "Wynik apply_patch: patch nie jest poprawnym unified diffem. Zwroc diff zaczynajacy sie od diff --git, z naglowkami ---/+++ i hunkami @@.\n".to_string();
                    result.push_str("Odrzucony patch, skrocony:\n");
                    result.push_str(&truncate(raw_patch, 2000));
                    result.push('\n');
                    transcript.push_str(&result);
                    push_developer_agent_step(
                        &mut agent_steps,
                        step,
                        &action_name,
                        action_reason.clone(),
                        result,
                    );
                    continue;
                };

                if let Err(error) = ensure_patch_touches_only_read_files(&patch, &inspected_files) {
                    let result =
                        format!("Wynik apply_patch: patch odrzucony przed git apply.\n{error}\n");
                    transcript.push_str(&result);
                    push_developer_agent_step(
                        &mut agent_steps,
                        step,
                        &action_name,
                        action_reason.clone(),
                        result,
                    );
                    continue;
                }

                let proposed_changed_files = match validate_unified_diff_paths(&patch) {
                    Ok(paths) => paths,
                    Err(error) => {
                        let result =
                            format!("Wynik apply_patch: patch ma niepoprawne sciezki.\n{error}\n");
                        transcript.push_str(&result);
                        push_developer_agent_step(
                            &mut agent_steps,
                            step,
                            &action_name,
                            action_reason.clone(),
                            result,
                        );
                        continue;
                    }
                };

                if let Err(apply_error) = apply_unified_diff(&project_root, &patch) {
                    let repair_input = build_codex_agent_input(
                        &task,
                        ask_before_change,
                        &question_preference,
                        developer_context,
                        &file_index,
                        &read_files,
                        &transcript,
                    );
                    let repaired_patch = match repair_code_patch(
                        &repair_input,
                        &patch,
                        &apply_error,
                    )
                    .await
                    {
                        Ok(value) => value,
                        Err(repair_error) => {
                            let mut result = "Wynik apply_patch: git apply odrzucil patch, a naprawa modelu tez sie nie powiodla.\n".to_string();
                            result.push_str(&truncate(&apply_error, 2000));
                            result.push_str("\nBlad naprawy:\n");
                            result.push_str(&truncate(&repair_error, 2000));
                            result.push('\n');
                            transcript.push_str(&result);
                            push_developer_agent_step(
                                &mut agent_steps,
                                step,
                                &action_name,
                                action_reason.clone(),
                                result,
                            );
                            continue;
                        }
                    };

                    if let Err(error) =
                        ensure_patch_touches_only_read_files(&repaired_patch, &inspected_files)
                    {
                        let result = format!(
                            "Wynik apply_patch: naprawiony patch odrzucony przed git apply.\n{error}\n",
                        );
                        transcript.push_str(&result);
                        push_developer_agent_step(
                            &mut agent_steps,
                            step,
                            &action_name,
                            action_reason.clone(),
                            result,
                        );
                        continue;
                    }

                    let repaired_changed_files = match validate_unified_diff_paths(&repaired_patch)
                    {
                        Ok(paths) => paths,
                        Err(error) => {
                            let result = format!(
                                "Wynik apply_patch: naprawiony patch ma niepoprawne sciezki.\n{error}\n",
                            );
                            transcript.push_str(&result);
                            push_developer_agent_step(
                                &mut agent_steps,
                                step,
                                &action_name,
                                action_reason.clone(),
                                result,
                            );
                            continue;
                        }
                    };

                    if let Err(repair_apply_error) =
                        apply_unified_diff(&project_root, &repaired_patch)
                    {
                        let mut result = "Wynik apply_patch: git apply odrzucil patch i jego naprawiona wersje.\n".to_string();
                        result.push_str(&truncate(&apply_error, 2000));
                        result.push_str("\nBlad naprawionego patcha:\n");
                        result.push_str(&truncate(&repair_apply_error, 2000));
                        result.push('\n');
                        transcript.push_str(&result);
                        push_developer_agent_step(
                            &mut agent_steps,
                            step,
                            &action_name,
                            action_reason.clone(),
                            result,
                        );
                        continue;
                    }

                    patch = repaired_patch;
                    changed_files = repaired_changed_files;
                } else {
                    changed_files = proposed_changed_files;
                }

                applied_patch = patch;
                let result =
                    "Wynik apply_patch: patch zostal zastosowany w working tree.\n".to_string();
                transcript.push_str(&result);
                push_developer_agent_step(
                    &mut agent_steps,
                    step,
                    &action_name,
                    action_reason,
                    result,
                );
            }
            "run_build" => {
                let build_result = run_developer_build()?;
                let mut result = "Wynik run_build:\n".to_string();
                result.push_str(&format!("success: {}\n", build_result.success));
                result.push_str(&truncate(&build_result.stdout, 4000));
                result.push('\n');
                result.push_str(&truncate(&build_result.stderr, 4000));
                result.push('\n');
                transcript.push_str(&result);
                push_developer_agent_step(
                    &mut agent_steps,
                    step,
                    &action_name,
                    action_reason,
                    result,
                );
            }
            "clarify" => {
                let message = action
                    .message
                    .map(|value| truncate(value.trim(), 500))
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "Doprecyzuj oczekiwane działanie.".to_string());

                return Ok(CodePatchApplyResult {
                    task,
                    patch: String::new(),
                    inspected_files,
                    changed_files: Vec::new(),
                    agent_steps,
                    needs_clarification: true,
                    clarification_question: Some(message),
                    created_at: unix_timestamp(),
                });
            }
            "finish" => {
                if applied_patch.is_empty() {
                    return Err("Agent zakonczyl prace bez zastosowania patcha.".to_string());
                }

                return Ok(CodePatchApplyResult {
                    task,
                    patch: applied_patch,
                    inspected_files,
                    changed_files,
                    agent_steps,
                    needs_clarification: false,
                    clarification_question: None,
                    created_at: unix_timestamp(),
                });
            }
            other => {
                return Err(format!("Agent zwrocil nieznana akcje: {other}."));
            }
        }
    }

    if applied_patch.is_empty() {
        return Err("Agent przekroczyl limit krokow bez zastosowania patcha.".to_string());
    }

    Ok(CodePatchApplyResult {
        task,
        patch: applied_patch,
        inspected_files,
        changed_files,
        agent_steps,
        needs_clarification: false,
        clarification_question: None,
        created_at: unix_timestamp(),
    })
}

/// Dodaje jawny, skrócony krok pracy agenta do wyniku zwracanego frontendowi.
fn push_developer_agent_step(
    agent_steps: &mut Vec<DeveloperAgentStep>,
    step: i64,
    action: &str,
    reason: Option<String>,
    result: String,
) {
    agent_steps.push(DeveloperAgentStep {
        step,
        action: action.to_string(),
        reason,
        result: truncate(&result, 1600),
    });
}

/// Ładuje historię aktualnego developer-chatu i preferencje pamięci oznaczone słowem developer.
fn load_developer_patch_context(
    db: &Connection,
    conversation_id: &str,
) -> Result<DeveloperPatchContext, String> {
    let conversation_history = load_messages(db, conversation_id)?;
    let developer_preferences = load_memory_records(db)?
        .into_iter()
        .filter(|record| {
            record.category == "preference" && record.content.to_lowercase().contains("developer")
        })
        .take(12)
        .collect::<Vec<_>>();

    Ok(DeveloperPatchContext {
        conversation_history,
        developer_preferences,
    })
}

/// Składa pełny stan kroku agent loop: zadanie, pamięć developer, indeks plików, przeczytane pliki i wyniki akcji.
fn build_codex_agent_input(
    task: &str,
    ask_before_change: bool,
    question_preference: &Option<String>,
    developer_context: Option<&DeveloperPatchContext>,
    file_index: &[String],
    read_files: &[CodeFileContext],
    transcript: &str,
) -> String {
    let mut input = String::new();

    input.push_str("Zadanie użytkownika:\n");
    input.push_str(task);
    append_developer_patch_context(&mut input, developer_context);
    input.push_str("\n\nPolityka pytania przed zmiana:\n");
    input.push_str(if ask_before_change {
        "- Funkcja zapytaj przed dodaniem jest wlaczona, ale pytanie do uzytkownika jest dozwolone tylko wtedy, gdy jest naprawde niezbedne.\n"
    } else {
        "- Funkcja zapytaj przed dodaniem jest wylaczona.\n"
    });
    input.push_str("- Pytaj tylko o decyzje funkcjonalne, bezpieczenstwo, prywatnosc, utrate danych, integracje z zewnetrznymi uslugami albo nieodwracalne skutki.\n");
    input.push_str("- Nie pytaj o drobne decyzje UI lub implementacyjne: polozenie przycisku, prosty tekst etykiety, nazwe helpera, kolor, spacing albo wybor oczywistego istniejacego wzorca.\n");
    input.push_str("- Jesli brakuje drobnej decyzji, przyjmij konserwatywne zalozenie zgodne z obecnym stylem aplikacji i zapisz je w reason.\n");

    if let Some(preference) = question_preference {
        input.push_str("- Preferencje uzytkownika: ");
        input.push_str(preference);
        input.push('\n');
    }

    input.push_str("\n\nIndeks plikow projektu XO:\n");
    for path in file_index.iter().take(500) {
        input.push_str("- ");
        input.push_str(path);
        input.push('\n');
    }

    input.push_str("\n\nPrzeczytane pliki:\n");
    if read_files.is_empty() {
        input.push_str("- Brak przeczytanych plikow. Zacznij od read_file.\n");
    } else {
        for file in read_files {
            input.push_str("\n--- ");
            input.push_str(&file.path);
            input.push_str(" ---\n");
            input.push_str(&file.excerpt);
            input.push('\n');
        }
    }

    input.push_str("\n\nTranskrypt wykonanych akcji:\n");
    if transcript.trim().is_empty() {
        input.push_str("- Brak wcześniejszych akcji.\n");
    } else {
        input.push_str(transcript);
    }

    input
}

/// Parsuje pojedynczą akcję JSON zwróconą przez model i odrzuca zwykłą odpowiedź tekstową.
fn parse_developer_agent_action(response_text: &str) -> Result<DeveloperAgentAction, String> {
    let json_text = extract_json_payload(response_text).ok_or_else(|| {
        let preview = truncate(&response_text.replace('\n', " "), 500);
        format!("Agent kodu nie zwrocil akcji JSON. Początek odpowiedzi modelu: {preview}")
    })?;

    serde_json::from_str::<DeveloperAgentAction>(&json_text)
        .map_err(|error| format!("Nie udało się odczytać akcji agenta kodu. {error}"))
}

/// Czyta jeden plik wskazany przez model tylko wtedy, gdy znajduje się w bezpiecznym indeksie projektu.
fn read_agent_project_file(
    project_root: &Path,
    file_index: &[String],
    raw_path: &str,
) -> Result<CodeFileContext, String> {
    let normalized = normalize_patch_path(raw_path)?;

    if !file_index.iter().any(|path| path == &normalized) {
        return Err(format!(
            "Agent poprosil o plik spoza dozwolonego indeksu projektu: {normalized}."
        ));
    }

    let content = fs::read_to_string(project_root.join(&normalized))
        .map_err(|error| format!("Nie udalo sie odczytac pliku kodu. {error}"))?;

    Ok(CodeFileContext {
        path: normalized,
        excerpt: truncate(&content, 80000),
    })
}

/// Pilnuje, żeby patch zmieniał wyłącznie pliki, które agent wcześniej jawnie przeczytał.
fn ensure_patch_touches_only_read_files(
    patch: &str,
    inspected_files: &[String],
) -> Result<(), String> {
    let changed_files = validate_unified_diff_paths(patch)?;

    for changed_file in changed_files {
        if !inspected_files.iter().any(|file| file == &changed_file) {
            return Err(format!(
                "Agent probowal zmienic plik, ktorego wczesniej nie przeczytal: {changed_file}."
            ));
        }
    }

    Ok(())
}

/// Dopisuje do promptu historię developer-chatu i preferencje, bez mieszania ich ze zwykłą pamięcią.
fn append_developer_patch_context(
    input: &mut String,
    developer_context: Option<&DeveloperPatchContext>,
) {
    if let Some(context) = developer_context {
        input.push_str("\n\nHistoria aktualnego developer-chatu:\n");
        if context.conversation_history.is_empty() {
            input.push_str("- To początek tej rozmowy developerskiej.\n");
        } else {
            for message in context
                .conversation_history
                .iter()
                .rev()
                .take(24)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                input.push_str(match message.role.as_str() {
                    "assistant" => "XO Developer: ",
                    _ => "Uzytkownik: ",
                });
                input.push_str(&truncate(&message.content, 1200));
                input.push('\n');
            }
        }

        input.push_str("\nPreferencje użytkownika oznaczone jako developer:\n");
        if context.developer_preferences.is_empty() {
            input.push_str("- Brak zapisanych preferencji developerskich.\n");
        } else {
            for preference in &context.developer_preferences {
                input.push_str("- ");
                input.push_str(&truncate(&preference.content, 500));
                input.push('\n');
            }
        }
    }
}

/// Szuka małej liczby pasujących plików kodu projektu i zwraca bezpieczne wycinki do promptu XO.
fn search_project_code_for_chat(input: &str) -> Result<Vec<CodeFileContext>, String> {
    let project_root = project_root_path()?;
    let keywords = code_search_keywords(input);
    let mut files = Vec::new();

    collect_code_files(&project_root, &project_root, &keywords, &mut files)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.truncate(8);

    Ok(files)
}

/// Buduje sam indeks ścieżek plików kodu, bez treści plików i bez katalogów zależności albo sekretów.
fn project_code_file_index() -> Result<Vec<String>, String> {
    let project_root = project_root_path()?;
    let mut files = Vec::new();

    collect_code_file_index(&project_root, &project_root, &mut files)?;
    files.sort();

    Ok(files)
}

/// Rekurencyjnie zbiera ścieżki dozwolonych plików źródłowych dla pierwszego etapu wyboru kontekstu.
fn collect_code_file_index(
    root: &Path,
    directory: &Path,
    output: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Nie udalo sie odczytac katalogu kodu. {error}"))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Nie udalo sie odczytac wpisu katalogu. {error}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if should_skip_code_directory(&file_name) {
                continue;
            }

            collect_code_file_index(root, &path, output)?;
            continue;
        }

        if !is_supported_code_file(&path, &file_name) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .replace('\\', "/");

        output.push(relative_path);
    }

    Ok(())
}

/// Wyznacza katalog repo na podstawie położenia crate'a Tauri, bez przyjmowania ścieżki od użytkownika.
fn project_root_path() -> Result<PathBuf, String> {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Nie udalo sie ustalic katalogu projektu XO.".to_string())
}

/// Rekurencyjnie zbiera czytelne pliki źródłowe, omijając katalogi buildów, zależności i sekrety.
fn collect_code_files(
    root: &Path,
    directory: &Path,
    keywords: &[String],
    output: &mut Vec<CodeFileContext>,
) -> Result<(), String> {
    if output.len() >= 8 {
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Nie udalo sie odczytac katalogu kodu. {error}"))?;

    for entry in entries {
        if output.len() >= 8 {
            break;
        }

        let entry =
            entry.map_err(|error| format!("Nie udalo sie odczytac wpisu katalogu. {error}"))?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if should_skip_code_directory(&file_name) {
                continue;
            }

            collect_code_files(root, &path, keywords, output)?;
            continue;
        }

        if !is_supported_code_file(&path, &file_name) {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Nie udalo sie odczytac pliku kodu. {error}"))?;

        if !keywords.is_empty()
            && !text_matches_keywords(&content, keywords)
            && !text_matches_keywords(&file_name, keywords)
        {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .replace('\\', "/");

        output.push(CodeFileContext {
            path: relative_path,
            excerpt: truncate(&content, 6000),
        });
    }

    Ok(())
}

fn should_skip_code_directory(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".agents" | ".codex" | "node_modules" | "target" | "dist" | "build"
    )
}

fn is_supported_code_file(path: &Path, file_name: &str) -> bool {
    if file_name.starts_with(".env")
        || file_name.ends_with(".lock")
        || file_name.eq_ignore_ascii_case("package-lock.json")
    {
        return false;
    }

    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("rs" | "ts" | "tsx" | "css" | "md" | "json" | "toml")
    )
}

fn code_search_keywords(input: &str) -> Vec<String> {
    let mut keywords = memory_search_keywords(input);
    keywords.retain(|keyword| !is_common_code_request_word(keyword));

    keywords
}

fn is_common_code_request_word(word: &str) -> bool {
    matches!(
        word,
        "dodaj"
            | "zrob"
            | "zrób"
            | "opcja"
            | "opcje"
            | "funkcja"
            | "kod"
            | "kodu"
            | "plik"
            | "aplikacji"
            | "zaimplementuj"
            | "popraw"
            | "zmien"
            | "zmień"
    )
}

/// Wyciąga unified diff z odpowiedzi modelu i odrzuca zwykły opis bez patcha.
fn extract_diff_payload(response_text: &str) -> Option<String> {
    let trimmed = response_text.trim();

    if looks_like_unified_diff(trimmed) {
        return Some(trimmed.to_string());
    }

    let mut remaining = trimmed;
    while let Some((_, rest)) = remaining.split_once("```") {
        if let Some((block, tail)) = rest.split_once("```") {
            let diff = strip_diff_fence_language(block).trim();

            if looks_like_unified_diff(diff) {
                return Some(diff.to_string());
            }

            remaining = tail;
        } else {
            break;
        }
    }

    if let Some((_, diff)) = trimmed.split_once("diff --git ") {
        let diff = format!("diff --git {}", diff.trim());

        if looks_like_unified_diff(&diff) {
            return Some(diff);
        }
    }

    if let Some(diff) = extract_plain_unified_diff(trimmed) {
        return Some(diff);
    }

    None
}

/// Prosi model o jedną naprawę syntaktycznie błędnego patcha, używając tego samego kontekstu kodu.
async fn repair_code_patch(
    original_patch_input: &str,
    rejected_patch: &str,
    git_error: &str,
) -> Result<String, String> {
    let mut repair_input = String::new();

    repair_input.push_str("Oryginalne zadanie i kontekst kodu:\n");
    repair_input.push_str(original_patch_input);
    repair_input.push_str("\n\nPatch odrzucony przez git apply:\n");
    repair_input.push_str(rejected_patch);
    repair_input.push_str("\n\nBlad git apply:\n");
    repair_input.push_str(git_error);

    let response_text =
        request_openai_code_text(CODE_PATCH_REPAIR_INSTRUCTIONS, &repair_input).await?;

    extract_diff_payload(&response_text).ok_or_else(|| {
        let preview = truncate(&response_text.replace('\n', " "), 500);
        format!(
            "Model nie zwrocil poprawionego unified diff. Początek odpowiedzi modelu: {preview}"
        )
    })
}

/// Usuwa nazwę języka z bloku markdown, jeśli model mimo instrukcji opakował patch w ```diff.
fn strip_diff_fence_language(block: &str) -> &str {
    block
        .strip_prefix("diff\r\n")
        .or_else(|| block.strip_prefix("diff\n"))
        .or_else(|| block.strip_prefix("patch\r\n"))
        .or_else(|| block.strip_prefix("patch\n"))
        .unwrap_or(block)
}

/// Rozpoznaje minimalne cechy unified diffu, zanim przekażemy go do walidacji ścieżek i git apply.
fn looks_like_unified_diff(value: &str) -> bool {
    let has_file_headers = value.contains("diff --git ")
        || (value.lines().any(|line| line.starts_with("--- "))
            && value.lines().any(|line| line.starts_with("+++ ")));

    has_file_headers && value.lines().any(|line| line.starts_with("@@"))
}

/// Wyciąga diff zaczynający się od nagłówków ---/+++, gdy model pominął linię diff --git.
fn extract_plain_unified_diff(value: &str) -> Option<String> {
    let lines = value.lines().collect::<Vec<_>>();
    let start_index = lines
        .iter()
        .position(|line| line.starts_with("--- ") || line.starts_with("diff --git "))?;
    let diff = lines[start_index..].join("\n").trim().to_string();

    if looks_like_unified_diff(&diff) {
        Some(diff)
    } else {
        None
    }
}

/// Sprawdza, czy patch dotyczy tylko zwykłych plików projektu i zwraca listę zmienionych ścieżek.
fn validate_unified_diff_paths(patch: &str) -> Result<Vec<String>, String> {
    let mut changed_files = Vec::new();

    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            let mut parts = rest.split_whitespace();
            let old_path = parts.next().unwrap_or_default();
            let new_path = parts.next().unwrap_or_default();

            validate_patch_path(old_path)?;
            validate_patch_path(new_path)?;

            let normalized = normalize_patch_path(new_path)?;

            if !changed_files.iter().any(|path| path == &normalized) {
                changed_files.push(normalized);
            }
        } else if let Some(path) = line.strip_prefix("--- ") {
            validate_patch_path(path)?;
        } else if let Some(path) = line.strip_prefix("+++ ") {
            validate_patch_path(path)?;

            if path.split_whitespace().next().unwrap_or_default() != "/dev/null" {
                let normalized = normalize_patch_path(path)?;

                if !changed_files.iter().any(|path| path == &normalized) {
                    changed_files.push(normalized);
                }
            }
        }
    }

    if changed_files.is_empty() {
        return Err("Patch nie zawiera listy zmienionych plików.".to_string());
    }

    Ok(changed_files)
}

fn validate_patch_path(raw_path: &str) -> Result<(), String> {
    if raw_path == "/dev/null" {
        return Ok(());
    }

    let normalized = normalize_patch_path(raw_path)?;

    if normalized.starts_with(".env") || normalized.contains("/.env") {
        return Err("Patch próbuje zmienić plik środowiskowy .env.".to_string());
    }

    for part in normalized.split('/') {
        if matches!(part, ".git" | "node_modules" | "target" | "dist" | "build") {
            return Err(format!("Patch próbuje zmienić chroniony katalog: {part}."));
        }
    }

    Ok(())
}

fn normalize_patch_path(raw_path: &str) -> Result<String, String> {
    let path = raw_path
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim();
    let path = path
        .strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path);

    if path.is_empty() {
        return Err("Patch zawiera pustą ścieżkę.".to_string());
    }

    let path_buf = PathBuf::from(path);

    if path_buf.is_absolute() || path.contains("..") {
        return Err("Patch próbuje wyjść poza katalog projektu.".to_string());
    }

    Ok(path.replace('\\', "/"))
}

/// Nakłada zwalidowany unified diff przez git apply, bez commita i bez uruchamiania dodatkowych komend.
fn apply_unified_diff(project_root: &Path, patch: &str) -> Result<(), String> {
    match apply_unified_diff_with_args(project_root, patch, &[]) {
        Ok(_) => Ok(()),
        Err(primary_error) => {
            apply_unified_diff_with_args(project_root, patch, &["--3way"]).map(|_| ()).map_err(
                |fallback_error| {
                    format!(
                        "{primary_error}\n\nProba dopasowania patcha przez git apply --3way tez sie nie powiodla: {fallback_error}"
                    )
                },
            )
        }
    }
}

fn apply_unified_diff_with_args(
    project_root: &Path,
    patch: &str,
    extra_args: &[&str],
) -> Result<String, String> {
    let mut child = Command::new("git")
        .arg("apply")
        .arg("--whitespace=nowarn")
        .args(extra_args)
        .current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Nie udalo sie uruchomic git apply. {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(patch.as_bytes())
            .map_err(|error| format!("Nie udalo sie przekazac patcha do git apply. {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Nie udalo sie poczekac na git apply. {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Nie udalo sie zastosowac patcha. {stderr}"))
    }
}

fn npm_command_name() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
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
        || !tool_context.notes.is_empty()
        || tool_context.memory_records.is_some()
        || tool_context.conversation_memory.is_some()
        || tool_context.code_files.is_some();

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
    if let Some(memory_records) = &tool_context.memory_records {
        input.push_str("Pasujące wpisy z pamięci użytkownika\n");
        for memory_record in memory_records {
            input.push_str("- [");
            input.push_str(&memory_record.category);
            input.push_str("] )");
            input.push_str(&memory_record.content);
            input.push('\n');
        }
    }

    if let Some(conversation_memory_records) = &tool_context.conversation_memory {
        input.push_str("Pasujące wpisy z poprzednich konwersacji użytkownika\n");
        for conversation_memory_record in conversation_memory_records {
            input.push_str(conversation_memory_record);
            input.push('\n');
        }
    }

    if let Some(code_files) = &tool_context.code_files {
        input.push_str("\nKod projektu XO, wybrane pliki tylko do odczytu:\n");

        if code_files.is_empty() {
            input.push_str("- Nie znaleziono pasujących plików kodu.\n");
        } else {
            for file in code_files {
                input.push_str("\n--- ");
                input.push_str(&file.path);
                input.push_str(" ---\n");
                input.push_str(&file.excerpt);
                input.push('\n');
            }
        }
    }
}

fn load_conversations(db: &Connection) -> Result<Vec<ConversationSummary>, String> {
    load_conversations_by_status(db, "active")
}

/// Laduje rozmowy archiwalne, oddzielone od glownej historii czatow.
fn load_archived_conversations(db: &Connection) -> Result<Vec<ConversationSummary>, String> {
    load_conversations_by_status(db, "archived")
}

/// Laduje rozmowy o wybranym statusie wraz z liczba wiadomosci i ostatnia wiadomoscia.
fn load_conversations_by_status(
    db: &Connection,
    status: &str,
) -> Result<Vec<ConversationSummary>, String> {
    let mut statement = db
        .prepare(
            "
            SELECT
              c.id,
              c.title,
              c.created_at,
              c.updated_at,
              c.status,
              c.kind,
              (
                SELECT COUNT(*)
                FROM messages
                WHERE conversation_id = c.id
              ) AS message_count,
              (
                SELECT content
                FROM messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS last_message
            FROM conversations c
            WHERE c.status = ?1
            ORDER BY c.updated_at DESC
            ",
        )
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))?;

    let rows = statement
        .query_map(params![status], map_conversation_summary)
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Nie udalo sie pobrac rozmow. {error}"))
}

/// Znajduje istniejaca pusta aktywna rozmowe, aby frontend nie tworzyl wielu pustych czatow.
fn load_empty_active_conversation(
    db: &Connection,
    kind: &str,
) -> Result<Option<ConversationSummary>, String> {
    db.query_row(
        "
        SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          c.status,
          c.kind,
          0 AS message_count,
          NULL AS last_message
        FROM conversations c
        WHERE c.status = 'active'
          AND c.kind = ?1
          AND NOT EXISTS (
            SELECT 1 FROM messages WHERE conversation_id = c.id
          )
        ORDER BY c.updated_at DESC
        LIMIT 1
        ",
        params![kind],
        map_conversation_summary,
    )
    .optional()
    .map_err(|error| format!("Nie udalo sie pobrac pustej rozmowy. {error}"))
}

fn load_conversation(
    db: &Connection,
    conversation_id: &str,
) -> Result<ConversationSummary, String> {
    db.query_row(
        "
        SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          c.status,
          c.kind,
          (
            SELECT COUNT(*)
            FROM messages
            WHERE conversation_id = c.id
          ) AS message_count,
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
        status: row.get(4)?,
        kind: row.get(5)?,
        message_count: row.get(6)?,
        last_message: row.get(7)?,
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
        scopes: default_scopes
            .split_whitespace()
            .map(str::to_string)
            .collect(),
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
        Err(
            "Brakuje Google OAuth Client ID. Wklej go w panelu wtyczki Google Calendar."
                .to_string(),
        )
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

fn format_google_api_error(api_name: &str, status: u16, error_body: &str) -> String {
    let hint = if error_body.contains("accessNotConfigured")
        || error_body.contains("SERVICE_DISABLED")
        || error_body.contains("has not been used")
        || error_body.contains("disabled")
    {
        " Wyglada na to, ze API nie jest wlaczone w Google Cloud dla tego projektu. Wlacz odpowiednie API w Google Cloud Console, a potem sprobuj ponownie."
    } else if error_body.contains("insufficientPermissions")
        || error_body.contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
        || error_body.contains("Request had insufficient authentication scopes")
    {
        " Token nie ma wymaganego scope. Odlacz wtyczke, upewnij sie, ze consent screen zawiera wymagany scope, a potem polacz ponownie."
    } else if error_body.contains("domainPolicy") {
        " Konto lub organizacja Google blokuje dostep tej aplikacji zasadami domeny."
    } else {
        ""
    };

    format!(
        "{api_name} zwrocilo blad {status}.{hint} Szczegoly: {}",
        truncate(error_body, 700)
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

        return Err(format_google_oauth_error(
            status.as_u16(),
            "laczenia",
            &error_body,
        ));
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

        return Err(format_google_oauth_error(
            status.as_u16(),
            "odswiezania",
            &error_body,
        ));
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
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Nie udalo sie odczytac tresci bledu Gmail API.".to_string());
        log::warn!(
            "Gmail API messages.get failed: status={status}, message_id={message_id}, body={error_body}"
        );

        return Err(format_google_api_error(
            "Gmail API",
            status.as_u16(),
            &error_body,
        ));
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
    let query = path
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or_default();
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
        Err(format!(
            "System nie otworzyl przegladarki. Status: {status}"
        ))
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

        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
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
    request_openai_text(CHAT_INSTRUCTIONS, input).await
}

async fn request_memory_suggestions(
    latest_user_message: &str,
    latest_assistant_response: &str,
    existing_memory: &[MemoryRecord],
) -> Result<Vec<MemorySuggestion>, String> {
    let analysis_input = build_memory_suggestion_input(
        latest_user_message,
        latest_assistant_response,
        existing_memory,
    );
    let response_text =
        request_openai_text(MEMORY_SUGGESTION_INSTRUCTIONS, &analysis_input).await?;
    let raw_suggestions = parse_memory_suggestions(&response_text)?;
    let raw_count = raw_suggestions.len();
    let mut suggestions = Vec::new();
    let mut rejected_count = 0_usize;

    log::info!(
        "Memory suggestion model returned raw suggestions. raw_count={raw_count}, response_chars={}",
        response_text.chars().count()
    );

    for raw in raw_suggestions {
        let Some(content) = raw.content.as_deref() else {
            rejected_count += 1;
            log::info!("Rejected memory suggestion: missing content.");
            continue;
        };
        let Some(category) = raw.category.as_deref() else {
            rejected_count += 1;
            log::info!(
                "Rejected memory suggestion: missing category. content_chars={}",
                content.chars().count()
            );
            continue;
        };
        let Some(reason) = raw
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            rejected_count += 1;
            log::info!(
                "Rejected memory suggestion: missing reason. category={}, content_chars={}",
                category,
                content.chars().count()
            );
            continue;
        };
        let suggestion = match validate_memory_suggestion(category, content, reason) {
            Ok(suggestion) => suggestion,
            Err(error) => {
                rejected_count += 1;
                log::info!(
                    "Rejected memory suggestion: validation failed. category={}, reason={}, content_chars={}",
                    category,
                    error,
                    content.chars().count()
                );
                continue;
            }
        };

        if is_duplicate_memory_suggestion(&suggestion.content, existing_memory, &suggestions) {
            rejected_count += 1;
            log::info!(
                "Rejected memory suggestion: duplicate. category={}, content_chars={}",
                suggestion.category,
                suggestion.content.chars().count()
            );
            continue;
        }

        suggestions.push(suggestion);

        if suggestions.len() == 3 {
            break;
        }
    }

    log::info!(
        "Memory suggestion filtering completed. raw_count={raw_count}, accepted_count={}, rejected_count={rejected_count}",
        suggestions.len()
    );

    Ok(suggestions)
}

fn build_memory_suggestion_input(
    latest_user_message: &str,
    latest_assistant_response: &str,
    existing_memory: &[MemoryRecord],
) -> String {
    let mut input = String::new();

    input.push_str("Polityka skrocona:\n");
    input.push_str("- Analizuj tylko dane w tym zapytaniu.\n");
    input.push_str("- Proponuj tylko stabilna, przyszlosciowo uzyteczna pamiec.\n");
    input.push_str("- Nie proponuj sekretow, zdrowia ani prywatnych danych osob trzecich.\n");
    input.push_str("- Nie powielaj istniejacych wpisow.\n\n");

    input.push_str("Istniejace jawne wpisy pamieci:\n");
    if existing_memory.is_empty() {
        input.push_str("- Brak.\n");
    } else {
        for item in existing_memory.iter().take(40) {
            input.push_str("- [");
            input.push_str(&item.category);
            input.push_str("] ");
            input.push_str(&truncate(&item.content, 360));
            input.push('\n');
        }
    }

    input.push_str("\nNajnowsza wiadomosc uzytkownika:\n");
    input.push_str(&truncate(latest_user_message, 4000));
    input.push_str("\n\nNajnowsza odpowiedz XO:\n");
    input.push_str(&truncate(latest_assistant_response, 4000));

    input
}

fn parse_memory_suggestions(response_text: &str) -> Result<Vec<RawMemorySuggestion>, String> {
    let json_text = extract_json_payload(response_text)
        .ok_or_else(|| "Model nie zwrocil JSON z sugestiami pamieci.".to_string())?;

    if let Ok(envelope) = serde_json::from_str::<MemorySuggestionEnvelope>(&json_text) {
        return Ok(envelope.suggestions);
    }

    serde_json::from_str::<Vec<RawMemorySuggestion>>(&json_text)
        .map_err(|error| format!("Nie udalo sie odczytac sugestii pamieci. {error}"))
}

fn extract_json_payload(response_text: &str) -> Option<String> {
    let trimmed = response_text.trim();

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Some(trimmed.to_string());
    }

    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim);

    if let Some(value) = without_fence {
        return Some(value.to_string());
    }

    let object_start = trimmed.find('{');
    let object_end = trimmed.rfind('}');
    if let (Some(start), Some(end)) = (object_start, object_end) {
        if start < end {
            return Some(trimmed[start..=end].to_string());
        }
    }

    let array_start = trimmed.find('[');
    let array_end = trimmed.rfind(']');
    if let (Some(start), Some(end)) = (array_start, array_end) {
        if start < end {
            return Some(trimmed[start..=end].to_string());
        }
    }

    None
}

fn is_duplicate_memory_suggestion(
    content: &str,
    existing_memory: &[MemoryRecord],
    suggestions: &[MemorySuggestion],
) -> bool {
    let normalized = normalize_for_memory_compare(content);

    existing_memory
        .iter()
        .map(|item| normalize_for_memory_compare(&item.content))
        .chain(
            suggestions
                .iter()
                .map(|item| normalize_for_memory_compare(&item.content)),
        )
        .any(|existing| {
            existing == normalized
                || existing.contains(&normalized)
                || normalized.contains(&existing)
        })
}

fn normalize_for_memory_compare(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric() || character.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
/// funkcja przyjmuje prompt instrukcji i input wiadomosci do usera, nastepnie zwraca odpowiedz jako odpowiedz modelu lub tez error
async fn request_openai_text(instructions: &str, input: &str) -> Result<String, String> {
    let api_key = load_openai_api_key()?;
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    request_openai_text_with_model(&api_key, &model, instructions, input).await
}

/// Wysyła zadania kodowe do modelu zoptymalizowanego pod agentowe programowanie.
async fn request_openai_code_text(instructions: &str, input: &str) -> Result<String, String> {
    let api_key = load_openai_api_key()?;
    let model = std::env::var("OPENAI_CODE_MODEL")
        .or_else(|_| std::env::var("OPENAI_MODEL"))
        .unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    request_openai_text_with_model(&api_key, &model, instructions, input).await
}

/// Wykonuje wspólne żądanie do Responses API dla zwykłego chatu i agenta kodującego.
async fn request_openai_text_with_model(
    api_key: &str,
    model: &str,
    instructions: &str,
    input: &str,
) -> Result<String, String> {
    let request = OpenAIResponsesRequest {
        model,
        instructions,
        input,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(OPENAI_REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("Nie udalo sie przygotowac klienta OpenAI API. {error}"))?;

    let response = client
        .post(OPENAI_API_URL)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| format_openai_request_error(&error))?;

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

/// Zamienia techniczny błąd reqwest na komunikat wskazujący, że awaria dotyczy połączenia z OpenAI.
fn format_openai_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!(
            "Nie udalo sie polaczyc z OpenAI API: przekroczono limit {} sekund oczekiwania na odpowiedz.",
            OPENAI_REQUEST_TIMEOUT_SECONDS
        );
    }

    if error.is_connect() {
        return format!("Nie udalo sie polaczyc z OpenAI API: problem z siecia lub DNS. {error}");
    }

    format!("Nie udalo sie polaczyc z OpenAI API. {error}")
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
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));

    if let Some(project_root) = manifest_dir.parent() {
        let _ = dotenvy::from_path(project_root.join(".env.local"));
        let _ = dotenvy::from_path(project_root.join(".env"));
    }

    let _ = dotenvy::from_path(manifest_dir.join(".env.local"));
    let _ = dotenvy::from_path(manifest_dir.join(".env"));
    let _ = dotenvy::dotenv();
}

/// Odczytuje klucz OpenAI z lokalnego środowiska i pilnuje, żeby pusty sekret nie trafił do API.
fn load_openai_api_key() -> Result<String, String> {
    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "Brakuje OPENAI_API_KEY w konfiguracji srodowiska.".to_string())?
        .trim()
        .to_string();

    if api_key.is_empty() {
        return Err("OPENAI_API_KEY jest pusty w konfiguracji srodowiska.".to_string());
    }

    Ok(api_key)
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
            list_archived_conversations,
            create_conversation,
            create_developer_conversation,
            archive_conversation,
            restore_conversation,
            delete_conversation,
            get_conversation_messages,
            save_voice_call_history,
            list_memory_records,
            create_memory_record,
            save_memory_suggestion,
            propose_code_patch,
            apply_code_patch,
            send_developer_chat_message,
            run_developer_build,
            revert_code_patch,
            get_realtime_call_config,
            create_realtime_call,
            update_memory_record,
            delete_memory_record,
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
