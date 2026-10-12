//! P5 — chat riche : réactions (P5-03), pièces jointes images (P5-02), réponses aux questions
//! `ask_user` (P5-04), citations (P5-06) et exécution des routines d'agent (P5-05).

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::routes::ApiError;
use crate::state::{now_str, AppState};

/// Réactions autorisées (liste blanche).
pub const REACTIONS: [&str; 8] = ["👍", "👎", "❤️", "🎉", "😄", "🤔", "👀", "🚀"];
pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_MESSAGE: usize = 4;
const IMAGE_MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        "ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS attachments_json TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS reply_to_uuid TEXT NULL",
        r#"CREATE TABLE IF NOT EXISTS agent_message_reactions (
              message_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL, emoji TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              PRIMARY KEY (message_uuid, user_uuid, emoji))"#,
        r#"CREATE TABLE IF NOT EXISTS agent_attachments (
              id TEXT PRIMARY KEY,
              project_uuid TEXT NOT NULL,
              agent_uuid TEXT NOT NULL,
              user_uuid TEXT NOT NULL,
              name TEXT NOT NULL,
              mime TEXT NOT NULL,
              size_bytes BIGINT NOT NULL,
              width INT NOT NULL DEFAULT 0,
              height INT NOT NULL DEFAULT 0,
              storage TEXT NOT NULL,
              storage_key TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now())"#,
        "CREATE INDEX IF NOT EXISTS idx_agent_attachments_agent ON agent_attachments(agent_uuid, created_at)",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'command'",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS agent_uuid TEXT NULL",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS prompt TEXT NULL",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS created_by TEXT NULL",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS notify TEXT NOT NULL DEFAULT 'on_change'",
        "ALTER TABLE project_crons ADD COLUMN IF NOT EXISTS last_summary_hash TEXT NULL",
    ] {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/messages/{message_uuid}/reactions/{emoji}",
            post(add_reaction).delete(remove_reaction),
        )
        .route(
            "/api/v1/projects/{project_uuid}/agents/{agent_uuid}/attachments",
            post(upload_attachment).layer(DefaultBodyLimit::max(MAX_ATTACHMENT_BYTES + 64 * 1024)),
        )
        .route("/api/v1/attachments/{id}", get(get_attachment))
}

/// Colonnes supplémentaires des messages listés (pièces jointes, citation, réactions agrégées).
/// `$3` = utilisateur courant (réactions « mine »), chaîne vide pour un partage.
pub const MESSAGE_EXTRA_COLUMNS: &str = r#"COALESCE(m.attachments_json, '[]') AS attachments_json, m.reply_to_uuid,
    COALESCE((SELECT json_agg(json_build_object('emoji', x.emoji, 'count', x.c, 'mine', x.mine) ORDER BY x.first)::text
              FROM (SELECT emoji, COUNT(*) AS c, BOOL_OR(user_uuid = $3) AS mine, MIN(created_at) AS first
                    FROM agent_message_reactions r WHERE r.message_uuid = m.uuid GROUP BY emoji) x), '[]') AS reactions_json"#;

/* ---------------- Réactions (P5-03) ---------------- */

fn decode_emoji(raw: &str) -> Option<&'static str> {
    let e = raw.trim();
    REACTIONS
        .iter()
        .copied()
        .find(|r| *r == e || r.trim_end_matches('\u{fe0f}') == e.trim_end_matches('\u{fe0f}'))
}

async fn message_owner(
    state: &AppState,
    headers: &HeaderMap,
    message_uuid: &str,
) -> Result<(String, String, String, String, String), ApiError> {
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT project_uuid, agent_uuid, role, content FROM agent_messages WHERE uuid = $1",
    )
    .bind(message_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::message(e.to_string()))?;
    let (project, agent, role, content) = row.ok_or_else(|| ApiError::not_found("message"))?;
    crate::routes::auth_project(state, headers, &project).await?;
    let (user, _) = crate::routes::require_auth(state, headers).await?;
    Ok((user.uuid, project, agent, role, content))
}

async fn reactions_of(pool: &PgPool, message_uuid: &str, user_uuid: &str) -> Value {
    let rows: Vec<(String, i64, bool)> = sqlx::query_as(
        r#"SELECT emoji, COUNT(*), BOOL_OR(user_uuid = $2) FROM agent_message_reactions
           WHERE message_uuid = $1 GROUP BY emoji ORDER BY MIN(created_at)"#,
    )
    .bind(message_uuid)
    .bind(user_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    json!(rows
        .into_iter()
        .map(|(emoji, count, mine)| json!({"emoji": emoji, "count": count, "mine": mine}))
        .collect::<Vec<_>>())
}

async fn add_reaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((message_uuid, emoji)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let emoji = decode_emoji(&emoji).ok_or_else(|| ApiError::message("réaction non autorisée"))?;
    let (user, project, agent, role, content) =
        message_owner(&state, &headers, &message_uuid).await?;
    let inserted = sqlx::query(
        "INSERT INTO agent_message_reactions (message_uuid, user_uuid, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(&message_uuid)
    .bind(&user)
    .bind(emoji)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::message(e.to_string()))?
    .rows_affected()
        > 0;
    // Signal pour l'agent : 👎 sur une réponse → note de fil (72 h) pour qu'il ajuste.
    if inserted && emoji == "👎" && role == "assistant" {
        thumbs_down_note(&state, &user, &project, &agent, &content).await;
    }
    Ok(Json(
        json!({"ok": true, "reactions": reactions_of(&state.pool, &message_uuid, &user).await}),
    ))
}

async fn remove_reaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((message_uuid, emoji)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let emoji = decode_emoji(&emoji).ok_or_else(|| ApiError::message("réaction non autorisée"))?;
    let (user, ..) = message_owner(&state, &headers, &message_uuid).await?;
    sqlx::query("DELETE FROM agent_message_reactions WHERE message_uuid = $1 AND user_uuid = $2 AND emoji = $3")
        .bind(&message_uuid)
        .bind(&user)
        .bind(emoji)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(
        json!({"ok": true, "reactions": reactions_of(&state.pool, &message_uuid, &user).await}),
    ))
}

pub fn thumbs_down_text(content: &str) -> String {
    let one_line = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let excerpt: String = one_line.chars().take(160).collect();
    let more = if one_line.chars().count() > 160 {
        "…"
    } else {
        ""
    };
    format!("Réponse jugée insatisfaisante par l'utilisateur : « {excerpt}{more} ». Sois plus précis et vérifie avant d'affirmer.")
}

async fn thumbs_down_note(state: &AppState, user: &str, project: &str, agent: &str, content: &str) {
    let Some(store) = state.registry.memory() else {
        return;
    };
    let mut req = devforge_memory::WriteReq::new(
        user,
        devforge_memory::Scope::Agent(agent.to_string()),
        devforge_memory::Tier::Note,
        "context",
        &thumbs_down_text(content),
    );
    req.project_uuid = Some(project.to_string());
    req.source = "user_said".into();
    req.created_by = "user".into();
    req.expires_in = Some(std::time::Duration::from_secs(72 * 3600));
    if let Err(e) = store.write(req).await {
        tracing::warn!(error = %e, "mémoire : note 👎 non écrite");
    }
}

/* ---------------- Pièces jointes (P5-02) ---------------- */

/// Dimensions d'une image PNG / JPEG / GIF / WebP lues dans l'en-tête (sans décoder l'image).
pub fn image_dims(b: &[u8]) -> Option<(u32, u32)> {
    let be16 =
        |i: usize| -> Option<u32> { Some(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let le16 =
        |i: usize| -> Option<u32> { Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let be32 = |i: usize| -> Option<u32> {
        Some(u32::from_be_bytes([
            *b.get(i)?,
            *b.get(i + 1)?,
            *b.get(i + 2)?,
            *b.get(i + 3)?,
        ]))
    };
    let le24 = |i: usize| -> Option<u32> {
        Some(u32::from_le_bytes([
            *b.get(i)?,
            *b.get(i + 1)?,
            *b.get(i + 2)?,
            0,
        ]))
    };
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be32(16)?, be32(20)?));
    }
    if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        return Some((le16(6)?, le16(8)?));
    }
    if b.len() > 30 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return match &b[12..16] {
            b"VP8 " => Some((le16(26)? & 0x3fff, le16(28)? & 0x3fff)),
            b"VP8L" => {
                let bits = u32::from_le_bytes([*b.get(21)?, *b.get(22)?, *b.get(23)?, *b.get(24)?]);
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le24(24)? + 1, le24(27)? + 1)),
            _ => None,
        };
    }
    if b.starts_with(&[0xff, 0xd8]) {
        let mut i = 2;
        while i + 9 < b.len() {
            if b[i] != 0xff {
                i += 1;
                continue;
            }
            let marker = b[i + 1];
            if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) || marker == 0xff
            {
                i += if marker == 0xff { 1 } else { 2 };
                continue;
            }
            let len = be16(i + 2)? as usize;
            // SOF0..SOF15 sauf DHT (C4), JPG (C8), DAC (CC).
            if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
                return Some((be16(i + 7)?, be16(i + 5)?));
            }
            i += 2 + len;
        }
    }
    None
}

/// Le contenu correspond-il au type annoncé ? (pas de HTML/SVG déguisé en image)
pub fn sniff_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Validation d'un envoi : taille, type annoncé dans la liste, contenu conforme.
pub fn validate_upload(declared: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() {
        return Err("fichier vide".into());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "image trop lourde ({} Mo max)",
            MAX_ATTACHMENT_BYTES / 1024 / 1024
        ));
    }
    let declared = declared
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !IMAGE_MIMES.contains(&declared.as_str()) {
        return Err("type refusé : PNG, JPEG, WebP ou GIF uniquement".into());
    }
    match sniff_mime(bytes) {
        Some(real) if real == declared => Ok(real),
        _ => Err("le contenu ne correspond pas au type d'image annoncé".into()),
    }
}

fn data_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into()))
        .join("attachments")
}

fn safe_name(raw: &str) -> String {
    let n: String = raw
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | '"' | '<' | '>'))
        .take(80)
        .collect();
    if n.trim().is_empty() {
        "image".into()
    } else {
        n.trim().to_string()
    }
}

fn random_id() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

async fn upload_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_uuid, agent_uuid)): Path<(String, String)>,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    crate::routes::auth_project(&state, &headers, &project_uuid).await?;
    let (user, _) = crate::routes::require_auth(&state, &headers).await?;
    let agent_ok: Option<(String,)> =
        sqlx::query_as("SELECT uuid FROM project_agents WHERE uuid = $1 AND project_uuid = $2")
            .bind(&agent_uuid)
            .bind(&project_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
    if agent_ok.is_none() {
        return Err(ApiError::not_found("agent"));
    }
    let declared = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mime = validate_upload(declared, &body).map_err(|e| ApiError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        message: e,
    })?;
    let (width, height) = image_dims(&body).unwrap_or((0, 0));
    let name = safe_name(
        &headers
            .get("x-filename")
            .and_then(|v| v.to_str().ok())
            .map(|s| urlencoding_decode(s))
            .unwrap_or_else(|| "image".into()),
    );
    let id = random_id();
    let key = format!("agent-attachments/{project_uuid}/{id}");
    let (storage, storage_key) = if state.storage.mode().await == "s3" {
        let bucket = state.storage.config().await.bucket;
        state
            .storage
            .put_bytes(bucket.trim(), &key, body.to_vec(), mime)
            .await
            .map_err(|e| ApiError::message(format!("stockage : {e}")))?;
        ("s3", key)
    } else {
        // Sans S3 configuré : disque persistant de l'instance (le stockage mémoire serait perdu au redémarrage).
        let dir = data_dir();
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| ApiError::message(format!("stockage : {e}")))?;
        tokio::fs::write(dir.join(&id), &body)
            .await
            .map_err(|e| ApiError::message(format!("stockage : {e}")))?;
        ("disk", id.clone())
    };
    sqlx::query(
        r#"INSERT INTO agent_attachments (id, project_uuid, agent_uuid, user_uuid, name, mime, size_bytes, width, height, storage, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
    )
    .bind(&id)
    .bind(&project_uuid)
    .bind(&agent_uuid)
    .bind(&user.uuid)
    .bind(&name)
    .bind(mime)
    .bind(body.len() as i64)
    .bind(width as i32)
    .bind(height as i32)
    .bind(storage)
    .bind(&storage_key)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(
        json!({"ok": true, "data": attachment_meta(&id, &name, mime, width, height, body.len() as i64)}),
    ))
}

fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn attachment_meta(
    id: &str,
    name: &str,
    mime: &str,
    width: u32,
    height: u32,
    size: i64,
) -> Value {
    json!({"id": id, "url": format!("/api/v1/attachments/{id}"), "name": name, "mime": mime, "width": width, "height": height, "size": size})
}

#[derive(sqlx::FromRow)]
struct AttachmentRow {
    id: String,
    project_uuid: String,
    agent_uuid: String,
    user_uuid: String,
    name: String,
    mime: String,
    size_bytes: i64,
    width: i32,
    height: i32,
    storage: String,
    storage_key: String,
}

async fn load_bytes(state: &AppState, row: &AttachmentRow) -> Option<Vec<u8>> {
    if row.storage == "s3" {
        let bucket = state.storage.config().await.bucket;
        state
            .storage
            .get_bytes(bucket.trim(), &row.storage_key)
            .await
            .ok()
    } else {
        // Clé = id aléatoire hexadécimal : pas de traversée de chemin possible.
        if !row.storage_key.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        tokio::fs::read(data_dir().join(&row.storage_key))
            .await
            .ok()
    }
}

/// Lien de capacité : l'id (256 bits aléatoires) suffit, comme un lien de partage — les balises
/// `<img>` ne portent pas l'en-tête d'authentification.
async fn get_attachment(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let row: Option<AttachmentRow> =
        sqlx::query_as("SELECT * FROM agent_attachments WHERE id = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some(row) = row else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(bytes) = load_bytes(&state, &row).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, row.mime.clone()),
            (
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable".to_string(),
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; sandbox".to_string(),
            ),
        ],
        bytes,
    )
        .into_response()
}

/* ---------------- Tour utilisateur enrichi (P5-02, P5-04, P5-06) ---------------- */

#[derive(Debug, Clone, Deserialize, Default)]
pub struct AnswerBody {
    /// Message de l'agent qui porte la question (`ask_user`).
    pub message_uuid: Option<String>,
    pub option_id: Option<String>,
    pub label: Option<String>,
    pub question: Option<String>,
    /// Réponse libre (« Autre… »).
    pub text: Option<String>,
}

/// Ce qui est persisté et ce qui part au modèle pour un message utilisateur.
#[derive(Debug, Default)]
pub struct PreparedTurn {
    pub persisted: String,
    pub for_model: String,
    pub extras: crate::agent_runs::UserTurnExtras,
    pub images: Vec<devforge_llm::ImagePart>,
}

/// Question et libellé de l'option choisie, lus dans le message de l'agent (pas ceux du client).
pub fn question_from_tools(
    tools_json: &str,
    option_id: Option<&str>,
) -> Option<(String, Option<String>)> {
    let tools: Value = serde_json::from_str(tools_json).ok()?;
    let ask = tools
        .as_array()?
        .iter()
        .find(|t| t.get("name").and_then(|v| v.as_str()) == Some("ask_user"))?;
    let r = ask.get("result")?;
    let question = r.get("question")?.as_str()?.to_string();
    let label = option_id.and_then(|id| {
        r.get("options")?
            .as_array()?
            .iter()
            .find(|o| o.get("id").and_then(|v| v.as_str()) == Some(id))
            .and_then(|o| o.get("label").and_then(|v| v.as_str()).map(str::to_string))
    });
    Some((question, label))
}

pub fn quote_prefix(content: &str) -> String {
    let one = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let excerpt: String = one.chars().take(200).collect();
    let more = if one.chars().count() > 200 { "…" } else { "" };
    format!("(en réponse à : « {excerpt}{more} »)")
}

pub async fn prepare_user_turn(
    state: &AppState,
    user_uuid: &str,
    project_uuid: &str,
    agent_uuid: &str,
    message: &str,
    answer: Option<&AnswerBody>,
    reply_to: Option<&str>,
    attachments: &[String],
) -> Result<PreparedTurn, ApiError> {
    let mut turn = PreparedTurn {
        persisted: message.to_string(),
        for_model: message.to_string(),
        ..Default::default()
    };
    // P5-04 : réponse structurée → texte clair pour le modèle, « ✓ X » à l'affichage.
    if let Some(a) = answer {
        let stored: Option<(String,)> = match a.message_uuid.as_deref().filter(|s| !s.is_empty()) {
            Some(uuid) => sqlx::query_as(
                "SELECT tool_calls_json FROM agent_messages WHERE uuid = $1 AND agent_uuid = $2",
            )
            .bind(uuid)
            .bind(agent_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?,
            None => None,
        };
        let from_db = stored.and_then(|(t,)| question_from_tools(&t, a.option_id.as_deref()));
        let question = from_db
            .as_ref()
            .map(|(q, _)| q.clone())
            .or_else(|| a.question.clone())
            .unwrap_or_default();
        let label = from_db
            .and_then(|(_, l)| l)
            .or_else(|| a.label.clone())
            .unwrap_or_default();
        let text = devforge_agent::ask_user_answer_text(&question, &label, a.text.as_deref());
        turn.persisted = text.clone();
        turn.for_model = text;
        turn.extras.tool_calls_json = json!([{
            "id": "answer",
            "name": "answer",
            "arguments": {},
            "result": {"ok": true, "answer_to": a.message_uuid, "option_id": a.option_id, "label": label, "text": a.text, "question": question},
        }])
        .to_string();
    }
    // P5-06 : citation → contexte pour le modèle, lien vers l'original à l'affichage.
    if let Some(uuid) = reply_to.filter(|s| !s.is_empty()) {
        let quoted: Option<(String,)> = sqlx::query_as(
            "SELECT content FROM agent_messages WHERE uuid = $1 AND agent_uuid = $2",
        )
        .bind(uuid)
        .bind(agent_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
        if let Some((content,)) = quoted {
            turn.for_model = format!("{}\n\n{}", quote_prefix(&content), turn.for_model);
            turn.extras.reply_to_uuid = Some(uuid.to_string());
        }
    }
    // P5-02 : images de ce fil, envoyées par cet utilisateur.
    if !attachments.is_empty() {
        let ids: Vec<String> = attachments
            .iter()
            .take(MAX_ATTACHMENTS_PER_MESSAGE)
            .cloned()
            .collect();
        let rows: Vec<AttachmentRow> = sqlx::query_as(
            "SELECT * FROM agent_attachments WHERE id = ANY($1) AND project_uuid = $2 AND agent_uuid = $3 AND user_uuid = $4",
        )
        .bind(&ids)
        .bind(project_uuid)
        .bind(agent_uuid)
        .bind(user_uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
        let mut metas = Vec::new();
        for id in &ids {
            let Some(row) = rows.iter().find(|r| &r.id == id) else {
                continue;
            };
            let _ = (&row.project_uuid, &row.agent_uuid, &row.user_uuid);
            metas.push(attachment_meta(
                &row.id,
                &row.name,
                &row.mime,
                row.width as u32,
                row.height as u32,
                row.size_bytes,
            ));
            if let Some(bytes) = load_bytes(state, row).await {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                turn.images.push(devforge_llm::ImagePart {
                    name: row.name.clone(),
                    data_url: format!("data:{};base64,{b64}", row.mime),
                });
            }
        }
        if !metas.is_empty() {
            turn.extras.attachments_json = Value::Array(metas).to_string();
            if turn.for_model.trim().is_empty() {
                turn.for_model = "Regarde l'image jointe.".into();
            }
        }
    }
    Ok(turn)
}

/* ---------------- Routines d'agent (P5-05) ---------------- */

pub struct ServerRoutineRunner {
    pub state: AppState,
}

const ROUTINE_RULES: &str = "Exécution automatique programmée : personne ne répond en direct. Fais la vérification demandée avec tes outils (pas d'affirmation sans preuve), ne publie rien et ne modifie rien. Réponds en 1 à 3 phrases : commence par « OK : » si le critère de succès est rempli, sinon « ÉCHEC : », puis la preuve (status HTTP, version, durée…).";

/// Statut d'une routine d'après la réponse de l'agent.
pub fn routine_status(reply: &str) -> &'static str {
    let t = reply.trim_start().to_lowercase();
    if t.starts_with("échec")
        || t.starts_with("echec")
        || t.starts_with("erreur")
        || t.starts_with("❌")
    {
        "failed"
    } else {
        "success"
    }
}

impl ServerRoutineRunner {
    async fn execute(&self, cron: &devforge_cron::ProjectCron) -> (String, String) {
        let state = &self.state;
        let Some(agent_uuid) = cron.agent_uuid.clone() else {
            return ("failed".into(), "routine sans agent cible".into());
        };
        let prompt = format!(
            "ROUTINE:{} « {} »\n{}\n\nConsigne : {}",
            cron.id,
            cron.name,
            ROUTINE_RULES,
            cron.prompt.as_deref().unwrap_or("")
        );
        // P1-10 : rien n'a changé depuis le dernier passage → pas de run LLM.
        let wake_key = format!("routine:{}", cron.id);
        let gate = match crate::wake_gate::project_by_uuid(state, &cron.project_uuid).await {
            Some(project) => {
                let observed = crate::wake_gate::observe(
                    state,
                    &project,
                    true,
                    json!({ "prompt": cron.prompt, "agent": agent_uuid }),
                )
                .await;
                crate::wake_gate::check(
                    &state.pool,
                    &cron.project_uuid,
                    "routine",
                    &wake_key,
                    &cron.name,
                    &observed,
                )
                .await
            }
            None => return ("failed".into(), "projet introuvable".into()),
        };
        if let crate::wake_gate::Decision::Skip { cause } = &gate.decision {
            return ("skipped".into(), cause.clone());
        }
        let run_uuid = crate::state::new_uuid();
        let now = now_str();
        let _ = sqlx::query(
            r#"INSERT INTO agent_runs (uuid, project_uuid, agent_uuid, message_uuid, status, created_at, updated_at, kind, title)
               VALUES ($1, $2, $3, $4, 'running', $5, $5, 'routine', $6)"#,
        )
        .bind(&run_uuid)
        .bind(&cron.project_uuid)
        .bind(&agent_uuid)
        .bind(format!("routine-{run_uuid}"))
        .bind(&now)
        .bind(&cron.name)
        .execute(&state.pool)
        .await;
        let mut ctx =
            crate::routes::load_agent_context(state, &cron.project_uuid, &agent_uuid).await;
        ctx.unattended = true;
        let owner = ctx.user_uuid.clone().unwrap_or_default();
        let (llm, mode) = state.llm_for_user(&owner).await;
        let gh = crate::user_prefs::github_token(&state.pool, &owner).await;
        let result = devforge_github::with_token(
            &gh,
            state
                .agent
                .handle_with_provider(&prompt, None, None, ctx, None, Some((llm, mode))),
        )
        .await;
        let (status, reply, tools_json, provider) = match result {
            Ok(r) => (
                routine_status(&r.reply),
                r.reply.clone(),
                serde_json::to_string(&r.tool_calls).unwrap_or_else(|_| "[]".into()),
                r.provider,
            ),
            Err(e) => (
                "failed",
                format!("ÉCHEC : la routine n'a pas pu s'exécuter ({e})."),
                "[]".into(),
                String::new(),
            ),
        };
        let summary: String = reply.chars().take(400).collect();
        crate::wake_gate::finish(
            &state.pool,
            &cron.project_uuid,
            &wake_key,
            &gate,
            status != "failed",
            &summary,
            Some(&run_uuid),
        )
        .await;
        let _ = sqlx::query(
            "UPDATE agent_runs SET status = $1, summary = $2, updated_at = $3 WHERE uuid = $4",
        )
        .bind(if status == "failed" {
            "failed"
        } else {
            "completed"
        })
        .bind(&summary)
        .bind(now_str())
        .bind(&run_uuid)
        .execute(&state.pool)
        .await;
        let hash = devforge_cron::summary_hash(&reply);
        let notify = cron.notify.as_deref().unwrap_or("on_change");
        if devforge_cron::should_notify(
            notify,
            cron.last_summary_hash.as_deref(),
            &hash,
            status == "failed",
        ) {
            let content = format!("Routine « {} » : {}", cron.name, reply.trim());
            let card = json!([{
                "id": format!("routine-{run_uuid}"),
                "name": "routine_result",
                "arguments": {"routine_id": cron.id},
                "result": {"ok": status != "failed", "routine_id": cron.id, "name": cron.name, "status": status, "run_uuid": run_uuid},
            }]);
            let tools = merge_tools(&card, &tools_json);
            let _ = sqlx::query(
                r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
                   VALUES ($1, $2, $3, 'assistant', $4, $5, $6, $7)"#,
            )
            .bind(crate::state::new_uuid())
            .bind(&cron.project_uuid)
            .bind(&agent_uuid)
            .bind(&content)
            .bind(tools)
            .bind(if provider.is_empty() { "system".to_string() } else { provider })
            .bind(now_str())
            .execute(&state.pool)
            .await;
        }
        let _ = sqlx::query("UPDATE project_crons SET last_summary_hash = $1 WHERE id = $2")
            .bind(&hash)
            .bind(&cron.id)
            .execute(&state.pool)
            .await;
        (status.to_string(), summary)
    }
}

fn merge_tools(card: &Value, tools_json: &str) -> String {
    let mut all = card.as_array().cloned().unwrap_or_default();
    if let Ok(Value::Array(rest)) = serde_json::from_str::<Value>(tools_json) {
        all.extend(rest);
    }
    Value::Array(all).to_string()
}

impl devforge_cron::AgentRoutineRunner for ServerRoutineRunner {
    fn run<'a>(
        &'a self,
        cron: &'a devforge_cron::ProjectCron,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = (String, String)> + Send + 'a>> {
        Box::pin(self.execute(cron))
    }
}

pub fn install_routine_runner(state: AppState) {
    devforge_cron::set_agent_routine_runner(Arc::new(ServerRoutineRunner { state }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_only() {
        assert_eq!(decode_emoji("👍"), Some("👍"));
        assert_eq!(decode_emoji("❤"), Some("❤️"), "variante sans sélecteur");
        assert_eq!(decode_emoji("💩"), None);
        assert_eq!(decode_emoji("<script>"), None);
    }

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 6, 0, 0, 0]);
        b
    }

    #[test]
    fn upload_validation() {
        assert_eq!(validate_upload("image/png", &png(10, 20)), Ok("image/png"));
        assert!(
            validate_upload("image/svg+xml", b"<svg onload=alert(1)>").is_err(),
            "SVG refusé"
        );
        assert!(
            validate_upload("image/png", b"<html><script>alert(1)</script>").is_err(),
            "HTML déguisé refusé"
        );
        assert!(
            validate_upload("image/jpeg", &png(1, 1)).is_err(),
            "type annoncé ≠ contenu"
        );
        assert!(validate_upload("application/pdf", b"%PDF").is_err());
        assert!(validate_upload("image/png", &[]).is_err());
        let mut big = png(1, 1);
        big.resize(MAX_ATTACHMENT_BYTES + 1, 0);
        assert!(validate_upload("image/png", &big)
            .unwrap_err()
            .contains("trop lourde"));
    }

    #[test]
    fn dims_from_headers() {
        assert_eq!(image_dims(&png(1280, 720)), Some((1280, 720)));
        let gif = [b"GIF89a".as_slice(), &[0x40, 0x01, 0xf0, 0x00]].concat();
        assert_eq!(image_dims(&gif), Some((320, 240)));
        // JPEG minimal : SOI, APP0 court, SOF0 (h=480, w=640).
        let jpg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01,
            0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(image_dims(&jpg), Some((640, 480)));
        assert_eq!(image_dims(b"nope"), None);
    }

    #[test]
    fn answer_reads_the_stored_question() {
        let tools = json!([{"name": "ask_user", "result": {"question": "Je pousse le correctif ?", "options": [{"id": "yes", "label": "Oui, publier"}, {"id": "no", "label": "Non, garder en local"}]}}]).to_string();
        assert_eq!(
            question_from_tools(&tools, Some("no")),
            Some((
                "Je pousse le correctif ?".into(),
                Some("Non, garder en local".into())
            ))
        );
        assert_eq!(
            question_from_tools(&tools, Some("zzz")),
            Some(("Je pousse le correctif ?".into(), None))
        );
        assert_eq!(question_from_tools("[]", Some("yes")), None);
    }

    #[test]
    fn quote_and_signals() {
        assert_eq!(
            quote_prefix("Le build\n casse"),
            "(en réponse à : « Le build casse »)"
        );
        assert!(quote_prefix(&"x".repeat(300)).ends_with("… »)"));
        assert!(thumbs_down_text("Tout est en ligne.").contains("« Tout est en ligne. »"));
        assert_eq!(routine_status("OK : popcornn.app répond 200"), "success");
        assert_eq!(routine_status("ÉCHEC : 502"), "failed");
    }
}
