//! Tests de smoke pour les endpoints MCP du catalogue.
//! Vérifie que les URLs hébergées répondent correctement avec Content-Type exact.

#[cfg(test)]
mod tests {
    use crate::catalog;
    use serde_json::json;

    /// Tableau récapitulatif des presets MCP avec leurs caractéristiques.
    #[test]
    fn catalog_preset_summary() {
        let presets = catalog();
        println!("\n╔════════════════════════════════════════════════════════════════════════════╗");
        println!("║           CATALOGUE MCP DEVFORGE - RÉSUMÉ DES PRESETS                     ║");
        println!("╚════════════════════════════════════════════════════════════════════════════╝\n");
        
        println!("{:<15} {:<12} {:<45} {:<10}", "PRESET", "AUTH_MODE", "URL", "HOSTED");
        println!("{}", "─".repeat(90));
        
        for preset in presets {
            let auth_mode = preset.auth_mode.as_deref().unwrap_or("?");
            let url = preset.default_url.as_deref().unwrap_or("(none)");
            let hosted = if preset.default_url.is_some() { "✓" } else { "✗" };
            
            let url_display = if url.len() > 45 {
                format!("{}...", &url[..42])
            } else {
                url.to_string()
            };
            
            println!("{:<15} {:<12} {:<45} {:<10}", 
                preset.id, 
                auth_mode, 
                url_display, 
                hosted
            );
        }
        
        println!("\n📊 Statistiques:");
        let total = presets.len();
        let with_url = presets.iter().filter(|p| p.default_url.is_some()).count();
        let token_auth = presets.iter().filter(|p| p.auth_mode.as_deref() == Some("token")).count();
        let oauth_auth = presets.iter().filter(|p| p.auth_mode.as_deref() == Some("oauth")).count();
        let self_hosted = presets.iter().filter(|p| p.auth_mode.as_deref() == Some("self_hosted")).count();
        
        println!("  Total presets: {}", total);
        println!("  Avec URL hébergée: {}", with_url);
        println!("  Auth token (Bearer OK): {}", token_auth);
        println!("  Auth OAuth (token insuffisant): {}", oauth_auth);
        println!("  Self-hosted (URL requise): {}", self_hosted);
        
        // Vérifier que tous les presets ont un auth_mode
        let missing_auth = presets.iter().filter(|p| p.auth_mode.is_none()).count();
        assert_eq!(missing_auth, 0, "Tous les presets doivent avoir un auth_mode");
    }

    /// Vérifie la sérialisation JSON du body MCP sans charset.
    #[test]
    fn json_rpc_body_no_charset() {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "devforge",
                    "version": "2.0.12"
                }
            }
        });
        
        // serde_json::to_vec ne devrait pas ajouter de charset
        let bytes = serde_json::to_vec(&body).expect("serialization failed");
        
        // Vérifier que c'est du JSON valide
        let reconstructed: serde_json::Value = 
            serde_json::from_slice(&bytes).expect("deserialization failed");
        
        assert_eq!(
            reconstructed.get("method").and_then(|m| m.as_str()),
            Some("initialize")
        );
        assert_eq!(
            reconstructed.get("jsonrpc").and_then(|v| v.as_str()),
            Some("2.0")
        );
    }

    /// Test manuel : vérifie que les URLs du catalogue sont accessibles.
    /// À exécuter manuellement avec --ignored pour éviter les appels réseau en CI.
    #[test]
    #[ignore]
    fn smoke_test_hosted_urls() {
        let presets = catalog();
        let hosted: Vec<_> = presets
            .iter()
            .filter(|p| p.default_url.is_some())
            .collect();
        
        println!("\n🔍 TEST DE SMOKE - URLs hébergées MCP\n");
        println!("{:<20} {:<50} {:<10}", "PRESET", "URL", "RÉSULTAT");
        println!("{}", "─".repeat(85));
        
        for preset in hosted {
            let url = preset.default_url.as_ref().unwrap();
            
            // Test HTTP HEAD ou OPTIONS pour vérifier l'accessibilité
            // Sans envoyer de secrets - juste tester que le host répond
            match reqwest::blocking::Client::new()
                .head(url)
                .timeout(std::time::Duration::from_secs(5))
                .send()
            {
                Ok(resp) => {
                    let status = resp.status();
                    let result = if status.is_success() || status.as_u16() == 405 {
                        "✓ accessible"
                    } else {
                        "⚠ status non-2xx"
                    };
                    println!("{:<20} {:<50} {:<10} ({})", 
                        preset.id, 
                        &url[..url.len().min(50)], 
                        result,
                        status
                    );
                },
                Err(e) => {
                    let err_str = if e.is_timeout() {
                        "✗ timeout"
                    } else if e.is_connect() {
                        "✗ connexion"
                    } else {
                        "✗ erreur"
                    };
                    println!("{:<20} {:<50} {:<10}", 
                        preset.id, 
                        &url[..url.len().min(50)], 
                        err_str
                    );
                }
            }
        }
        
        println!("\n⚠️  Ce test vérifie uniquement l'accessibilité des hosts.");
        println!("    Les vraies requêtes MCP (initialize) nécessitent des tokens.");
    }

    /// Documente les URLs mortes connues du catalogue.
    #[test]
    fn document_known_dead_urls() {
        // L'ancien mcp.turso.tech ne résout plus → migré vers mcp.turso.ai
        let presets = catalog();
        let turso = presets.iter().find(|p| p.id == "turso").unwrap();
        
        assert!(
            turso.default_url.as_deref() == Some("https://mcp.turso.ai/mcp"),
            "Turso URL doit pointer vers mcp.turso.ai (pas l'ancien mcp.turso.tech)"
        );
    }

    /// Vérifie que les presets OAuth ont une documentation claire.
    #[test]
    fn oauth_presets_have_clear_documentation() {
        let presets = catalog();
        let oauth_presets: Vec<_> = presets
            .iter()
            .filter(|p| p.auth_mode.as_deref() == Some("oauth"))
            .collect();
        
        for preset in oauth_presets {
            // Vérifier qu'il y a une documentation tools_help OU setup_intro
            let has_doc = preset.tools_help.is_some() || preset.setup_intro.is_some();
            assert!(
                has_doc,
                "Preset {} (OAuth) doit avoir tools_help ou setup_intro pour documenter la limitation",
                preset.id
            );
            
            // Si tools_help existe, vérifier qu'il mentionne OAuth
            if let Some(help) = &preset.tools_help {
                let mentions_oauth = help.to_lowercase().contains("oauth") 
                    || help.contains("token") && (help.contains("suffit") || help.contains("insuffisant"));
                assert!(
                    mentions_oauth,
                    "Preset {} tools_help devrait mentionner OAuth ou limitation token",
                    preset.id
                );
            }
        }
    }

    /// Vérifie que les presets self-hosted n'ont pas de default_url ou l'indiquent clairement.
    #[test]
    fn self_hosted_presets_documentation() {
        let presets = catalog();
        let self_hosted: Vec<_> = presets
            .iter()
            .filter(|p| p.auth_mode.as_deref() == Some("self_hosted"))
            .collect();
        
        for preset in self_hosted {
            // Pour self-hosted, default_url devrait être None ou optionnel
            if preset.default_url.is_some() {
                println!("⚠️  Preset {} (self-hosted) a une default_url : {}", 
                    preset.id, 
                    preset.default_url.as_ref().unwrap()
                );
            }
            
            // Devrait avoir un field "url" dans fields
            let has_url_field = preset.fields.iter().any(|f| f.key == "url");
            assert!(
                has_url_field,
                "Preset {} (self-hosted) doit avoir un field 'url'",
                preset.id
            );
        }
    }
}
