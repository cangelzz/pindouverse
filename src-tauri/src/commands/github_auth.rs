use serde::{Deserialize, Serialize};

const GITHUB_CLIENT_ID: &str = "Ov23libthPsNlBTIBZHs";

#[derive(Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct PollResult {
    pub access_token: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn github_request_device_code() -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": GITHUB_CLIENT_ID,
            "scope": ""
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("GitHub returned {}", res.status()));
    }

    res.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| format!("Parse failed: {}", e))
}

#[tauri::command]
pub async fn github_poll_token(device_code: String) -> Result<PollResult, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": GITHUB_CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let data: TokenResponse = res.json().await.map_err(|e| format!("Parse failed: {}", e))?;

    Ok(PollResult {
        access_token: data.access_token,
        error: data.error,
    })
}

#[tauri::command]
pub async fn github_models_chat(token: String, transcript: String, system_prompt: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://models.inference.ai.azure.com/chat/completions")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": transcript }
            ],
            "max_tokens": 50,
            "temperature": 0
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| format!("Parse failed: {}", e))?;
    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("{\"command\":\"unknown\"}")
        .trim()
        .to_string();

    Ok(content)
}
