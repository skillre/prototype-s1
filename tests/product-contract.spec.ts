import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  CONTRACT_FILENAME,
  ENFORCEMENT_KINDS,
  ID_PATTERN,
  SCHEMA_VERSION,
  assertNonVacuousScan,
  crossCheckContract,
  scanRegistrations,
  validateProductContract,
} from "../scripts/lib/product-contract.mjs"
import { stripComments } from "../scripts/lib/kits-seam.mjs"
import { invariant } from "./support/product-contract"

/**
 * The Product Semantic Contract (Factory v1.2 · N4 = F11).
 *
 * The third prototype had 18 well-written, fully-enforced invariants and no way
 * for anything outside their spec file to know they existed. This contract is
 * the registration surface; this spec is the proof that both directions of the
 * check can fail.
 */

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const codes = (input: unknown) =>
  validateProductContract(input).issues.map((issue) => issue.code)
const errors = (input: unknown) =>
  validateProductContract(input).issues.filter((issue) => issue.severity === "error")

const VALID_ENTRY = {
  id: "tension.resolved-requires-fact-change",
  statement: "把紧张标记为「已解决」必须伴随一次真实的事实变更，而不只是状态字段被改写。",
  enforcement: "test",
}
const VALID_CONTRACT = { schemaVersion: SCHEMA_VERSION, invariants: [VALID_ENTRY] }

/** Write a fixture tree; `files` are repo-relative paths. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "factory-contract-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

/**
 * A line that registers an id, assembled so this file does not look like a
 * registration to the scanner. The scanner reads literal `invariant("<id>"`
 * calls; a spec that builds fixtures must not accidentally count as one.
 */
const registrationLine = (id: string) =>
  `${"inv" + "ariant"}(${JSON.stringify(id)}, () => {})`

/* -------------------------------------------------------------------------- */
/* §7.1 / §7.6 — zero invariants is a legitimate product                       */
/* -------------------------------------------------------------------------- */

test.describe("contract shape", () => {
  test("zero invariants is legal — and says so out loud", () => {
    const result = validateProductContract({ schemaVersion: SCHEMA_VERSION, invariants: [] })
    expect(result.ok, "0 条不变量必须合法").toBe(true)
    expect(result.issues.map((i) => i.code)).toContain("contract/no-invariants")
    // A warning, not an error: "no invariants" and "nobody asked" must not be
    // the same output, but only one of them is a failure.
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true)
  })

  test("a well-formed declaration passes", () => {
    expect(errors(VALID_CONTRACT)).toEqual([])
  })

  test("the document itself is closed", () => {
    expect(codes({ ...VALID_CONTRACT, extra: 1 })).toContain("contract/unknown-field")
    expect(codes({ ...VALID_CONTRACT, schemaVersion: 2 })).toContain(
      "contract/unsupported-schema-version",
    )
    expect(codes({ invariants: [] })).toContain("contract/unsupported-schema-version")
    expect(codes({ schemaVersion: SCHEMA_VERSION })).toContain("contract/missing-field")
    expect(codes({ schemaVersion: SCHEMA_VERSION, invariants: "none" })).toContain(
      "contract/not-an-array",
    )
    for (const bad of [null, undefined, "x", 42, []]) {
      expect(validateProductContract(bad).ok, `${JSON.stringify(bad)} 必须失败`).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* §7.3 / §7.6 / §7.7 — a declaration that says nothing                        */
/* -------------------------------------------------------------------------- */

test.describe("declaration rejections", () => {
  const withEntry = (entry: Record<string, unknown>) => ({
    schemaVersion: SCHEMA_VERSION,
    invariants: [entry],
  })

  test("a declaration without enforcement fails", () => {
    expect(codes(withEntry({ ...VALID_ENTRY, enforcement: undefined }))).toContain(
      "contract/missing-field",
    )
    expect(codes(withEntry({ ...VALID_ENTRY, enforcement: undefined }))).not.toContain(
      "contract/unknown-enforcement",
    )
  })

  test("an unknown enforcement kind fails", () => {
    for (const bad of ["manual", "qa", "review", 1, null]) {
      expect(
        codes(withEntry({ ...VALID_ENTRY, enforcement: bad })),
        `enforcement ${JSON.stringify(bad)} 必须失败`,
      ).toContain("contract/unknown-enforcement")
    }
    expect(ENFORCEMENT_KINDS).toEqual(["test"])
  })

  test("a malformed id fails, and the message says what a good one looks like", () => {
    for (const bad of [
      "已解决必须真的解决",
      "Tension.Resolved",
      "tension",
      "tension..resolved",
      "tension.Resolved-Requires",
      "9lives.thing",
      "tension.resolved ",
    ]) {
      expect(codes(withEntry({ ...VALID_ENTRY, id: bad })), `id ${JSON.stringify(bad)} 必须失败`).toContain(
        "contract/invalid-id",
      )
    }
    const message = validateProductContract(withEntry({ ...VALID_ENTRY, id: "不是 id" })).issues.find(
      (i) => i.code === "contract/invalid-id",
    )
    expect(message?.message).toContain("tension.resolved-requires-fact-change")
  })

  test("a short or empty statement fails", () => {
    expect(codes(withEntry({ ...VALID_ENTRY, statement: "" }))).toContain("contract/empty-field")
    expect(codes(withEntry({ ...VALID_ENTRY, statement: "别坏" }))).toContain(
      "contract/statement-too-short",
    )
    expect(codes(withEntry({ ...VALID_ENTRY, statement: undefined }))).toContain(
      "contract/missing-field",
    )
  })

  test("a duplicate id fails", () => {
    const doubled = { schemaVersion: SCHEMA_VERSION, invariants: [VALID_ENTRY, VALID_ENTRY] }
    expect(codes(doubled)).toContain("contract/duplicate-id")
  })

  test("unknown fields inside a declaration fail", () => {
    expect(codes(withEntry({ ...VALID_ENTRY, note: "why" }))).toContain("contract/unknown-field")
  })
})

/* -------------------------------------------------------------------------- */
/* §7.4 / §7.5 — the bidirectional check                                       */
/* -------------------------------------------------------------------------- */

test.describe("declared ↔ registered", () => {
  test("both sides present is OK", () => {
    const result = crossCheckContract(VALID_CONTRACT, [
      { id: VALID_ENTRY.id, file: "tests/x.spec.ts" },
    ])
    expect(result.ok).toBe(true)
  })

  test("declared with no registration FAILS", () => {
    const result = crossCheckContract(VALID_CONTRACT, [])
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(["contract/unregistered"])
    expect(result.issues[0].message).toContain("invariant()")
  })

  test("registration with no declaration FAILS", () => {
    const result = crossCheckContract({ schemaVersion: SCHEMA_VERSION, invariants: [] }, [
      { id: "demo.rule", file: "tests/demo.spec.ts" },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(["contract/undeclared"])
    expect(result.issues[0].message).toContain("tests/demo.spec.ts")
  })

  test("the scanner reads literal registrations, and only those", () => {
    const root = fixture({
      "tests/a.spec.ts": [
        "import { invariant } from './support/product-contract'",
        registrationLine("alpha.one"),
        registrationLine("alpha.two"),
        `const dynamic = ${JSON.stringify("beta")}`,
        `${"inv" + "ariant"}("gamma.three", () => {})`,
      ].join("\n"),
      "tests/support/product-contract.ts": [
        "export function " + "invariant(id: string, title: string, body: () => void) {}",
      ].join("\n"),
    })

    const scan = scanRegistrations(root)
    expect(scan.registrations.map((r: { id: string }) => r.id).sort()).toEqual([
      "alpha.one",
      "alpha.two",
      "gamma.three",
    ])
    // The helper's own definition is not a registration — it has no literal.
    expect(scan.registrations.some((r: { file: string }) => r.file.includes("support/"))).toBe(false)
    expect(scan.scanned).toBeGreaterThan(0)
  })

  test("a scan that read nothing FAILS instead of passing", () => {
    const root = fixture({ "README.md": "no tests here\n" })
    const scan = scanRegistrations(root)
    expect(scan.scanned).toBe(0)
    expect(() => assertNonVacuousScan(scan, { declaredCount: 2 })).toThrow(/根本没检查/)
  })
})

/* -------------------------------------------------------------------------- */
/* §7.10 — the Factory never invents a product's semantics                     */
/* -------------------------------------------------------------------------- */

test.describe("no generated semantics", () => {
  test("the gate has no product knowledge and no generator", () => {
    // Structural, not lexical: the words to worry about are in the module's own
    // "we do not infer anything" comment, so the check is about what the code
    // can *do* — read product source, or write a declaration.
    for (const file of ["scripts/lib/product-contract.mjs", "scripts/verify-product-contract.mjs"]) {
      const source = stripComments(read(file))
      expect(source, `${file} 不得写任何文件（不含 generator）`).not.toMatch(
        /writeFileSync|appendFileSync|mkdirSync|createWriteStream|\brmSync\b/,
      )
      expect(source, `${file} 不得 import 产品代码`).not.toMatch(
        /from\s+["'][^"']*(lib\/research|lib\/crm|app\/crm|app\/demo)/,
      )
    }
  })

  test("the shipped contract declares this product's own invariants", () => {
    /*
     * 原断言是基线规则：starter 里出现产品领域不变量 = 继承来的残留。
     * 本仓是**产品**（`init-contract.json` 的 `stage: "product"`），规则因此反过来：
     * 领域不变量在这里是**全部意义**，`product-contract.json` 就是它们的家；
     * 而基线级的 `factory.*` 不变量不该在没有对应登记的情况下留下来
     * （与 `prototype-ai-research` / `prototype-ai-finance` 的处置一致）。
     *
     * `contract.declaration-matches-enforcement` 例外且**必须**在：它的登记就在这个文件里，
     * 契约不声明它，`pnpm factory:contract` 就会报 `contract/undeclared`。
     */
    const contract = JSON.parse(read(CONTRACT_FILENAME))
    const ids = contract.invariants.map((entry: { id: string }) => entry.id)

    for (const id of ids) expect(id, `${id} 不是合法 id`).toMatch(ID_PATTERN)
    expect(ids.length).toBeGreaterThan(0)

    // 门禁自己的不变量：登记在本文件里，所以契约必须声明它。
    expect(ids).toContain("contract.declaration-matches-enforcement")

    // 没有登记方的基线级不变量不该留在这里。
    expect(ids.filter((id: string) => id.startsWith("factory."))).toEqual([])

    // 反方向：这个产品自己的语义必须有家（否则「没人问过」会被当成「没问题」）。
    expect(ids.filter((id: string) => !id.startsWith("contract.")).length).toBeGreaterThan(0)
  })

  test("the schema and the module agree", () => {
    const schema = JSON.parse(read("lib/product-contract.schema.json"))
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(["schemaVersion", "invariants"])
    expect(schema.properties.schemaVersion.const).toBe(SCHEMA_VERSION)
    expect(new Set(schema.properties.invariants.items.properties.enforcement.enum)).toEqual(
      new Set(ENFORCEMENT_KINDS),
    )
    expect(VALID_ENTRY.id).toMatch(ID_PATTERN)
  })
})

/* -------------------------------------------------------------------------- */
/* the Factory's own contract                                                  */
/* -------------------------------------------------------------------------- */

invariant(
  "contract.declaration-matches-enforcement",
  "契约里的每条声明都有测试登记，且每条登记都被声明",
  () => {
    test("the real contract and the real registrations agree", () => {
      const contract = JSON.parse(read(CONTRACT_FILENAME))
      const validation = validateProductContract(contract)
      expect(validation.issues.filter((i) => i.severity === "error")).toEqual([])

      const scan = scanRegistrations(ROOT)
      assertNonVacuousScan(scan, { declaredCount: contract.invariants.length })
      expect(scan.scanned).toBeGreaterThan(5)

      const result = crossCheckContract(contract, scan.registrations)
      expect(result.issues, JSON.stringify(result.issues, null, 2)).toEqual([])
      expect(result.ok).toBe(true)
    })
  },
)

test.describe("the gate CLI", () => {
  const runGate = (args: string[], cwd = ROOT) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [join(ROOT, "scripts/verify-product-contract.mjs"), ...args],
        { encoding: "utf8", cwd },
      )
      return { status: 0, stdout }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { status: failure.status ?? -1, stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
    }
  }

  test("passes on the real tree and prints the counts", () => {
    const result = runGate(["--json"])
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.ok).toBe(true)
    expect(report.scannedFiles).toBeGreaterThan(5)
    expect(report.invariants).toBeGreaterThan(0)
  })

  test("fails on a contract with an unenforced declaration", () => {
    const root = fixture({
      [CONTRACT_FILENAME]: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        invariants: [{ ...VALID_ENTRY, id: "demo.never-happens" }],
      }),
      "tests/a.spec.ts": "// no registrations here\n",
    })
    const result = runGate([], root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("contract/unregistered")
  })

  test("fails when the contract is missing", () => {
    const root = fixture({ "tests/a.spec.ts": "// nothing\n" })
    const result = runGate([], root)
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("没有找到 Product Semantic Contract")
  })
})

/* -------------------------------------------------------------------------- */
/* §7.9 — the archived product's shape, read-only                              */
/* -------------------------------------------------------------------------- */

test.describe("the third prototype's invariants are expressible", () => {
  const archived = "/Users/skillre/ai-prototypes/prototype-ai-research/tests/invariants.spec.ts"

  test("its describe titles are already nearly ids — this contract gives them a home", () => {
    let source: string
    try {
      source = readFileSync(archived, "utf8")
    } catch {
      test.skip(true, "归档的第三个 Prototype 不在本机")
      return
    }

    const titles = [...source.matchAll(/test\.describe\(\s*"([^"]+)"/g)].map((m) => m[1])
    expect(titles.length).toBeGreaterThan(10)

    // Its own convention already reads `N · area.kebab-statement`.
    const candidates = titles.map((title) => title.replace(/^\d+\s*·\s*/, ""))
    const idShaped = candidates.filter((id) => ID_PATTERN.test(id))
    const notIdShaped = candidates.filter((id) => !ID_PATTERN.test(id))

    // Most of them are ids already…
    expect(idShaped.length).toBeGreaterThan(notIdShaped.length)
    for (const id of ["evidence.all-resolvable", "citation.roundtrip"].filter((i) =>
      candidates.includes(i),
    )) {
      expect(id).toMatch(ID_PATTERN)
    }

    // …and the ones that are not are prose (`unverified ≠ verified`), which is
    // precisely why an id column had to exist instead of a title convention.
    expect(
      notIdShaped.length,
      `这些标题不是合法 id，需要一行改名：${notIdShaped.join(" / ")}`,
    ).toBeGreaterThanOrEqual(0)

    // A contract built from the id-shaped ones validates end to end.
    const expressive = {
      schemaVersion: SCHEMA_VERSION,
      invariants: idShaped.map((id) => ({
        id,
        statement: "从第三个 Prototype 的 invariant 标题恢复（只读验证，未修改该仓库）。",
        enforcement: "test",
      })),
    }
    expect(errors(expressive)).toEqual([])
  })
})
