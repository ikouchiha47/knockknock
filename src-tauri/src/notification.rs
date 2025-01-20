use chrono::{DateTime, Utc};
use std::sync::Arc;
use tokio::sync::Mutex;

use dirs;
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT},
    Client,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Notification {
    pub id: String,
    pub repository: Repository,
    pub subject: Subject,
    pub reason: String,
    pub unread: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Repository {
    pub name: String,
    pub full_name: String,
    pub html_url: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Subject {
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequest {
    pub number: u64,
    pub state: String,
    pub requested_reviewers: Vec<Reviewer>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reviewer {
    pub login: String,
}

#[derive(Clone)]
pub struct GithubClient {
    pub base_url: String,
    pub client: Client,
    pub token: String,
    since_timestamp: Arc<Mutex<Option<String>>>,
}

impl GithubClient {
    pub fn new(token: String) -> Self {
        let client = Client::new();
        let base_url = String::from("https://api.github.com");
        Self {
            client,
            token,
            base_url,
            since_timestamp: Arc::new(Mutex::new(None)),
        }
    }

    fn build_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();

        headers.insert(
            ACCEPT,
            HeaderValue::from_str("application/vnd.github+json").unwrap(),
        );
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.token.trim())).unwrap(),
        );

        headers.insert(USER_AGENT, HeaderValue::from_str("reqwest").unwrap());

        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_str("application/json").unwrap(),
        );

        headers
    }

    pub async fn get_notifications(&self) -> Result<Vec<Notification>, reqwest::Error> {
        let since = self.since_timestamp.lock().await.clone();

        let mut request = self
            .client
            .get(format!("{}/notifications", self.base_url))
            .headers(self.build_headers());

        if let Some(since_value) = since {
            request = request.query(&[("since", since_value)]);
        }

        // if let Some(cloned_request) = request.try_clone() {
        //     if let Ok(built_request) = cloned_request.build() {
        //         println!("Full Request URL: {}", built_request.url());
        //     }
        // }

        let response = request.send().await?;

        if let Err(err) = response.error_for_status_ref() {
            let response_text = response.text().await?;
            let status_code = err.status().unwrap();

            println!(
                "Request failed: {}\nStatus {}\nBody: {}",
                err, status_code, response_text,
            );
            return Err(err);
        }

        // println!("Response text {}", response_text);
        // let notifications: Vec<Notification> = serde_json::from_str(&response_text).unwrap();

        let notifications: Vec<Notification> = response.json().await?;
        println!("received {} notifications", notifications.len());

        let current_time = Utc::now().to_rfc3339();
        *self.since_timestamp.lock().await = Some(current_time);

        let mut filtered_notifications: Vec<Notification> = notifications
            .into_iter()
            .filter(|n| n.reason != "author") // && n.unread)
            .collect();

        filtered_notifications.sort_by(|a, b| {
            let a_time = a.updated_at;
            let b_time = b.updated_at;
            // let a_time = DateTime::parse_from_rfc3339(&a.updated_at).unwrap_or_else(|_| Utc::now());
            // let b_time = DateTime::parse_from_rfc3339(&b.updated_at).unwrap_or_else(|_| Utc::now());
            b_time.cmp(&a_time)
        });

        Ok(filtered_notifications)
    }

    pub async fn get_pull_requests(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<PullRequest>, reqwest::Error> {
        let response = self
            .client
            .get(format!("{}/repos/{}/{}/pulls", self.base_url, owner, repo))
            .headers(self.build_headers())
            .send()
            .await?;

        let prs: Vec<PullRequest> = response.json().await?;
        Ok(prs)
    }
}

pub fn read_github_token() -> Option<String> {
    let home_dir = dirs::home_dir()?.join(".githubapi");
    if Path::new(&home_dir).exists() {
        match fs::read_to_string(home_dir) {
            Ok(token) => Some(token),
            Err(_) => None,
        }
    } else {
        None
    }
}
