use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

const SIGN_TTL: Duration = Duration::from_secs(900);

/// S3-compatible credentials (Scaleway / MinIO / AWS), configured via UX.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct S3Config {
    pub enabled: bool,
    pub name: String,
    pub key: String,
    pub secret: String,
    pub bucket: String,
    pub region: String,
    pub endpoint: String,
}

impl S3Config {
    pub fn is_ready(&self) -> bool {
        self.enabled
            && !self.key.trim().is_empty()
            && !self.secret.trim().is_empty()
            && !self.bucket.trim().is_empty()
            && !self.endpoint.trim().is_empty()
    }

    pub fn masked_key(&self) -> String {
        let k = self.key.trim();
        if k.len() <= 4 {
            return "••••".into();
        }
        format!("••••{}", &k[k.len().saturating_sub(4)..])
    }
}

/// Object in an S3-compatible bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageObject {
    pub key: String,
    pub size_bytes: u64,
    pub content_type: String,
    pub etag: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketInfo {
    pub name: String,
    pub region: String,
    pub endpoint: Option<String>,
}

#[async_trait]
pub trait ObjectStore: Send + Sync {
    async fn list_buckets(&self) -> Result<Vec<BucketInfo>>;
    async fn list_objects(&self, bucket: &str, prefix: &str) -> Result<Vec<StorageObject>>;
    async fn put_object(
        &self,
        bucket: &str,
        key: &str,
        size_bytes: u64,
        content_type: &str,
    ) -> Result<StorageObject>;
    async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<StorageObject>;
    async fn get_bytes(&self, bucket: &str, key: &str) -> Result<Vec<u8>>;
    async fn delete_object(&self, bucket: &str, key: &str) -> Result<bool>;
    async fn test_connection(&self) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct MemoryObjectStore {
    buckets: Arc<RwLock<HashMap<String, BucketInfo>>>,
    objects: Arc<RwLock<HashMap<String, Vec<StorageObject>>>>,
    blobs: Arc<RwLock<HashMap<String, Vec<u8>>>>,
}

impl MemoryObjectStore {
    pub fn new() -> Self {
        Self::default()
    }

    async fn ensure_demo(&self) {
        let mut buckets = self.buckets.write().await;
        if buckets.is_empty() {
            buckets.insert(
                "artifacts".into(),
                BucketInfo {
                    name: "artifacts".into(),
                    region: "eu-west-1".into(),
                    endpoint: None,
                },
            );
            buckets.insert(
                "backups".into(),
                BucketInfo {
                    name: "backups".into(),
                    region: "eu-west-1".into(),
                    endpoint: None,
                },
            );
        }
    }

    fn blob_key(bucket: &str, key: &str) -> String {
        format!("{bucket}::{key}")
    }
}

#[async_trait]
impl ObjectStore for MemoryObjectStore {
    async fn list_buckets(&self) -> Result<Vec<BucketInfo>> {
        self.ensure_demo().await;
        let mut v: Vec<_> = self.buckets.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    async fn list_objects(&self, bucket: &str, prefix: &str) -> Result<Vec<StorageObject>> {
        self.ensure_demo().await;
        if !self.buckets.read().await.contains_key(bucket) {
            return Err(DevForgeError::NotFound(format!("bucket {bucket}")));
        }
        let objs = self
            .objects
            .read()
            .await
            .get(bucket)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|o| prefix.is_empty() || o.key.starts_with(prefix))
            .collect();
        Ok(objs)
    }

    async fn put_object(
        &self,
        bucket: &str,
        key: &str,
        size_bytes: u64,
        content_type: &str,
    ) -> Result<StorageObject> {
        self.put_bytes(bucket, key, vec![0u8; size_bytes as usize], content_type)
            .await
    }

    async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<StorageObject> {
        self.ensure_demo().await;
        if !self.buckets.read().await.contains_key(bucket) {
            return Err(DevForgeError::NotFound(format!("bucket {bucket}")));
        }
        let obj = StorageObject {
            key: key.into(),
            size_bytes: bytes.len() as u64,
            content_type: content_type.into(),
            etag: format!("etag_{}", &Uuid::new_v4().to_string()[..8]),
            updated_at: chrono_now(),
        };
        self.blobs
            .write()
            .await
            .insert(Self::blob_key(bucket, key), bytes);
        let mut guard = self.objects.write().await;
        let list = guard.entry(bucket.into()).or_default();
        list.retain(|o| o.key != key);
        list.push(obj.clone());
        Ok(obj)
    }

    async fn get_bytes(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        self.blobs
            .read()
            .await
            .get(&Self::blob_key(bucket, key))
            .cloned()
            .ok_or_else(|| DevForgeError::NotFound(format!("object {bucket}/{key}")))
    }

    async fn delete_object(&self, bucket: &str, key: &str) -> Result<bool> {
        self.blobs.write().await.remove(&Self::blob_key(bucket, key));
        let mut guard = self.objects.write().await;
        let Some(list) = guard.get_mut(bucket) else {
            return Ok(false);
        };
        let before = list.len();
        list.retain(|o| o.key != key);
        Ok(list.len() != before)
    }

    async fn test_connection(&self) -> Result<()> {
        self.ensure_demo().await;
        Ok(())
    }
}

/// Real S3-compatible client (path-style — Scaleway / MinIO).
pub struct S3ObjectStore {
    config: S3Config,
    http: reqwest::Client,
}

impl S3ObjectStore {
    pub fn new(config: S3Config) -> Result<Self> {
        Ok(Self {
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .map_err(|e| DevForgeError::Message(e.to_string()))?,
        })
    }

    fn credentials(&self) -> Credentials {
        Credentials::new(
            self.config.key.trim().to_string(),
            self.config.secret.trim().to_string(),
        )
    }

    fn bucket(&self, bucket_name: Option<&str>) -> Result<Bucket> {
        let name: String = bucket_name
            .unwrap_or(self.config.bucket.trim())
            .to_string();
        let endpoint = normalize_endpoint(&self.config.endpoint)?;
        let region = if self.config.region.trim().is_empty() {
            "fr-par".to_string()
        } else {
            self.config.region.trim().to_string()
        };
        Bucket::new(endpoint, UrlStyle::Path, name, region)
            .map_err(|e| DevForgeError::Message(format!("endpoint S3 invalide: {e}")))
    }
}

#[async_trait]
impl ObjectStore for S3ObjectStore {
    async fn list_buckets(&self) -> Result<Vec<BucketInfo>> {
        Ok(vec![BucketInfo {
            name: self.config.bucket.clone(),
            region: self.config.region.clone(),
            endpoint: Some(self.config.endpoint.clone()),
        }])
    }

    async fn list_objects(&self, bucket: &str, prefix: &str) -> Result<Vec<StorageObject>> {
        let b = self.bucket(Some(bucket))?;
        let creds = self.credentials();
        let mut action = b.list_objects_v2(Some(&creds));
        if !prefix.is_empty() {
            action.with_prefix(prefix.to_string());
        }
        let url = action.sign(SIGN_TTL);
        let res = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("S3 list: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(format!(
                "S3 list {status}: {body}"
            )));
        }
        let xml = res
            .text()
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(parse_list_objects_v2(&xml))
    }

    async fn put_object(
        &self,
        bucket: &str,
        key: &str,
        size_bytes: u64,
        content_type: &str,
    ) -> Result<StorageObject> {
        self.put_bytes(bucket, key, vec![0u8; size_bytes as usize], content_type)
            .await
    }

    async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<StorageObject> {
        let b = self.bucket(Some(bucket))?;
        let creds = self.credentials();
        let action = b.put_object(Some(&creds), key);
        let url = action.sign(SIGN_TTL);
        let size = bytes.len() as u64;
        let res = self
            .http
            .put(url)
            .header("content-type", content_type)
            .body(bytes)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("S3 put: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(format!(
                "S3 put {status}: {body}"
            )));
        }
        let etag = res
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim_matches('"')
            .to_string();
        Ok(StorageObject {
            key: key.into(),
            size_bytes: size,
            content_type: content_type.into(),
            etag,
            updated_at: chrono_now(),
        })
    }

    async fn get_bytes(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let b = self.bucket(Some(bucket))?;
        let creds = self.credentials();
        let action = b.get_object(Some(&creds), key);
        let url = action.sign(SIGN_TTL);
        let res = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("S3 get: {e}")))?;
        if res.status().as_u16() == 404 {
            return Err(DevForgeError::NotFound(format!("object {bucket}/{key}")));
        }
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(format!(
                "S3 get {status}: {body}"
            )));
        }
        res.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| DevForgeError::Message(e.to_string()))
    }

    async fn delete_object(&self, bucket: &str, key: &str) -> Result<bool> {
        let b = self.bucket(Some(bucket))?;
        let creds = self.credentials();
        let action = b.delete_object(Some(&creds), key);
        let url = action.sign(SIGN_TTL);
        let res = self
            .http
            .delete(url)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("S3 delete: {e}")))?;
        Ok(res.status().is_success() || res.status().as_u16() == 404)
    }

    async fn test_connection(&self) -> Result<()> {
        // List with empty prefix — validates credentials + bucket access.
        let _ = self.list_objects(self.config.bucket.trim(), "").await?;
        Ok(())
    }
}

/// Facade: memory demo until UX configures S3; then real client.
pub struct StorageFacade {
    store: Arc<RwLock<Arc<dyn ObjectStore>>>,
    mode: Arc<RwLock<String>>,
    config: Arc<RwLock<S3Config>>,
}

impl StorageFacade {
    pub fn memory() -> Self {
        Self {
            store: Arc::new(RwLock::new(Arc::new(MemoryObjectStore::new()))),
            mode: Arc::new(RwLock::new("memory".into())),
            config: Arc::new(RwLock::new(S3Config::default())),
        }
    }

    /// Kept for boot compat — ignores env; UX owns config.
    pub fn from_env() -> Self {
        Self::memory()
    }

    pub async fn configure(&self, config: S3Config) -> Result<()> {
        if config.is_ready() {
            let s3 = S3ObjectStore::new(config.clone())?;
            s3.test_connection().await?;
            *self.store.write().await = Arc::new(s3);
            *self.mode.write().await = "s3".into();
        } else if config.enabled {
            return Err(DevForgeError::Message(
                "S3 activé mais clé / secret / bucket / endpoint incomplets".into(),
            ));
        } else {
            *self.store.write().await = Arc::new(MemoryObjectStore::new());
            *self.mode.write().await = "memory".into();
        }
        *self.config.write().await = config;
        Ok(())
    }

    /// Apply config without connection test (e.g. boot from DB).
    pub async fn apply_config_unchecked(&self, config: S3Config) {
        if config.is_ready() {
            match S3ObjectStore::new(config.clone()) {
                Ok(s3) => {
                    *self.store.write().await = Arc::new(s3);
                    *self.mode.write().await = "s3".into();
                }
                Err(e) => {
                    tracing::warn!(error = %e, "S3 config invalide au boot");
                    *self.mode.write().await = "memory".into();
                }
            }
        }
        *self.config.write().await = config;
    }

    pub async fn config(&self) -> S3Config {
        self.config.read().await.clone()
    }

    pub async fn mode(&self) -> String {
        self.mode.read().await.clone()
    }

    pub async fn list_buckets(&self) -> Result<Value> {
        let mode = self.mode().await;
        let store = self.store.read().await.clone();
        Ok(json!({
            "ok": true,
            "mode": mode,
            "buckets": store.list_buckets().await?
        }))
    }

    pub async fn list_objects(&self, bucket: &str, prefix: Option<&str>) -> Result<Value> {
        let store = self.store.read().await.clone();
        Ok(json!({
            "ok": true,
            "bucket": bucket,
            "objects": store.list_objects(bucket, prefix.unwrap_or("")).await?
        }))
    }

    pub async fn put(
        &self,
        bucket: &str,
        key: &str,
        size_bytes: Option<u64>,
        content_type: Option<&str>,
    ) -> Result<Value> {
        let store = self.store.read().await.clone();
        let obj = store
            .put_object(
                bucket,
                key,
                size_bytes.unwrap_or(0),
                content_type.unwrap_or("application/octet-stream"),
            )
            .await?;
        Ok(json!({ "ok": true, "object": obj }))
    }

    pub async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<StorageObject> {
        let store = self.store.read().await.clone();
        store.put_bytes(bucket, key, bytes, content_type).await
    }

    pub async fn get_bytes(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        let store = self.store.read().await.clone();
        store.get_bytes(bucket, key).await
    }

    pub async fn delete(&self, bucket: &str, key: &str) -> Result<Value> {
        let store = self.store.read().await.clone();
        Ok(json!({ "ok": store.delete_object(bucket, key).await? }))
    }

    pub async fn test(&self, config: Option<S3Config>) -> Result<Value> {
        let cfg = match config {
            Some(c) => c,
            None => self.config().await,
        };
        if !cfg.is_ready() && !cfg.enabled {
            return Err(DevForgeError::Message(
                "Configure d’abord le stockage S3".into(),
            ));
        }
        let s3 = S3ObjectStore::new(cfg)?;
        s3.test_connection().await?;
        Ok(json!({ "ok": true, "message": "Connexion S3 OK" }))
    }
}

/// Normalize endpoint: strip trailing slash, ensure https URL, path-style base.
pub fn normalize_endpoint(raw: &str) -> Result<url::Url> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err(DevForgeError::Message("endpoint S3 vide".into()));
    }
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    // Avoid virtual-host style pasted by mistake: https://bucket.s3.region.scw.cloud
    // Prefer https://s3.region.scw.cloud
    let url = url::Url::parse(&s).map_err(|e| DevForgeError::Message(format!("endpoint: {e}")))?;
    Ok(url)
}

fn parse_list_objects_v2(xml: &str) -> Vec<StorageObject> {
    let mut out = Vec::new();
    // Minimal XML scrape — enough for ListObjectsV2 Contents blocks.
    for chunk in xml.split("<Contents>").skip(1) {
        let Some(end) = chunk.find("</Contents>") else {
            continue;
        };
        let block = &chunk[..end];
        let key = xml_tag(block, "Key").unwrap_or_default();
        if key.is_empty() {
            continue;
        }
        let size: u64 = xml_tag(block, "Size")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let etag = xml_tag(block, "ETag")
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let updated = xml_tag(block, "LastModified").unwrap_or_else(chrono_now);
        out.push(StorageObject {
            key,
            size_bytes: size,
            content_type: "application/octet-stream".into(),
            etag,
            updated_at: updated,
        });
    }
    out
}

fn xml_tag(block: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].to_string())
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
