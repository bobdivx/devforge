//! Parseur du flux SSE OpenAI Chat Completions (`stream: true`), P2-02.
//!
//! `data: {"choices":[{"delta":{"content":"…","tool_calls":[{"index":0,"id":"…","function":{"name":"…","arguments":"…"}}]}}]}`
//! jusqu'à `data: [DONE]`. Les `tool_calls` arrivent fragmentés : on les accumule par `index`
//! (les `arguments` sont concaténés).

use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::{AssistantTurn, ToolCallRequest};

#[derive(Default, Debug)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

/// Accumule un flux SSE et reconstruit l'`AssistantTurn` final (identique à `chat()`).
#[derive(Default, Debug)]
pub struct OpenAiStreamAccumulator {
    bytes: Vec<u8>,
    line: String,
    content: String,
    calls: BTreeMap<u64, PartialCall>,
    finish: Option<String>,
    error: Option<String>,
    done: bool,
}

impl OpenAiStreamAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// `data: [DONE]` reçu.
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Erreur envoyée dans le flux (`data: {"error":{…}}`).
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Octets bruts du réseau (un caractère UTF-8 peut être coupé entre deux paquets).
    /// Renvoie les morceaux de texte à afficher.
    pub fn push_bytes(&mut self, chunk: &[u8]) -> Vec<String> {
        self.bytes.extend_from_slice(chunk);
        let valid = match std::str::from_utf8(&self.bytes) {
            Ok(s) => s.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            // Octets invalides : on remplace plutôt que de bloquer le flux.
            Err(_) => {
                let s = String::from_utf8_lossy(&self.bytes).into_owned();
                self.bytes.clear();
                return self.push_str(&s);
            }
        };
        let text = String::from_utf8(self.bytes.drain(..valid).collect()).unwrap_or_default();
        self.push_str(&text)
    }

    /// Texte du flux ; renvoie les morceaux de contenu à afficher.
    pub fn push_str(&mut self, chunk: &str) -> Vec<String> {
        let mut out = Vec::new();
        self.line.push_str(chunk);
        while let Some(pos) = self.line.find('\n') {
            let line: String = self.line.drain(..=pos).collect();
            self.handle_line(line.trim_end_matches(['\n', '\r']), &mut out);
        }
        out
    }

    fn handle_line(&mut self, line: &str, out: &mut Vec<String>) {
        let Some(data) = line.strip_prefix("data:") else {
            return;
        };
        let data = data.trim();
        if data.is_empty() {
            return;
        }
        if data == "[DONE]" {
            self.done = true;
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return;
        };
        if let Some(e) = v.get("error") {
            let msg = e
                .get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| e.to_string());
            self.error = Some(msg);
            return;
        }
        let Some(choice) = v.pointer("/choices/0") else {
            return;
        };
        if let Some(f) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            self.finish = Some(f.to_string());
        }
        let delta = choice.get("delta").or_else(|| choice.get("message"));
        let Some(delta) = delta else {
            return;
        };
        if let Some(c) = delta.get("content").and_then(|c| c.as_str()) {
            if !c.is_empty() {
                self.content.push_str(c);
                out.push(c.to_string());
            }
        }
        if let Some(arr) = delta.get("tool_calls").and_then(|t| t.as_array()) {
            for (pos, tc) in arr.iter().enumerate() {
                self.merge_call(pos as u64, tc);
            }
        }
    }

    fn merge_call(&mut self, pos: u64, tc: &Value) {
        let mut index = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(pos);
        let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        // Certains fournisseurs renvoient chaque appel complet avec le même index : un id
        // différent sur un appel déjà rempli = nouvel appel.
        if let Some(existing) = self.calls.get(&index) {
            if !id.is_empty() && !existing.id.is_empty() && existing.id != id {
                index = self.calls.keys().next_back().map(|k| k + 1).unwrap_or(0).max(index + 1);
            }
        }
        let entry = self.calls.entry(index).or_default();
        if !id.is_empty() && entry.id.is_empty() {
            entry.id = id.to_string();
        }
        if let Some(name) = tc.pointer("/function/name").and_then(|v| v.as_str()) {
            if entry.name.is_empty() {
                entry.name = name.to_string();
            } else if !name.is_empty() && !entry.name.ends_with(name) && entry.args.is_empty() {
                entry.name.push_str(name);
            }
        }
        match tc.pointer("/function/arguments") {
            Some(Value::String(a)) => entry.args.push_str(a),
            Some(v @ Value::Object(_)) => entry.args.push_str(&v.to_string()),
            _ => {}
        }
    }

    /// Tour final (texte complet + appels d'outils reconstruits).
    pub fn finish(mut self) -> AssistantTurn {
        if !self.line.is_empty() {
            let rest = std::mem::take(&mut self.line);
            let mut sink = Vec::new();
            self.handle_line(rest.trim_end_matches('\r'), &mut sink);
        }
        let tool_calls: Vec<ToolCallRequest> = self
            .calls
            .into_iter()
            .enumerate()
            .filter(|(_, (_, c))| !c.name.is_empty())
            .map(|(i, (_, c))| ToolCallRequest {
                id: if c.id.is_empty() { format!("call_{i}") } else { c.id },
                name: c.name,
                arguments: if c.args.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&c.args).unwrap_or_else(|_| json!({}))
                },
            })
            .collect();
        AssistantTurn {
            content: self.content,
            finish_reason: self.finish.unwrap_or_else(|| {
                if tool_calls.is_empty() { "stop".into() } else { "tool_calls".into() }
            }),
            tool_calls,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(fixture: &str, chunk: usize) -> (Vec<String>, AssistantTurn) {
        let mut acc = OpenAiStreamAccumulator::new();
        let mut deltas = Vec::new();
        for part in fixture.as_bytes().chunks(chunk) {
            deltas.extend(acc.push_bytes(part));
        }
        assert!(acc.is_done(), "[DONE] attendu");
        (deltas, acc.finish())
    }

    const CONTENT_ONLY: &str = include_str!("../tests/fixtures/openai_content.sse");
    const TOOL_CALLS: &str = include_str!("../tests/fixtures/openai_tool_calls.sse");

    #[test]
    fn content_only_stream() {
        for chunk in [1, 3, 7, 64, 10_000] {
            let (deltas, turn) = run(CONTENT_ONLY, chunk);
            assert_eq!(deltas.concat(), "Bonjour, c'est réglé — preview OK.");
            assert_eq!(turn.content, "Bonjour, c'est réglé — preview OK.");
            assert!(turn.tool_calls.is_empty());
            assert_eq!(turn.finish_reason, "stop");
        }
    }

    #[test]
    fn tool_calls_fragmented_over_three_chunks() {
        let (deltas, turn) = run(TOOL_CALLS, 5);
        assert_eq!(deltas.concat(), "Je lis le fichier.");
        assert_eq!(turn.tool_calls.len(), 2);
        assert_eq!(turn.tool_calls[0].id, "call_a");
        assert_eq!(turn.tool_calls[0].name, "read_project_file");
        assert_eq!(turn.tool_calls[0].arguments, json!({"path": "src/app.ts"}));
        assert_eq!(turn.tool_calls[1].name, "run_workdir_command");
        assert_eq!(turn.tool_calls[1].arguments, json!({"command": "npm run build"}));
        assert_eq!(turn.finish_reason, "tool_calls");
    }

    #[test]
    fn utf8_split_between_packets() {
        let mut acc = OpenAiStreamAccumulator::new();
        let line = "data: {\"choices\":[{\"delta\":{\"content\":\"é\"}}]}\n\n".as_bytes();
        let split = line.iter().position(|b| *b == 0xC3).unwrap() + 1;
        let mut out = acc.push_bytes(&line[..split]);
        out.extend(acc.push_bytes(&line[split..]));
        assert_eq!(out, vec!["é".to_string()]);
    }

    #[test]
    fn stream_error_is_reported() {
        let mut acc = OpenAiStreamAccumulator::new();
        acc.push_str("data: {\"error\":{\"message\":\"rate limit\"}}\n\n");
        assert_eq!(acc.error(), Some("rate limit"));
    }

    #[test]
    fn same_index_different_ids_are_two_calls() {
        let mut acc = OpenAiStreamAccumulator::new();
        acc.push_str("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"get_project\",\"arguments\":\"{}\"}}]}}]}\n");
        acc.push_str("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"b\",\"function\":{\"name\":\"list_projects\",\"arguments\":\"{}\"}}]}}]}\n");
        acc.push_str("data: [DONE]\n");
        let t = acc.finish();
        assert_eq!(t.tool_calls.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["get_project", "list_projects"]);
    }
}
