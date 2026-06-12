use serde::Serialize;

/// Unified error type for all commands. Serializes to a plain string so the
/// frontend always receives a human-readable message.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not connected to MongoDB")]
    NotConnected,

    #[error("{0}")]
    Mongo(String),

    #[error("Invalid query: {0}")]
    Parse(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<mongodb::error::Error> for AppError {
    fn from(e: mongodb::error::Error) -> Self {
        // The driver's Display nests the useful part inside "Error { kind: ... }";
        // `kind` alone reads much better in a toast.
        AppError::Mongo(format!("{}", *e.kind))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Storage(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Parse(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
