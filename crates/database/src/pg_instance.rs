//! Instance PostgreSQL applicative : un conteneur Docker par base, joignable
//! sur le réseau `devforge` depuis n'importe quel conteneur du même nœud.

use uuid::Uuid;

pub const PG_IMAGE: &str = "postgres:16-alpine";
pub const PG_NETWORK: &str = "devforge";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PgInstance {
    pub container: String,
    pub volume: String,
    pub user: String,
    pub password: String,
    pub database: String,
    pub network: String,
    pub image: String,
    /// Port hôte publié pour la réplication. 0 = pas publié.
    pub host_port: u16,
    pub replication_password: String,
}

impl PgInstance {
    /// Nouvelle instance. `name` sert de slug de base (lettres, chiffres).
    pub fn create(name: &str) -> Result<Self, String> {
        let slug = slug_db(name);
        let suffix = Uuid::new_v4().simple().to_string();
        let suffix = &suffix[..8];
        let container = format!("df-pg-{slug}-{suffix}");
        ensure_token(&container, "conteneur")?;
        let user = format!("u{suffix}");
        ensure_token(&user, "utilisateur")?;
        let database = slug.replace('-', "_");
        ensure_token(&database, "base")?;
        let password = format!(
            "{}{}",
            &Uuid::new_v4().simple().to_string()[..16],
            &Uuid::new_v4().simple().to_string()[..8]
        );
        ensure_token(&password, "mot de passe")?;
        let host_port = 25_000 + (u16::from_str_radix(&suffix[..4], 16).unwrap_or(1) % 15_000);
        let replication_password = Uuid::new_v4().simple().to_string()[..24].to_string();
        ensure_token(&replication_password, "réplication")?;
        Ok(Self {
            volume: container.clone(),
            container,
            user,
            password,
            database,
            network: PG_NETWORK.into(),
            image: PG_IMAGE.into(),
            host_port,
            replication_password,
        })
    }

    /// Reconstruit une instance déjà provisionnée (déplacement de nœud).
    pub fn resume(
        container: &str,
        volume: &str,
        user: &str,
        password: &str,
        database: &str,
    ) -> Result<Self, String> {
        ensure_token(container, "conteneur")?;
        ensure_token(volume, "volume")?;
        ensure_token(user, "utilisateur")?;
        ensure_token(password, "mot de passe")?;
        ensure_token(database, "base")?;
        Ok(Self {
            container: container.into(),
            volume: volume.into(),
            user: user.into(),
            password: password.into(),
            database: database.into(),
            network: PG_NETWORK.into(),
            image: PG_IMAGE.into(),
            host_port: 0,
            replication_password: String::new(),
        })
    }

    pub fn with_replication(mut self, host_port: u16, replication_password: &str) -> Result<Self, String> {
        if host_port != 0 && !(1024..=65535).contains(&host_port) {
            return Err("port postgres invalide".into());
        }
        if !replication_password.is_empty() {
            ensure_token(replication_password, "réplication")?;
        }
        self.host_port = host_port;
        self.replication_password = replication_password.into();
        Ok(self)
    }

    pub fn standby_container(&self) -> String {
        format!("{}-ha", self.container)
    }

    pub fn standby_volume(&self) -> String {
        format!("{}-ha", self.volume)
    }

    pub fn database_url(&self) -> String {
        format!(
            "postgres://{}:{}@{}:5432/{}",
            self.user, self.password, self.container, self.database
        )
    }

    fn check(&self) -> Result<(), String> {
        ensure_token(&self.container, "conteneur")?;
        ensure_token(&self.volume, "volume")?;
        ensure_token(&self.user, "utilisateur")?;
        ensure_token(&self.password, "mot de passe")?;
        ensure_token(&self.database, "base")?;
        ensure_token(&self.network, "réseau")?;
        if self.image != PG_IMAGE {
            return Err("image postgres inattendue".into());
        }
        if self.host_port != 0 && !(1024..=65535).contains(&self.host_port) {
            return Err("port postgres invalide".into());
        }
        if !self.replication_password.is_empty() {
            ensure_token(&self.replication_password, "réplication")?;
        }
        Ok(())
    }
}

/// Lettres, chiffres, tiret, underscore. Longueur bornée : le nom sert d'hôte Docker.
fn ensure_token(value: &str, what: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 63
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("{what} invalide"))
    }
}

fn slug_db(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if (c == '-' || c == '_' || c.is_whitespace())
            && !out.ends_with('-')
            && !out.is_empty()
        {
            out.push('-');
        }
        if out.len() >= 20 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "app".into()
    } else {
        out
    }
}

fn postgres_run_flags() -> &'static str {
    "postgres -c wal_level=replica -c hot_standby=on -c max_wal_senders=10 -c wal_keep_size=256MB -c wal_log_hints=on"
}

fn replication_sql(inst: &PgInstance) -> String {
    if inst.replication_password.is_empty() || inst.host_port == 0 {
        return String::new();
    }
    format!(
        r#"
docker exec -i {name} psql -U {user} -d {db} -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '{pw}';
  ELSE
    ALTER ROLE replicator WITH LOGIN REPLICATION PASSWORD '{pw}';
  END IF;
END $$;
SQL
docker exec {name} sh -c "grep -q 'host replication replicator all scram-sha-256' /var/lib/postgresql/data/pg_hba.conf || echo 'host replication replicator all scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec {name} psql -U {user} -d {db} -c "SELECT pg_reload_conf()"
"#,
        name = inst.container,
        user = inst.user,
        db = inst.database,
        pw = inst.replication_password,
    )
}

pub fn provision_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    let publish = if inst.host_port == 0 {
        String::new()
    } else {
        format!("-p 0.0.0.0:{}:5432 \\\n    ", inst.host_port)
    };
    Ok(format!(
        r#"set -eu
docker network inspect {net} >/dev/null 2>&1 || docker network create {net}
docker volume create {vol} >/dev/null
if docker inspect {name} >/dev/null 2>&1; then
  docker start {name} >/dev/null
else
  docker run -d --name {name} --restart unless-stopped \
    --network {net} --network-alias {name} \
    {publish}-v {vol}:/var/lib/postgresql/data \
    -e POSTGRES_USER={user} \
    -e POSTGRES_PASSWORD={password} \
    -e POSTGRES_DB={db} \
    {image} \
    {flags} >/dev/null
fi
{repl}
echo started {name}
"#,
        net = inst.network,
        vol = inst.volume,
        name = inst.container,
        publish = publish,
        user = inst.user,
        password = inst.password,
        db = inst.database,
        image = inst.image,
        flags = postgres_run_flags(),
        repl = replication_sql(inst),
    ))
}

/// Recrée le conteneur s'il n'écoute pas encore sur le port de réplication.
pub fn ensure_published_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    if inst.host_port == 0 || inst.replication_password.is_empty() {
        return Err("réplication non configurée".into());
    }
    Ok(format!(
        r#"set -eu
docker network inspect {net} >/dev/null 2>&1 || docker network create {net}
docker volume create {vol} >/dev/null
published=$(docker inspect -f '{{{{json .HostConfig.PortBindings}}}}' {name} 2>/dev/null || echo missing)
case "$published" in
  *{port}*) docker start {name} >/dev/null ;;
  *)
    docker rm -f {name} >/dev/null 2>&1 || true
    docker run -d --name {name} --restart unless-stopped \
      --network {net} --network-alias {name} \
      -p 0.0.0.0:{port}:5432 \
      -v {vol}:/var/lib/postgresql/data \
      -e POSTGRES_USER={user} \
      -e POSTGRES_PASSWORD={password} \
      -e POSTGRES_DB={db} \
      {image} \
      {flags} >/dev/null
    ;;
esac
i=0
while [ "$i" -lt 40 ]; do
  if docker exec {name} pg_isready -U {user} -d {db} >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
{repl}
echo published {name}
"#,
        net = inst.network,
        vol = inst.volume,
        name = inst.container,
        port = inst.host_port,
        user = inst.user,
        password = inst.password,
        db = inst.database,
        image = inst.image,
        flags = postgres_run_flags(),
        repl = replication_sql(inst),
    ))
}

pub fn ensure_host_token(host: &str) -> Result<(), String> {
    let ok = !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if ok {
        Ok(())
    } else {
        Err("hôte postgres invalide".into())
    }
}

/// Réplique physique sur CE nœud, alimentée par le primaire `upstream_host:host_port`.
pub fn standby_shell(inst: &PgInstance, upstream_host: &str) -> Result<String, String> {
    inst.check()?;
    ensure_host_token(upstream_host)?;
    if inst.host_port == 0 || inst.replication_password.is_empty() {
        return Err("réplication non configurée".into());
    }
    let ha = inst.standby_container();
    let vol = inst.standby_volume();
    ensure_token(&ha, "conteneur")?;
    ensure_token(&vol, "volume")?;
    Ok(format!(
        r#"set -eu
if docker exec {ha} psql -U {user} -d {db} -tAc "SELECT status FROM pg_stat_wal_receiver" 2>/dev/null | grep -q streaming; then
  echo streaming
  exit 0
fi
docker rm -f {ha} >/dev/null 2>&1 || true
docker volume rm {vol} >/dev/null 2>&1 || true
docker volume create {vol} >/dev/null
docker run --rm --user root -v {vol}:/var/lib/postgresql/data {image} \
  sh -c 'rm -rf /var/lib/postgresql/data/* /var/lib/postgresql/data/.[!.]*; chown postgres:postgres /var/lib/postgresql/data'
docker run --rm --user postgres --network host -e PGPASSWORD={rpw} -v {vol}:/var/lib/postgresql/data {image} \
  pg_basebackup -h {host} -p {port} -U replicator -D /var/lib/postgresql/data -Fp -Xs -R -c fast
docker network inspect {net} >/dev/null 2>&1 || docker network create {net}
docker run -d --name {ha} --restart unless-stopped --network {net} \
  -v {vol}:/var/lib/postgresql/data {image} >/dev/null
echo standby {ha}
"#,
        ha = ha,
        vol = vol,
        user = inst.user,
        db = inst.database,
        image = inst.image,
        rpw = inst.replication_password,
        host = upstream_host,
        port = inst.host_port,
        net = inst.network,
    ))
}

/// Promeut la réplique locale et la republie sous le nom canonique du conteneur.
pub fn promote_standby_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    if inst.host_port == 0 {
        return Err("port postgres manquant".into());
    }
    let ha = inst.standby_container();
    let vol = inst.standby_volume();
    Ok(format!(
        r#"set -eu
docker exec -u postgres {ha} pg_ctl promote -D /var/lib/postgresql/data
i=0
while [ "$i" -lt 30 ]; do
  rec=$(docker exec {ha} psql -U {user} -d {db} -tAc "SELECT pg_is_in_recovery()")
  if [ "$rec" = "f" ]; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
docker stop {ha}
docker rm {ha}
docker rm -f {name} >/dev/null 2>&1 || true
docker network inspect {net} >/dev/null 2>&1 || docker network create {net}
docker run -d --name {name} --restart unless-stopped \
  --network {net} --network-alias {name} \
  -p 0.0.0.0:{port}:5432 \
  -v {vol}:/var/lib/postgresql/data \
  {image} \
  {flags} >/dev/null
echo promoted {name}
"#,
        ha = ha,
        vol = vol,
        user = inst.user,
        db = inst.database,
        name = inst.container,
        net = inst.network,
        port = inst.host_port,
        image = inst.image,
        flags = postgres_run_flags(),
    ))
}

pub fn wait_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    Ok(format!(
        r#"set -eu
i=0
while [ "$i" -lt 40 ]; do
  if docker exec {name} pg_isready -U {user} -d {db} >/dev/null 2>&1; then
    echo ready
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "postgres {name} pas prêt" >&2
exit 1
"#,
        name = inst.container,
        user = inst.user,
        db = inst.database,
    ))
}

/// Envoie du SQL à `psql` dans le conteneur. Le délimiteur de heredoc est choisi
/// pour ne pas apparaître dans le script.
pub fn apply_sql_shell(inst: &PgInstance, sql: &str) -> Result<String, String> {
    inst.check()?;
    let mut tag = format!("DFSQL{}", inst.container.replace('-', ""));
    while sql.contains(&tag) {
        tag.push('x');
    }
    Ok(format!(
        "docker exec -i {name} psql -v ON_ERROR_STOP=1 -U {user} -d {db} <<'{tag}'\n{sql}\n{tag}\n",
        name = inst.container,
        user = inst.user,
        db = inst.database,
    ))
}

pub fn dump_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    Ok(format!(
        r#"set -eu
err=$(mktemp)
if ! docker exec {name} pg_dump -U {user} --no-owner --no-acl --clean --if-exists {db} 2>"$err"; then
  cat "$err" >&2
  rm -f "$err"
  exit 1
fi
rm -f "$err"
"#,
        name = inst.container,
        user = inst.user,
        db = inst.database,
    ))
}

pub fn drop_shell(inst: &PgInstance) -> Result<String, String> {
    inst.check()?;
    Ok(format!(
        r#"set -eu
docker rm -f {name} >/dev/null
docker volume rm {vol} >/dev/null
echo dropped {name}
"#,
        name = inst.container,
        vol = inst.volume,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_yields_a_docker_safe_instance() {
        let inst = PgInstance::create("App Démo").unwrap();
        assert!(inst.container.starts_with("df-pg-app-"));
        assert!(inst.database.starts_with("app"));
        assert!(inst.database_url().starts_with("postgres://"));
        assert!(inst.database_url().contains(&inst.container));
        assert!(inst.host_port >= 25_000);
        let sh = provision_shell(&inst).unwrap();
        assert!(sh.contains("--network devforge"));
        assert!(sh.contains("postgres:16-alpine"));
        assert!(sh.contains(&inst.password));
        assert!(sh.contains("replicator"));
        assert!(sh.contains(&inst.host_port.to_string()));
        assert!(wait_shell(&inst).unwrap().contains("pg_isready"));
        assert!(drop_shell(&inst).unwrap().contains("docker volume rm"));
        let published = ensure_published_shell(&inst).unwrap();
        assert!(published.contains("{{json .HostConfig.PortBindings}}"));
        assert!(standby_shell(&inst, "10.1.0.8").unwrap().contains("pg_basebackup"));
        assert!(standby_shell(&inst, "bad host").is_err());
    }

    #[test]
    fn apply_sql_picks_a_heredoc_tag_absent_from_the_script() {
        let inst = PgInstance::resume(
            "df-pg-app-abcd1234",
            "df-pg-app-abcd1234",
            "uabcd1234",
            "secretsecret",
            "app",
        )
        .unwrap();
        let tag = format!("DFSQL{}", inst.container.replace('-', ""));
        let sql = format!("SELECT '{tag}'");
        let sh = apply_sql_shell(&inst, &sql).unwrap();
        assert!(sh.contains(&format!("<<'{tag}x'")));
        assert!(sh.contains("ON_ERROR_STOP=1"));
    }

    #[test]
    fn resume_rejects_shell_metacharacters() {
        let err = PgInstance::resume("df-pg-app", "vol", "user", "bad pass", "app").unwrap_err();
        assert!(err.contains("mot de passe"));
    }
}
