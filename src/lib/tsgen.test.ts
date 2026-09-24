import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, generate, looksLikeMap, singularize, typeName, type ShapeNode, type SchemaTree } from "./tsgen";

/** Tiny shape builder: kinds counted per value, like the backend does. */
function shape(kinds: Record<string, number>, extra: Partial<ShapeNode> = {}): ShapeNode {
  const count = Object.values(kinds).reduce((a, b) => a + b, 0);
  return { count, kinds, objects: kinds.object ?? 0, fields: [], capped: false, items: null, values: null, examples: [], ...extra };
}
const field = (name: string, present: number, s: ShapeNode) => ({ name, present, shape: s });

const tree: SchemaTree = {
  sampled: 10,
  root: shape(
    { object: 10 },
    {
      fields: [
        field("_id", 10, shape({ objectId: 10 })),
        field("riskLevel", 10, shape({ string: 10 }, { values: [["RED", 4], ["AMBER", 3], ["GREEN", 3]] })),
        field("createdAt", 10, shape({ date: 10 })),
        field("score", 7, shape({ int: 6, null: 1 })),
        field(
          "trend",
          10,
          shape({ object: 10 }, { fields: [field("who5", 10, shape({ object: 10 }, { fields: [field("score", 10, shape({ int: 10 }))] }))] })
        ),
        field(
          "items",
          10,
          shape({ array: 10 }, { items: shape({ object: 12 }, { fields: [field("sku", 12, shape({ string: 12 })), field("qty", 6, shape({ double: 6 }))] }) })
        ),
        field("tags", 3, shape({ array: 3 }, { items: shape({ string: 5 }) })),
        field("first-name", 10, shape({ string: 10 })),
      ],
    }
  ),
};

const opts = { ...DEFAULT_OPTIONS, rootName: "profiles" };

describe("tsgen - TypeScript", () => {
  it("backend: native BSON types, optional + nullable, inline nesting", () => {
    const { text } = generate(tree, opts, {});
    expect(text).toContain('import type { ObjectId } from "mongodb";');
    expect(text).toContain("export interface Profiles {");
    expect(text).toContain("  _id: ObjectId;");
    expect(text).toContain("  createdAt: Date;");
    expect(text).toContain("  score?: number | null;");
    expect(text).toContain("  trend: {\n    who5: {\n      score: number;\n    };\n  };");
    expect(text).toContain("  items: {\n    sku: string;\n    qty?: number;\n  }[];");
    expect(text).toContain("  tags?: string[];");
    expect(text).toContain('  "first-name": string;');
  });

  it("frontend: ObjectId and Date become strings, no import", () => {
    const { text } = generate(tree, { ...opts, target: "frontend" }, {});
    expect(text).not.toContain("import");
    expect(text).toContain("  _id: string;");
    expect(text).toContain("  createdAt: string;");
  });

  it("per-field override beats the target default", () => {
    const { text } = generate(tree, { ...opts, target: "frontend" }, { _id: { as: "native" } });
    expect(text).toContain('import type { ObjectId } from "bson";');
    expect(text).toContain("  _id: ObjectId;");
    expect(text).toContain("  createdAt: string;");
  });

  it("extracts objects and array elements into named interfaces", () => {
    const { text, decls } = generate(tree, opts, { trend: { extract: true }, "items[]": { extract: true }, "trend.who5": { extract: true, name: "WhoScore" } });
    expect(text).toContain("  trend: Trend;");
    expect(text).toContain("  items: Item[];");
    expect(text).toContain("export interface Trend {\n  who5: WhoScore;\n}");
    expect(text).toContain("export interface WhoScore {\n  score: number;\n}");
    expect(text).toContain("export interface Item {");
    expect(decls.map((d) => d.name)).toEqual(["Profiles", "Trend", "WhoScore", "Item"]);
  });

  it("literal unions, type aliases, no export, required override", () => {
    const { text } = generate(tree, { ...opts, declaration: "type", exported: false, nullable: false }, { riskLevel: { union: true }, score: { optional: false } });
    expect(text).toContain("type Profiles = {");
    expect(text).toContain('  riskLevel: "RED" | "AMBER" | "GREEN";');
    expect(text).toContain("  score: number;");
    expect(text).not.toContain("export");
  });

  it("mongoose source uses Types.ObjectId", () => {
    const { text } = generate(tree, { ...opts, oidSource: "mongoose" }, {});
    expect(text).toContain('import type { Types } from "mongoose";');
    expect(text).toContain("  _id: Types.ObjectId;");
  });

  it("maps line paths for the structure panel", () => {
    const { lines } = generate(tree, opts, {});
    const line = lines.find((l) => l.path === "items[].sku");
    expect(line?.toks.map((t) => t.v).join("")).toBe("    sku: string;");
  });
});

describe("tsgen - Zod", () => {
  it("declares extracted schemas before use and infers types", () => {
    const { text } = generate(tree, { ...opts, format: "zod" }, { "items[]": { extract: true }, riskLevel: { union: true } });
    expect(text).toContain('import { z } from "zod";');
    expect(text).toContain('import { ObjectId } from "mongodb";');
    expect(text.indexOf("export const ItemSchema")).toBeLessThan(text.indexOf("export const ProfilesSchema"));
    expect(text).toContain("  _id: z.instanceof(ObjectId),");
    expect(text).toContain('  riskLevel: z.enum(["RED", "AMBER", "GREEN"]),');
    expect(text).toContain("  score: z.number().int().nullable().optional(),");
    expect(text).toContain("  items: z.array(ItemSchema),");
    expect(text).toContain("export type Profiles = z.infer<typeof ProfilesSchema>;");
  });

  it("frontend zod validates ObjectId strings and ISO dates", () => {
    const { text } = generate(tree, { ...opts, format: "zod", target: "frontend" }, {});
    expect(text).toContain("  _id: z.string().regex(/^[0-9a-f]{24}$/i),");
    expect(text).toContain("  createdAt: z.string().datetime(),");
  });
});

describe("tsgen - helpers", () => {
  it("names types", () => {
    expect(typeName("saarthprofiles", true)).toBe("Saarthprofile");
    expect(typeName("user_accounts", true)).toBe("UserAccount");
    expect(typeName("agendaJobs", true)).toBe("AgendaJob");
    expect(singularize("categories")).toBe("category");
    expect(singularize("status")).toBe("status");
  });

  it("spots id-keyed maps", () => {
    const m = shape({ object: 2 }, { fields: ["6a39f5337c4effc5d4150d41", "6a39f5337c4effc5d4150d42", "6a39f5337c4effc5d4150d43"].map((k) => field(k, 1, shape({ int: 1 }))) });
    expect(looksLikeMap(m)).toBe(true);
    const t = generate({ sampled: 2, root: shape({ object: 2 }, { fields: [field("byUser", 2, m)] }) }, opts, {}).text;
    expect(t).toContain("  byUser: Record<string, number>;");
  });
});
