use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "com.ognom.app";
const KEYRING_USER: &str = "master-key";

/// Where the encryption key lives. Keychain is the goal; a 0600 key file next
/// to the profile store is the honest fallback (surfaced in the UI).
#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    Keychain,
    File,
}

#[derive(Clone)]
pub struct Crypto {
    key: [u8; 32],
    pub source: KeySource,
}

fn random_key() -> [u8; 32] {
    let key = Aes256Gcm::generate_key(OsRng);
    key.into()
}

/// Which backend the user picked, persisted in <data_dir>/settings.json so the
/// backend is known before the webview exists.
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct AppPrefs {
    secret_backend: Option<String>, // "file" | "keychain"
}

fn prefs_path(data_dir: &PathBuf) -> std::path::PathBuf {
    data_dir.join("settings.json")
}

fn read_pref(data_dir: &PathBuf) -> Option<String> {
    let raw = std::fs::read_to_string(prefs_path(data_dir)).ok()?;
    serde_json::from_str::<AppPrefs>(&raw).ok()?.secret_backend
}

fn write_pref(data_dir: &PathBuf, backend: &str) -> AppResult<()> {
    std::fs::create_dir_all(data_dir)?;
    let prefs = AppPrefs { secret_backend: Some(backend.to_string()) };
    std::fs::write(prefs_path(data_dir), serde_json::to_vec_pretty(&prefs)?)?;
    Ok(())
}

fn keyring_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Storage(format!("keychain unavailable: {e}")))
}

impl Crypto {
    /// Load (or create) the master key.
    ///
    /// Default is the local key file - zero prompts on every platform. The OS
    /// keychain is opt-in via the in-app toggle. Installs that already have a
    /// keychain entry from before the toggle existed keep using it.
    ///
    /// Returns `(crypto, degraded)`; degraded means the user asked for the
    /// keychain but it wasn't available and the key file was used instead.
    pub fn init(data_dir: &PathBuf) -> AppResult<(Self, bool)> {
        match read_pref(data_dir).as_deref() {
            Some("keychain") => match Self::from_keyring(true) {
                Ok(c) => Ok((c, false)),
                Err(_) => Self::from_file(data_dir).map(|c| (c, true)),
            },
            Some(_) => Self::from_file(data_dir).map(|c| (c, false)),
            None => match Self::from_keyring(false) {
                // pre-toggle install that already lives in the keychain
                Ok(c) => Ok((c, false)),
                Err(_) => Self::from_file(data_dir).map(|c| (c, false)),
            },
        }
    }

    /// Read the key from the OS keychain. With `create`, a missing entry is
    /// generated; without it, missing means "not using the keychain".
    fn from_keyring(create: bool) -> AppResult<Self> {
        let entry = keyring_entry()?;
        match entry.get_password() {
            Ok(b64) => {
                let bytes = B64
                    .decode(b64.trim())
                    .map_err(|e| AppError::Storage(format!("corrupt keychain key: {e}")))?;
                let key: [u8; 32] = bytes
                    .try_into()
                    .map_err(|_| AppError::Storage("corrupt keychain key length".into()))?;
                Ok(Crypto { key, source: KeySource::Keychain })
            }
            Err(keyring::Error::NoEntry) if create => {
                let key = random_key();
                entry
                    .set_password(&B64.encode(key))
                    .map_err(|e| AppError::Storage(format!("keychain write failed: {e}")))?;
                Ok(Crypto { key, source: KeySource::Keychain })
            }
            Err(keyring::Error::NoEntry) => {
                Err(AppError::Storage("no keychain entry".into()))
            }
            Err(e) => Err(AppError::Storage(format!("keychain read failed: {e}"))),
        }
    }

    /// Move the (unchanged) master key to the other backend. Stored secrets
    /// stay valid - only where the key itself lives changes.
    pub fn migrate(&mut self, data_dir: &PathBuf, to: KeySource) -> AppResult<()> {
        match to {
            KeySource::Keychain => {
                keyring_entry()?
                    .set_password(&B64.encode(self.key))
                    .map_err(|e| AppError::Storage(format!("keychain write failed: {e}")))?;
                let _ = std::fs::remove_file(data_dir.join("ognom.key"));
                self.source = KeySource::Keychain;
                write_pref(data_dir, "keychain")
            }
            KeySource::File => {
                let path = data_dir.join("ognom.key");
                std::fs::write(&path, self.key)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
                }
                if let Ok(entry) = keyring_entry() {
                    let _ = entry.delete_credential();
                }
                self.source = KeySource::File;
                write_pref(data_dir, "file")
            }
        }
    }

    fn from_file(data_dir: &PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("ognom.key");
        if path.exists() {
            let bytes = std::fs::read(&path)?;
            let key: [u8; 32] = bytes
                .try_into()
                .map_err(|_| AppError::Storage("corrupt key file".into()))?;
            return Ok(Crypto { key, source: KeySource::File });
        }
        let key = random_key();
        std::fs::write(&path, key)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(Crypto { key, source: KeySource::File })
    }

    #[cfg(test)]
    pub fn for_tests() -> Self {
        Crypto { key: [7u8; 32], source: KeySource::File }
    }

    fn cipher(&self) -> Aes256Gcm {
        let key: Key<Aes256Gcm> = self.key.into();
        Aes256Gcm::new(&key)
    }

    /// Encrypt to "v1:<b64 nonce>:<b64 ciphertext>".
    pub fn encrypt(&self, plaintext: &str) -> AppResult<String> {
        let cipher = self.cipher();
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|_| AppError::Storage("encryption failed".into()))?;
        Ok(format!("v1:{}:{}", B64.encode(nonce), B64.encode(ct)))
    }

    pub fn decrypt(&self, payload: &str) -> AppResult<String> {
        let mut parts = payload.splitn(3, ':');
        let (v, nonce_b64, ct_b64) = match (parts.next(), parts.next(), parts.next()) {
            (Some(v), Some(n), Some(c)) => (v, n, c),
            _ => return Err(AppError::Storage("malformed secret".into())),
        };
        if v != "v1" {
            return Err(AppError::Storage(format!("unknown secret version '{v}'")));
        }
        let nonce_bytes: [u8; 12] = B64
            .decode(nonce_b64)
            .map_err(|_| AppError::Storage("malformed secret nonce".into()))?
            .try_into()
            .map_err(|_| AppError::Storage("malformed secret nonce".into()))?;
        let ct = B64
            .decode(ct_b64)
            .map_err(|_| AppError::Storage("malformed secret body".into()))?;
        let pt = self
            .cipher()
            .decrypt(&nonce_bytes.into(), ct.as_ref())
            .map_err(|_| {
                AppError::Storage(
                    "could not decrypt stored credential (encryption key changed?)".into(),
                )
            })?;
        String::from_utf8(pt).map_err(|_| AppError::Storage("corrupt secret".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let c = Crypto::for_tests();
        let secret = "p@ss:w/ord🔒";
        let enc = c.encrypt(secret).unwrap();
        assert!(enc.starts_with("v1:"));
        assert_ne!(enc, secret);
        assert_eq!(c.decrypt(&enc).unwrap(), secret);
    }

    #[test]
    fn unique_nonces() {
        let c = Crypto::for_tests();
        assert_ne!(c.encrypt("x").unwrap(), c.encrypt("x").unwrap());
    }

    #[test]
    fn tamper_detected() {
        let c = Crypto::for_tests();
        let enc = c.encrypt("secret").unwrap();
        let mut tampered: String = enc.clone();
        tampered.pop();
        tampered.push(if enc.ends_with('A') { 'B' } else { 'A' });
        assert!(c.decrypt(&tampered).is_err());
    }
}
