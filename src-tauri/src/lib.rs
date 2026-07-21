use serde::{Deserialize, Serialize};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL: &str = "gpt-4.1-mini";
const FEEDBACK_INSTRUCTIONS: &str = "Jesteś XO, spokojnym asystentem Human First. Odpowiadaj po polsku. Daj konkretny, życzliwy feedback do zapytania użytkownika: wyjaśnij sedno, zasugeruj następny krok i wskaż jedno dobre pytanie doprecyzowujące, jeśli ma sens.";

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
async fn request_gpt_feedback(input: String) -> Result<String, String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Wpisz pytanie albo użyj transkrypcji z mikrofonu.".to_string());
    }

    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "Brakuje OPENAI_API_KEY w konfiguracji środowiska.".to_string())?;
    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    let request = OpenAIResponsesRequest {
        model: &model,
        instructions: FEEDBACK_INSTRUCTIONS,
        input,
    };

    let response = reqwest::Client::new()
        .post(OPENAI_API_URL)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("Nie udało się połączyć z OpenAI API. {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let fallback = format!("OpenAI API zwróciło błąd {status}.");
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
        .map_err(|error| format!("Nie udało się odczytać odpowiedzi OpenAI API. {error}"))?;

    extract_response_text(payload)
        .ok_or_else(|| "Model nie zwrócił tekstowej odpowiedzi.".to_string())
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

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![request_gpt_feedback])
        .run(tauri::generate_context!())
        .expect("error while running XO application");
}
