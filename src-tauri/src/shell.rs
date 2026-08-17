//! mongosh-style statement parsing.
//!
//! Pipeline: strip comments → convert shell helpers (ObjectId, ISODate, ...) to
//! Extended JSON → parse with json5 (unquoted keys, single quotes, trailing
//! commas) → normalize whole numbers back to integers.
//!
//! Every text transformation is string-aware: helper syntax inside string
//! literals in user data is never rewritten.

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// string-aware scanning utilities
// ---------------------------------------------------------------------------

/// Advance past a string literal starting at `i` (which must point at a quote).
/// Returns the index just past the closing quote (or end of input).
fn skip_string(chars: &[char], i: usize) -> usize {
    let quote = chars[i];
    let mut j = i + 1;
    while j < chars.len() {
        if chars[j] == '\\' {
            j += 2;
            continue;
        }
        if chars[j] == quote {
            return j + 1;
        }
        j += 1;
    }
    j
}

/// Remove `//` line comments and `/* */` block comments outside strings.
fn strip_comments(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            let end = skip_string(&chars, i);
            out.extend(&chars[i..end.min(chars.len())]);
            i = end;
        } else if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            out.push(' ');
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

type HelperRule = (&'static Regex, fn(&regex::Captures) -> String);

fn helper_rules() -> &'static Vec<HelperRule> {
    static RULES: OnceLock<Vec<HelperRule>> = OnceLock::new();
    static REGEXES: OnceLock<Vec<Regex>> = OnceLock::new();
    let regexes = REGEXES.get_or_init(|| {
        vec![
            // 0: ObjectId("hex") / ObjectId('hex') / ObjectId(hex) / new ObjectId(...)
            Regex::new(r#"^(?:new\s+)?ObjectId\s*\(\s*["']?([0-9a-fA-F]{24})["']?\s*\)"#).unwrap(),
            // 1: ISODate()/Date()/new Date() with no args → now
            Regex::new(r#"^(?:new\s+)?(?:ISODate|Date)\s*\(\s*\)"#).unwrap(),
            // 2: ISODate("...")/Date("...")
            Regex::new(r#"^(?:new\s+)?(?:ISODate|Date)\s*\(\s*["']([^"']+)["']\s*\)"#).unwrap(),
            // 3: Date(millis)
            Regex::new(r#"^(?:new\s+)?(?:ISODate|Date)\s*\(\s*(-?\d+)\s*\)"#).unwrap(),
            // 4: NumberLong("123") / NumberLong(123)
            Regex::new(r#"^NumberLong\s*\(\s*["']?(-?\d+)["']?\s*\)"#).unwrap(),
            // 5: NumberInt
            Regex::new(r#"^NumberInt\s*\(\s*["']?(-?\d+)["']?\s*\)"#).unwrap(),
            // 6: NumberDecimal
            Regex::new(r#"^NumberDecimal\s*\(\s*["']?([0-9eE\.\+\-]+)["']?\s*\)"#).unwrap(),
            // 7: Double
            Regex::new(r#"^Double\s*\(\s*["']?([0-9eE\.\+\-]+)["']?\s*\)"#).unwrap(),
            // 8: UUID("...")
            Regex::new(r#"^(?:new\s+)?UUID\s*\(\s*["']([0-9a-fA-F\-]{36})["']\s*\)"#).unwrap(),
            // 9: BinData(subtype, "base64")
            Regex::new(r#"^BinData\s*\(\s*(\d+)\s*,\s*["']([A-Za-z0-9\+/=]*)["']\s*\)"#).unwrap(),
            // 10: Timestamp(t, i)
            Regex::new(r#"^Timestamp\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)"#).unwrap(),
            // 11: MinKey / MaxKey (callable or bare)
            Regex::new(r#"^MinKey(?:\s*\(\s*\))?"#).unwrap(),
            Regex::new(r#"^MaxKey(?:\s*\(\s*\))?"#).unwrap(),
        ]
    });
    RULES.get_or_init(|| {
        vec![
            (&regexes[0], |c| format!(r#"{{"$oid":"{}"}}"#, &c[1].to_lowercase())),
            (&regexes[1], |_| {
                format!(
                    r#"{{"$date":"{}"}}"#,
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                )
            }),
            (&regexes[2], |c| format!(r#"{{"$date":"{}"}}"#, &c[1])),
            (&regexes[3], |c| format!(r#"{{"$date":{{"$numberLong":"{}"}}}}"#, &c[1])),
            (&regexes[4], |c| format!(r#"{{"$numberLong":"{}"}}"#, &c[1])),
            (&regexes[5], |c| c[1].to_string()),
            (&regexes[6], |c| format!(r#"{{"$numberDecimal":"{}"}}"#, &c[1])),
            (&regexes[7], |c| format!(r#"{{"$numberDouble":"{}"}}"#, &c[1])),
            (&regexes[8], |c| format!(r#"{{"$uuid":"{}"}}"#, &c[1].to_lowercase())),
            (&regexes[9], |c| {
                let sub: u8 = c[1].parse().unwrap_or(0);
                format!(r#"{{"$binary":{{"base64":"{}","subType":"{:02x}"}}}}"#, &c[2], sub)
            }),
            (&regexes[10], |c| format!(r#"{{"$timestamp":{{"t":{},"i":{}}}}}"#, &c[1], &c[2])),
            (&regexes[11], |_| r#"{"$minKey":1}"#.to_string()),
            (&regexes[12], |_| r#"{"$maxKey":1}"#.to_string()),
        ]
    })
}

fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// Rewrite shell helper calls to Extended JSON, skipping string literals.
pub fn convert_helpers(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len() + 32);
    let mut i = 0;
    let mut prev: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            let end = skip_string(&chars, i);
            out.extend(&chars[i..end.min(chars.len())]);
            i = end;
            prev = Some('"');
            continue;
        }
        // Helper names can only start a fresh identifier.
        if c.is_ascii_alphabetic() && !prev.map(is_ident_char).unwrap_or(false) {
            let rest: String = chars[i..].iter().collect();
            let mut matched = false;
            for (re, fmt) in helper_rules() {
                if let Some(caps) = re.captures(&rest) {
                    let whole = caps.get(0).unwrap();
                    out.push_str(&fmt(&caps));
                    i += rest[..whole.end()].chars().count();
                    prev = Some('}');
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }
        }
        out.push(c);
        prev = Some(c);
        i += 1;
    }
    out
}

/// json5 parses every number as f64; put whole numbers back as integers so
/// edits and inserts keep Int32/Int64 types (mongosh behaves the same way).
pub fn normalize_numbers(v: Value) -> Value {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_992.0 {
                    return Value::Number((f as i64).into());
                }
            }
            Value::Number(n)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(normalize_numbers).collect()),
        Value::Object(map) => {
            // Inside $numberDouble etc. values are strings already; this only
            // touches plain JSON numbers.
            Value::Object(map.into_iter().map(|(k, v)| (k, normalize_numbers(v))).collect())
        }
        other => other,
    }
}

/// Parse one shell-flavored JSON value (document, array, string, number...).
pub fn parse_value(text: &str) -> AppResult<Value> {
    let trimmed = text.trim();
    let prepared = convert_helpers(trimmed);
    let parsed: Value = json5::from_str(&prepared).map_err(|e| friendly_parse_error(e, trimmed))?;
    Ok(normalize_numbers(parsed))
}

/// Turn json5's raw pest diagnostic (a multi-line ASCII caret dump) into a
/// single readable sentence pointing at the offending line.
///
/// `convert_helpers` rewrites the text before json5 sees it (e.g. `ISODate("...")`
/// → `{"$date":"..."}`), which shifts columns but never adds or removes newlines - 
/// so the reported *line* still lines up with the user's editor, but the column
/// does not. We surface the line (and its text), not the bogus column.
fn friendly_parse_error(e: json5::Error, source: &str) -> AppError {
    let json5::Error::Message { msg, location } = e;
    let message = match location {
        // A pest syntax error. Its `= expected ...` list names grammar rules
        // (e.g. "expected boolean or null" for a missing comma), which reads as
        // gibberish to a user - so we swap it for a generic, actionable hint and
        // point at the offending line instead.
        Some(loc) => {
            const HINT: &str = "invalid syntax - check for a missing comma, quote, colon, or bracket";
            match source.lines().nth(loc.line - 1).map(str::trim) {
                Some(line) if !line.is_empty() => {
                    format!("near line {} (`{}`) - {}", loc.line, line, HINT)
                }
                _ => format!("near line {} - {}", loc.line, HINT),
            }
        }
        // No location means a semantic error (e.g. "expected a document") whose
        // message is already meaningful; pass it through.
        None => msg.lines().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).unwrap_or_else(|| "could not parse".to_string()),
    };
    AppError::Parse(message)
}

/// Parse a filter/sort/projection text box: blank means empty document.
pub fn parse_doc_or_empty(text: &str) -> AppResult<Value> {
    let t = strip_comments(text);
    let t = t.trim();
    if t.is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    let v = parse_value(t)?;
    if !v.is_object() {
        return Err(AppError::Parse("expected a document, e.g. { field: \"value\" }".into()));
    }
    Ok(v)
}

/// Split `args_raw` on top-level commas (string- and bracket-aware).
fn split_args(raw: &str) -> Vec<String> {
    let chars: Vec<char> = raw.chars().collect();
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut depth: i32 = 0;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '"' | '\'' => {
                let end = skip_string(&chars, i);
                current.extend(&chars[i..end.min(chars.len())]);
                i = end;
                continue;
            }
            '(' | '[' | '{' => {
                depth += 1;
                current.push(c);
            }
            ')' | ']' | '}' => {
                depth -= 1;
                current.push(c);
            }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(c),
        }
        i += 1;
    }
    let last = current.trim().to_string();
    if !last.is_empty() {
        parts.push(last);
    }
    parts
}

// ---------------------------------------------------------------------------
// statement parsing
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum Statement {
    ShowDbs,
    ShowCollections,
    Use(String),
    DbStats,
    RunCommand(Value),
    AdminCommand(Value),
    CreateCollection(String),
    DropDatabase,
    Collection {
        collection: String,
        method: String,
        args: Vec<Value>,
        chain: Vec<(String, Vec<Value>)>,
    },
}

enum Segment {
    Plain(String),
    Call(String, String), // name, raw args
}

fn parse_segments(s: &str) -> AppResult<Vec<Segment>> {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 2; // past "db"
    let mut segments = Vec::new();

    loop {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        if chars[i] == ';' && chars[i + 1..].iter().all(|c| c.is_whitespace()) {
            break;
        }
        if chars[i] != '.' {
            return Err(AppError::Parse(format!(
                "unexpected '{}' - expected '.' after '{}'",
                chars[i],
                chars[..i].iter().collect::<String>().trim()
            )));
        }
        i += 1;
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let start = i;
        while i < chars.len() && is_ident_char(chars[i]) {
            i += 1;
        }
        if start == i {
            return Err(AppError::Parse("expected a name after '.'".into()));
        }
        let name: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == '(' {
            // find the balanced closing paren, skipping strings
            let mut depth = 0;
            let mut j = i;
            let close = loop {
                if j >= chars.len() {
                    return Err(AppError::Parse(format!("unclosed '(' in .{name}(...)")));
                }
                match chars[j] {
                    '"' | '\'' => {
                        j = skip_string(&chars, j);
                        continue;
                    }
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            break j;
                        }
                    }
                    _ => {}
                }
                j += 1;
            };
            let raw: String = chars[i + 1..close].iter().collect();
            segments.push(Segment::Call(name, raw));
            i = close + 1;
        } else {
            segments.push(Segment::Plain(name));
        }
    }
    Ok(segments)
}

fn parse_args(name: &str, raw: &str) -> AppResult<Vec<Value>> {
    split_args(raw)
        .iter()
        .map(|a| {
            parse_value(a).map_err(|e| AppError::Parse(format!("in {name}(...): {e}")))
        })
        .collect()
}

/// Parse a single shell statement.
pub fn parse_statement(input: &str) -> AppResult<Statement> {
    let cleaned = strip_comments(input);
    let s = cleaned.trim().trim_end_matches(';').trim();
    if s.is_empty() {
        return Err(AppError::Parse("nothing to run".into()));
    }

    // Reject multiple statements: a top-level ';' with content after it.
    {
        let chars: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            match chars[i] {
                '"' | '\'' => i = skip_string(&chars, i),
                ';' => {
                    if chars[i + 1..].iter().any(|c| !c.is_whitespace()) {
                        return Err(AppError::Parse("run one statement at a time".into()));
                    }
                    i += 1;
                }
                _ => i += 1,
            }
        }
    }

    static SHOW_RE: OnceLock<(Regex, Regex, Regex)> = OnceLock::new();
    let (show_dbs, show_colls, use_db) = SHOW_RE.get_or_init(|| {
        (
            Regex::new(r"^show\s+(dbs|databases)$").unwrap(),
            Regex::new(r"^show\s+collections$").unwrap(),
            Regex::new(r#"^use\s+["']?([A-Za-z0-9_\-]+)["']?$"#).unwrap(),
        )
    });
    if show_dbs.is_match(s) {
        return Ok(Statement::ShowDbs);
    }
    if show_colls.is_match(s) {
        return Ok(Statement::ShowCollections);
    }
    if let Some(c) = use_db.captures(s) {
        return Ok(Statement::Use(c[1].to_string()));
    }

    if !(s == "db" || s.starts_with("db.") || s.starts_with("db ")) {
        return Err(AppError::Parse(
            "statements must start with db. - e.g. db.users.find({})".into(),
        ));
    }
    if s == "db" {
        return Err(AppError::Parse("try db.<collection>.find({}) or show collections".into()));
    }

    let segments = parse_segments(s)?;
    if segments.is_empty() {
        return Err(AppError::Parse("expected something after db.".into()));
    }

    let mut coll_parts: Vec<String> = Vec::new();
    let mut idx = 0;

    // Leading plain segments form the collection name (db.foo.bar.find()).
    while idx < segments.len() {
        match &segments[idx] {
            Segment::Plain(p) => {
                coll_parts.push(p.clone());
                idx += 1;
            }
            Segment::Call(_, _) => break,
        }
    }

    if idx >= segments.len() {
        let path = coll_parts.join(".");
        return Err(AppError::Parse(format!(
            "db.{path} is not a command - did you mean db.{path}.find({{}})?"
        )));
    }

    let (first_name, first_raw) = match &segments[idx] {
        Segment::Call(n, r) => (n.clone(), r.clone()),
        Segment::Plain(_) => unreachable!(),
    };

    // db-level methods (no collection prefix)
    if coll_parts.is_empty() {
        match first_name.as_str() {
            "stats" => return Ok(Statement::DbStats),
            "runCommand" | "adminCommand" => {
                let args = parse_args(&first_name, &first_raw)?;
                let doc = args
                    .into_iter()
                    .next()
                    .ok_or_else(|| AppError::Parse(format!("{first_name}() needs a document")))?;
                return Ok(if first_name == "adminCommand" {
                    Statement::AdminCommand(doc)
                } else {
                    Statement::RunCommand(doc)
                });
            }
            "getCollectionNames" => return Ok(Statement::ShowCollections),
            "dropDatabase" => return Ok(Statement::DropDatabase),
            "version" => {
                return Ok(Statement::RunCommand(serde_json::json!({"buildInfo": 1})))
            }
            "createCollection" => {
                let args = parse_args(&first_name, &first_raw)?;
                match args.first() {
                    Some(Value::String(name)) => {
                        return Ok(Statement::CreateCollection(name.clone()))
                    }
                    _ => {
                        return Err(AppError::Parse(
                            "createCollection needs a name, e.g. db.createCollection('events')"
                                .into(),
                        ))
                    }
                }
            }
            "getCollection" => {
                let args = parse_args(&first_name, &first_raw)?;
                match args.first() {
                    Some(Value::String(name)) => coll_parts.push(name.clone()),
                    _ => {
                        return Err(AppError::Parse(
                            "getCollection needs a string name".into(),
                        ))
                    }
                }
                idx += 1;
                if idx >= segments.len() {
                    return Err(AppError::Parse(
                        "add a method, e.g. db.getCollection('users').find({})".into(),
                    ));
                }
            }
            other => {
                return Err(AppError::Parse(format!(
                    "db.{other}() is not supported - supported: stats, runCommand, adminCommand, \
                     createCollection, dropDatabase, getCollectionNames, getCollection, version"
                )));
            }
        }
    }

    // The method on the collection.
    let (method, args) = match &segments[idx] {
        Segment::Call(n, r) => (n.clone(), parse_args(n, r)?),
        Segment::Plain(p) => {
            return Err(AppError::Parse(format!(
                "expected a method call, found '.{p}' - did you mean .{p}()?"
            )))
        }
    };
    idx += 1;

    let mut chain: Vec<(String, Vec<Value>)> = Vec::new();
    while idx < segments.len() {
        match &segments[idx] {
            Segment::Call(n, r) => chain.push((n.clone(), parse_args(n, r)?)),
            Segment::Plain(p) => {
                return Err(AppError::Parse(format!(
                    "expected a method call after {method}(), found '.{p}'"
                )))
            }
        }
        idx += 1;
    }

    Ok(Statement::Collection { collection: coll_parts.join("."), method, args, chain })
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn find_with_chain() {
        let st =
            parse_statement("db.users.find({name: 'ada'}).sort({age: -1}).limit(5)").unwrap();
        match st {
            Statement::Collection { collection, method, args, chain } => {
                assert_eq!(collection, "users");
                assert_eq!(method, "find");
                assert_eq!(args, vec![json!({"name": "ada"})]);
                assert_eq!(
                    chain,
                    vec![
                        ("sort".to_string(), vec![json!({"age": -1})]),
                        ("limit".to_string(), vec![json!(5)]),
                    ]
                );
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn dotted_collection_name() {
        let st = parse_statement("db.app.events.find({})").unwrap();
        match st {
            Statement::Collection { collection, method, .. } => {
                assert_eq!(collection, "app.events");
                assert_eq!(method, "find");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn get_collection_form() {
        let st = parse_statement(r#"db.getCollection("weird-name.x").countDocuments()"#).unwrap();
        match st {
            Statement::Collection { collection, method, args, .. } => {
                assert_eq!(collection, "weird-name.x");
                assert_eq!(method, "countDocuments");
                assert!(args.is_empty());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn helpers_convert() {
        let v = parse_value(r#"{_id: ObjectId("507F1F77BCF86CD799439011"), at: ISODate("2024-01-15T10:00:00Z"), n: NumberLong("9007199254740993"), i: NumberInt(7)}"#)
            .unwrap();
        assert_eq!(v["_id"], json!({"$oid": "507f1f77bcf86cd799439011"}));
        assert_eq!(v["at"], json!({"$date": "2024-01-15T10:00:00Z"}));
        assert_eq!(v["n"], json!({"$numberLong": "9007199254740993"}));
        assert_eq!(v["i"], json!(7));
    }

    #[test]
    fn helpers_inside_strings_untouched() {
        let v = parse_value(r#"{note: 'see ObjectId("507f1f77bcf86cd799439011") here'}"#).unwrap();
        assert_eq!(v["note"], json!(r#"see ObjectId("507f1f77bcf86cd799439011") here"#));
    }

    #[test]
    fn whole_numbers_become_ints() {
        let v = parse_value("{a: 5, b: 5.5, c: -3}").unwrap();
        assert_eq!(v, json!({"a": 5, "b": 5.5, "c": -3}));
        assert!(v["a"].is_i64());
        assert!(v["b"].is_f64());
    }

    #[test]
    fn parse_error_points_at_the_editor_line() {
        // A missing comma after the ISODate on line 4. The helper rewrite shifts
        // columns, so the message must anchor on the line (with its text), not a
        // bogus column, and must not carry the noisy pest caret dump.
        let src = "{\n  _id: ObjectId(\"68946bc8207a437dfe44ce70\"),\n  status: true,\n  updatedAt: ISODate(\"2025-08-07T09:03:04.064Z\")\n  __v: 0\n}";
        let err = parse_value(src).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("line 4"), "message was: {msg}");
        assert!(msg.contains("updatedAt: ISODate"), "message was: {msg}");
        assert!(msg.contains("a missing comma"), "message was: {msg}");
        // The misleading pest grammar wording must not leak through.
        assert!(!msg.contains("expected boolean"), "pest wording leaked: {msg}");
        assert!(!msg.contains("-->") && !msg.contains('|'), "pest dump leaked: {msg}");
    }

    #[test]
    fn json5_flavors() {
        let v = parse_value("{ name: 'x', tags: ['a', 'b',], /* note */ ok: true, }").unwrap();
        assert_eq!(v, json!({"name": "x", "tags": ["a", "b"], "ok": true}));
    }

    #[test]
    fn aggregate_pipeline() {
        let st = parse_statement(
            "db.orders.aggregate([{$match: {status: 'paid'}}, {$group: {_id: '$cat', n: {$sum: 1}}}])",
        )
        .unwrap();
        match st {
            Statement::Collection { method, args, .. } => {
                assert_eq!(method, "aggregate");
                assert!(args[0].is_array());
                assert_eq!(args[0][0]["$match"]["status"], json!("paid"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn special_statements() {
        assert_eq!(parse_statement("show dbs").unwrap(), Statement::ShowDbs);
        assert_eq!(parse_statement("show databases;").unwrap(), Statement::ShowDbs);
        assert_eq!(parse_statement("show collections").unwrap(), Statement::ShowCollections);
        assert_eq!(parse_statement("use analytics").unwrap(), Statement::Use("analytics".into()));
        assert_eq!(parse_statement("db.stats()").unwrap(), Statement::DbStats);
        assert_eq!(parse_statement("db.dropDatabase()").unwrap(), Statement::DropDatabase);
    }

    #[test]
    fn run_command() {
        let st = parse_statement("db.runCommand({ping: 1})").unwrap();
        assert_eq!(st, Statement::RunCommand(json!({"ping": 1})));
    }

    #[test]
    fn comments_stripped() {
        let st = parse_statement(
            "// who are the admins?\ndb.users.find({role: 'admin'}) // tail comment",
        )
        .unwrap();
        match st {
            Statement::Collection { method, args, .. } => {
                assert_eq!(method, "find");
                assert_eq!(args[0]["role"], json!("admin"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn url_in_string_not_a_comment() {
        let v = parse_value(r#"{site: "https://example.com/x"}"#).unwrap();
        assert_eq!(v["site"], json!("https://example.com/x"));
    }

    #[test]
    fn multiple_statements_rejected() {
        assert!(parse_statement("db.a.find({}); db.b.find({})").is_err());
    }

    #[test]
    fn missing_parens_hint() {
        let err = parse_statement("db.users.find").unwrap_err().to_string();
        assert!(err.contains("find({})"), "got: {err}");
    }

    #[test]
    fn second_arg_projection() {
        let st = parse_statement("db.u.find({a: 1}, {b: 0, _id: 0})").unwrap();
        match st {
            Statement::Collection { args, .. } => {
                assert_eq!(args.len(), 2);
                assert_eq!(args[1], json!({"b": 0, "_id": 0}));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn string_with_comma_and_parens_in_args() {
        let st = parse_statement(r#"db.u.insertOne({name: "Doe, John (Jr)", age: 30})"#).unwrap();
        match st {
            Statement::Collection { args, .. } => {
                assert_eq!(args[0]["name"], json!("Doe, John (Jr)"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn bindata_and_timestamp() {
        let v = parse_value(r#"{b: BinData(0, "aGVsbG8="), t: Timestamp(170000, 1)}"#).unwrap();
        assert_eq!(v["b"], json!({"$binary": {"base64": "aGVsbG8=", "subType": "00"}}));
        assert_eq!(v["t"], json!({"$timestamp": {"t": 170000, "i": 1}}));
    }

    #[test]
    fn parse_doc_or_empty_blank() {
        assert_eq!(parse_doc_or_empty("  ").unwrap(), json!({}));
        assert_eq!(parse_doc_or_empty("{age: {$gte: 21}}").unwrap(), json!({"age": {"$gte": 21}}));
        assert!(parse_doc_or_empty("[1,2]").is_err());
    }
}
