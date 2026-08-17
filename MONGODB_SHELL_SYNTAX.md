# Ognom shell syntax

The shell tab (and the filter / sort / projection boxes, and the document
editor) understand mongosh-flavored syntax - not just strict JSON.

Everything below is parsed **string-aware**: helper syntax inside your string
data is never rewritten.

## Statements

One statement per run. Comments (`//` and `/* */`) are allowed anywhere.

```javascript
db.users.find({ role: "admin" }, { name: 1 }).sort({ createdAt: -1 }).skip(10).limit(5)
db.users.findOne({ _id: ObjectId("507f1f77bcf86cd799439011") })
db.orders.aggregate([
  { $match: { status: "paid" } },           // unquoted keys, comments - fine
  { $group: { _id: "$category", n: { $sum: 1 } } },
])
db.users.countDocuments({ active: true })
db.users.estimatedDocumentCount()
db.users.distinct("country", { active: true })

db.users.insertOne({ name: "Ada", joined: ISODate() })
db.users.insertMany([{ a: 1 }, { a: 2 }])
db.users.updateOne({ _id: ObjectId("...") }, { $set: { active: false } })
db.users.updateMany({ active: false }, { $set: { archived: true } }, { upsert: false })
db.users.replaceOne({ _id: ObjectId("...") }, { name: "Replaced" })
db.users.deleteOne({ _id: ObjectId("...") })
db.users.deleteMany({ archived: true })

db.users.getIndexes()
db.users.createIndex({ email: 1 }, { unique: true, name: "uniq_email" })
db.users.dropIndex("uniq_email")
db.users.stats()
db.users.drop()

db.getCollection("weird-name.with.dots").find({})
db.runCommand({ ping: 1 })
db.adminCommand({ listDatabases: 1 })
db.createCollection("events")
db.stats()
db.version()
db.dropDatabase()

show dbs
show collections
use otherDatabase        // switches the tab's shell context
```

### Cursor chains (find)

`.sort({})`, `.limit(n)`, `.skip(n)`, `.project({})`, `.hint({})`, `.count()`,
plus no-ops people type out of habit: `.toArray()`, `.pretty()`.

`find` without `.limit()` is capped at **100 documents** (you'll see a notice).
Aggregations without `$limit` / `$out` / `$merge` / `$count` / `$sample` are
capped at **500**.

### Updates

`updateOne` / `updateMany` require operator documents (`{ $set: ... }`). For a
full replacement use `replaceOne` - this mirrors mongosh and prevents
accidental document clobbering.

## Value syntax (JSON5 + helpers)

```javascript
{
  unquoted: "keys",
  single: 'quotes',
  trailing: "commas",      // ← allowed
  _id: ObjectId("507f1f77bcf86cd799439011"),
  when: ISODate("2024-01-15T10:00:00Z"),
  now: ISODate(),                       // current time
  epoch: Date(1700000000000),           // ms since epoch
  big: NumberLong("9007199254740993"),
  small: NumberInt(7),
  precise: NumberDecimal("19.99"),
  forced: Double("3"),
  uuid: UUID("3b241101-e2bb-4255-8caf-4136c566a962"),
  blob: BinData(0, "aGVsbG8="),
  ts: Timestamp(170000, 1),
  range: { from: MinKey, to: MaxKey },
}
```

Whole numbers are stored as integers (Int32/Int64), fractional as doubles - 
the same heuristic mongosh uses. Use `NumberLong` / `NumberDecimal` / `Double`
to force a type.

### Display

Results render as relaxed Extended JSON with shell-style affordances:
`ObjectId(...)` pills, ISO dates, typed colors in both the JSON tree and the
table. *Copy as shell* produces text that pastes straight back into mongosh
or this shell; *Copy as Extended JSON* produces strict JSON.

## Not supported (yet)

- Multiple statements per run, variables, or arbitrary JavaScript
- Regex literals (`/abc/i`) - use `{ $regex: "abc", $options: "i" }`
- `findOneAndUpdate` family, bulk operations, transactions

## Regular expressions and dates

- `/pattern/flags` literals work anywhere a value is expected: `{ topic: /hello/i }`.
- `new RegExp("pattern", "flags")` and `RegExp("pattern")` are accepted too, with JavaScript
  string escaping (`"\\d+"`), and become `$regularExpression`.
- `new Date("2024-01-15")`, `Date("...")`, `new Date(1700000000000)` and `ISODate(...)` all
  produce a BSON date. Any helper may be prefixed with `new`.
