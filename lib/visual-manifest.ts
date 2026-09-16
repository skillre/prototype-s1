/**
 * Visual Manifest — the Factory's machine-readable Art Direction contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without a declared visual direction, an agent's default aesthetic pulls hard
 * back to "generic AI SaaS": purple gradient, card everywhere, 16px radius,
 * glow on everything. The result is a page that is *fine everywhere and true
 * nowhere*. The fix is procedural, not cosmetic: the visual direction must be
 * **declared before any JSX is written**, and the declaration must be
 * machine-checkable so it cannot be quietly skipped.
 *
 * WHAT THIS FILE OWNS — AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------------
 * Factory Core owns the **contract**: the field set, the shape, and the
 * enforcement rules that make a manifest non-vacuous.
 *
 * Factory Core does NOT own the **creative semantics**. Which Style Pack fits a
 * product, how many signature components a page may carry, what belongs in
 * `avoid`, and what each pack's hard constraints are — all of that lives in
 * Prototype Kits (`skills/visual-direction/SKILL.md`). It is deliberately NOT
 * restated here, because a second copy of a rule is a second source of truth.
 *
 * Consequently this module contains **no asset ids and no visual values**. It
 * must stay a closed vocabulary of *shapes*. The legal *values* for
 * `stylePack` / `signatureComponents` / `effects` are discovered from the Kits
 * registry at verification time, never hardcoded — see
 * `scripts/validate-manifest.mjs`. An enum literal copied into this file would
 * go stale the moment Kits ships a new pack and would make Factory v1.1
 * silently aware of a specific Style Pack, which is exactly what v1.1 exists
 * to prevent.
 *
 * @see docs/visual-manifest.md      — the contract, in prose
 * @see docs/kits-ownership.md       — installed/ vs adapters/ ownership
 */

/** Where a manifest lives, by convention, relative to the prototype repo root. */
export const VISUAL_MANIFEST_FILENAME = "visual-manifest.json"

/** Where a new prototype looks, by convention, for the Kits checkout. */
export const KITS_ROOT_ENV_VAR = "KITS_ROOT"

/**
 * The axes an intentional deviation may be recorded on.
 *
 * Closed on purpose. `density` and `motion` are linked to a manifest field (see
 * `LINKED_DEVIATION_AXES`); the rest are recorded but not cross-checked, because
 * the Factory has nothing to check them against. A typo that produced a new axis
 * would be a decision that looks recorded and is not, so an unknown axis is an
 * error rather than an accepted free-form string.
 */
export const DEVIATION_AXES = [
  "density",
  "motion",
  "layout",
  "component-budget",
  "effect-budget",
  "typography",
  "color",
] as const

export type DeviationAxis = (typeof DEVIATION_AXES)[number]

/**
 * Axes whose `to` value must agree with a declared manifest field.
 *
 * A deviation that contradicts the field it is supposed to explain is worse
 * than no record at all: it reads as a decision that was taken, while the
 * manifest says something else.
 */
export const LINKED_DEVIATION_AXES: Partial<Record<DeviationAxis, keyof VisualManifest>> = {
  density: "density",
  motion: "motionDirection",
}

/**
 * One intentional divergence from a Style Pack default.
 *
 * This is **a record, not a permission**. It says "we know the pack says X, and
 * we are doing Y instead, on purpose, for this reason" — which is a different
 * statement from "we never noticed". That difference is the whole of F1: the
 * third prototype deviated on density and had nowhere to write it down, so the
 * deviation existed as a paragraph in a CSS header and as a silent mismatch
 * against the pack.
 */
export interface VisualManifestDeviation {
  axis: DeviationAxis
  /** The pack's / default's value. Quoted, so the record is readable alone. */
  from: string
  /** What this product does instead. Must not equal `from`. */
  to: string
  /** Why. A deviation without a reason is a typo with a longer body. */
  reason: string
}

/**
 * A declared visual direction.
 *
 * Every field is required. `firstVisual` and `avoid` are the two that carry the
 * most weight: `firstVisual` forces the author to say what the user actually
 * sees first, and `avoid` closes the doors the default aesthetic would
 * otherwise walk through.
 *
 * Field semantics are defined by the Kits `visual-direction` skill; the doc
 * comments below only record what the Factory *validates*.
 */
export interface VisualManifest {
  /** JSON Schema pointer. Optional — purely an editor affordance. */
  $schema?: string
  /**
   * Product type in kebab-case (`ai-finance-console`, `observability-console`).
   * Drives the pack recommendation; must not be a bare category word.
   */
  productType: string
  /**
   * One sentence describing **what the user sees first**.
   * A slogan ("modern, clean, premium") is a validation error, not a value.
   */
  firstVisual: string
  /**
   * Style Pack id. Value must resolve to an `approved` asset of type `style`
   * in the Kits registry — checked at verification time, not encoded here.
   */
  stylePack: string
  /**
   * Signature Component ids. Values must resolve to `approved` assets of type
   * `component`. How MANY a product may carry is the product's own decision,
   * recorded in `signatureComponentBudget` below — never the Factory's.
   */
  signatureComponents: string[]
  /**
   * How many signature components this product allows itself. Optional: the
   * Factory does not impose a number, it enforces the number the product stated.
   * `0` is legal, and a different decision from "we forgot".
   */
  signatureComponentBudget?: number
  /**
   * Effect Pack ids. Values must resolve to `approved` assets of type `effect`.
   * May legitimately be empty — an empty array is a decision, and a different
   * one from "we forgot".
   */
  effects: string[]
  /**
   * Motion language id (e.g. `restrained` / `atmospheric` / `precise`).
   * Must agree with the chosen pack's `motionLanguage`, or carry a recorded
   * `motion` deviation saying why not.
   */
  motionDirection: string
  /** Information density id. Must agree with the chosen pack's `density`. */
  density: string
  /**
   * What this product must **not** look like. Must be non-empty.
   * This is the highest-value field in the manifest: it is the only one that
   * constrains what the default aesthetic would otherwise produce.
   */
  avoid: string[]
  /**
   * Where this product knowingly diverges from its pack's defaults, and why.
   * A deviation is a record, not an approval: it makes a divergence *visible*,
   * and it can never re-open a door `avoid` has closed.
   */
  deviations?: VisualManifestDeviation[]
}

/** Severity of a manifest problem. `error` blocks; `warning` is advisory. */
export type ManifestIssueSeverity = "error" | "warning"

/** One problem found while validating a manifest. */
export interface ManifestIssue {
  /** Dotted path to the offending field, or `$` for document-level problems. */
  path: string
  severity: ManifestIssueSeverity
  /** Stable, greppable machine code — tests assert on this, not on prose. */
  code: string
  /** Human-readable explanation. */
  message: string
}

/** Result of a structural validation pass. */
export interface ManifestValidationResult {
  ok: boolean
  issues: ManifestIssue[]
}

/**
 * Words that describe an *impression* rather than a *sight*.
 *
 * `firstVisual` exists to answer "what do I see first". An answer built only
 * from these words answers nothing — it is the default aesthetic talking.
 * Matching is substring-based against a normalised form, so "现代简洁" is
 * caught without needing a word segmenter for Chinese.
 */
const VACUOUS_FIRST_VISUAL_TERMS = [
  // zh-CN
  "现代",
  "简洁",
  "简约",
  "高级",
  "优雅",
  "美观",
  "大气",
  "干净",
  "清爽",
  "专业",
  "精致",
  "时尚",
  "科技感",
  "设计感",
  "体验好",
  "好看",
  "漂亮",
  "大方",
  // en
  "modern",
  "clean",
  "minimal",
  "minimalist",
  "sleek",
  "elegant",
  "beautiful",
  "premium",
  "professional",
  "polished",
  "nice",
  "pretty",
  "gorgeous",
  "stunning",
  "sophisticated",
  "state-of-the-art",
  "cutting-edge",
] as const

/** Minimum meaningful length of a `firstVisual` description. */
const FIRST_VISUAL_MIN_LENGTH = 12
/** Minimum meaningful length once every vacuous term has been removed. */
const FIRST_VISUAL_MIN_SUBSTANCE = 8

/** Normalise for vacuity matching: lowercase, drop whitespace and punctuation. */
function normaliseForVacuity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
}

/**
 * Does `firstVisual` actually describe something visible?
 *
 * Two ways to fail: too short to carry information, or composed entirely of
 * impression words. Both are reported separately so the author knows which
 * mistake they made.
 */
export function isVacuousFirstVisual(value: string): boolean {
  const normalised = normaliseForVacuity(value)
  if (normalised.length < FIRST_VISUAL_MIN_LENGTH) return true

  let residue = normalised
  for (const term of VACUOUS_FIRST_VISUAL_TERMS) {
    residue = residue.split(normaliseForVacuity(term)).join("")
  }
  return residue.length < FIRST_VISUAL_MIN_SUBSTANCE
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/** The eight required fields, in the order they should be authored. */
const REQUIRED_STRING_FIELDS = [
  "productType",
  "firstVisual",
  "stylePack",
  "motionDirection",
  "density",
] as const

/** Required fields that hold a list of asset ids. */
const REQUIRED_ARRAY_FIELDS = ["signatureComponents", "effects", "avoid"] as const

/** Fields the contract defines. Anything else is rejected, not ignored. */
const KNOWN_FIELDS = new Set<string>([
  "$schema",
  ...REQUIRED_STRING_FIELDS,
  ...REQUIRED_ARRAY_FIELDS,
  "deviations",
  "signatureComponentBudget",
])

/** Fields whose value is a *vocabulary identifier*, not free text. */
const IDENTIFIER_FIELDS = ["motionDirection", "density"] as const

/**
 * Minimum meaningful length of a deviation `reason`.
 *
 * A deviation is the one place the manifest says "we are deliberately not doing
 * what the pack says". "ok" / "n/a" / "-" is not a reason; it is the record of a
 * decision nobody made.
 */
const DEVIATION_REASON_MIN_LENGTH = 8

/** Is this a lowercase identifier token (`medium`, `precise-structural`)? */
export function isIdentifierToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value)
}

/** Normalise for cross-field comparison: lowercase, punctuation and space gone. */
function normaliseToken(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}_]/gu, "")
}

/**
 * Validate a parsed manifest against the Factory's structural contract.
 *
 * Structural only — this deliberately does NOT check whether an asset id
 * exists, because that requires the Kits registry and must therefore happen
 * where the registry is reachable (`scripts/validate-manifest.mjs`).
 *
 * Never throws, and never returns `ok: true` for a document it could not
 * understand. A validator that silently accepts "I couldn't read this" is the
 * exact failure mode that produced a false-green QA pass in Prototype Kits
 * v0.1.1, so unreadable input is always an error.
 */
export function validateVisualManifest(input: unknown): ManifestValidationResult {
  const issues: ManifestIssue[] = []

  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          severity: "error",
          code: "manifest/not-an-object",
          message: "Visual Manifest 必须是一个 JSON 对象。",
        },
      ],
    }
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_FIELDS.has(key)) {
      issues.push({
        path: key,
        severity: "error",
        code: "manifest/unknown-field",
        message: `未知字段 \`${key}\`。Visual Manifest 的字段集合是封闭的；写错字段名通常意味着某个决策没有被记录。`,
      })
    }
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = input[field]
    if (value === undefined) {
      issues.push({
        path: field,
        severity: "error",
        code: "manifest/missing-field",
        message: `缺少必填字段 \`${field}\`。`,
      })
    } else if (!isNonEmptyString(value)) {
      issues.push({
        path: field,
        severity: "error",
        code: "manifest/empty-string",
        message: `\`${field}\` 必须是非空字符串。`,
      })
    }
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    const value = input[field]
    if (value === undefined) {
      issues.push({
        path: field,
        severity: "error",
        code: "manifest/missing-field",
        message: `缺少必填字段 \`${field}\`。`,
      })
      continue
    }
    if (!Array.isArray(value)) {
      issues.push({
        path: field,
        severity: "error",
        code: "manifest/not-an-array",
        message: `\`${field}\` 必须是数组。`,
      })
      continue
    }
    value.forEach((entry, index) => {
      if (!isNonEmptyString(entry)) {
        issues.push({
          path: `${field}[${index}]`,
          severity: "error",
          code: "manifest/empty-entry",
          message: `\`${field}[${index}]\` 必须是非空字符串。`,
        })
      }
    })
  }

  // `avoid` is the manifest's load-bearing field: an empty list means the one
  // decision that constrains the default aesthetic was never made.
  const avoid = input.avoid
  if (Array.isArray(avoid) && avoid.length === 0) {
    issues.push({
      path: "avoid",
      severity: "error",
      code: "manifest/avoid-empty",
      message:
        "`avoid` 不能为空。这一栏是 Manifest 里最有价值的一条：默认审美会主动回拉，写下 avoid 就是在动手前把那些门关掉。",
    })
  }

  // `effects` may be empty — "no effects" is a legitimate decision.
  const firstVisual = input.firstVisual
  if (isNonEmptyString(firstVisual) && isVacuousFirstVisual(firstVisual)) {
    issues.push({
      path: "firstVisual",
      severity: "error",
      code: "manifest/first-visual-vacuous",
      message:
        "`firstVisual` 必须写出「第一眼看到什么」，而不是印象词（如「现代简洁」「modern, clean」）。写不出这一句，说明视觉方向还没想清楚。",
    })
  }

  /*
   * Vocabulary identifiers (L1).
   *
   * The legal *values* come from Kits — the Factory must not enumerate them, or
   * it becomes a second, staler copy of the registry. What the Factory can and
   * does check is that these fields are identifiers at all: a sentence, a
   * number, or an empty string is a malformed decision regardless of which pack
   * is chosen. Membership is checked upstream, in `crossCheckPackProfile`.
   */
  for (const field of IDENTIFIER_FIELDS) {
    const value = input[field]
    if (value === undefined || !isNonEmptyString(value)) continue
    if (!isIdentifierToken(value)) {
      issues.push({
        path: field,
        severity: "error",
        code: "manifest/invalid-identifier",
        message:
          `\`${field}\` 必须是标识符（小写字母开头，只含小写字母、数字与连字符），当前是 ${JSON.stringify(value)}。` +
          " 可选值由所选 pack 定义，不在 Factory 里枚举——但一个句子或一个数字不是可选值。",
      })
    }
  }

  /* ---- signature component budget ---------------------------------------- */

  const budget = input.signatureComponentBudget
  if (budget !== undefined) {
    if (!Number.isInteger(budget) || (budget as number) < 0) {
      issues.push({
        path: "signatureComponentBudget",
        severity: "error",
        code: "manifest/signature-budget-not-an-integer",
        message: "`signatureComponentBudget` 必须是非负整数（0 是合法的：一个签名组件都不要）。",
      })
    } else if (
      Array.isArray(input.signatureComponents) &&
      input.signatureComponents.length > (budget as number)
    ) {
      issues.push({
        path: "signatureComponents",
        severity: "error",
        code: "manifest/signature-budget-exceeded",
        message:
          `声明了 ${input.signatureComponents.length} 个签名组件，但上限是 ${budget}。` +
          " 上限是产品自己定的（Factory 不规定所有产品能用几个）——定了就要守。",
      })
    }
  } else {
    issues.push({
      path: "signatureComponentBudget",
      severity: "warning",
      code: "manifest/signature-budget-undeclared",
      message:
        "未声明 `signatureComponentBudget`：Factory 不会替你规定上限，也不会把一个没写下来的上限当成通过。" +
        " 想让机器守住「最多 2 个」，就把 2 写进去。",
    })
  }

  /* ---- intentional deviations -------------------------------------------- */

  const deviations = input.deviations
  if (deviations !== undefined && !Array.isArray(deviations)) {
    issues.push({
      path: "deviations",
      severity: "error",
      code: "manifest/deviations-not-an-array",
      message: "`deviations` 必须是数组（每一项记录一次有意偏离）。",
    })
  } else if (Array.isArray(deviations)) {
    const seenAxes = new Map<string, number>()
    const avoidTokens = (Array.isArray(input.avoid) ? input.avoid : [])
      .filter((entry): entry is string => typeof entry === "string")
      .map(normaliseToken)

    deviations.forEach((entry, index) => {
      const path = `deviations[${index}]`
      if (!isPlainObject(entry)) {
        issues.push({
          path,
          severity: "error",
          code: "manifest/deviation-not-an-object",
          message: `${path} 必须是一个对象：{ axis, from, to, reason }。`,
        })
        return
      }

      for (const field of ["axis", "from", "to", "reason"] as const) {
        if (entry[field] === undefined) {
          issues.push({
            path: `${path}.${field}`,
            severity: "error",
            code: "manifest/deviation-missing-field",
            message: `${path} 缺少 \`${field}\`。一次偏离必须写清「哪条轴 / 从什么 / 改成什么 / 为什么」。`,
          })
        } else if (!isNonEmptyString(entry[field])) {
          issues.push({
            path: `${path}.${field}`,
            severity: "error",
            code: "manifest/deviation-empty-field",
            message: `${path}.${field} 必须是非空字符串。`,
          })
        }
      }

      const axis = entry.axis
      if (isNonEmptyString(axis) && !(DEVIATION_AXES as readonly string[]).includes(axis)) {
        issues.push({
          path: `${path}.axis`,
          severity: "error",
          code: "manifest/deviation-unknown-axis",
          message:
            `未知的 deviation axis：\`${axis}\`。合法取值：${DEVIATION_AXES.join(", ")}。` +
            " 写错轴名会让一次真实的偏离看起来「记录过了」——所以这里是错误，不是忽略。",
        })
      } else if (isNonEmptyString(axis)) {
        const previous = seenAxes.get(axis)
        if (previous !== undefined) {
          issues.push({
            path: `${path}.axis`,
            severity: "error",
            code: "manifest/deviation-duplicate-axis",
            message: `axis \`${axis}\` 在 deviations[${previous}] 已经出现过。同一条轴只能偏离一次，否则两条记录互相矛盾。`,
          })
        } else {
          seenAxes.set(axis, index)
        }
      }

      const from = entry.from
      const to = entry.to
      if (isNonEmptyString(from) && isNonEmptyString(to) && normaliseToken(from) === normaliseToken(to)) {
        issues.push({
          path: `${path}.to`,
          severity: "error",
          code: "manifest/deviation-not-a-deviation",
          message: `${path} 的 from 与 to 相同（\`${from}\`）——这不是一次偏离，只是一条注释。`,
        })
      }

      const reason = entry.reason
      if (isNonEmptyString(reason) && reason.trim().length < DEVIATION_REASON_MIN_LENGTH) {
        issues.push({
          path: `${path}.reason`,
          severity: "error",
          code: "manifest/deviation-reason-too-short",
          message:
            `偏离理由太短（${reason.trim().length} 字，至少 ${DEVIATION_REASON_MIN_LENGTH} 字）。` +
            " deviation 的价值全在理由上：没有理由的偏离和下一个人眼里的笔误没有区别。",
        })
      }

      /*
       * A deviation may relax a pack default. It may never re-open a door the
       * manifest itself closed: `avoid` is the manifest's load-bearing field,
       * and a "deviation" that points straight at an avoided thing is an
       * authorisation nobody gave.
       */
      if (isNonEmptyString(to) && avoidTokens.length > 0) {
        const target = normaliseToken(to)
        const conflicting = avoidTokens.find(
          (token) => token.length > 0 && (target === token || target.includes(token)),
        )
        if (conflicting) {
          issues.push({
            path: `${path}.to`,
            severity: "error",
            code: "manifest/deviation-contradicts-avoid",
            message:
              `${path}.to（\`${to}\`）撞上了本 manifest 的 avoid 条目。` +
              " deviation 可以偏离 pack 的默认值，但不能重新打开 avoid 已经关上的门。",
          })
        }
      }

      /*
       * Linked axes must agree with the field they explain. A recorded deviation
       * that contradicts the manifest's own declared value is worse than no
       * record: it looks like a decision while saying two different things.
       */
      const linkedField =
        isNonEmptyString(axis) && axis in LINKED_DEVIATION_AXES
          ? LINKED_DEVIATION_AXES[axis as DeviationAxis]
          : undefined
      if (linkedField && isNonEmptyString(to)) {
        const declared = input[linkedField]
        if (isNonEmptyString(declared) && normaliseToken(declared) !== normaliseToken(to)) {
          issues.push({
            path: `${path}.to`,
            severity: "error",
            code: "manifest/deviation-mismatch",
            message:
              `${path} 记录 \`${axis}\` 偏离到 \`${to}\`，但 \`${linkedField}\` 声明的是 \`${declared}\`。` +
              " 两者必须一致——否则 manifest 自己说了两件不同的事。",
          })
        }
      }
    })
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  }
}

/** Render issues as a printable report. Used by the CLI and by tests. */
export function formatManifestIssues(issues: ManifestIssue[]): string {
  if (issues.length === 0) return "Visual Manifest 结构校验通过。"
  return issues
    .map((issue) => {
      const glyph = issue.severity === "error" ? "✗" : "!"
      return `${glyph} [${issue.code}] ${issue.path} — ${issue.message}`
    })
    .join("\n")
}
