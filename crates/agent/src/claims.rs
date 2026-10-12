//! Garde « affirmation sans outil » (P1-02) : une réponse qui dit « j'ai corrigé / déployé »
//! alors qu'aucun outil n'a tourné dans ce tour est renvoyée au modèle une fois.

use regex::Regex;
use std::sync::OnceLock;

fn claim_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:j'ai|j’ai|c'est|c’est|a été|ont été|est|sont|il a|elle a|on a)\s+(?:(?:bien|correctement|maintenant|entièrement|enfin)\s+)?(?:exécutée?s?|écrite?s?|modifiée?s?|corrigée?s?|déployée?s?|publiée?s?|poussée?s?|lancée?s?|créée?s?|mise?s? à jour|appliquée?s?|installée?s?|ajoutée?s?|supprimée?s?|réparée?s?|résolue?s?)\b|\b(?:c'est fait|c’est fait|c'est terminé|c’est terminé|est terminé|déployée? avec succès|est en ligne|sont en ligne|est maintenant en ligne)\b",
        )
        .expect("regex claims")
    })
}

fn previous_turn_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b(?:au tour précédent|tour précédent|précédemment|lors du précédent|au dernier tour|plus tôt|déjà fait|déjà été|déjà exécuté|déjà appliqué)")
            .expect("regex previous turn")
    })
}

/// La réponse affirme qu'une action a été faite (passé composé / résultat).
pub fn claims_action(reply: &str) -> bool {
    claim_re().is_match(reply)
}

/// La réponse renvoie explicitement à un tour précédent (pas une affirmation sur ce tour).
pub fn refers_to_previous_turn(reply: &str) -> bool {
    previous_turn_re().is_match(reply)
}

/// Affirmation à vérifier : action revendiquée, sans renvoi explicite au tour précédent.
pub fn unverified_claim(reply: &str) -> bool {
    claims_action(reply) && !refers_to_previous_turn(reply)
}

pub const CLAIM_NUDGE: &str = "Tu affirmes avoir agi mais tu n'as appelé aucun outil dans ce tour. Soit tu appelles maintenant les outils nécessaires, soit tu reformules en disant ce qui a été fait AU TOUR PRÉCÉDENT (avec la référence) ou ce qui reste à faire. N'invente rien.";

pub const UNVERIFIED_PREFIX: &str = "⚠️ Non vérifié dans ce tour : ";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_past_actions() {
        assert!(claims_action("J'ai exécuté le plan en local."));
        assert!(claims_action("Le plan a été exécuté en local"));
        assert!(claims_action("j’ai corrigé le header"));
        assert!(claims_action("Les fichiers ont été modifiés"));
        assert!(claims_action("C'est fait !"));
        assert!(claims_action("Le site est en ligne."));
        assert!(claims_action("Déployé avec succès"));
        assert!(claims_action("J'ai bien mis à jour la page"));
    }

    #[test]
    fn ignores_future_and_questions() {
        assert!(!claims_action("Je vais exécuter le plan."));
        assert!(!claims_action("Veux-tu que je déploie ?"));
        assert!(!claims_action("Prochaine étape : corriger le header."));
        assert!(!claims_action(
            "Le build échoue sur src/index.astro ligne 12."
        ));
        assert!(!claims_action(
            "Pour mettre en ligne, valide la publication."
        ));
    }

    #[test]
    fn previous_turn_reference_is_not_a_fresh_claim() {
        assert!(!unverified_claim(
            "C'est déjà fait au tour précédent (fichiers index.astro, preview OK)."
        ));
        assert!(unverified_claim("J'ai exécuté le plan."));
    }
}
