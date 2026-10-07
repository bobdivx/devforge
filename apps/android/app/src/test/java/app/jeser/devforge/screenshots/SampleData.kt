package app.jeser.devforge.screenshots

import app.jeser.devforge.data.Agent
import app.jeser.devforge.data.ContainerStatus
import app.jeser.devforge.data.DeployCard
import app.jeser.devforge.data.GitFile
import app.jeser.devforge.data.GitInfo
import app.jeser.devforge.data.GitSync
import app.jeser.devforge.data.GitWorkdir
import app.jeser.devforge.data.PreviewStatus
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.InboxEvent
import app.jeser.devforge.data.Me
import app.jeser.devforge.data.Project
import app.jeser.devforge.data.SpecFeature
import app.jeser.devforge.ui.apps.AppsUiState
import app.jeser.devforge.ui.project.ChatItem
import app.jeser.devforge.ui.project.ProjectUiState
import java.time.OffsetDateTime
import java.time.ZoneOffset

object SampleData {
    private fun ago(minutes: Long) = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(minutes).toString()

    val vigie = Project(
        uuid = "p-vigie", name = "Vigie", status = "live", productionUrl = "https://vigie.jeser.app",
        gitRepository = "https://github.com/bobdivx/Vigie", gitBranch = "main",
        deploy = DeployCard("success", "9b620d0", "Landing commerciale publique"), updatedAt = ago(42),
    )

    val projects = listOf(
        vigie,
        Project("p-shop", "Boutique de Léa", status = "failed", productionUrl = "https://boutique.jeser.app",
            gitRepository = "https://github.com/x/shop", deploy = DeployCard("failed", "abc1234", "Ajoute le paiement"), updatedAt = ago(12)),
        Project("p-tesla", "tesla", status = "deploying", productionUrl = "https://tesla.jeser.app",
            gitRepository = "https://github.com/x/tesla", deploy = DeployCard("running", "77aa001", "Nouveau tableau de bord"), updatedAt = ago(2)),
        Project("p-pop", "popcornn", status = "live", productionUrl = "https://client.popcornn.app",
            gitRepository = "https://github.com/x/pop", deploy = DeployCard("success", "ae471f0", "Merge pull request #41"), updatedAt = ago(60 * 20)),
        Project("p-studio", "template-studio", status = "stopped", productionUrl = "https://template-studio.jeser.app",
            gitRepository = "https://github.com/x/template-studio", updatedAt = ago(60 * 24 * 3)),
        Project("p-draft", "Carnet de recettes", status = "draft", updatedAt = ago(60 * 24)),
        Project("p-meteo", "Météo du jardin", status = "unhealthy", productionUrl = "https://meteo.jeser.app",
            gitRepository = "https://github.com/x/meteo", deploy = DeployCard("success", "1234567", "Graphiques"), updatedAt = ago(60 * 5)),
    )

    val inbox = listOf(
        InboxEvent("spec:p-vigie:001", "spec_waiting", "p-vigie", "Vigie", "Braise attend ton OK · Vigie",
            "« Page contact » est prête. Relis-la et approuve-la quand tu veux.", ago(5)),
        InboxEvent("deploy:d-9", "deploy_failed", "p-shop", "Boutique de Léa", "Mise en ligne échouée · Boutique de Léa",
            "npm ERR! missing script: build", ago(12)),
    )

    val apps = AppsUiState(projects = projects, inbox = inbox, me = Me("mathieu@jeser.app", "Mathieu"), loading = false)

    val deployments = listOf(
        Deployment("d-3", "failed", "abc1234ff", "Ajoute la page contact avec formulaire, carte et horaires d'ouverture", "npm ERR! missing script: build",
            "Ajoute un script « build » dans package.json.", ago(12)),
        Deployment("d-2", "success", "9b620d051d", "Landing commerciale publique", createdAt = ago(60 * 26)),
        Deployment("d-1", "success", "5e1f00aa", "Première version", createdAt = ago(60 * 24 * 6)),
    )

    val messages = listOf(
        ChatItem("m1", "user", "Est-ce que tout va bien ? Fais juste un bilan rapide, sans rien modifier.", ago(30)),
        ChatItem(
            "m2", "assistant",
            """
            Tout va bien côté **Vigie** 🔥

            - L'app répond sur https://vigie.jeser.app
            - Dernière mise en ligne : *hier*, réussie
            - Brouillon : 2 fichiers modifiés en local (`src/pages/contact.astro`, `styles.css`)

            Je n'ai rien touché.
            """.trimIndent(),
            ago(29),
        ),
        ChatItem("m3", "user", "Ajoute une page contact avec un formulaire simple.", ago(8)),
        ChatItem(
            "m4", "assistant",
            "J'ai écrit la spec **Page contact**. Relis-la : je ne construis rien avant ton accord. Un « oui » ici ne suffit pas, il faut le bouton **Approuver**.",
            ago(7),
        ),
    )

    val agents = listOf(
        Agent("a-1", "Coordinateur", "coordinator", status = "idle"),
        Agent("a-2", "Ops", "ops"), Agent("a-3", "Deploy", "deploy"),
        Agent("a-4", "Reviewer", "reviewer"),
        Agent("a-5", "Réparation", "custom", kind = "custom", triggerType = "event", triggerConfig = "{\"event\":\"deploy_fail\"}"),
    )

    val project = ProjectUiState(
        container = ContainerStatus("running", true, "Up 26 hours (healthy)"),
        checkedAt = ago(0),
        git = GitInfo(true, "main", "https://github.com/bobdivx/Vigie", GitSync("up_to_date", 0, 0, "9b620d0"),
            GitWorkdir(true, true, listOf(GitFile("M", "src/pages/contact.astro"), GitFile("M", "src/styles.css")))),
        agents = agents,
        specs = listOf(SpecFeature("001-contact", "Page contact", "awaiting_validation", updatedAt = ago(7))),
        preview = PreviewStatus("stopped", "https://dev-vigie.jeser.app"),
        uuid = "p-vigie",
        project = vigie,
        deployments = deployments,
        messages = messages,
        coordinatorUuid = "a-1",
        waitingSpecs = listOf(SpecFeature("001-contact", "Page contact", "awaiting_validation", updatedAt = ago(7))),
        loading = false,
    )
}
