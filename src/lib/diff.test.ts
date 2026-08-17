import { describe, expect, it } from "vitest";
import { diffDocs, formatId, previewValue } from "./diff";

describe("diffDocs", () => {
  it("returns nothing for identical docs", () => {
    const a = { _id: { $oid: "aaaaaaaaaaaaaaaaaaaaaaaa" }, name: "x", n: 1 };
    expect(diffDocs(a, { ...a })).toEqual([]);
  });

  it("reports changed leaves with both sides", () => {
    const out = diffDocs({ a: 1 }, { a: 2 });
    expect(out).toEqual([{ path: "a", left: 1, right: 2 }]);
  });

  it("walks nested objects with dotted paths", () => {
    const out = diffDocs({ user: { name: "a", age: 1 } }, { user: { name: "b", age: 1 } });
    expect(out).toEqual([{ path: "user.name", left: "a", right: "b" }]);
  });

  it("reports one-sided fields", () => {
    const out = diffDocs({ a: 1, gone: true }, { a: 1, added: false });
    expect(out).toContainEqual({ path: "gone", left: true });
    expect(out).toContainEqual({ path: "added", right: false });
    expect(out).toHaveLength(2);
  });

  it("indexes into arrays", () => {
    const out = diffDocs({ tags: ["a", "b"] }, { tags: ["a", "c", "d"] });
    expect(out).toContainEqual({ path: "tags[1]", left: "b", right: "c" });
    expect(out).toContainEqual({ path: "tags[2]", right: "d" });
  });

  it("treats extJSON wrappers as leaves, not objects", () => {
    const out = diffDocs(
      { when: { $date: "2024-01-01T00:00:00Z" } },
      { when: { $date: "2025-01-01T00:00:00Z" } }
    );
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("when");
  });

  it("flags type mismatches as a single leaf change", () => {
    const out = diffDocs({ v: { nested: 1 } }, { v: "plain" });
    expect(out).toEqual([{ path: "v", left: { nested: 1 }, right: "plain" }]);
  });
});

describe("previewValue", () => {
  it("renders ObjectId extJSON compactly", () => {
    expect(previewValue({ $oid: "abc123abc123abc123abc123" })).toBe(
      "ObjectId(abc123abc123abc123abc123)"
    );
  });

  it("renders missing values as an em dash", () => {
    expect(previewValue(undefined)).toBe(" - ");
  });

  it("truncates long values", () => {
    const long = previewValue({ text: "x".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("...")).toBe(true);
  });

  it("renders numeric $date extJSON as ISO", () => {
    expect(previewValue({ $date: { $numberLong: "0" } })).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("formatId", () => {
  it("delegates to previewValue", () => {
    expect(formatId({ $oid: "ffffffffffffffffffffffff" })).toBe(
      "ObjectId(ffffffffffffffffffffffff)"
    );
    expect(formatId(42)).toBe("42");
  });
});
