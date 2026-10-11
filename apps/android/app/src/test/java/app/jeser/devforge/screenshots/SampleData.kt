package app.jeser.devforge.screenshots

import app.jeser.devforge.data.Agent
import app.jeser.devforge.data.ContainerStatus
import app.jeser.devforge.data.DeployCard
import app.jeser.devforge.data.GitFile
import app.jeser.devforge.data.AndroidInfo
import app.jeser.devforge.data.Conversation
import app.jeser.devforge.data.GitCommit
import app.jeser.devforge.data.GitInfo
import app.jeser.devforge.ui.hub.HubUiState
import app.jeser.devforge.data.GitSync
import app.jeser.devforge.data.GitWorkdir
import app.jeser.devforge.data.PreviewStatus
import app.jeser.devforge.data.Deployment
import app.jeser.devforge.data.DraftBackup
import app.jeser.devforge.data.DraftDiffFile
import app.jeser.devforge.data.DraftFile
import app.jeser.devforge.data.DraftPreview
import app.jeser.devforge.data.DraftStatus
import app.jeser.devforge.data.DraftSummary
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

    /** App en ligne et à jour : pas de bouton principal, « Reconstruire » dans « Plus ». */
    val projectUpToDate = project.copy(deployments = deployments.drop(1))

    /** Changements sur GitHub pas encore en ligne → « Publier les changements ». */
    val projectPending = projectUpToDate.copy(
        git = project.git!!.copy(
            sync = GitSync(
                "behind", 3, 0, "9b620d0", headSha = "c0ffee1",
                commits = listOf(
                    GitCommit("a1b2c3d4", "Corrige le pied de page"),
                    GitCommit("b2c3d4e5", "Ajoute la page tarifs"),
                    GitCommit("c0ffee12", "Page contact avec formulaire"),
                ),
            ),
        ),
    )

    /** Brouillon local de 3 fichiers (pas encore sur GitHub). */
    val draft = DraftStatus(
        available = true, dirty = true, count = 3, branch = "main", hasRemote = true,
        files = listOf(
            DraftFile("src/pages/contact.astro", "added"),
            DraftFile("src/components/Footer.astro", "modified"),
            DraftFile("public/old-banner.png", "deleted"),
        ),
        junkCount = 2, updatedAt = ago(42), suggestedMessage = "feat: met à jour contact.astro, Footer.astro, old-banner.png",
        preview = DraftPreview(true, "https://vigie-preview.jeser.app"),
        backups = listOf(DraftBackup("20261007T120000Z", ago(60 * 5), "discard", listOf("src/old.ts"), emptyList())),
    )
    val draftDiff = listOf(
        DraftDiffFile(
            "src/pages/contact.astro", "added", additions = 9,
            patch = "@@ -0,0 +1,9 @@\n+---\n+import Layout from '../layouts/Layout.astro';\n+---\n+<Layout title=\"Contact\">\n+  <h1>Écris-nous</h1>\n+  <form method=\"post\" action=\"/api/contact\" class=\"grid gap-3 max-w-md\">\n+    <input name=\"email\" type=\"email\" required placeholder=\"ton@email.fr\" />\n+  </form>\n+</Layout>",
        ),
        DraftDiffFile(
            "src/components/Footer.astro", "modified", additions = 2, deletions = 1,
            patch = "@@ -4,7 +4,8 @@\n <footer class=\"py-8 text-sm text-zinc-400\">\n-  <p>© 2025 Vigie</p>\n+  <p>© 2026 Vigie · <a href=\"/contact\">Contact</a></p>\n+  <p class=\"mt-1\">Fait avec soin à Paris, hébergé sur notre propre serveur.</p>\n </footer>",
        ),
        DraftDiffFile("public/old-banner.png", "deleted"),
    )
    val projectDraft = projectUpToDate.copy(draft = draft, draftDiff = draftDiff)

    val hub = HubUiState(
        conversations = listOf(
            Conversation("p-vigie", "Vigie", "vigie.jeser.app", lastRole = "assistant",
                excerpt = "J'ai écrit la spec Page contact. Relis-la : je ne construis rien avant ton accord.",
                createdAt = ago(7), waiting = "spec", specTitle = "Page contact"),
            Conversation("p-shop", "Boutique de Léa", "boutique-lea.fr", lastRole = "assistant",
                excerpt = "Je peux garder le bleu actuel ou passer au vert sauge. Tu préfères lequel ?",
                createdAt = ago(40), waiting = "question"),
            Conversation("p-tesla", "tesla", "teslasphere.app", lastRole = "user",
                excerpt = "Ajoute un mode sombre sur le tableau de bord", createdAt = ago(90), working = true),
            Conversation("p-pop", "popcornn", "client.popcornn.app", lastRole = "assistant",
                excerpt = "Tout va bien côté popcornn 🔥 L'app répond, dernière mise en ligne réussie hier.", createdAt = ago(60 * 26)),
        ),
        conversationsLoading = false,
        drafts = listOf(
            DraftSummary("p-vigie", "Vigie", "vigie.jeser.app", count = 3, updatedAt = ago(42)),
            DraftSummary("p-tesla", "tesla", "teslasphere.app", count = 1, behind = 2, updatedAt = ago(60 * 30)),
        ),
        alerts = inbox + listOf(
            InboxEvent("deploy:old", "deploy_failed", "p-pop", "popcornn", "Mise en ligne échouée · popcornn",
                "npm ERR! missing script: build", ago(60 * 30)),
        ),
        alertsLoading = false,
        android = AndroidInfo(true, "2.0.200", "/api/v1/android/apk", 2_036_919),
        appVersion = "2.0.199",
        instance = "https://web.jeser.app",
    )

    val branchesDev = app.jeser.devforge.data.ProjectBranches(
        production = app.jeser.devforge.data.ProdBranch("main", "https://template-studio.jeser.app"),
        dev = app.jeser.devforge.data.DevBranch(
            enabled = true,
            branch = "devforge-dev-test",
            url = "https://dev-template-studio.jeser.app",
            lastDeployment = Deployment("d-dev", "success", gitSha = "4f2a9c1", environment = "dev"),
        ),
        autoDeploy = true,
    )
    val branchesOff = app.jeser.devforge.data.ProjectBranches(
        production = app.jeser.devforge.data.ProdBranch("main", "https://vigie.jeser.app"),
        dev = app.jeser.devforge.data.DevBranch(enabled = false, url = "https://dev-vigie.jeser.app"),
    )

    /* Mémoire (écran natif Réglages → Mémoire). */
    private fun inDays(d: Long) = OffsetDateTime.now(ZoneOffset.UTC).plusDays(d).toString()
    val memoryProfile = listOf(
        app.jeser.devforge.data.MemoryItem("mem-1", "user", tier = "profile", kind = "preference", content = "Réponds-moi en français, de façon courte et concrète.", source = "user_said", pinned = true, createdBy = "user", updatedAt = ago(60 * 26)),
        app.jeser.devforge.data.MemoryItem("mem-2", "user", tier = "profile", kind = "infra", content = "Le NAS ZimaOS héberge les apps ; le GPU est partagé avec Ollama (file d'attente).", source = "agent_inferred", inferred = true, createdBy = "agent:a-1", createdByName = "Braise", updatedAt = ago(60 * 3)),
        app.jeser.devforge.data.MemoryItem("mem-3", "project", projectName = "Vigie", tier = "profile", kind = "fact", content = "Vigie utilise Astro 5 et Tailwind 4 ; le build sort dans dist/.", source = "user_said", createdBy = "agent:a-1", createdByName = "Braise", updatedAt = ago(40)),
    )
    val memory = app.jeser.devforge.ui.memory.MemoryUiState(
        items = memoryProfile,
        budget = app.jeser.devforge.data.MemoryBudget(used = 1180, max = 1500),
        loading = false,
    )
    val memoryNotes = app.jeser.devforge.ui.memory.MemoryUiState(
        tab = app.jeser.devforge.ui.memory.MemoryTab.Note,
        items = listOf(
            app.jeser.devforge.data.MemoryItem("mem-9", "agent", agentName = "Braise", tier = "note", kind = "context", content = "Déjà tenté : npm ci échoue tant que package-lock n'est pas resynchronisé.", source = "agent_inferred", createdBy = "agent:a-1", createdByName = "Braise", updatedAt = ago(20), expiresAt = inDays(3)),
        ),
        loading = false,
    )

    /* Cartes de job dans Braise (P4). */
    val projectJobs = project.copy(
        messages = messages.take(3) + ChatItem(
            "m5", "assistant", "C'est lancé en arrière-plan : je te préviens à la fin. Tu peux continuer à me parler.", ago(5),
            jobs = listOf(
                app.jeser.devforge.data.JobInfo("run-1", "worker", "Refonte de la page d'accueil", "running",
                    milestones = listOf(app.jeser.devforge.data.RunMilestone("Lecture du code", "done"), app.jeser.devforge.data.RunMilestone("Modifications", "running"))),
            ),
        ) + ChatItem(
            "m6", "assistant", "Worker « Page contact » terminé : formulaire ajouté, build OK.", ago(1),
            jobs = listOf(app.jeser.devforge.data.JobInfo("run-0", "worker", "Page contact", "done", "Formulaire ajouté, build OK.", files = 3)),
        ),
    )

    /* Chat riche (P5) : question ask_user, réactions, image jointe, réponse « ✓ ». */
    val richQuestion = app.jeser.devforge.data.QuestionInfo(
        "Je pousse le correctif lockfile sur fix/lockfile ?",
        listOf(
            app.jeser.devforge.data.QuestionOption("yes", "Oui, publier", action = "approve_publish", style = "primary"),
            app.jeser.devforge.data.QuestionOption("no", "Non, garder en local"),
        ),
    )
    val projectRich = project.copy(
        messages = listOf(
            ChatItem("r1", "user", "Le bouton est décalé sur mobile, regarde :", ago(12), uuid = "u-1",
                attachments = listOf(app.jeser.devforge.data.AttachmentInfo("a".repeat(64), name = "capture.png", mime = "image/png", width = 1080, height = 1920))),
            ChatItem("r2", "assistant", "Corrigé en local : le bouton garde sa marge sur 360 px. Build OK.", ago(10), uuid = "a-1",
                reactions = listOf(app.jeser.devforge.data.ReactionInfo("👍", 1, true), app.jeser.devforge.data.ReactionInfo("🎉", 2, false))),
            ChatItem("r3", "assistant", "Je pousse le correctif lockfile sur fix/lockfile ?", ago(2), uuid = "a-2", question = richQuestion),
        ),
    )
    val projectRichAnswered = projectRich.copy(
        messages = projectRich.messages + ChatItem("r4", "user", "Réponse à ta question « Je pousse le correctif lockfile sur fix/lockfile ? » : Non, garder en local", ago(1), uuid = "u-2",
            answer = app.jeser.devforge.data.AnswerInfo("a-2", "no", "Non, garder en local")),
    )
}
