/**
 * zh-CN — S1 工作台的界面词典。
 *
 * Every user-visible string in the product lives here. Components never inline
 * copy: they read it through `useMessages()`. Adding a locale therefore means
 * adding one sibling file (`en-US.ts`) that satisfies the same shape — no
 * component needs to change.
 *
 * Conventions
 *   • Parameterised copy is a function, never string concatenation.
 *   • Keys describe meaning (`landing.pending.title`), not position.
 *   • Route slugs, code identifiers, keyboard shortcuts and brand names that
 *     are genuinely proper nouns stay as-is by design.
 *
 * 范围（与 Factory 的初始化边界一致）
 *   ✅ `components/**`  共享组件与外壳的默认文案（Sidebar / TopNav / Pagination /
 *                        OnboardingWizard / AiSummaryPanel / CommandPalette …）
 *   ✅ `app/**`         本产品自己的路由与 404
 *   ⛔ **不**包括业务记录内容 —— 那是数据，不是可翻译的文案。
 *
 * 这个文件属于初始化面（`init-contract.json` 的 `productFacing`）：它不得再出现
 * Reference Sample 或 Factory baseline 的产品身份。
 * `pnpm factory:init` 会逐字扫描它，而且**不区分代码与注释** —— 所以哪怕是解释
 * 「这里已经不含样例身份」的说明文字，也不能把那两个名字写出来。
 */
/**
 * 动作码类型是**类型导入**（编译期擦除，运行时没有依赖）：
 * 它只用来给 `workbench.toolConsole.actions` 加一条完整性约束 ——
 * 动作目录里新增一个动作而没有中文名，typecheck 就会红。
 */
import type { ActionCode } from "../s1/contract"

export const zhCN = {
  /* ------------------------------------------------------------------ meta */
  locale: {
    label: "简体中文",
    short: "中",
  },

  common: {
    cancel: "取消",
    close: "关闭",
    confirm: "确认",
    save: "保存",
    back: "返回",
    retry: "重试",
    reset: "重置",
    search: "搜索",
    searchPlaceholder: "搜索…",
    clearSearch: "清除搜索",
    resetFilters: "重置筛选",
    clearFilters: "清除筛选",
    loading: "加载中",
    loadFailed: "数据加载失败",
    copy: "复制",
    copied: "已复制",
    openMenu: "打开菜单",
    more: "更多",
    none: "暂无",
    notAvailable: "—",
  },

  /* --------------------------------------------------------------- 无障碍 */
  a11y: {
    primaryNav: "主导航",
    openNav: "打开导航",
    openCommand: "打开命令面板",
    commandHint: "搜索或运行命令",
    toggleTheme: "切换主题",
    refreshData: "刷新数据",
    notifications: "通知",
    accountMenu: "账户菜单",
    prototypeControls: "原型状态",
    backToTop: "回到顶部",
    sectionLabel: "工作区",
    skipToContent: "跳到主要内容",
  },

  /* ------------------------------------------------------------ 产品身份 */
  /**
   * S1 的身份。这里是品牌与文档元信息的**唯一**来源：
   * `app/layout.tsx` 的 metadata 读它，而不是各写一份字面量。
   */
  brand: {
    name: "S1",
    subtitle: "AI 原生安全运营工作台",
    mark: "S1",
    metaTitle: "S1 · AI 原生安全运营工作台",
    metaDescription:
      "面向保险公司安全团队的 SOC 控制台原型：AI 自主调查与闭环、人只在关键门授权、每条结论都能点开证据。",
  },

  /* --------------------------------------------------------------- 首屏 */
  /**
   * 首页文案。本轮的首页是**诚实的首屏**：说明这是什么产品、当前阶段的
   * 边界在哪里、下一步是什么 —— 不展示尚未实现的能力。
   * 因此下面每一段都标了「已完成 / 尚未开始」，改文案时不要把它们混起来。
   *
   * ⚠ 它是**阶段快照**：哪一批落盘了就得改一次，否则这一页会开始说谎。
   * 页面自己不带日期，日期在 `README.md` 的「当前进度」一节。
   */
  landing: {
    eyebrow: "安全运营 · AI 原生工作台",
    title: "S1 工作台",
    description:
      "给保险公司安全团队用的 SOC 控制台。产品形态是 16:9 单屏不加滚动的三列战情室：左列攻击链实体视图，中列任务计划与研判流，右列处置授权与审计，底部常驻「问 S1」与流式报告。",

    /* 工作台入口。它是一个真链接，不是装饰：第一批组件就在这一页后面。 */
    entry: {
      label: "打开工作台",
      note: "第一批：骨架 + 态势指挥条 + 任务计划 / 研判流 / 工具控制台；其余面板在页面上标着「本面板尚未实现」。",
    },

    /* 顶栏读数条：等宽读数，不是 hero。 */
    strip: {
      stageLabel: "阶段",
      stageValue: "组件层 · 第一批",
      stageNote: "骨架 + ①②③④ 已落盘",
      specLabel: "形态规格",
      specValue: "12 个组件 · 6 特征",
      specNote: "见设计稿实测与实现规格",
      visualLabel: "视觉方向",
      /* 不写 pack 的资产 id：产品源码里出现 id 会被 Kits 的 seam 门禁判违规
         （id 只能在 adapters/ 里出现，产品要的是「能力」不是「资产名」）。
         哪一套 pack 由 visual-manifest.json 与 lib/kits/kits.lock.json 回答。 */
      visualValue: "Kits 风格包",
      visualNote: "已安装 · 双主题接入",
    },

    done: {
      title: "本轮已完成",
      caption: "初始化边界（baseline → product）",
      items: [
        "身份重写：包名、metadata、首页、404 与词典都改成 S1 自己的，初始化面上不再有基线或样例的名字。",
        "Reference Sample 删除：CRM 路由、内置演示、样例样式层与只服务它们的测试全部移除，边界记在 init-contract.json。",
        "工厂门禁接上：初始化边界、策略、Visual Manifest、语义契约四道自查命令，加上 lint / typecheck / test / build / qa。",
        "端口与 QA 隔离：QA 端口 3310，自有 server 自起自停，绝不复用已经存在的进程。",
      ],
    },

    pending: {
      title: "尚未开始",
      caption: "以下都不是本仓现在的能力",
      items: [
        "十二个组件里只有第一批落盘（骨架 + ① ② ③ ④，在「打开工作台」那一页）：攻击链画布、处置授权区、审计时间线、战果沉淀、问 S1、E+N 汇流视图、顶栏花名册、报告流式生成都还是页面上的「本面板尚未实现」占位。",
        "数据层与确定性回放引擎已经建好，并且被第一批界面消费；但「界面上的数字显示对不对」目前只有那一批的测试覆盖，其余面板的判据要等各自的批次。",
        "视觉方向已经落地：Kits 风格包由适配层接入深色与浅色两套主题；签名组件仍是 0。",
      ],
    },

    spec: {
      title: "形态规格的六个特征",
      caption: "来自已签署的页面形态规格，是本轮之后的实现目标",
      features: [
        {
          title: "自主规划",
          detail: "任务计划由 Agent 自主拆解，并且留下重规划痕迹，而不是一条不会变的清单。",
        },
        {
          title: "工具调用",
          detail: "处置动作在堡垒机托管会话里执行，每条命令之前先给处置说明卡：依据、动作、影响、回滚。",
        },
        {
          title: "证据推理",
          detail: "每条结论都带证据引用与置信度，证据可以点开，不是一句无法追问的判断。",
        },
        {
          title: "分级授权",
          detail: "L0–L4 授权阶梯：低风险自动执行并留下回滚窗口，高风险挂起等人批准、驳回或改参数。",
        },
        {
          title: "记忆进化",
          detail: "每次事件都沉淀成剧本章节、基线策略与攻击者画像，下一次不必从零开始。",
        },
        {
          title: "主动汇报",
          detail: "处置报告流式生成，全程审计留痕可回放，人随时能问「谁批准了这次删除」。",
        },
      ],
    },

    boundary: {
      title: "交付边界",
      items: [
        "16:9 单屏不加滚动，滚动只发生在面板内部；移动视口不在产品形态里。",
        "本阶段是确定性回放：界面 100% 真实，命令不落到真实主机。",
        "演示编排（左屏、双屏投屏调度、真实攻防环境）不在本仓。",
        "纯前端：没有后端服务、没有数据库、没有鉴权，也不调用任何外部接口。",
      ],
    },

    commands: {
      title: "常用命令",
      items: [
        "pnpm dev --port 3310",
        "pnpm factory:init",
        "pnpm check",
      ],
    },

    footer: "S1 工作台原型 · 由 Prototype Factory 生产 · 前端 + 本地状态，无后端",
  },

  /**
   * 外壳（Sidebar / TopNav）里不属于某个具体页面的文案。
   * 这些字符串由**调用方**注入：共享组件本身不含任何产品身份。
   */
  shell: {
    workspaceSection: "工作台",
    live: "数据实时同步",
    liveAt: (time: string) => `最近同步 ${time}`,
    syncing: "正在同步…",
    accountHint: "打开个人资料",
    commandHint: "搜索或运行命令",
  },

  /** 通用分页文案——Pagination 的默认标签取这里，调用方无需重复传入。 */
  pagination: {
    nav: "分页",
    previous: "上一页",
    next: "下一页",
    page: (value: number) => `第 ${value} 页`,
    noResults: "暂无结果",
    range: (from: number, to: number, total: number) =>
      `第 ${from}–${to} 条，共 ${total} 条`,
  },

  /** 通用多步向导文案——OnboardingWizard 的默认文案。 */
  wizard: {
    title: "设置你的工作区",
    description: "一分钟即可完成设置，之后随时可以修改。",
    step: (index: number, total: number) => `第 ${index} 步，共 ${total} 步`,
    back: "上一步",
    next: "下一步",
    finish: "完成",
  },

  /* -------------------------------------------------- AI 摘要面板（共享组件） */
  aiSummary: {
    title: "AI 智能摘要",
    description: "基于这条记录确定性生成，不调用任何外部 API。",
    generate: "生成 AI 摘要",
    regenerate: "重新生成",
    generating: "生成中",
    generatingSr: "正在生成摘要…",
    idleHint: "还没有摘要。基于这条记录确定性生成一份简报。",
    recommendedNextStep: "建议的下一步",
    confidence: (value: number) => `置信度 ${value}%`,
    failed: "生成失败，请重试。",
  },

  /* ---------------------------------------------------------- 命令面板 */
  palette: {
    title: "命令面板",
    placeholder: "输入命令或搜索…",
    empty: "没有匹配的命令。",
    intelligence: "智能",
  },

  /* --------------------------------------------------------------- 通知 */
  notifications: {
    title: "通知",
    empty: "没有新通知了。",
    markAllRead: "全部标为已读",
    unreadCount: (count: number) => `${count} 条未读`,
  },

  /* ----------------------------------------------------------- 原型状态 */
  prototype: {
    title: "原型状态",
    description: "强制触发加载、错误与重置流程，预览所有状态。",
    simulateSlowLoad: "模拟慢加载",
    simulateFailure: "模拟接口失败",
    resetData: "重置原型数据",
    resetToastTitle: "原型数据已重置",
    resetToastDescription: "界面上的所有本地状态都已恢复初始值。",
  },

  /* ----------------------------------------------------------------- 提示 */
  toast: {
    refreshed: "数据已刷新",
    refreshFailed: "请求失败",
    refreshFailedDescription: "已切换到错误状态。",
    emailCopied: "邮箱已复制",
    clipboardUnavailable: "无法访问剪贴板",
    clipboardUnavailableDescription: "请授予剪贴板权限后重试。",
    notificationsRead: "已将全部通知标为已读",
    signedOut: "已退出登录",
    signedOutDescription: "本地会话状态已重置。",
  },

  /* ---------------------------------------------------------------- 浮层 */
  dialogs: {
    profile: {
      title: "个人资料",
      description: (workspace: string) => `你当前登录的是 ${workspace} 工作区。`,
      email: "邮箱",
      workspace: "工作区",
      role: "角色",
      plan: "版本",
    },
    signOut: {
      title: "确认退出登录？",
      description: (email?: string) =>
        `这是一个纯前端原型，没有真实鉴权。继续会把本地会话${
          email ? `（${email}）` : ""
        }恢复到初始状态——界面上的本地改动都会回到最初的样子。`,
      confirm: "退出登录",
    },
  },

  /* ------------------------------------------------- S1 工作台（战情室控制台） */
  /**
   * 十二个组件的界面文案。**业务记录内容不在这里**：计划条目的名字、命令、
   * 回显、审计行的动作、攻击者编号、IP、hash、时间戳、Agent 名都住在 `lib/s1/**`
   * 的种子事实底本里，按仓规不翻译（它们是记录，不是文案）。
   *
   * 这里只放两类东西：
   *   • 面板自己的标题 / 字段标签 / 状态词（「依据」「回滚」「受阻」…）；
   *   • 由界面拼出来、必须与种子对齐的模板 —— 例如 `liveStatus(0)` 必须逐字等于
   *     种子 `headerStats.liveStatus`（那条断言在 `tests/s1-console.spec.ts` 里）。
   *
   * 动作码的中文名是**词典的一份覆盖纪律**：`satisfies Record<ActionCode, string>`
   * 让「动作目录里多了一个动作、而界面上没有它的名字」在 typecheck 阶段就红，
   * 而不是让某个面板在演示当天显示一个英文枚举。
   */
  workbench: {
    /* --------------------------------------------------- 回放控制（真实交互） */
    replay: {
      label: "回放控制",
      play: "播放",
      pause: "暂停",
      stepBack: "上一拍",
      stepForward: "下一拍",
      restart: "回到开场",
      playing: "回放中",
      paused: "已暂停",
      finished: "回放结束",
      /** `T+4.60s` —— 回放位置。`T` 与 `s` 是单位记号，不是未翻译的文案。 */
      position: (seconds: string) => `T+${seconds}s`,
      beatNow: (step: number) => `第 ${step} 拍`,
      beatSoFar: (step: number) => `已揭示到第 ${step} 拍`,
      beforeOpening: "尚未开场",
      timeline: "拖到任意时刻",
      jump: (step: number) => `跳到第 ${step} 拍`,
      jumpAny: "跳到某一拍",
      /**
       * 请求的拍没有自己的帧时的说明（第 18 拍由 ⑨ 按需追加，固定排程里没有它）。
       * `requested` 是观众点的那一拍，`landed` 是真正的落点 —— 两个都写出来，
       * 因为「你要的第 18 拍落在了第 17 拍」是一句可核对的话，而「回放结束」不是。
       */
      beatClamped: (requested: number, landed: number) =>
        `第 ${requested} 拍由「问 S1」按需追加 · 已停在排程末尾（第 ${landed} 拍）`,
    },

    /* ----------------------------------------- 演示标识（已签署的不变量） */
    demo: {
      /** 组件级角标：这个组件的动作在本阶段是脚本化回放。 */
      scripted: "脚本化回放 · 命令不落到真实主机",
      /** 诚实标注：未建成的面板不假装。 */
      notBuilt: "本面板尚未实现",
      notBuiltNote: (panel: string) => `${panel} 计划在组件阶段下一批实现`,
      shellNote: "演示环境",
    },

    /* ------------------------------------------------------------ ① 态势指挥条 */
    commandBar: {
      counterAutonomous: "今日 AI 自主闭环",
      counterInterventions: "人工介入",
      counterHandling: "平均处置",
      /** 秒的后缀，与种子的 `avgHandlingSeconds` 拼成 `41s`。 */
      secondUnit: "s",
      /**
       * 顶栏状态句。`count` 是**派生值**（待批授权卡的条数），
       * `liveStatus(0)` 必须逐字等于种子 `headerStats.liveStatus`。
       */
      liveStatus: (count: number) => `AI 调查中 · 待人工授权 ${count} 项`,
      pendingHint: "点开右列可看待批卡",
      countersHint: "三个计数都从已发生的事件聚合重算，不做直接赋值",
      autonomy: "自主度",
      autonomyCurrent: (level: string) => `当前 ${level}`,
    },

    /* ------------------------------------------------------------ ② 任务计划面板 */
    plan: {
      title: "任务计划 · 事件",
      subtitle: "调查 Agent 自主拆解",
      empty: "计划尚未生成",
      emptyNote: "第 3 拍之后这里会出现 AI 拆解出的任务清单。",
      replanNote: (from: string, to: string) => `${from} → ${to}`,
      replanLabel: "重规划",
      progress: (done: number, total: number) => `完成 ${done} / ${total}`,
      stateDone: "完成",
      stateRunning: "进行中",
      stateBlocked: "受阻",
      stateReplanned: "重规划新增",
      stateSuperseded: "已划掉",
      statePending: "待办",
      statePlanned: "待办",
      strikeNote: "被第 9 拍的重规划划掉",
    },

    /* ------------------------------------------------------------ ③ 研判流 */
    findings: {
      title: "AI 研判流",
      subtitle: "结论必带证据",
      confidence: (percent: number) => `置信度 ${percent}%`,
      nextStep: "下一步",
      sources: "数据来源",
      empty: "还没有形成结论",
      emptyNote: "第 2 拍汇流之后，这里会出现第一条带证据的结论。",
      claimShape: "结论",
    },

    /* ---------------------------------------------------------- ④ 工具控制台 */
    toolConsole: {
      title: "工具控制台",
      empty: "尚未执行任何命令",
      emptyNote: "第 10 拍之后，处置 Agent 会先在说明卡之下逐字打出命令。",
      briefTitle: "处置说明卡",
      briefBasis: "依据",
      briefAction: "动作",
      briefImpact: "影响",
      briefRollback: "回滚",
      briefSessionSource: "会话级说明卡 · 本会话的每条命令都在它之下执行",
      briefOwnSource: "本条命令自己的说明卡",
      sessionLabel: "会话",
      outputLabel: "回显",
      exitLabel: "退出码",
      autoChannel: (level: string) => `自主执行 · ${level} 授权策略内`,
      approvedChannel: "经人批准后执行 · 停在人这道门",
      rollbackWindow: (seconds: string) => `可回滚 · 窗口 ${seconds}s`,
      rollbackNoWindow: "可回滚 · 清单未声明窗口",
      notReversible: "不可回滚 · 必须停在人这道门",
      approvalRequired: "需人工授权 · 不在自主清单内",
      noBasis: "本动作不引用证据",
      /** 动作码 → 中文名。少一个就 typecheck 失败（见上）。 */
      actions: {
        "inspect-file": "只读排查",
        "verify-file": "只读复核",
        "block-source": "封禁攻击源",
        "quarantine-file": "隔离可疑文件",
        "delete-file-with-backup": "删除文件（先备份）",
        "terminate-process": "终止进程",
        "isolate-host": "隔离主机",
        "revoke-session": "吊销会话",
        "patch-config": "修改业务配置",
        "rotate-credential": "轮换凭证",
      } satisfies Record<ActionCode, string>,
      /**
       * 动作码 → **影响面图例**。
       *
       * 这一栏不是事件数据，是「动作目录」的中文对照：它说的是**这个动作本身的爆炸半径**
       * （只读 / 只影响攻击源 / 改一处业务接口…），同一动作码在任何事件里都得到同一句话。
       * 它由 `tests/s1-console.spec.ts` 断言「目录里的每个动作码都必须有图例」，
       * 所以界面上不可能出现一个没有影响说明的动作。
       */
      impacts: {
        "inspect-file": "只读排查 · 不写入、不删除",
        "verify-file": "只读复核 · 不改动主机状态",
        "block-source": "只影响攻击源地址 · 一键可撤销",
        "quarantine-file": "隔离文件 · 原文件保留",
        "delete-file-with-backup": "只删除已验证的文件 · 删除前留备份",
        "terminate-process": "终止进程 · 服务会重启",
        "isolate-host": "主机断网隔离 · 该主机业务中断",
        "revoke-session": "吊销会话 · 对方需重新登录",
        "patch-config": "改动一处业务接口 / 配置",
        "rotate-credential": "轮换凭证 · 旧凭证立即失效",
      } satisfies Record<ActionCode, string>,
      /** 说明卡上的四条字段，顺序就是设计稿的顺序。 */
      briefFieldOrder: ["basis", "action", "impact", "rollback"] as const,
    },

    /* ------------------------------------------- 面板三态与未建面板的诚实标注 */
    panel: {
      loading: "正在装载今日事件簿…",
      error: "这一屏派生失败",
      errorNote: "事件流里出现了无法解析的引用。这是坏序列，不是要展示的状态。",
      errorRetry: "重新装载事件流",
      emptyDefault: "本回合尚未到达这一步",
      scrollHint: "面板内滚动",
    },

    /* ------------------------------------------------------ ⑤ 攻击链 · 实体视图 */
    attackGraph: {
      title: "攻击链 · 实体视图",
      subtitle: "对象模型：人-资产-文件-进程-数据",
      empty: "画布上还没有实体",
      emptyNote: "第 2 拍汇流之后，画布上会逐条长出与结论相关的实体节点。",
      /**
       * 图例 —— **视觉语汇的对照表**，说的是这个标记在画布上是什么意思。
       * 它由 `tests/s1-console.spec.ts` 断言「三个键都在 DOM 上出现」。
       */
      legend: {
        attackPath: "攻击路径",
        controlled: "AI 控制中",
        closed: "已闭环",
      },
      /** 图上**只有**带得动证据的边；这一句解释为什么线比设计稿少。 */
      edgesNote: "图上只画有证据支撑的边：没有证据的连接不画，而不是补一条看起来对的线。",
      /** 某个实体在事件流里找不到可引用的证据时的诚实标注。 */
      noCitation: "本回合事件流里没有指向它的证据",
      attackerProfile: "攻击者画像",
      fingerprint: "手法指纹",
      fingerprintMatches: (count: number) => `匹配 ${count} 次`,
      mergedFrom: "AI 自动合并",
    },

    /* ------------------------------------------------------ ⑥ 处置与授权卡片区 */
    authority: {
      title: "人把关键门 · L0–L4 授权阶梯",
      empty: "本回合还没有处置动作",
      emptyNote: "第 6 拍之后，自主执行与待授权的处置都会出现在这里。",
      submitted: (count: number) => `AI 提交 ${count} 项待授权`,
      autoChannel: "免授权通道",
      autoState: (level: string, decision: string) => `${level} 授权策略内 · ${decision}`,
      autoExecuted: "已自动执行",
      approvalRequired: "需人工授权",
      rollbackWindow: "回滚窗口",
      basis: "依据",
      impact: "影响评估",
      rollback: "回滚",
      five: {
        what: "做什么",
        basis: "证据",
        impact: "影响与风险",
        rollback: "回滚",
        alternative: "替代方案",
      },
      sla: "SLA 倒计时",
      slaTimeout: "超时默认挂起不执行",
      /** `02:17` —— 剩余时间。 */
      remaining: (clock: string) => clock,
      approve: "批准",
      reject: "驳回",
      changeParams: "改参数后批准",
      decided: (decision: string) => `人工裁决 · ${decision}`,
      decisions: {
        approved: "批准",
        rejected: "驳回",
        "param-changed": "改参数后批准",
      } satisfies Record<"approved" | "rejected" | "param-changed", string>,
      authoritySource: "自主度与白名单来自数据层",
      /**
       * 动作代号 → 界面词。
       *
       * 这些代号（`ACTION_CATALOG` 的键）是**数据层的机器名**，不是给人读的文案。
       * 当日事件簿里那些闭环各自带一张处置卡，标题过去直接拿代号拼
       * （`rotate-credential · #b0041`）—— 于是中文界面里冒出两行英文，
       * `/workbench` 的零英文泄漏检查当场判红（2026-09-17 实测）。
       *
       * 代号本身是**记录内容**、不翻译；**给人看的名字**住在这里。
       * `satisfies Record<ActionCode, string>` 让数据层新增动作而词典漏掉时
       * 在 `pnpm typecheck` 就红 —— 而不是等到演示现场才看见一行英文。
       */
      actionLabels: {
        "inspect-file": "检查文件",
        "verify-file": "复核文件",
        "block-source": "封禁攻击源",
        "quarantine-file": "隔离文件",
        "delete-file-with-backup": "删除文件（先备份）",
        "terminate-process": "终止进程",
        "isolate-host": "隔离主机",
        "revoke-session": "吊销会话",
        "patch-config": "修补配置",
        "rotate-credential": "轮换凭据",
      } satisfies Record<ActionCode, string>,
    },

    /* ---------------------------------------------------------- ⑧ 审计时间线 */
    audit: {
      title: "全流程审计 · 留痕回放",
      empty: "还没有留痕",
      emptyNote: "第 7 拍之后，本回合的每一步都会在这里留下主体、时间与依据。",
      /** 角标。**不写「可 4× 回放」** —— 播放倍速没有实现，写了就是一句做不到的承诺。 */
      badge: "逐拍可回放",
      badgeNote: "点任一行停在那一帧上",
      rowSeek: "停在这一帧",
      clock: "时间",
      actor: "主体",
      action: "动作",
      basis: "依据",
      result: "结果",
      noBasis: "本行不引用证据",
      /** ⑧ 的重放忠实性：同一游标两次渲染逐字段相同 —— 这句话就是那条不变量的界面说法。 */
      faithfulNote: "按游标重放：不跳拍、不补拍",
      cursorLabel: "游标",
      replaySpeed: "1× · 播放倍速未实现",
    },

    /* -------------------------------------------------------- ⑪ 战果与沉淀面板 */
    sediment: {
      title: "战果 · AI 越用越聪明",
      subtitle: "本次事件沉淀",
      empty: "本回合还没有沉淀",
      emptyNote: "第 16 拍之后，本回合学到的东西会逐条入账。",
      /**
       * 导出/导入 —— 不变量 `sediment.survives-export` 的界面侧。
       * 三个控件都是真的：导出写剪贴板 + 下载文件，导入把贴回来的 JSON 解析并与当前状态逐条比对。
       */
      exportAction: "导出沉淀",
      exportHint: "带出去的是条目 + 计数 + 裁决记录 + 事件链",
      copyAction: "复制",
      downloadAction: "下载 JSON",
      importAction: "导入并核对",
      importPlaceholder: "把导出的 JSON 贴回这里",
      importOk: "导入一致：条目、计数、裁决与事件链逐条等价",
      importFailed: (count: number) => `导入不一致：${count} 处差异`,
      importParseFailed: "导入失败：这段文本不是一份可解析的沉淀导出物",
      roundTripHint: "导出再导入，逐条等价",
      exportNote: "导出物不含墙上时间：游标就是它的时间戳",
      sourceRefs: "来源",
      kindLabels: {
        "detection-playbook": "检测剧本章节",
        policy: "白名单策略",
        "attacker-profile": "攻击者画像",
      } satisfies Record<"detection-playbook" | "policy" | "attacker-profile", string>,
    },

    /** 本批**没有**实现的三个面板（⑨⑩⑭）。名字在这里，内容不在。 */
    pending: {
      askS1: "⑨ 问 S1",
      pipeline: "⑩ E+N 数据汇流",
      report: "⑭ 报告流式生成",
    },
  },

  /* ------------------------------------------------------------------- 404 */
  notFound: {
    app: {
      metaTitle: "页面不存在",
      title: "这个页面不存在",
      description: "你访问的地址不属于这个原型，回到首页继续。",
      action: "返回首页",
      backHome: "返回首页",
    },
  },
}

/** Shape every locale must satisfy. */
export type Messages = typeof zhCN
