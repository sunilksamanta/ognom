//! Portable connection export / import.
//!
//! Two flavours of export file, both JSON:
//!  * **Safe** (`encrypted: false`) — profile metadata only, no secrets. The
//!    encrypted `secret_enc` blobs are useless off this machine anyway (the
//!    master key lives in the OS keychain / local key file, never in the
//!    export), so a portable file must either drop secrets or re-key them.
//!  * **Full** (`encrypted: true`) — the connections (incl. decrypted secrets)
//!    are serialized and re-encrypted under a key derived from a user
//!    passphrase (Argon2id → AES-256-GCM). This is the only correct way to
//!    carry credentials to another machine.

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::profiles::{ConnFields, ProfileKind};

const FORMAT_VERSION: u32 = 1;

/// One connection in an export. `secret` (the password for field profiles, or
/// the full connection string for URI profiles) is present only in full exports.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportConn {
    pub name: String,
    pub color: Option<String>,
    pub kind: ProfileKind,
    #[serde(default)]
    pub fields: ConnFields,
    pub uri_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

/// Argon2 parameters, stored alongside the ciphertext so import can re-derive.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub algo: String,
    pub salt: String, // base64
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    /// Format version — bumped if the shape changes.
    pub ognom_export: u32,
    pub encrypted: bool,
    pub exported_at: String,
    /// Present when `!encrypted`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connections: Option<Vec<ExportConn>>,
    /// Encryption envelope — present when `encrypted`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kdf: Option<KdfParams>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>, // base64
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>, // base64 ciphertext of Vec<ExportConn>
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub encrypted: bool,
    /// Number of connections — 0 for encrypted files (unknown until decrypted).
    pub count: u32,
    pub exported_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: u32,
    /// How many imported connections still need a password / connection string.
    pub needs_password: u32,
}

fn derive_key(passphrase: &str, salt: &[u8], kdf: &KdfParams) -> AppResult<[u8; 32]> {
    let params = Params::new(kdf.m_cost, kdf.t_cost, kdf.p_cost, Some(32))
        .map_err(|e| AppError::Storage(format!("bad kdf params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Storage(format!("key derivation failed: {e}")))?;
    Ok(key)
}

fn cipher_for(key: [u8; 32]) -> Aes256Gcm {
    let k: Key<Aes256Gcm> = key.into();
    Aes256Gcm::new(&k)
}

/// Serialize an export to a JSON string. With `include_secrets`, a non-empty
/// `passphrase` is required and the body is encrypted.
pub fn build_export(
    conns: Vec<ExportConn>,
    include_secrets: bool,
    passphrase: Option<&str>,
    exported_at: String,
) -> AppResult<String> {
    if !include_secrets {
        // Defensively strip secrets so a safe export can never leak credentials,
        // regardless of what the caller passed in.
        let conns = conns
            .into_iter()
            .map(|mut c| {
                c.secret = None;
                c
            })
            .collect();
        let file = ExportFile {
            ognom_export: FORMAT_VERSION,
            encrypted: false,
            exported_at,
            connections: Some(conns),
            kdf: None,
            nonce: None,
            payload: None,
        };
        return serde_json::to_string_pretty(&file).map_err(|e| AppError::Storage(e.to_string()));
    }

    let pass = passphrase
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Other("a passphrase is required to export with credentials".into()))?;

    let plaintext = serde_json::to_vec(&conns).map_err(|e| AppError::Storage(e.to_string()))?;

    // 16-byte salt drawn from the same OS RNG used for keys/nonces.
    let salt_material = Aes256Gcm::generate_key(OsRng);
    let salt = &salt_material[..16];
    let kdf = KdfParams {
        algo: "argon2id".into(),
        salt: B64.encode(salt),
        m_cost: Params::DEFAULT_M_COST,
        t_cost: Params::DEFAULT_T_COST,
        p_cost: Params::DEFAULT_P_COST,
    };
    let key = derive_key(pass, salt, &kdf)?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher_for(key)
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|_| AppError::Storage("export encryption failed".into()))?;

    let file = ExportFile {
        ognom_export: FORMAT_VERSION,
        encrypted: true,
        exported_at,
        connections: None,
        kdf: Some(kdf),
        nonce: Some(B64.encode(nonce)),
        payload: Some(B64.encode(ct)),
    };
    serde_json::to_string_pretty(&file).map_err(|e| AppError::Storage(e.to_string()))
}

fn parse_file(content: &str) -> AppResult<ExportFile> {
    let file: ExportFile = serde_json::from_str(content)
        .map_err(|_| AppError::Other("not a valid Ognom connections export".into()))?;
    if file.ognom_export != FORMAT_VERSION {
        return Err(AppError::Other(format!(
            "unsupported export version {}",
            file.ognom_export
        )));
    }
    Ok(file)
}

/// Cheap peek used to decide whether to prompt for a passphrase before import.
pub fn inspect(content: &str) -> AppResult<ImportPreview> {
    let file = parse_file(content)?;
    let count = if file.encrypted {
        0
    } else {
        file.connections.as_ref().map(|c| c.len() as u32).unwrap_or(0)
    };
    Ok(ImportPreview {
        encrypted: file.encrypted,
        count,
        exported_at: Some(file.exported_at),
    })
}

/// Decode an export into its connections, decrypting with `passphrase` when the
/// file is encrypted.
pub fn parse_export(content: &str, passphrase: Option<&str>) -> AppResult<Vec<ExportConn>> {
    let file = parse_file(content)?;
    if !file.encrypted {
        return file
            .connections
            .ok_or_else(|| AppError::Other("export contains no connections".into()));
    }

    let pass = passphrase
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Other("this export is encrypted — a passphrase is required".into()))?;
    let kdf = file
        .kdf
        .ok_or_else(|| AppError::Other("encrypted export is missing its key parameters".into()))?;
    let salt = B64
        .decode(&kdf.salt)
        .map_err(|_| AppError::Other("corrupt export salt".into()))?;
    let nonce_bytes = B64
        .decode(file.nonce.as_deref().unwrap_or(""))
        .map_err(|_| AppError::Other("corrupt export nonce".into()))?;
    if nonce_bytes.len() != 12 {
        return Err(AppError::Other("corrupt export nonce".into()));
    }
    let ct = B64
        .decode(file.payload.as_deref().unwrap_or(""))
        .map_err(|_| AppError::Other("corrupt export payload".into()))?;

    let key = derive_key(pass, &salt, &kdf)?;
    let pt = cipher_for(key)
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|_| AppError::Other("incorrect passphrase or corrupt export file".into()))?;
    serde_json::from_slice(&pt)
        .map_err(|e| AppError::Storage(format!("corrupt export contents: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<ExportConn> {
        vec![ExportConn {
            name: "Prod".into(),
            color: None,
            kind: ProfileKind::Uri,
            fields: ConnFields::default(),
            uri_summary: Some("mongodb+srv://u@c.mongodb.net".into()),
            secret: Some("mongodb+srv://u:hunter2@c.mongodb.net/".into()),
        }]
    }

    #[test]
    fn safe_export_drops_secret() {
        let json = build_export(sample(), false, None, "now".into()).unwrap();
        assert!(!json.contains("hunter2"));
        let back = parse_export(&json, None).unwrap();
        assert!(back[0].secret.is_none());
    }

    #[test]
    fn encrypted_roundtrip() {
        let json = build_export(sample(), true, Some("correct horse"), "now".into()).unwrap();
        assert!(!json.contains("hunter2"));
        let back = parse_export(&json, Some("correct horse")).unwrap();
        assert_eq!(back[0].secret.as_deref(), Some("mongodb+srv://u:hunter2@c.mongodb.net/"));
    }

    #[test]
    fn wrong_passphrase_fails() {
        let json = build_export(sample(), true, Some("right"), "now".into()).unwrap();
        assert!(parse_export(&json, Some("wrong")).is_err());
        assert!(parse_export(&json, None).is_err());
    }

    #[test]
    fn encrypted_needs_passphrase_to_build() {
        assert!(build_export(sample(), true, None, "now".into()).is_err());
    }
}
