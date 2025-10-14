# MongoDB Shell Syntax Support

Ognom now supports MongoDB shell syntax for queries and results display!

## Supported Syntax

### ObjectId

**In Queries (Input):**
```javascript
// Find by ObjectId
{
  "_id": ObjectId("507f1f77bcf86cd799439011")
}

// Update by ObjectId
{
  "filter": { "_id": ObjectId("6877a7a5b2482ef444b24ced") },
  "update": { "$set": { "status": "active" } }
}

// Array of ObjectIds
{
  "userId": { "$in": [
    ObjectId("507f1f77bcf86cd799439011"),
    ObjectId("507f1f77bcf86cd799439012")
  ]}
}
```

**In Results (Output):**
Instead of the extended JSON format:
```json
{
  "_id": {
    "$oid": "507f1f77bcf86cd799439011"
  }
}
```

You'll see the cleaner MongoDB shell format:
```javascript
{
  "_id": ObjectId("507f1f77bcf86cd799439011")
}
```

### ISODate

**In Queries (Input):**
```javascript
// Current date/time
{
  "createdAt": ISODate()
}

// Specific date
{
  "startDate": ISODate("2025-01-15T00:00:00Z")
}

// Date range query
{
  "createdAt": {
    "$gte": ISODate("2025-01-01T00:00:00Z"),
    "$lt": ISODate("2025-02-01T00:00:00Z")
  }
}

// Insert with timestamp
{
  "name": "John Doe",
  "createdAt": ISODate(),
  "updatedAt": ISODate()
}
```

**In Results (Output):**
Instead of the extended JSON format:
```json
{
  "dateOfBirth": {
    "$date": {
      "$numberLong": "810691200000"
    }
  }
}
```

You'll see the MongoDB shell format:
```javascript
{
  "dateOfBirth": ISODate("1995-09-09T00:00:00.000Z")
}
```

## Examples by Query Type

### find / findOne
```javascript
// Find by ObjectId and date range
{
  "_id": ObjectId("507f1f77bcf86cd799439011"),
  "createdAt": {
    "$gte": ISODate("2025-01-01T00:00:00Z")
  }
}
```

### aggregate
```javascript
[
  {
    "$match": {
      "createdAt": { "$gte": ISODate("2025-01-01T00:00:00Z") }
    }
  },
  {
    "$group": {
      "_id": "$userId",
      "count": { "$sum": 1 }
    }
  }
]
```

### insertOne / insertMany
```javascript
// Single document with timestamps
{
  "name": "John Doe",
  "email": "john@example.com",
  "createdAt": ISODate(),
  "updatedAt": ISODate()
}

// Multiple documents
[
  {
    "name": "John",
    "createdAt": ISODate()
  },
  {
    "name": "Jane",
    "createdAt": ISODate()
  }
]
```

### updateOne / updateMany
```javascript
{
  "filter": {
    "_id": ObjectId("507f1f77bcf86cd799439011")
  },
  "update": {
    "$set": {
      "status": "active",
      "updatedAt": ISODate()
    }
  }
}
```

### deleteOne / deleteMany
```javascript
// Delete by ObjectId
{
  "_id": ObjectId("507f1f77bcf86cd799439011")
}

// Delete old records
{
  "createdAt": {
    "$lt": ISODate("2024-01-01T00:00:00Z")
  }
}
```

## How It Works

### Backend Processing
1. **Input Conversion**: When you submit a query, the backend automatically converts MongoDB shell syntax to extended JSON format that MongoDB drivers understand:
   - `ObjectId("...")` → `{"$oid": "..."}`
   - `ISODate("...")` → `{"$date": "..."}`
   - `ISODate()` → `{"$date": "<current_timestamp>"}`

2. **Output Conversion**: Results from MongoDB are converted from extended JSON to readable MongoDB shell format:
   - `{"$oid": "..."}` → `ObjectId("...")`
   - `{"$date": {"$numberLong": "..."}}` → `ISODate("...")`
   - `{"$date": "..."}` → `ISODate("...")`

### Benefits
- ✅ More readable and familiar syntax (same as MongoDB shell)
- ✅ Copy-paste queries from MongoDB documentation
- ✅ Cleaner display of ObjectIds and dates in results
- ✅ Automatic timestamp generation with `ISODate()`
- ✅ Works with all query types (find, aggregate, insert, update, delete)

## Notes
- ObjectIds must be exactly 24 hexadecimal characters
- Date strings should be in ISO 8601 format
- `ISODate()` without arguments uses the current date/time
- The conversion is automatic - no configuration needed!
