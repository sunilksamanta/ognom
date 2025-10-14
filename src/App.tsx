import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Database, 
  Table, 
  Play, 
  Trash2, 
  Save, 
  PlusCircle,
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  FolderOpen,
  FileCode,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonacoEditor } from "@/components/MonacoEditor";

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
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());

  // Query state
  const [queryType, setQueryType] = useState<string>("find");
  const [queryInput, setQueryInput] = useState('{\n  "name": "John"\n}');
  const [queryResults, setQueryResults] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  // Query examples for different operations
  const queryExamples: Record<string, string> = {
    find: '{\n\n}',
    findOne: '{\n  "email": "john@example.com"\n}',
    aggregate: '[\n  { "$match": { "status": "active" } },\n  { "$group": { "_id": "$category", "total": { "$sum": 1 } } }\n]',
    insertOne: '{\n  "name": "John Doe",\n  "email": "john@example.com",\n  "age": 30\n}',
    insertMany: '[\n  { "name": "John", "age": 30 },\n  { "name": "Jane", "age": 25 }\n]',
    updateOne: '{\n  "filter": { "name": "John" },\n  "update": { "$set": { "age": 31 } }\n}',
    updateMany: '{\n  "filter": { "status": "pending" },\n  "update": { "$set": { "status": "active" } }\n}',
    deleteOne: '{\n  "name": "John"\n}',
    deleteMany: '{\n  "status": "inactive"\n}',
    countDocuments: '{\n  "status": "active"\n}',
  };

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
      setExpandedDatabases(new Set());
    } catch (error) {
      setStatusMessage(`Error: ${error}`);
    }
  };

  const saveConnection = () => {
    if (!connectionName || !connectionString) {
      setStatusMessage("Please provide both name and connection string");
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
    setStatusMessage("Connection saved!");
  };

  const loadConnection = (connection: SavedConnection) => {
    setConnectionString(connection.connectionString);
    setStatusMessage(`Loaded: ${connection.name}`);
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

  const toggleDatabase = async (dbName: string) => {
    const newExpanded = new Set(expandedDatabases);
    if (newExpanded.has(dbName)) {
      newExpanded.delete(dbName);
      if (selectedDatabase === dbName) {
        setSelectedDatabase("");
        setSelectedCollection("");
        setCollections([]);
      }
    } else {
      newExpanded.add(dbName);
      setSelectedDatabase(dbName);
      try {
        const cols = await invoke<string[]>("list_collections", {
          databaseName: dbName,
        });
        setCollections(cols);
      } catch (error) {
        setStatusMessage(`Error loading collections: ${error}`);
      }
    }
    setExpandedDatabases(newExpanded);
  };

  const handleCollectionClick = (colName: string) => {
    setSelectedCollection(colName);
    setQueryResults([]);
  };

  const executeQuery = async () => {
    if (!selectedDatabase || !selectedCollection) {
      setStatusMessage("Please select a database and collection first");
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
        queryType: queryType,
        queryJson: queryInput,
      });

      if (result.success && result.data) {
        setQueryResults(result.data);
        setStatusMessage(`✓ ${queryType}: Found ${result.data.length} result(s)`);
      } else {
        setStatusMessage(`✗ Query error: ${result.error}`);
        setQueryResults([]);
      }
    } catch (error) {
      setStatusMessage(`✗ Error: ${error}`);
      setQueryResults([]);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background dark">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="flex h-16 items-center px-6 gap-4">
          <div className="flex items-center gap-3">
            <Database className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
              Ognom
            </h1>
            <Badge variant="secondary" className="ml-2">MongoDB GUI</Badge>
          </div>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-3">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-muted-foreground">Connected</span>
                </div>
                <Button onClick={handleDisconnect} variant="outline" size="sm">
                  Disconnect
                </Button>
              </>
            ) : (
              <Dialog open={showConnectionModal} onOpenChange={setShowConnectionModal}>
                <DialogTrigger asChild>
                  <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Connect to Database
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[525px]">
                  <DialogHeader>
                    <DialogTitle>Connect to MongoDB</DialogTitle>
                    <DialogDescription>
                      Enter your MongoDB connection details to get started.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Connection Name (optional)</label>
                      <Input
                        placeholder="My MongoDB Instance"
                        value={connectionName}
                        onChange={(e) => setConnectionName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Connection String</label>
                      <Input
                        placeholder="mongodb://localhost:27017"
                        value={connectionString}
                        onChange={(e) => setConnectionString(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleConnect} className="flex-1">
                        Connect
                      </Button>
                      <Button onClick={saveConnection} variant="outline">
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </Button>
                    </div>

                    {savedConnections.length > 0 && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Saved Connections</h4>
                          <ScrollArea className="h-32">
                            {savedConnections.map((conn, index) => (
                              <div
                                key={index}
                                className="flex items-center justify-between p-2 hover:bg-accent rounded-md mb-1"
                              >
                                <button
                                  onClick={() => loadConnection(conn)}
                                  className="text-sm flex-1 text-left"
                                >
                                  {conn.name}
                                </button>
                                <Button
                                  onClick={() => deleteConnection(index)}
                                  variant="ghost"
                                  size="sm"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            ))}
                          </ScrollArea>
                        </div>
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      {isConnected ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - Databases & Collections */}
          <aside className="w-80 border-r bg-card flex flex-col">
            <div className="p-4 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Databases
              </h2>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2">
                {databases.map((db) => (
                  <div key={db} className="mb-1">
                    <button
                      onClick={() => toggleDatabase(db)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent rounded-md text-sm transition-colors"
                    >
                      {expandedDatabases.has(db) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Database className="h-4 w-4 text-blue-500" />
                      <span className="flex-1 text-left">{db}</span>
                    </button>
                    {expandedDatabases.has(db) && selectedDatabase === db && (
                      <div className="ml-6 mt-1 space-y-1">
                        {collections.map((col) => (
                          <button
                            key={col}
                            onClick={() => handleCollectionClick(col)}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                              selectedCollection === col
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent"
                            }`}
                          >
                            <Table className="h-4 w-4" />
                            {col}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </aside>

          {/* Main Panel - Query & Results */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {selectedCollection ? (
              <>
                {/* Query Editor */}
                <div className="border-b bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold">
                        Query Editor
                      </h3>
                      <Badge variant="outline">
                        {selectedDatabase}.{selectedCollection}
                      </Badge>
                    </div>
                    <Button onClick={executeQuery} disabled={isExecuting}>
                      {isExecuting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Executing...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Execute Query
                        </>
                      )}
                    </Button>
                  </div>
                  
                  <div className="flex items-center gap-2 mb-3">
                    <label className="text-sm font-medium">Query Type:</label>
                    <Select value={queryType} onValueChange={(value) => {
                      setQueryType(value);
                      setQueryInput(queryExamples[value] || '{}');
                    }}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select query type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="find">Find</SelectItem>
                        <SelectItem value="findOne">Find One</SelectItem>
                        <SelectItem value="aggregate">Aggregate</SelectItem>
                        <SelectItem value="insertOne">Insert One</SelectItem>
                        <SelectItem value="insertMany">Insert Many</SelectItem>
                        <SelectItem value="updateOne">Update One</SelectItem>
                        <SelectItem value="updateMany">Update Many</SelectItem>
                        <SelectItem value="deleteOne">Delete One</SelectItem>
                        <SelectItem value="deleteMany">Delete Many</SelectItem>
                        <SelectItem value="countDocuments">Count Documents</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setQueryInput(queryExamples[queryType])}
                    >
                      <BookOpen className="mr-2 h-3 w-3" />
                      Load Example
                    </Button>
                  </div>
                  
                  <MonacoEditor
                    value={queryInput}
                    onChange={(value) => setQueryInput(value || "")}
                    height="200px"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 Tip: Select a query type above to see examples. The query will be executed using the selected operation.
                  </p>
                </div>

                {/* Results */}
                <div className="flex-1 flex flex-col overflow-hidden p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold flex items-center gap-2">
                      Results
                      {queryResults.length > 0 && (
                        <Badge variant="secondary">{queryResults.length} documents</Badge>
                      )}
                    </h3>
                  </div>
                  <ScrollArea className="flex-1 border rounded-lg bg-muted/50">
                    {queryResults.length > 0 ? (
                      <div className="p-4 space-y-2">
                        {queryResults.map((result, index) => (
                          <Card key={index} className="bg-card">
                            <CardContent className="p-4">
                              <pre className="text-sm font-mono overflow-x-auto">
                                {result}
                              </pre>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                          <FileCode className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No results yet</p>
                          <p className="text-sm">Execute a query to see results</p>
                        </div>
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Database className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">Select a Collection</h3>
                  <p>Choose a database and collection from the sidebar to start querying</p>
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <Card className="w-[450px]">
            <CardHeader className="text-center">
              <Database className="h-16 w-16 mx-auto mb-4 text-primary" />
              <CardTitle className="text-2xl">Welcome to Ognom</CardTitle>
              <CardDescription>
                A beautiful MongoDB GUI client. Connect to your database to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={() => setShowConnectionModal(true)} size="lg">
                <PlusCircle className="mr-2 h-5 w-5" />
                Connect to Database
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status Bar */}
      {statusMessage && (
        <footer className="border-t bg-card px-6 py-2 flex items-center gap-2">
          {statusMessage.startsWith("✓") ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : statusMessage.startsWith("✗") ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          <span className="text-sm">{statusMessage}</span>
        </footer>
      )}
    </div>
  );
}

export default App;