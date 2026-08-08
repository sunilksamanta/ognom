import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, kindOf, leafText } from "./bson";

describe("kindOf", () => {
  it("classifies extJSON wrappers", () => {
    expect(kindOf({ $oid: "aaaaaaaaaaaaaaaaaaaaaaaa" })).toBe("objectId");
    expect(kindOf({ $date: "2024-01-01T00:00:00Z" })).toBe("date");
    expect(kindOf({ $numberLong: "9" })).toBe("long");
    expect(kindOf(null)).toBe("null");
    expect(kindOf("x")).toBe("string");
    expect(kindOf(3)).toBe("number");
    expect(kindOf([1])).toBe("array");
    expect(kindOf({ plain: true })).toBe("object");
  });
});

describe("leafText", () => {
  it("renders ObjectId hex", () => {
    expect(leafText({ $oid: "abcabcabcabcabcabcabcabc" })).toBe("abcabcabcabcabcabcabcabc");
  });
  it("renders longs and decimals from their wrappers", () => {
    expect(leafText({ $numberLong: "42" })).toBe("42");
    expect(leafText({ $numberDecimal: "1.5" })).toBe("1.5");
  });
  it("renders regex in shell form", () => {
    expect(leafText({ $regularExpression: { pattern: "ab", options: "i" } })).toBe("/ab/i");
  });
});

describe("formatBytes", () => {
  it("handles missing values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
  it("uses bytes below 1 KiB and scales above", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatCount", () => {
  it("adds thousands separators", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(null)).toBe("—");
  });
});
