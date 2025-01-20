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

    // let mut tinterval = tokio::time::interval(tokio::time::Duration::from_secs(60));
    let mut interval_duration = tokio::time::Duration::from_secs(60);
    let max_backoff_duration = tokio::time::Duration::from_secs(1200);
    let base_interval = tokio::time::Duration::from_secs(60);

    // Hack to wait for UI to load
    // Non-hack way, let the UI load and send an event to start the ev loop
    // butfuck that.
    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

    loop {
        // tinterval.tick().await;
        let client = client.lock().await;

        match client.get_notifications().await {
            Ok(notifications) => {
                if notifications.is_empty() {
                    interval_duration =
                        std::cmp::min(interval_duration.mul_f32(1.2), max_backoff_duration);

                    eprintln!(
                        "No notifications found. Backing off to {:?} seconds.",
                        interval_duration.as_secs()
                    );
                } else {
                    interval_duration = base_interval;
                    app.emit("github-notification", notifications.clone())
                        .unwrap_or_else(|e| eprintln!("Failed to emit: {}", e));
                }
            }
            Err(e) => eprintln!("Error fetching notifications: {}", e),
        }

        tokio::time::sleep(interval_duration).await;
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
