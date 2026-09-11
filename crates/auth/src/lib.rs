use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub uuid: String,
    pub email: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTeam {
    pub uuid: String,
    pub name: String,
    pub slug: String,
    pub show_boarding: bool,
    pub plan: String,
}

pub const PLAN_FREE: &str = "free";
pub const PLAN_PRO: &str = "pro";
pub const ROLE_INSTANCE_ADMIN: &str = "instance_admin";
pub const ROLE_USER: &str = "user";

pub const ABILITY_READ: &str = "read";
pub const ABILITY_WRITE: &str = "write";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OnboardingSteps {
    pub account: bool,
    pub instance: bool,
    pub domain: bool,
    pub github: bool,
    pub server: bool,
}

impl OnboardingSteps {
    pub fn from_settings(
        has_user: bool,
        instance_name: &str,
        instance_url: &str,
        wildcard_domain: &str,
        github_token: &str,
        ssh_host: &str,
    ) -> Self {
        Self {
            account: has_user,
            instance: !instance_name.trim().is_empty() && !instance_url.trim().is_empty(),
            domain: !wildcard_domain.trim().is_empty(),
            github: !github_token.trim().is_empty(),
            server: !ssh_host.trim().is_empty()
                || std::env::var("DEVFORGE_EXECUTOR").as_deref() == Ok("local"),
        }
    }

    pub fn all_required_done(&self) -> bool {
        self.account && self.instance && self.domain
    }
}

pub fn hash_password(password: &str) -> Result<String> {
    if password.len() < 8 {
        return Err(DevForgeError::Message(
            "Le mot de passe doit faire au moins 8 caractères".into(),
        ));
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| DevForgeError::Message(format!("hash: {e}")))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(password_hash)
        .map_err(|e| DevForgeError::Message(format!("hash invalide: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub fn new_session_token() -> String {
    format!("df_{}", Uuid::new_v4().simple())
}

/// Plaintext API token (shown once). Prefix `dfat_` for routing vs session `df_`.
pub fn new_api_token() -> String {
    format!("dfat_{}", Uuid::new_v4().simple())
}

pub fn hash_api_token(plaintext: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(plaintext.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn api_token_prefix(plaintext: &str) -> String {
    plaintext.chars().take(12).collect()
}

pub fn normalize_abilities(abilities: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for a in abilities {
        let t = a.trim().to_lowercase();
        if (t == ABILITY_READ || t == ABILITY_WRITE) && !out.iter().any(|x| x == &t) {
            out.push(t);
        }
    }
    if out.is_empty() {
        out.push(ABILITY_READ.into());
    }
    // write implique read
    if out.iter().any(|a| a == ABILITY_WRITE) && !out.iter().any(|a| a == ABILITY_READ) {
        out.insert(0, ABILITY_READ.into());
    }
    out
}

pub fn abilities_csv(abilities: &[String]) -> String {
    normalize_abilities(abilities).join(",")
}

pub fn parse_abilities_csv(csv: &str) -> Vec<String> {
    let parts: Vec<String> = csv
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    normalize_abilities(&parts)
}

pub fn has_ability(abilities: &[String], need: &str) -> bool {
    abilities.iter().any(|a| a == need)
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string().replace('-', "")[..24].to_string()
}

pub fn slugify(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = s.trim_matches('-');
    if trimmed.is_empty() {
        "team".into()
    } else {
        trimmed.chars().take(40).collect()
    }
}
