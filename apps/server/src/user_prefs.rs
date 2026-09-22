//! Préférences par compte : token GitHub et domaine wildcard.
//! Le domaine d’instance (`instance_settings.wildcard_domain`) sert de repli.

use sqlx::PgPool;

fn norm_domain(raw: &str) -> String {
    raw.trim().trim_start_matches('.').trim().to_lowercase()
}

pub async fn github_token(pool: &PgPool, user_uuid: &str) -> String {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT github_token FROM user_settings WHERE user_uuid = $1")
            .bind(user_uuid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(t,)| t).unwrap_or_default()
}

pub async fn set_github_token(
    pool: &PgPool,
    user_uuid: &str,
    token: &str,
) -> Result<(), sqlx::Error> {
    let now = crate::state::now_str();
    sqlx::query(
        r#"
        INSERT INTO user_settings (user_uuid, wildcard_domain, github_token, updated_at)
        VALUES ($1, '', $2, $3)
        ON CONFLICT (user_uuid) DO UPDATE
            SET github_token = EXCLUDED.github_token, updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(user_uuid)
    .bind(token)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn wildcard_own(pool: &PgPool, user_uuid: &str) -> String {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT wildcard_domain FROM user_settings WHERE user_uuid = $1")
            .bind(user_uuid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(d,)| norm_domain(&d)).unwrap_or_default()
}

pub async fn set_wildcard(pool: &PgPool, user_uuid: &str, domain: &str) -> Result<(), sqlx::Error> {
    let now = crate::state::now_str();
    let domain = norm_domain(domain);
    sqlx::query(
        r#"
        INSERT INTO user_settings (user_uuid, wildcard_domain, github_token, updated_at)
        VALUES ($1, $2, '', $3)
        ON CONFLICT (user_uuid) DO UPDATE
            SET wildcard_domain = EXCLUDED.wildcard_domain, updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(user_uuid)
    .bind(&domain)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn instance_wildcard(pool: &PgPool) -> String {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT wildcard_domain FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(d,)| norm_domain(&d)).unwrap_or_default()
}

/// Domaine de l’utilisateur, sinon celui configuré par l’admin instance.
pub async fn effective_wildcard_for_user(pool: &PgPool, user_uuid: &str) -> String {
    let own = wildcard_own(pool, user_uuid).await;
    if !own.is_empty() {
        return own;
    }
    instance_wildcard(pool).await
}

pub async fn workspace_owner(pool: &PgPool, workspace_uuid: &str) -> Option<String> {
    if workspace_uuid.is_empty() {
        return None;
    }
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT user_uuid FROM team_members WHERE team_uuid = $1 AND role = 'owner' ORDER BY created_at ASC LIMIT 1",
    )
    .bind(workspace_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.map(|(u,)| u)
}

pub async fn effective_wildcard_for_workspace(pool: &PgPool, workspace_uuid: &str) -> String {
    if let Some(owner) = workspace_owner(pool, workspace_uuid).await {
        return effective_wildcard_for_user(pool, &owner).await;
    }
    instance_wildcard(pool).await
}
