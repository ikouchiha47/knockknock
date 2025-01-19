use std::sync::Arc;
use tokio::sync::Mutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{AppHandle, Emitter};

pub mod notification;

use notification::{read_github_token, GithubClient};

#[tauri::command]
async fn get_github_notifications(
    client: Arc<Mutex<GithubClient>>,
    app: AppHandle,
) -> Result<(), String> {
    let client = client.clone();

    // TODO: add a decay
    let mut tinterval = tokio::time::interval(tokio::time::Duration::from_secs(60));

    loop {
        tinterval.tick().await;

        let client = client.lock().await;
        match client.get_notifications().await {
            Ok(notifications) => {
                app.emit("github-notification", notifications.clone())
                    .unwrap_or_else(|e| eprintln!("Failed to emit: {}", e));
            }
            Err(e) => eprintln!("Error fetching notifications: {}", e),
        }
    }
}

#[tokio::main]
pub async fn run() {
    let github_token = read_github_token().unwrap();
    let github_client = Arc::new(Mutex::new(GithubClient::new(github_token)));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let app_handle = app.handle();
            tokio::spawn(get_github_notifications(github_client, app_handle.clone()));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
