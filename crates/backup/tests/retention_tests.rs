use devforge_backup::{InstanceBackupService, BackupScheduler};
use devforge_storage::StorageFacade;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn test_local_backup_creation() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    tokio::fs::write(&db_path, b"SQLite format 3\0test data").await.unwrap();
    
    let storage = Arc::new(StorageFacade::memory());
    let svc = InstanceBackupService::new(storage, db_path.clone());
    
    let result = svc.create().await;
    assert!(result.is_ok());
    
    let response = result.unwrap();
    assert_eq!(response.get("ok").and_then(|v| v.as_bool()), Some(true));
    
    let backup = response.get("backup").unwrap();
    assert!(backup.get("storage_key").is_some());
    assert!(backup.get("size_bytes").and_then(|v| v.as_u64()).unwrap() > 0);
}

#[tokio::test]
async fn test_local_backup_list() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    tokio::fs::write(&db_path, b"SQLite format 3\0test data").await.unwrap();
    
    let storage = Arc::new(StorageFacade::memory());
    let svc = InstanceBackupService::new(storage, db_path.clone());
    
    let _ = svc.create().await.unwrap();
    let _ = svc.create().await.unwrap();
    
    let backups = svc.list_local().await.unwrap();
    assert_eq!(backups.len(), 2);
}

#[tokio::test]
async fn test_backup_retention() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    tokio::fs::write(&db_path, b"SQLite format 3\0test data").await.unwrap();
    
    let storage = Arc::new(StorageFacade::memory());
    let svc = InstanceBackupService::new(storage, db_path.clone());
    
    for _ in 0..10 {
        let _ = svc.create().await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }
    
    let before = svc.list_local().await.unwrap();
    assert_eq!(before.len(), 10);
    
    let result = svc.prune(3).await.unwrap();
    assert_eq!(result.get("ok").and_then(|v| v.as_bool()), Some(true));
    
    let after = svc.list_local().await.unwrap();
    assert_eq!(after.len(), 3);
    
    let deleted_local = result.get("deleted_local").and_then(|v| v.as_u64()).unwrap();
    assert_eq!(deleted_local, 7);
}

#[tokio::test]
async fn test_s3_fallback_to_local() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    tokio::fs::write(&db_path, b"SQLite format 3\0test data").await.unwrap();
    
    let storage = Arc::new(StorageFacade::memory());
    let svc = InstanceBackupService::new(storage.clone(), db_path.clone());
    
    let cfg = storage.config().await;
    assert!(!cfg.is_ready());
    
    let result = svc.create().await;
    assert!(result.is_ok());
    
    let response = result.unwrap();
    let backup = response.get("backup").unwrap();
    let message = backup.get("message").and_then(|v| v.as_str()).unwrap();
    assert!(message.contains("local"));
}
