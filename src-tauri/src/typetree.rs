//! Nested type inference for the TypeScript / Zod exporter.
//!
//! Unlike the flat field report in `analyze_schema`, this keeps the real
//! shape: object children merged across documents (with how many parents
//! contained each key, so optional fields are known), array elements merged
//! into one element shape, and the distinct values of short strings so the UI
//! can suggest literal unions ("RED" | "AMBER" | "GREEN").

use std::collections::{BTreeMap, HashMap};

use mongodb::bson::{Bson, Document};
use serde_json::{json, Value};

/// Past this depth values are recorded as their kind only.
const MAX_DEPTH: usize = 16;
/// Objects with more keys than this are dynamic maps, not records.
const MAX_FIELDS: usize = 400;
/// Distinct string values tracked per node before giving up on an enum.
const MAX_DISTINCT: usize = 24;
const MAX_ENUM_LEN: usize = 64;

fn kind(b: &Bson) -> &'static str {
    match b {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null | Bson::Undefined => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binary",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Decimal128(_) => "decimal",
        _ => "unknown",
    }
}

#[derive(Default)]
pub struct Shape {
    /// Values observed at this position.
    count: i64,
    kinds: BTreeMap<&'static str, i64>,
    /// Object values seen (the denominator for child `present`).
    objects: i64,
    fields: Vec<(String, Field)>,
    index: HashMap<String, usize>,
    capped: bool,
    /// Merged shape of every array element seen here.
    items: Option<Box<Shape>>,
    /// `None` once there are too many distinct strings to be an enum.
    strings: Option<BTreeMap<String, i64>>,
    examples: Vec<Value>,
}

struct Field {
    present: i64,
    shape: Shape,
}

impl Shape {
    pub fn new() -> Self {
        Shape { strings: Some(BTreeMap::new()), ..Default::default() }
    }

    pub fn add_doc(&mut self, d: &Document) {
        self.count += 1;
        *self.kinds.entry("object").or_insert(0) += 1;
        self.add_fields(d, 0);
    }

    fn add_fields(&mut self, d: &Document, depth: usize) {
        self.objects += 1;
        for (k, v) in d {
            let idx = match self.index.get(k) {
                Some(&i) => i,
                None => {
                    if self.fields.len() >= MAX_FIELDS {
                        self.capped = true;
                        continue;
                    }
                    self.fields.push((k.clone(), Field { present: 0, shape: Shape::new() }));
                    self.index.insert(k.clone(), self.fields.len() - 1);
                    self.fields.len() - 1
                }
            };
            let f = &mut self.fields[idx].1;
            f.present += 1;
            f.shape.add(v, depth + 1);
        }
    }

    fn add(&mut self, v: &Bson, depth: usize) {
        self.count += 1;
        *self.kinds.entry(kind(v)).or_insert(0) += 1;
        if depth > MAX_DEPTH {
            return;
        }
        match v {
            Bson::Document(d) => self.add_fields(d, depth),
            Bson::Array(arr) => {
                let items = self.items.get_or_insert_with(|| Box::new(Shape::new()));
                for e in arr {
                    items.add(e, depth + 1);
                }
            }
            Bson::String(s) => {
                if let Some(map) = &mut self.strings {
                    if s.len() > MAX_ENUM_LEN {
                        self.strings = None;
                    } else {
                        *map.entry(s.clone()).or_insert(0) += 1;
                        if map.len() > MAX_DISTINCT {
                            self.strings = None;
                        }
                    }
                }
            }
            _ => {}
        }
        if self.examples.len() < 2 && !matches!(v, Bson::Document(_) | Bson::Array(_)) {
            let ex = v.clone().into_relaxed_extjson();
            if !self.examples.contains(&ex) {
                self.examples.push(ex);
            }
        }
    }

    pub fn to_json(&self) -> Value {
        let only_strings = self.kinds.keys().all(|k| *k == "string" || *k == "null");
        let values = match (&self.strings, self.kinds.contains_key("string") && only_strings) {
            (Some(map), true) if !map.is_empty() => {
                let mut v: Vec<(&String, &i64)> = map.iter().collect();
                v.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
                json!(v.into_iter().map(|(s, n)| json!([s, n])).collect::<Vec<_>>())
            }
            _ => Value::Null,
        };
        json!({
            "count": self.count,
            "kinds": self.kinds,
            "objects": self.objects,
            "fields": self.fields.iter().map(|(name, f)| json!({
                "name": name,
                "present": f.present,
                "shape": f.shape.to_json(),
            })).collect::<Vec<_>>(),
            "capped": self.capped,
            "items": self.items.as_ref().map(|i| i.to_json()),
            "values": values,
            "examples": self.examples,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId};

    #[test]
    fn merges_fields_arrays_and_enums() {
        let mut root = Shape::new();
        root.add_doc(&doc! { "_id": ObjectId::new(), "risk": "RED", "tags": ["a"], "items": [{ "sku": "x", "qty": 1 }] });
        root.add_doc(&doc! { "_id": ObjectId::new(), "risk": "GREEN", "items": [{ "sku": "y" }], "note": null });
        let j = root.to_json();
        let fields = j["fields"].as_array().unwrap();
        let get = |n: &str| fields.iter().find(|f| f["name"] == n).unwrap().clone();

        assert_eq!(j["objects"], 2);
        assert_eq!(get("_id")["present"], 2);
        assert_eq!(get("tags")["present"], 1);
        assert_eq!(get("risk")["shape"]["values"].as_array().unwrap().len(), 2);
        let items = &get("items")["shape"]["items"];
        assert_eq!(items["objects"], 2);
        let qty = items["fields"].as_array().unwrap().iter().find(|f| f["name"] == "qty").unwrap();
        assert_eq!(qty["present"], 1);
        assert_eq!(get("note")["shape"]["kinds"]["null"], 1);
    }

    #[test]
    fn long_or_many_strings_are_not_enums() {
        let mut root = Shape::new();
        for i in 0..40 {
            root.add_doc(&doc! { "email": format!("user{i}@example.com") });
        }
        let j = root.to_json();
        assert!(j["fields"][0]["shape"]["values"].is_null());
    }
}
