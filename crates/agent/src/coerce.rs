//! Coercition des arguments d'outils selon leur schéma JSON (P1-03).
//! Les modèles envoient parfois `steps: "[a, b]"`, `force: "true"`, `timeout: "120"`.

use serde_json::Value;

/// Corrige en place les types des propriétés de premier niveau d'après `schema.properties`.
pub fn coerce_args(schema: &Value, args: &mut Value) {
    let Some(props) = schema.get("properties").and_then(|p| p.as_object()) else {
        return;
    };
    let Some(obj) = args.as_object_mut() else {
        return;
    };
    for (key, prop) in props {
        let Some(expected) = prop.get("type").and_then(|t| t.as_str()) else {
            continue;
        };
        let Some(current) = obj.get(key).cloned() else {
            continue;
        };
        if let Some(fixed) = coerce_value(expected, prop, &current) {
            obj.insert(key.clone(), fixed);
        }
    }
}

fn coerce_value(expected: &str, prop: &Value, v: &Value) -> Option<Value> {
    match (expected, v) {
        ("array", Value::String(s)) => Some(Value::Array(string_to_array(s, prop))),
        ("boolean", Value::String(s)) => match s.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "oui" => Some(Value::Bool(true)),
            "false" | "0" | "no" | "non" => Some(Value::Bool(false)),
            _ => None,
        },
        ("integer", Value::String(s)) => s.trim().parse::<i64>().ok().map(Value::from),
        ("integer", Value::Number(n)) if n.is_f64() => n.as_f64().map(|f| Value::from(f.round() as i64)),
        ("number", Value::String(s)) => s.trim().parse::<f64>().ok().and_then(|f| serde_json::Number::from_f64(f).map(Value::Number)),
        ("object", Value::String(s)) => match serde_json::from_str::<Value>(s.trim()) {
            Ok(Value::Object(m)) => Some(Value::Object(m)),
            _ => None,
        },
        ("string", Value::Number(n)) => Some(Value::String(n.to_string())),
        ("string", Value::Bool(b)) => Some(Value::String(b.to_string())),
        _ => None,
    }
}

fn string_to_array(s: &str, prop: &Value) -> Vec<Value> {
    let t = s.trim();
    if t.is_empty() {
        return vec![];
    }
    if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(t) {
        return arr;
    }
    let items: Vec<String> = if t.starts_with('[') && t.ends_with(']') {
        split_outside_quotes(&t[1..t.len() - 1], ',')
    } else if t.contains('\n') {
        t.lines().map(str::to_string).collect()
    } else if t.contains(';') {
        t.split(';').map(str::to_string).collect()
    } else if t.contains(',') && !prop_items_are_prose(prop) {
        split_outside_quotes(t, ',')
    } else {
        vec![t.to_string()]
    };
    let item_type = prop.pointer("/items/type").and_then(|v| v.as_str()).unwrap_or("string");
    items
        .into_iter()
        .map(|i| clean_item(&i))
        .filter(|i| !i.is_empty())
        .map(|i| match item_type {
            "integer" => i.parse::<i64>().map(Value::from).unwrap_or(Value::String(i)),
            _ => Value::String(i),
        })
        .collect()
}

/// Les étapes d'un plan sont des phrases : sans crochets, on ne coupe pas sur les virgules.
fn prop_items_are_prose(prop: &Value) -> bool {
    prop.get("description")
        .and_then(|d| d.as_str())
        .map(|d| {
            let d = d.to_lowercase();
            d.contains("étape") || d.contains("phrase")
        })
        .unwrap_or(false)
}

fn clean_item(s: &str) -> String {
    let t = s.trim();
    // Puces markdown / numérotation : « - a », « 1. a », « 2) a »
    let t = t.trim_start_matches(['-', '*', '•']).trim_start();
    let t = match t.find(|c: char| !c.is_ascii_digit()) {
        Some(i) if i > 0 && (t[i..].starts_with(". ") || t[i..].starts_with(") ")) => t[i + 2..].trim_start(),
        _ => t,
    };
    t.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_string()
}

fn split_outside_quotes(s: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '"' | '\'' if quote.is_none() && cur.trim().is_empty() => {
                quote = Some(c);
                cur.push(c);
            }
            c2 if Some(c2) == quote => {
                quote = None;
                cur.push(c2);
            }
            '(' | '[' | '{' if quote.is_none() => {
                depth += 1;
                cur.push(c);
            }
            ')' | ']' | '}' if quote.is_none() => {
                depth -= 1;
                cur.push(c);
            }
            c2 if c2 == sep && quote.is_none() && depth <= 0 => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

/// Aide pour les tests et la défense en profondeur.
pub fn coerce_with(schema: &Value, args: Value) -> Value {
    let mut a = args;
    coerce_args(schema, &mut a);
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "steps": {"type": "array", "items": {"type": "string"}, "description": "Étapes concrètes, dans l'ordre"},
                "force": {"type": "boolean"},
                "timeout": {"type": "integer"},
                "arguments": {"type": "object"}
            }
        })
    }

    #[test]
    fn real_failure_of_10_10_gives_five_steps() {
        let args = json!({
            "title": "Resynchroniser le lockfile",
            "steps": "[Lire le fichier package.json, Exécuter npm install dans le workdir, Vérifier que package-lock.json est à jour, Lancer la preview locale, Demander la validation pour pousser]"
        });
        let out = coerce_with(&plan_schema(), args);
        let steps = out["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 5, "{steps:?}");
        assert_eq!(steps[0], "Lire le fichier package.json");
        assert_eq!(steps[4], "Demander la validation pour pousser");
    }

    #[test]
    fn json_string_array() {
        let out = coerce_with(&plan_schema(), json!({"steps": "[\"a\",\"b\"]"}));
        assert_eq!(out["steps"], json!(["a", "b"]));
    }

    #[test]
    fn multiline_steps() {
        let out = coerce_with(&plan_schema(), json!({"steps": "1. Lire, vérifier\n2. Écrire\n- Tester"}));
        assert_eq!(out["steps"], json!(["Lire, vérifier", "Écrire", "Tester"]));
    }

    #[test]
    fn scalars() {
        let out = coerce_with(&plan_schema(), json!({"force": "true", "timeout": "120", "arguments": "{\"a\":1}"}));
        assert_eq!(out["force"], json!(true));
        assert_eq!(out["timeout"], json!(120));
        assert_eq!(out["arguments"], json!({"a": 1}));
    }

    #[test]
    fn untouched_when_already_typed() {
        let args = json!({"steps": ["x", "y"], "force": false, "timeout": 5, "title": "t", "extra": "keep"});
        let out = coerce_with(&plan_schema(), args.clone());
        assert_eq!(out, args);
    }
}
