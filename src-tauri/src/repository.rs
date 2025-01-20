use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

pub struct NotificationManager {
    db_pool: Pool<Sqlite>,
}

impl NotificationManager {
    pub async fn new(db_path: &str) -> Self {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect(db_path)
            .await
            .expect("Failed to connect to SQLite");

        NotificationManager { db_pool: pool }
    }

    pub async fn save_notifications(&self, notifications: Vec<Notification>) {
        for notification in notifications {
            sqlx::query!(
            r#"
            INSERT INTO notifications (
                id, reason, unread, subject_title, repository_name, repository_full_name, repository_html_url, insert_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET unread = excluded.unread
            "#,
            notification.id,
            notification.reason,
            notification.unread as i32,
            notification.subject.title,
            notification.repository.name,
            notification.repository.full_name,
            notification.repository.html_url
        )
        .execute(&self.db_pool)
        .await
        .expect("Failed to save notification");
        }
    }

    pub async fn mark_as_read(&self, id: &str) {
        sqlx::query!(
            r#"
        UPDATE notifications
        SET unread = 0, read_time = datetime('now')
        WHERE id = ?
        "#,
            id
        )
        .execute(&self.db_pool)
        .await
        .expect("Failed to mark notification as read");
    }

    pub async fn fetch_notifications(&self) -> Vec<Notification> {
        sqlx::query_as!(
            Notification,
            r#"
            SELECT
                id,
                reason,
                unread != 0 as unread,
                subject_title as "subject:title",
                repository_name as "repository:name",
                repository_full_name as "repository:full_name",
                repository_html_url as "repository:html_url"
            FROM notifications
            "#,
        )
        .fetch_all(&self.db_pool)
        .await
        .expect("Failed to fetch notifications")
    }
}
