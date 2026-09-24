//! SSH tunnels for connections that sit behind a bastion / jump host.
//!
//! A tunnel is a local TCP listener on `127.0.0.1:<random port>`; every socket
//! accepted there is forwarded to the target MongoDB host through an SSH
//! `direct-tcpip` channel (the same thing `ssh -L` does). The driver then
//! connects to the local port with `directConnection=true`.
//!
//! Host keys: the server key must match `~/.ssh/known_hosts` when the host is
//! listed there. Unknown hosts are trusted on first use and remembered in
//! Ognom's own `known_hosts` file (we never write to the user's ~/.ssh). A
//! changed key is always a hard error.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);

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
}

impl SshConfig {
    pub fn is_active(&self) -> bool {
        self.enabled && !self.host.trim().is_empty()
    }

    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    /// "user@bastion:22" for display.
    pub fn summary(&self) -> String {
        let user = self.username.trim();
        let host = self.host.trim();
        let port = self.port();
        match (user.is_empty(), port == 22) {
            (true, true) => host.to_string(),
            (true, false) => format!("{host}:{port}"),
            (false, true) => format!("{user}@{host}"),
            (false, false) => format!("{user}@{host}:{port}"),
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        if !self.is_active() {
            return Ok(());
        }
        if self.username.trim().is_empty() {
            return Err(AppError::Other("SSH username is required".into()));
        }
        match self.auth.as_str() {
            "password" | "agent" => Ok(()),
            "key" if self.key_path.as_deref().map(str::trim).unwrap_or("").is_empty() => {
                Err(AppError::Other("choose a private key file for the SSH tunnel".into()))
            }
            "key" => Ok(()),
            other => Err(AppError::Other(format!("unknown SSH auth method '{other}'"))),
        }
    }
}

/// A running tunnel. Dropping it stops accepting new sockets; sockets already
/// forwarded close with the driver's connections.
pub struct Tunnel {
    pub local_port: u16,
    accept_task: tokio::task::JoinHandle<()>,
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

/// Connect + authenticate to the bastion, then start forwarding a local port
/// to `target_host:target_port` (as seen from the bastion).
pub async fn open(
    cfg: &SshConfig,
    secret: Option<&str>,
    target_host: &str,
    target_port: u16,
    data_dir: &std::path::Path,
) -> AppResult<Tunnel> {
    cfg.validate()?;
    let host = cfg.host.trim().to_string();
    let port = cfg.port();
    let user = cfg.username.trim().to_string();

    let rejected = Arc::new(std::sync::Mutex::new(None));
    let handler = HostKeyCheck {
        host: host.clone(),
        port,
        ognom_known_hosts: data_dir.join("known_hosts"),
        rejected: rejected.clone(),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        nodelay: true,
        ..Default::default()
    });

    let connecting = client::connect(config, (host.as_str(), port), handler);
    let mut session = match tokio::time::timeout(CONNECT_TIMEOUT, connecting).await {
        Err(_) => return Err(ssh_err(format!("timed out connecting to {host}:{port}"))),
        Ok(Err(e)) => {
            if let Some(why) = rejected.lock().unwrap().take() {
                return Err(ssh_err(why));
            }
            return Err(ssh_err(format!("could not connect to {host}:{port} - {e}")));
        }
        Ok(Ok(s)) => s,
    };

    let ok = match cfg.auth.as_str() {
        "password" => session
            .authenticate_password(&user, secret.unwrap_or(""))
            .await
            .map_err(ssh_err)?
            .success(),
        "key" => {
            let path = expand_home(cfg.key_path.as_deref().unwrap_or("").trim());
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

    Ok(Tunnel { local_port, accept_task })
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
}
