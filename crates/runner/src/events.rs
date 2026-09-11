use crate::models::RunnerEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct RunnerEventBus {
    tx: broadcast::Sender<RunnerEvent>,
}

impl RunnerEventBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity.max(16));
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RunnerEvent> {
        self.tx.subscribe()
    }

    pub fn publish(&self, event: RunnerEvent) {
        let _ = self.tx.send(event);
    }
}

impl Default for RunnerEventBus {
    fn default() -> Self {
        Self::new(256)
    }
}
