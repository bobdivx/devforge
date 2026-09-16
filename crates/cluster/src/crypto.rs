use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn hash_secret(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn new_join_token() -> String {
    format!("dfjoin_{}", Uuid::new_v4().simple())
}

pub fn new_node_secret() -> String {
    format!("dfnode_{}", Uuid::new_v4().simple())
}

pub fn new_node_id() -> String {
    let s = Uuid::new_v4().simple().to_string();
    format!("node_{}", &s[..12])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable() {
        assert_eq!(hash_secret("abc"), hash_secret("abc"));
        assert_ne!(hash_secret("abc"), hash_secret("abd"));
        assert_eq!(hash_secret("abc").len(), 64);
    }

    #[test]
    fn tokens_have_prefix() {
        assert!(new_join_token().starts_with("dfjoin_"));
        assert!(new_node_secret().starts_with("dfnode_"));
        assert!(new_node_id().starts_with("node_"));
    }
}
