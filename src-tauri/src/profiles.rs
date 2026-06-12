use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::crypto::Crypto;
use crate::error::{AppError, AppResult};

/// Percent-encode a URI component (RFC 3986 unreserved set passes through).
pub fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Structured connection fields. Everything here is non-secret; the password
/// (or full URI for uri-kind profiles) is stored encrypted separately.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ConnFields {
    pub scheme: String, // "mongodb" | "mongodb+srv"
    pub host: String,
    pub port: Option<u16>,
    pub extra_hosts: Vec<String>,
    pub username: Option<String>,
    pub auth_source: Option<String>,
    pub auth_mechanism: Option<String>,
    pub default_database: Option<String>,
    pub replica_set: Option<String>,
    pub direct_connection: bool,
    pub read_preference: Option<String>,
    pub tls_enabled: bool,
    pub tls_insecure: bool,
    pub tls_ca_file: Option<String>,
    pub tls_cert_key_file: Option<String>,
    pub connect_timeout_ms: Option<u32>,
    pub server_selection_timeout_ms: Option<u32>,
    pub max_pool_size: Option<u32>,
    pub extra_options: Option<String>,
}

fn none_if_blank(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

impl ConnFields {
    /// Build a connection URI. `password` comes decrypted from the vault.
    pub fn build_uri(&self, password: Option<&str>) -> AppResult<String> {
        let scheme = if self.scheme == "mongodb+srv" { "mongodb+srv" } else { "mongodb" };
        let host = self.host.trim();
        if host.is_empty() {
            return Err(AppError::Other("host is required".into()));
        }

        let mut uri = format!("{scheme}://");
        if let Some(user) = none_if_blank(&self.username) {
            uri.push_str(&pct_encode(user));
            if let Some(pass) = password.filter(|p| !p.is_empty()) {
                uri.push(':');
                uri.push_str(&pct_encode(pass));
            }
            uri.push('@');
        }

        uri.push_str(host);
        if scheme == "mongodb" {
            if let Some(port) = self.port {
                uri.push_str(&format!(":{port}"));
            }
            for extra in self.extra_hosts.iter().map(|h| h.trim()).filter(|h| !h.is_empty()) {
                uri.push(',');
                uri.push_str(extra);
            }
        }

        uri.push('/');
        if let Some(db) = none_if_blank(&self.default_database) {
            uri.push_str(&pct_encode(db));
        }

        let mut params: Vec<String> = Vec::new();
        let mut push = |k: &str, v: String| params.push(format!("{k}={v}"));

        if let Some(v) = none_if_blank(&self.auth_source) {
            push("authSource", pct_encode(v));
        }
        if let Some(v) = none_if_blank(&self.auth_mechanism) {
            if v != "DEFAULT" {
                push("authMechanism", pct_encode(v));
            }
        }
        if let Some(v) = none_if_blank(&self.replica_set) {
            push("replicaSet", pct_encode(v));
        }
        if self.direct_connection {
            push("directConnection", "true".into());
        }
        if let Some(v) = none_if_blank(&self.read_preference) {
            if v != "primary" {
                push("readPreference", v.to_string());
            }
        }
        if self.tls_enabled || scheme == "mongodb+srv" {
            if self.tls_enabled {
                push("tls", "true".into());
            }
            if self.tls_insecure {
                push("tlsAllowInvalidCertificates", "true".into());
                push("tlsAllowInvalidHostnames", "true".into());
            }
            if let Some(v) = none_if_blank(&self.tls_ca_file) {
                push("tlsCAFile", pct_encode(v));
            }
            if let Some(v) = none_if_blank(&self.tls_cert_key_file) {
                push("tlsCertificateKeyFile", pct_encode(v));
            }
        }
        if let Some(v) = self.connect_timeout_ms {
            push("connectTimeoutMS", v.to_string());
        }
        if let Some(v) = self.server_selection_timeout_ms {
            push("serverSelectionTimeoutMS", v.to_string());
        }
        if let Some(v) = self.max_pool_size {
            push("maxPoolSize", v.to_string());
        }
        if let Some(extra) = none_if_blank(&self.extra_options) {
            params.push(extra.trim_matches(&['?', '&'][..]).to_string());
        }

        if !params.is_empty() {
            uri.push('?');
            uri.push_str(&params.join("&"));
        }
        Ok(uri)
    }

    pub fn host_summary(&self) -> String {
        let mut s = String::new();
        if let Some(u) = none_if_blank(&self.username) {
            s.push_str(u);
            s.push('@');
        }
        s.push_str(self.host.trim());
        if self.scheme != "mongodb+srv" {
            if let Some(p) = self.port {
                s.push_str(&format!(":{p}"));
            }
        }
        if let Some(db) = none_if_blank(&self.default_database) {
            s.push('/');
            s.push_str(db);
        }
        s
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProfileKind {
    Fields,
    Uri,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredProfile {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub kind: ProfileKind,
    #[serde(default)]
    pub fields: ConnFields,
    /// Display-only summary for uri-kind profiles (credentials stripped).
    pub uri_summary: Option<String>,
    /// Encrypted secret: the password (fields) or the full URI (uri).
    pub secret_enc: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// What the UI sends when creating/updating a profile.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub kind: ProfileKind,
    #[serde(default)]
    pub fields: ConnFields,
    pub uri: Option<String>,
    /// Plaintext password; None on edit means "keep the stored one".
    pub password: Option<String>,
}

/// What the UI gets back. Never contains secrets.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub kind: ProfileKind,
    pub host_summary: String,
    pub srv: bool,
    pub tls: bool,
    pub has_secret: bool,
    pub fields: ConnFields,
    pub last_used_at: Option<String>,
}

/// Strip credentials from a pasted URI for display: scheme://user@host/...
fn sanitize_uri(uri: &str) -> String {
    if let Some(scheme_end) = uri.find("://") {
        let rest = &uri[scheme_end + 3..];
        if let Some(at) = rest.find('@') {
            let userinfo = &rest[..at];
            let user = userinfo.split(':').next().unwrap_or("");
            return format!("{}://{}@{}", &uri[..scheme_end], user, &rest[at + 1..]);
        }
    }
    uri.to_string()
}

impl StoredProfile {
    pub fn summary(&self) -> ProfileSummary {
        let (host_summary, srv, tls) = match self.kind {
            ProfileKind::Fields => (
                self.fields.host_summary(),
                self.fields.scheme == "mongodb+srv",
                self.fields.tls_enabled || self.fields.scheme == "mongodb+srv",
            ),
            ProfileKind::Uri => {
                let s = self.uri_summary.clone().unwrap_or_default();
                let srv = s.starts_with("mongodb+srv");
                (s, srv, srv)
            }
        };
        ProfileSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            color: self.color.clone(),
            kind: self.kind.clone(),
            host_summary,
            srv,
            tls,
            has_secret: self.secret_enc.is_some(),
            fields: self.fields.clone(),
            last_used_at: self.last_used_at.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct StoreFile {
    version: u32,
    profiles: Vec<StoredProfile>,
}

pub struct ProfileStore {
    path: PathBuf,
    profiles: Vec<StoredProfile>,
}

impl ProfileStore {
    pub fn load(data_dir: &PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("connections.json");
        let profiles = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            let file: StoreFile = serde_json::from_str(&raw)
                .map_err(|e| AppError::Storage(format!("could not read connections.json: {e}")))?;
            file.profiles
        } else {
            Vec::new()
        };
        Ok(ProfileStore { path, profiles })
    }

    fn persist(&self) -> AppResult<()> {
        let file = StoreFile { version: 1, profiles: self.profiles.clone() };
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&file)?)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    pub fn summaries(&self) -> Vec<ProfileSummary> {
        let mut list: Vec<ProfileSummary> = self.profiles.iter().map(|p| p.summary()).collect();
        // Most recently used first, then alphabetical.
        list.sort_by(|a, b| match (&b.last_used_at, &a.last_used_at) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => std::cmp::Ordering::Greater,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (None, None) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        list
    }

    pub fn get(&self, id: &str) -> AppResult<&StoredProfile> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::Other("connection not found".into()))
    }

    pub fn upsert(&mut self, input: ProfileInput, crypto: &Crypto) -> AppResult<ProfileSummary> {
        if input.name.trim().is_empty() {
            return Err(AppError::Other("connection name is required".into()));
        }
        let existing = input
            .id
            .as_ref()
            .and_then(|id| self.profiles.iter().position(|p| &p.id == id));

        let (secret_plain, uri_summary) = match input.kind {
            ProfileKind::Uri => {
                let uri = none_if_blank(&input.uri).map(str::to_string);
                match (&uri, existing) {
                    (Some(u), _) => (Some(u.clone()), Some(sanitize_uri(u))),
                    // Editing a uri profile without retyping the URI keeps the old one.
                    (None, Some(idx)) => {
                        let old = &self.profiles[idx];
                        if old.kind != ProfileKind::Uri || old.secret_enc.is_none() {
                            return Err(AppError::Other("connection string is required".into()));
                        }
                        (None, old.uri_summary.clone())
                    }
                    (None, None) => {
                        return Err(AppError::Other("connection string is required".into()))
                    }
                }
            }
            ProfileKind::Fields => {
                if input.fields.host.trim().is_empty() {
                    return Err(AppError::Other("host is required".into()));
                }
                (input.password.clone().filter(|p| !p.is_empty()), None)
            }
        };

        let secret_enc = match (&secret_plain, existing) {
            (Some(plain), _) => Some(crypto.encrypt(plain)?),
            (None, Some(idx)) => {
                let old = &self.profiles[idx];
                // Keep stored secret unless the user cleared the username (fields kind).
                let keep = match input.kind {
                    ProfileKind::Fields => none_if_blank(&input.fields.username).is_some(),
                    ProfileKind::Uri => true,
                };
                if keep { old.secret_enc.clone() } else { None }
            }
            (None, None) => None,
        };

        let now = chrono::Utc::now().to_rfc3339();
        let profile = StoredProfile {
            id: input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            name: input.name.trim().to_string(),
            color: input.color.clone(),
            kind: input.kind.clone(),
            fields: input.fields.clone(),
            uri_summary,
            secret_enc,
            created_at: existing
                .map(|i| self.profiles[i].created_at.clone())
                .unwrap_or_else(|| now.clone()),
            last_used_at: existing.and_then(|i| self.profiles[i].last_used_at.clone()),
        };

        let summary = profile.summary();
        match existing {
            Some(idx) => self.profiles[idx] = profile,
            None => self.profiles.push(profile),
        }
        self.persist()?;
        Ok(summary)
    }

    pub fn delete(&mut self, id: &str) -> AppResult<()> {
        let before = self.profiles.len();
        self.profiles.retain(|p| p.id != id);
        if self.profiles.len() == before {
            return Err(AppError::Other("connection not found".into()));
        }
        self.persist()
    }

    pub fn touch(&mut self, id: &str) -> AppResult<()> {
        if let Some(p) = self.profiles.iter_mut().find(|p| p.id == id) {
            p.last_used_at = Some(chrono::Utc::now().to_rfc3339());
            self.persist()?;
        }
        Ok(())
    }

    /// Resolve the connection URI for a stored profile, decrypting its secret.
    pub fn uri_for(&self, id: &str, crypto: &Crypto) -> AppResult<String> {
        let p = self.get(id)?;
        match p.kind {
            ProfileKind::Uri => {
                let enc = p
                    .secret_enc
                    .as_ref()
                    .ok_or_else(|| AppError::Other("profile has no connection string".into()))?;
                crypto.decrypt(enc)
            }
            ProfileKind::Fields => {
                let password = match &p.secret_enc {
                    Some(enc) => Some(crypto.decrypt(enc)?),
                    None => None,
                };
                p.fields.build_uri(password.as_deref())
            }
        }
    }
}

/// Build a URI directly from unsaved input (test/connect-without-saving).
pub fn uri_from_input(input: &ProfileInput) -> AppResult<String> {
    match input.kind {
        ProfileKind::Uri => none_if_blank(&input.uri)
            .map(str::to_string)
            .ok_or_else(|| AppError::Other("connection string is required".into())),
        ProfileKind::Fields => input
            .fields
            .build_uri(input.password.as_deref().filter(|p| !p.is_empty())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_basic() {
        let f = ConnFields {
            scheme: "mongodb".into(),
            host: "localhost".into(),
            port: Some(27017),
            ..Default::default()
        };
        assert_eq!(f.build_uri(None).unwrap(), "mongodb://localhost:27017/");
    }

    #[test]
    fn uri_full() {
        let f = ConnFields {
            scheme: "mongodb".into(),
            host: "db1.example.com".into(),
            port: Some(27017),
            extra_hosts: vec!["db2.example.com:27018".into()],
            username: Some("sa m".into()),
            auth_source: Some("admin".into()),
            replica_set: Some("rs0".into()),
            tls_enabled: true,
            tls_insecure: true,
            read_preference: Some("secondaryPreferred".into()),
            max_pool_size: Some(20),
            default_database: Some("appdb".into()),
            ..Default::default()
        };
        let uri = f.build_uri(Some("p@ss/w:rd")).unwrap();
        assert_eq!(
            uri,
            "mongodb://sa%20m:p%40ss%2Fw%3Ard@db1.example.com:27017,db2.example.com:27018/appdb?authSource=admin&replicaSet=rs0&readPreference=secondaryPreferred&tls=true&tlsAllowInvalidCertificates=true&tlsAllowInvalidHostnames=true&maxPoolSize=20"
        );
    }

    #[test]
    fn uri_srv_skips_port() {
        let f = ConnFields {
            scheme: "mongodb+srv".into(),
            host: "cluster0.abc.mongodb.net".into(),
            port: Some(27017),
            username: Some("u".into()),
            ..Default::default()
        };
        assert_eq!(
            f.build_uri(Some("p")).unwrap(),
            "mongodb+srv://u:p@cluster0.abc.mongodb.net/"
        );
    }

    #[test]
    fn sanitize_strips_password() {
        assert_eq!(
            sanitize_uri("mongodb+srv://user:hunter2@c.mongodb.net/db?w=majority"),
            "mongodb+srv://user@c.mongodb.net/db?w=majority"
        );
    }
}
