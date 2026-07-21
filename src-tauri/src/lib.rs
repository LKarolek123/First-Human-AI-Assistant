use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const CHAT_INSTRUCTIONS: &str = "Jestes XO, spokojnym asystentem Human First. Odpowiadaj po polsku, konkretnie i zyczliwie. Masz pamietac wczesniejsze rozmowy uzytkownika, kiedy dostajesz je w kontekscie. Nie udawaj dostepu do narzedzi, ktorych nie masz. Jesli kontekst z poprzednich rozmow pomaga, uzyj go naturalnie i dyskretnie.";

struct AppState {
    db: Mutex<Connection>,
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

    let (conversation_id, user_message, openai_input) = {
        let db = state
            .db
            .lock()
            .map_err(|_| "Nie udalo sie otworzyc lokalnej bazy XO.".to_string())?;
        let conversation_id = ensure_conversation(&db, conversation_id, &input)?;
        let openai_input = build_openai_input(&db, &conversation_id, &input)?;
        let user_message = insert_message(&db, &conversation_id, "user", &input)?;

        (conversation_id, user_message, openai_input)
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

            app.manage(AppState { db: Mutex::new(db) });

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
            request_gpt_feedback
        ])
        .run(tauri::generate_context!())
        .expect("error while running XO application");
}
