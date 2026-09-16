import { expect, test } from "@playwright/test"

import { ID_PATTERN } from "../../scripts/lib/product-contract.mjs"

/**
 * Registration surface for the Product Semantic Contract (Factory v1.2 · N4).
 *
 * ## How a product declares an invariant
 *
 * 1. add it to `product-contract.json` (`id`, `statement`, `enforcement`);
 * 2. wrap the test that holds it:
 *
 * ```ts
 * import { invariant } from "./support/product-contract"
 *
 * invariant(
 *   "tension.resolved-requires-fact-change",
 *   "把紧张标记为「已解决」必须伴随一次真实的事实变更",
 *   () => {
 *     test("正例：变更事实后可以解决", async () => { … })
 *     test("负例：只改状态码 → 必须被拒绝", async () => { … })
 *   },
 * )
 * ```
 *
 * `pnpm factory:contract` then checks both directions: every declared id has a
 * registration, and every registration is declared.
 *
 * ## Why a helper and not a naming convention
 *
 * The id must not depend on a test title. The third prototype's invariants were
 * named `"1 · evidence.all-resolvable"` in a describe title — readable, and
 * invisible to anything that is not a human reading the file. The helper makes
 * the id a real argument, so the scanner has something exact to look for and
 * the contract has something exact to match against.
 *
 * ## What this file deliberately does not do
 *
 * It does not check that the test actually tests the statement — no machine can,
 * and pretending otherwise would be the kind of false confidence this Factory
 * keeps removing. It checks that the *declaration exists* and that *something
 * claims to hold it*.
 */

/** Ids registered in this worker process, in declaration order. */
export const REGISTERED_INVARIANTS: string[] = []

/**
 * Declare and register one product invariant.
 *
 * @param id dotted lowercase id, e.g. `finding.suggestion-excluded`
 * @param title human-readable title (Chinese is fine — the id is the key)
 * @param body defines the tests that hold the invariant
 */
export function invariant(id: string, title: string, body: () => void): void {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    // Loud at the test level, because a malformed id would otherwise surface
    // only in the gate — far from the line that wrote it.
    throw new Error(
      `invariant() 的 id 不合法：${JSON.stringify(id)}。` +
        " 必须是点分的小写 kebab（至少两段），例如 tension.resolved-requires-fact-change。",
    )
  }
  if (REGISTERED_INVARIANTS.includes(id)) {
    throw new Error(`invariant \`${id}\` 在同一个 worker 里被登记了两次。`)
  }
  REGISTERED_INVARIANTS.push(id)

  test.describe(`${id} · ${title}`, () => {
    body()
  })
}

/**
 * Assert that a statement is a statement: not a slogan, not a stub.
 *
 * Exported for specs that want the same floor the contract applies, without
 * reaching into the gate's internals.
 */
export function expectMeaningfulStatement(statement: string): void {
  expect(typeof statement).toBe("string")
  expect(statement.trim().length).toBeGreaterThanOrEqual(12)
}
