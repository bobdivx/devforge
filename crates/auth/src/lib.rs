use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
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
