//! SSH tunnels for connections that sit behind a bastion / jump host.
//!
//! A tunnel is a local TCP listener on `127.0.0.1:<random port>`; every socket
//! accepted there is forwarded to the target MongoDB host through an SSH
//! `direct-tcpip` channel (the same thing `ssh -L` does). The driver then
//! connects to the local port with `directConnection=true`.
//!
//! With a jump host (`ssh -J`), Ognom first connects to the jump host, opens
//! a `direct-tcpip` channel from there to the SSH server, and runs the SSH
//! session to the server inside that channel. The MongoDB host is then
//! resolved by the SSH server, so `127.0.0.1` reaches a mongod that only
//! listens locally on it.
//!
//! Host keys: the server key must match `~/.ssh/known_hosts` when the host is
//! listed there. Unknown hosts are trusted on first use and remembered in
//! Ognom's own `known_hosts` file (we never write to the user's ~/.ssh). A
//! changed key is always a hard error. Each hop is checked on its own.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);

/// "user@host:port" for display, leaving out an empty user and port 22.
fn hop_summary(user: &str, host: &str, port: u16) -> String {
    let (user, host) = (user.trim(), host.trim());
    match (user.is_empty(), port == 22) {
        (true, true) => host.to_string(),
        (true, false) => format!("{host}:{port}"),
        (false, true) => format!("{user}@{host}"),
        (false, false) => format!("{user}@{host}:{port}"),
    }
}

/// One SSH server on the way to MongoDB. The password (or the private key's
/// passphrase) is stored encrypted next to the profile, never here.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct SshHop {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    /// "password" | "key" | "agent"
    pub auth: String,
    /// Private key file for `auth = "key"`.
    pub key_path: Option<String>,
}

impl SshHop {
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    pub fn summary(&self) -> String {
        hop_summary(&self.username, &self.host, self.port())
    }

    /// Whether this hop authenticates with a stored password / passphrase.
    pub fn uses_secret(&self) -> bool {
        self.auth != "agent"
    }

    /// `what` names the hop in messages: "SSH tunnel" or "jump host".
    fn validate(&self, what: &str) -> AppResult<()> {
        let fail = |msg: String| Err(AppError::Other(msg));
        if self.host.trim().is_empty() {
            return fail(format!("enter the {what} address"));
        }
        if self.username.trim().is_empty() {
            return fail(format!("{what} username is required"));
        }
        match self.auth.as_str() {
            "password" | "agent" => Ok(()),
            "key" if self.key_path.as_deref().map(str::trim).unwrap_or("").is_empty() => {
                fail(format!("choose a private key file for the {what}"))
            }
            "key" => Ok(()),
            other => fail(format!("unknown {what} auth method '{other}'")),
        }
    }
}

/// Non-secret SSH settings saved with a profile. The password (or the private
/// key's passphrase) is stored encrypted next to it, never here.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    /// "password" | "key" | "agent"
    pub auth: String,
    /// Private key file for `auth = "key"`.
    pub key_path: Option<String>,
    /// Optional jump host (`ssh -J`): Ognom connects to it first and reaches
    /// `host` through it, so `host` only has to be reachable from the jump host.
    pub jump: Option<SshHop>,
}

impl SshConfig {
    pub fn is_active(&self) -> bool {
        self.enabled && !self.host.trim().is_empty()
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    /// The SSH server the MongoDB traffic leaves from, as a hop.
    pub fn server(&self) -> SshHop {
        SshHop {
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            auth: self.auth.clone(),
            key_path: self.key_path.clone(),
        }
    }

    /// The jump host, when the tunnel is active and has one.
    pub fn active_jump(&self) -> Option<&SshHop> {
        self.jump.as_ref().filter(|_| self.is_active())
    }

    /// "user@server" or "user@server (jump user@bastion)" for display.
    pub fn summary(&self) -> String {
        let server = hop_summary(&self.username, &self.host, self.port());
        match &self.jump {
            Some(jump) => format!("{server} (jump {})", jump.summary()),
            None => server,
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        if !self.is_active() {
            return Ok(());
        }
        self.server().validate("SSH tunnel")?;
        if let Some(jump) = &self.jump {
            jump.validate("jump host")?;
        }
        Ok(())
    }
}

/// Decrypted SSH passwords / key passphrases for one tunnel.
#[derive(Clone, Default)]
pub struct SshSecrets {
    /// For the SSH server (`SshConfig::host`).
    pub server: Option<String>,
    /// For the jump host, when there is one.
    pub jump: Option<String>,
}

type Session = client::Handle<HostKeyCheck>;

/// A running tunnel. Dropping it stops accepting new sockets; sockets already
/// forwarded close with the driver's connections.
pub struct Tunnel {
    pub local_port: u16,
    accept_task: tokio::task::JoinHandle<()>,
    /// The session to the jump host, if any. The forwarding session runs
    /// inside one of its channels, so it lives as long as the tunnel.
    _jump: Option<Session>,
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

struct HostKeyCheck {
    host: String,
    port: u16,
    ognom_known_hosts: PathBuf,
    /// Set when the key is rejected, so the error can say why.
    rejected: Arc<std::sync::Mutex<Option<String>>>,
}

impl client::Handler for HostKeyCheck {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let owned: PublicKey = match server {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(cert) => PublicKey::from(cert.public_key().clone()),
        };
        let key = &owned;
        let reject = |why: String| {
            *self.rejected.lock().unwrap() = Some(why);
            Ok(false)
        };
        // The user's own known_hosts wins when it lists this host.
        match keys::check_known_hosts(&self.host, self.port, key) {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(keys::Error::KeyChanged { line }) => {
                return reject(format!(
                    "the SSH host key for {} changed (~/.ssh/known_hosts line {line}) - refusing to connect",
                    self.host
                ))
            }
            // No ~/.ssh or unreadable file: fall through to Ognom's own list.
            Err(_) => {}
        }
        match keys::check_known_hosts_path(&self.host, self.port, key, &self.ognom_known_hosts) {
            Ok(true) => Ok(true),
            Err(keys::Error::KeyChanged { .. }) => reject(format!(
                "the SSH host key for {} changed since Ognom first connected - refusing to connect",
                self.host
            )),
            // Unknown host: trust on first use and remember it.
            _ => {
                let _ = keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    key,
                    &self.ognom_known_hosts,
                );
                Ok(true)
            }
        }
    }
}

fn ssh_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("SSH: {e}"))
}

/// Connect + authenticate to the SSH server (through the jump host, when there
/// is one), then start forwarding a local port to `target_host:target_port`
/// as seen from the SSH server.
pub async fn open(
    cfg: &SshConfig,
    secrets: &SshSecrets,
    target_host: &str,
    target_port: u16,
    data_dir: &Path,
) -> AppResult<Tunnel> {
    cfg.validate()?;
    let known_hosts = data_dir.join("known_hosts");
    let server = cfg.server();
    let server_addr = format!("{}:{}", server.host.trim(), server.port());

    let (jump_session, session) = match cfg.active_jump() {
        None => {
            let secret = secrets.server.as_deref();
            let session = open_session(&server, secret, &known_hosts, &server_addr, |config, handler| {
                client::connect(config, (server.host.trim(), server.port()), handler)
            })
            .await?;
            (None, session)
        }
        Some(jump) => {
            let jump_addr = format!("{}:{}", jump.host.trim(), jump.port());
            let secret = secrets.jump.as_deref();
            let jump_session = open_session(jump, secret, &known_hosts, &jump_addr, |config, handler| {
                client::connect(config, (jump.host.trim(), jump.port()), handler)
            })
            .await?;
            // A TCP stream from the jump host to the SSH server; the second
            // SSH session runs inside it, exactly like `ssh -J`.
            let opening = jump_session.channel_open_direct_tcpip(
                server.host.trim(),
                u32::from(server.port()),
                "127.0.0.1",
                0,
            );
            let channel = match tokio::time::timeout(CONNECT_TIMEOUT, opening).await {
                Err(_) => {
                    return Err(ssh_err(format!(
                        "timed out while the jump host {} was connecting to {server_addr}",
                        jump.summary()
                    )))
                }
                Ok(Err(e)) => {
                    return Err(ssh_err(format!(
                        "the jump host {} could not reach {server_addr} - {e}",
                        jump.summary()
                    )))
                }
                Ok(Ok(c)) => c,
            };
            let stream = channel.into_stream();
            let label = format!("{server_addr} through the jump host");
            let secret = secrets.server.as_deref();
            let session = open_session(&server, secret, &known_hosts, &label, move |config, handler| {
                client::connect_stream(config, stream, handler)
            })
            .await?;
            (Some(jump_session), session)
        }
    };

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_port = listener.local_addr()?.port();
    let session = Arc::new(session);
    let target_host = target_host.to_string();

    let accept_task = tokio::spawn(async move {
        loop {
            let Ok((mut socket, origin)) = listener.accept().await else { break };
            let session = session.clone();
            let target_host = target_host.clone();
            tokio::spawn(async move {
                let _ = socket.set_nodelay(true);
                let channel = match session
                    .channel_open_direct_tcpip(
                        target_host,
                        u32::from(target_port),
                        origin.ip().to_string(),
                        u32::from(origin.port()),
                    )
                    .await
                {
                    Ok(c) => c,
                    Err(_) => return, // the driver sees a closed socket and reports it
                };
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }
    });

    Ok(Tunnel { local_port, accept_task, _jump: jump_session })
}

/// SSH handshake (via `connect`, over TCP or over a jump-host channel), host
/// key check, then authentication for one hop. `addr` names the hop in errors.
async fn open_session<F, Fut>(
    hop: &SshHop,
    secret: Option<&str>,
    known_hosts: &Path,
    addr: &str,
    connect: F,
) -> AppResult<Session>
where
    F: FnOnce(Arc<client::Config>, HostKeyCheck) -> Fut,
    Fut: Future<Output = Result<Session, russh::Error>>,
{
    let host = hop.host.trim().to_string();
    let user = hop.username.trim().to_string();

    let rejected = Arc::new(std::sync::Mutex::new(None));
    let handler = HostKeyCheck {
        host: host.clone(),
        port: hop.port(),
        ognom_known_hosts: known_hosts.to_path_buf(),
        rejected: rejected.clone(),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        nodelay: true,
        ..Default::default()
    });

    let mut session = match tokio::time::timeout(CONNECT_TIMEOUT, connect(config, handler)).await {
        Err(_) => return Err(ssh_err(format!("timed out connecting to {addr}"))),
        Ok(Err(e)) => {
            if let Some(why) = rejected.lock().unwrap().take() {
                return Err(ssh_err(why));
            }
            return Err(ssh_err(format!("could not connect to {addr} - {e}")));
        }
        Ok(Ok(s)) => s,
    };

    let ok = match hop.auth.as_str() {
        "password" => session
            .authenticate_password(&user, secret.unwrap_or(""))
            .await
            .map_err(ssh_err)?
            .success(),
        "key" => {
            let path = expand_home(hop.key_path.as_deref().unwrap_or("").trim());
            let key = keys::load_secret_key(&path, secret.filter(|s| !s.is_empty())).map_err(|e| {
                ssh_err(format!("could not read the private key {}: {e}", path.display()))
            })?;
            let hash = session.best_supported_rsa_hash().await.map_err(ssh_err)?.flatten();
            session
                .authenticate_publickey(&user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(ssh_err)?
                .success()
        }
        "agent" => authenticate_with_agent(&mut session, &user).await?,
        other => return Err(ssh_err(format!("unknown auth method '{other}'"))),
    };
    if !ok {
        return Err(ssh_err(format!("authentication failed for {user}@{host}")));
    }
    Ok(session)
}

async fn authenticate_with_agent<H: client::Handler>(
    session: &mut client::Handle<H>,
    user: &str,
) -> AppResult<bool> {
    #[cfg(unix)]
    let mut agent = keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| ssh_err(format!("no SSH agent available ({e}) - is SSH_AUTH_SOCK set?")))?;
    #[cfg(windows)]
    let mut agent = keys::agent::client::AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .map_err(|e| ssh_err(format!("no SSH agent available ({e})")))?;

    let identities = agent.request_identities().await.map_err(ssh_err)?;
    if identities.is_empty() {
        return Err(ssh_err("the SSH agent has no keys loaded (ssh-add)"));
    }
    let hash = session.best_supported_rsa_hash().await.map_err(ssh_err)?.flatten();
    for identity in identities {
        let key = identity.public_key().into_owned();
        let res = session
            .authenticate_publickey_with(user, key, hash, &mut agent)
            .await
            .map_err(ssh_err)?;
        if res.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_formats() {
        let mut c = SshConfig { enabled: true, host: "bastion".into(), username: "ops".into(), ..Default::default() };
        assert_eq!(c.summary(), "ops@bastion");
        c.port = Some(2222);
        assert_eq!(c.summary(), "ops@bastion:2222");
    }

    #[test]
    fn validate_requires_key_path() {
        let c = SshConfig {
            enabled: true,
            host: "b".into(),
            username: "u".into(),
            auth: "key".into(),
            ..Default::default()
        };
        assert!(c.validate().is_err());
        assert!(SshConfig::default().validate().is_ok());
    }

    fn with_jump(jump: SshHop) -> SshConfig {
        SshConfig {
            enabled: true,
            host: "10.0.1.5".into(),
            username: "app".into(),
            auth: "agent".into(),
            jump: Some(jump),
            ..Default::default()
        }
    }

    #[test]
    fn summary_names_the_jump_host() {
        let c = with_jump(SshHop { host: "bastion".into(), username: "ops".into(), port: Some(2222), ..Default::default() });
        assert_eq!(c.summary(), "app@10.0.1.5 (jump ops@bastion:2222)");
    }

    #[test]
    fn validate_checks_the_jump_host() {
        let ok = SshHop { host: "bastion".into(), username: "ops".into(), auth: "agent".into(), ..Default::default() };
        assert!(with_jump(ok.clone()).validate().is_ok());
        assert!(with_jump(SshHop { host: " ".into(), ..ok.clone() }).validate().is_err());
        assert!(with_jump(SshHop { username: "".into(), ..ok.clone() }).validate().is_err());
        assert!(with_jump(SshHop { auth: "key".into(), key_path: None, ..ok }).validate().is_err());
    }

    #[test]
    fn jump_is_ignored_while_the_tunnel_is_off() {
        let mut c = with_jump(SshHop::default());
        c.enabled = false;
        assert!(c.validate().is_ok());
        assert!(c.active_jump().is_none());
    }

    #[test]
    fn profiles_saved_before_jump_hosts_still_load() {
        let old = r#"{"enabled":true,"host":"b","port":22,"username":"u","auth":"agent","keyPath":null}"#;
        let c: SshConfig = serde_json::from_str(old).unwrap();
        assert!(c.jump.is_none());
        let off: SshConfig = serde_json::from_str(r#"{"enabled":true,"host":"b","jump":null}"#).unwrap();
        assert!(off.jump.is_none());
    }
}
