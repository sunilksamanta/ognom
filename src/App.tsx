import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface SavedConnection {
  name: string;
  connectionString: string;
}

function App() {
  // Connection state
  const [connectionString, setConnectionString] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [showConnectionModal, setShowConnectionModal] = useState(false);

  // Database and collection state
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState("");

  // Query state
  const [queryInput, setQueryInput] = useState("{}");
  const [queryResults, setQueryResults] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  // Saved connections
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);

  // Load saved connections from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("mongoConnections");
    if (saved) {
      setSavedConnections(JSON.parse(saved));
    }
  }, []);

  const handleConnect = async () => {
    try {
      setStatusMessage("Connecting...");
      const result = await invoke<{ success: boolean; message: string }>(
        "connect_to_mongodb",
        { connectionString }
      );

      if (result.success) {
        setIsConnected(true);
        setStatusMessage(result.message);
        setShowConnectionModal(false);
        await loadDatabases();
      }
    } catch (error) {
      setStatusMessage(`Error: ${error}`);
      setIsConnected(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("disconnect_mongodb");
      setIsConnected(false);
      setStatusMessage("Disconnected");
      setDatabases([]);
      setCollections([]);
      setSelectedDatabase("");
      setSelectedCollection("");
      setQueryResults([]);
    } catch (error) {
      setStatusMessage(`Error: ${error}`);
    }
  };

  const saveConnection = () => {
    if (!connectionName || !connectionString) {
      alert("Please provide both name and connection string");
      return;
    }

    const newConnection: SavedConnection = {
      name: connectionName,
      connectionString: connectionString,
    };

    const updated = [...savedConnections, newConnection];
    setSavedConnections(updated);
    localStorage.setItem("mongoConnections", JSON.stringify(updated));
    setConnectionName("");
    alert("Connection saved!");
  };

  const loadConnection = (connection: SavedConnection) => {
    setConnectionString(connection.connectionString);
  };

  const deleteConnection = (index: number) => {
    const updated = savedConnections.filter((_, i) => i !== index);
    setSavedConnections(updated);
    localStorage.setItem("mongoConnections", JSON.stringify(updated));
  };

  const loadDatabases = async () => {
    try {
      const dbs = await invoke<string[]>("list_databases");
      setDatabases(dbs);
    } catch (error) {
      setStatusMessage(`Error loading databases: ${error}`);
    }
  };

  const handleDatabaseClick = async (dbName: string) => {
    setSelectedDatabase(dbName);
    setSelectedCollection("");
    setQueryResults([]);

    try {
      const cols = await invoke<string[]>("list_collections", {
        databaseName: dbName,
      });
      setCollections(cols);
    } catch (error) {
      setStatusMessage(`Error loading collections: ${error}`);
    }
  };

  const handleCollectionClick = (colName: string) => {
    setSelectedCollection(colName);
    setQueryResults([]);
    setQueryInput("{}");
  };

  const executeQuery = async () => {
    if (!selectedDatabase || !selectedCollection) {
      alert("Please select a database and collection first");
      return;
    }

    try {
      setIsExecuting(true);
      setStatusMessage("Executing query...");
      const result = await invoke<{
        success: boolean;
        data?: string[];
        error?: string;
      }>("execute_query", {
        databaseName: selectedDatabase,
        collectionName: selectedCollection,
        queryJson: queryInput,
      });

      if (result.success && result.data) {
        setQueryResults(result.data);
        setStatusMessage(`Found ${result.data.length} documents`);
      } else {
        setStatusMessage(`Query error: ${result.error}`);
        setQueryResults([]);
      }
    } catch (error) {
      setStatusMessage(`Error: ${error}`);
      setQueryResults([]);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="app">
      {/* Top Bar */}
      <div className="top-bar">
        <h1>MongoDB Client</h1>
        <div className="top-bar-actions">
          {isConnected ? (
            <>
              <span className="connection-status">● Connected</span>
              <button onClick={handleDisconnect} className="btn-secondary">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={() => setShowConnectionModal(true)} className="btn-primary">
              Connect to Database
            </button>
          )}
        </div>
      </div>

      {/* Connection Modal */}
      {showConnectionModal && (
        <div className="modal-overlay" onClick={() => setShowConnectionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect to MongoDB</h2>
              <button
                className="close-btn"
                onClick={() => setShowConnectionModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Connection Name (optional)</label>
                <input
                  type="text"
                  placeholder="My MongoDB"
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Connection String</label>
                <input
                  type="text"
                  placeholder="mongodb://localhost:27017"
                  value={connectionString}
                  onChange={(e) => setConnectionString(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button onClick={handleConnect} className="btn-primary">
                  Connect
                </button>
                <button onClick={saveConnection} className="btn-secondary">
                  Save Connection
                </button>
              </div>
              {statusMessage && <p className="status-message">{statusMessage}</p>}

              {/* Saved Connections */}
              {savedConnections.length > 0 && (
                <div className="saved-connections">
                  <h3>Saved Connections</h3>
                  {savedConnections.map((conn, index) => (
                    <div key={index} className="saved-connection-item">
                      <span className="connection-name">{conn.name}</span>
                      <div className="connection-actions">
                        <button
                          onClick={() => loadConnection(conn)}
                          className="btn-link"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => deleteConnection(index)}
                          className="btn-link danger"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      {isConnected ? (
        <div className="main-content">
          {/* Left Sidebar - Databases & Collections */}
          <div className="sidebar">
            <div className="sidebar-header">
              <h3>Databases</h3>
            </div>
            <div className="sidebar-content">
              {databases.map((db) => (
                <div key={db} className="database-item">
                  <div
                    className={`database-name ${
                      selectedDatabase === db ? "active" : ""
                    }`}
                    onClick={() => handleDatabaseClick(db)}
                  >
                    📁 {db}
                  </div>
                  {selectedDatabase === db && collections.length > 0 && (
                    <div className="collections-list">
                      {collections.map((col) => (
                        <div
                          key={col}
                          className={`collection-item ${
                            selectedCollection === col ? "active" : ""
                          }`}
                          onClick={() => handleCollectionClick(col)}
                        >
                          📄 {col}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right Panel - Query & Results */}
          <div className="content-area">
            {selectedCollection ? (
              <>
                {/* Query Section */}
                <div className="query-panel">
                  <div className="panel-header">
                    <h3>
                      Query: {selectedDatabase}.{selectedCollection}
                    </h3>
                    <button
                      onClick={executeQuery}
                      disabled={isExecuting}
                      className="btn-primary"
                    >
                      {isExecuting ? "Executing..." : "Execute Query"}
                    </button>
                  </div>
                  <textarea
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder='{"field": "value"}'
                    className="query-input"
                  />
                </div>

                {/* Results Section */}
                <div className="results-panel">
                  <div className="panel-header">
                    <h3>Results</h3>
                    {queryResults.length > 0 && (
                      <span className="result-count">
                        {queryResults.length} documents
                      </span>
                    )}
                  </div>
                  <div className="results-content">
                    {queryResults.length > 0 ? (
                      queryResults.map((result, index) => (
                        <pre key={index} className="result-item">
                          {result}
                        </pre>
                      ))
                    ) : (
                      <div className="empty-state">
                        <p>No results yet. Execute a query to see results.</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state-large">
                <h2>Select a Collection</h2>
                <p>Choose a database and collection from the sidebar to start querying.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state-large">
          <h2>Not Connected</h2>
          <p>Click "Connect to Database" to get started.</p>
        </div>
      )}

      {/* Status Bar */}
      {statusMessage && (
        <div className="status-bar">
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;