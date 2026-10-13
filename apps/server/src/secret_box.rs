//! Coffre de secrets : chiffrement au repos AES-256-GCM.
//!
//! Clé maître : `DEVFORGE_SECRET_KEY` (32 octets encodés en base64). À défaut, une clé est
//! générée au premier lancement dans `$DEVFORGE_DATA_DIR/secret.key` (permissions 0600).
//! Format stocké : `v1:<nonce_b64>:<ciphertext_b64>`.
//!
//! Aucune valeur secrète (clé ou clair) n'est jamais journalisée.

use std::fmt;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use once_cell::sync::OnceCell;
use rand::RngCore;
use zeroize::Zeroizing;

pub const PREFIX: &str = "v1:";
pub const KEY_ENV: &str = "DEVFORGE_SECRET_KEY";
pub const KEY_FILE: &str = "secret.key";

#[derive(Debug, PartialEq, Eq)]
pub enum SecretError {
    /// Clé maître absente ou invalide (message sans secret).
    Key(String),
    /// Valeur mal formée (préfixe, base64, nonce).
    Format,
    /// Échec d'authentification : valeur altérée ou mauvaise clé.
    Decrypt,
}

impl fmt::Display for SecretError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecretError::Key(m) => write!(f, "clé maître indisponible : {m}"),
            SecretError::Format => write!(f, "secret scellé mal formé"),
            SecretError::Decrypt => write!(
                f,
                "déchiffrement impossible (secret altéré ou mauvaise clé)"
            ),
        }
    }
}

impl std::error::Error for SecretError {}

/// Enveloppe dont `Debug`/`Display` affichent `***`, pour ne jamais logguer un secret.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct Redacted<T>(pub T);

impl<T> Redacted<T> {
    pub fn new(v: T) -> Self {
        Self(v)
    }
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> fmt::Debug for Redacted<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl<T> fmt::Display for Redacted<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

pub struct SecretBox {
    cipher: Aes256Gcm,
}

impl fmt::Debug for SecretBox {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretBox(***)")
    }
}

impl SecretBox {
    pub fn from_key(key: &[u8; 32]) -> Self {
        Self {
            cipher: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)),
        }
    }

    /// Clé encodée base64 (env ou fichier) → coffre.
    pub fn from_b64(raw: &str) -> Result<Self, SecretError> {
        let bytes = Zeroizing::new(
            B64.decode(raw.trim())
                .map_err(|_| SecretError::Key("base64 invalide".into()))?,
        );
        if bytes.len() != 32 {
            return Err(SecretError::Key("la clé doit faire 32 octets".into()));
        }
        let mut key = Zeroizing::new([0u8; 32]);
        key.copy_from_slice(&bytes);
        Ok(Self::from_key(&key))
    }

    /// Charge la clé depuis `DEVFORGE_SECRET_KEY`, sinon depuis/vers `<data_dir>/secret.key`.
    pub fn load(env_value: Option<&str>, data_dir: &Path) -> Result<Self, SecretError> {
        if let Some(v) = env_value.map(str::trim).filter(|v| !v.is_empty()) {
            return Self::from_b64(v);
        }
        let path = data_dir.join(KEY_FILE);
        if path.is_file() {
            let raw = Zeroizing::new(
                std::fs::read_to_string(&path)
                    .map_err(|e| SecretError::Key(format!("lecture {} : {e}", path.display())))?,
            );
            return Self::from_b64(&raw);
        }
        let mut key = Zeroizing::new([0u8; 32]);
        rand::rngs::OsRng.fill_bytes(key.as_mut());
        let encoded = Zeroizing::new(B64.encode(key.as_ref()));
        write_key_file(&path, encoded.as_bytes())?;
        tracing::info!("clé maître du coffre générée dans {}", path.display());
        Ok(Self::from_key(&key))
    }

    pub fn seal(&self, plaintext: &[u8]) -> String {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        // AES-GCM ne peut échouer qu'au-delà de ~64 Gio de clair.
        let ct = self
            .cipher
            .encrypt(&nonce, plaintext)
            .expect("AES-GCM encrypt");
        format!("{PREFIX}{}:{}", B64.encode(nonce), B64.encode(ct))
    }

    pub fn open(&self, sealed: &str) -> Result<Zeroizing<Vec<u8>>, SecretError> {
        let rest = sealed.strip_prefix(PREFIX).ok_or(SecretError::Format)?;
        let (n, c) = rest.split_once(':').ok_or(SecretError::Format)?;
        let nonce = B64.decode(n).map_err(|_| SecretError::Format)?;
        if nonce.len() != 12 {
            return Err(SecretError::Format);
        }
        let ct = B64.decode(c).map_err(|_| SecretError::Format)?;
        self.cipher
            .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
            .map(Zeroizing::new)
            .map_err(|_| SecretError::Decrypt)
    }
}

fn write_key_file(path: &Path, content: &[u8]) -> Result<(), SecretError> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| SecretError::Key(format!("création {} : {e}", dir.display())))?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(path)
        .map_err(|e| SecretError::Key(format!("écriture {} : {e}", path.display())))?;
    f.write_all(content)
        .and_then(|_| f.sync_all())
        .map_err(|e| SecretError::Key(format!("écriture {} : {e}", path.display())))?;
    Ok(())
}

pub fn is_sealed(v: &str) -> bool {
    v.starts_with(PREFIX)
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into()))
}

static GLOBAL: OnceCell<SecretBox> = OnceCell::new();

/// Coffre global de l'instance (initialisé au démarrage, ou paresseusement).
pub fn global() -> Result<&'static SecretBox, SecretError> {
    GLOBAL.get_or_try_init(|| {
        let env = std::env::var(KEY_ENV).ok();
        SecretBox::load(env.as_deref(), &data_dir())
    })
}

/// Initialise le coffre au démarrage ; une erreur est journalisée sans secret.
pub fn init() {
    if let Err(e) = global() {
        tracing::error!("coffre de secrets indisponible : {e} — les tokens restent en clair");
    }
}

pub fn seal(plaintext: &[u8]) -> Result<String, SecretError> {
    Ok(global()?.seal(plaintext))
}

pub fn open(sealed: &str) -> Result<Zeroizing<Vec<u8>>, SecretError> {
    global()?.open(sealed)
}

/// Lecture rétro-compatible : valeur sans préfixe `v1:` = clair historique.
/// Un secret scellé illisible renvoie une chaîne vide (jamais la valeur brute).
pub fn open_compat(stored: &str) -> String {
    if !is_sealed(stored) {
        return stored.to_string();
    }
    match open(stored) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            tracing::warn!("secret scellé illisible : {e}");
            String::new()
        }
    }
}

/// Écriture : scelle une valeur non vide (repli en clair si le coffre est indisponible).
pub fn seal_compat(plain: &str) -> String {
    if plain.is_empty() || is_sealed(plain) {
        return plain.to_string();
    }
    match seal(plain.as_bytes()) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("coffre indisponible, secret stocké en clair : {e}");
            plain.to_string()
        }
    }
}

#[cfg(test)]
#[path = "secret_box_tests.rs"]
mod tests;
