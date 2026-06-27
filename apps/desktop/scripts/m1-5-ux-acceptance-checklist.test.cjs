const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const checklistPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-ux-acceptance-checklist.json",
);
const readinessLedgerPath = path.join(
  repoRoot,
  "docs",
  "04_runbook",
  "m1.5-readiness-ledger.json",
);
const roadmapPath = path.join(repoRoot, "docs", "roadmap.md");
const uiuxBaselinePath = path.join(
  repoRoot,
  "AI_Agent_Workflow工作台_UIUX详细设计规范与需求规格说明书_v1.1_新增Workflow编排.docx",
);

const expectedFrItems = [
  [
    "FR-001",
    "应用 Shell",
    "MUST",
    "系统必须提供跨平台桌面应用 Shell，包含窗口区域与菜单栏。",
  ],
  [
    "FR-002",
    "左侧 Dock",
    "MUST",
    "系统必须提供可折叠左侧 Dock，包含所有一级模块入口。",
  ],
  [
    "FR-003",
    "文件树入口",
    "MUST",
    "系统必须保留文件树入口，默认隐藏，点击后打开文件树 Drawer。",
  ],
  [
    "FR-004",
    "Workflow Canvas",
    "MUST",
    "系统必须以 Node Canvas 显示 Workflow，并支持分支、并行与反馈回路。",
  ],
  [
    "FR-005",
    "节点选择",
    "MUST",
    "用户点击节点后，节点高亮且右侧详情面板自动打开。",
  ],
  [
    "FR-006",
    "右侧 Task 详情",
    "MUST",
    "Task 详情必须展示节点名称、状态、输入、输出、审查规则、Skill、模型、产物。",
  ],
  [
    "FR-007",
    "执行模式切换",
    "MUST",
    "系统必须支持单步、半自动、自动三种模式，并放在执行按钮旁边。",
  ],
  [
    "FR-008",
    "Chat Box",
    "MUST",
    "系统必须提供固定底部 Chat Box，支持针对当前节点或全局 Workflow 输入指令。",
  ],
  ["FR-009", "流式输出折叠", "MUST", "系统必须提供默认折叠的流式输出面板。"],
  [
    "FR-010",
    "流式输出展开",
    "MUST",
    "系统必须支持展开显示思考摘要、工具调用、阶段结果和 AI 回复。",
  ],
  [
    "FR-011",
    "新建项目",
    "MUST",
    "系统必须支持工作台模式项目初始化，输入任务背景并上传参考资料。",
  ],
  [
    "FR-012",
    "Git 初始化",
    "MUST",
    "每个工作台项目必须默认初始化 Git 仓库，不允许用户取消。",
  ],
  [
    "FR-013",
    "参考资料管理",
    "MUST",
    "系统必须支持导入、启用、禁用、查看项目参考资料。",
  ],
  [
    "FR-014",
    "Skill 管理",
    "MUST",
    "系统必须支持启用 Skill、查看候选 Skill 与 Skill 配置。",
  ],
  [
    "FR-015",
    "版本快照",
    "MUST",
    "系统必须支持自动快照、查看时间线、恢复到此处、继续执行。",
  ],
  [
    "FR-016",
    "流式事件类型",
    "MUST",
    "系统必须区分展示工具调用、阶段结果、AI 回复等事件类型。",
  ],
  [
    "FR-017",
    "节点产物",
    "MUST",
    "系统必须将节点生成的产物记录并在详情面板中展示。",
  ],
  [
    "FR-018",
    "半自动审查",
    "MUST",
    "半自动模式下，审查节点或高风险节点必须能暂停等待用户确认。",
  ],
  [
    "FR-019",
    "画布操作",
    "SHOULD",
    "系统应支持平移、缩放、适配视图、锁定编辑。",
  ],
  ["FR-020", "快捷键", "SHOULD", "系统应支持常用快捷键。"],
];

const expectedPrinciples = [
  ["P1", "中央主视图必须是 Workflow Canvas，不再使用流程列表作为主执行视图。"],
  [
    "P2",
    "Chat Box 固定在底部，用于自然语言输入；所有 AI 输出显示进入流式输出面板。",
  ],
  ["P3", "流式输出面板默认折叠，位于 Chat Box 上方；用户需要时展开查看。"],
  ["P4", "右侧 Task 详情面板默认隐藏，点击节点后自动显示并绑定当前节点。"],
  ["P5", "文件树保留入口，但默认折叠隐藏，不抢占主视图。"],
  ["P6", "执行模式切换必须放在主执行按钮附近，可随时调整。"],
  ["P7", "所有复杂信息采用渐进呈现，避免用户迷失。"],
];

const allowedEvidenceStatuses = new Set([
  "candidate_evidence_available",
  "runtime_bridge_evidence_available",
  "partial_runtime_bridge_evidence",
  "partial_evidence",
  "partial_scaffold",
  "backend_evidence_only",
  "backend_or_schema_evidence_only",
  "blocked_by_dependency_gate",
  "not_started",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));
}

function countItems(items, predicate) {
  return items.filter(predicate).length;
}

test("M1.5 UX acceptance checklist preserves source authority and conservative status", () => {
  const checklist = readJson(checklistPath);
  const readinessLedger = readJson(readinessLedgerPath);
  const roadmap = fs.readFileSync(roadmapPath, { encoding: "utf8" });

  assert.equal(fs.existsSync(uiuxBaselinePath), true);
  assert.equal(checklist.schema_version, "0.1.0");
  assert.equal(checklist.milestone, "M1.5");
  assert.equal(checklist.slice, "W1.5.199");
  assert.equal(checklist.checklist_status, "evidence_refreshed_not_accepted");
  assert.equal(checklist.exit_criterion, "EXIT-P1-1");
  assert.equal(checklist.exit_p1_1_status, "not_ready");
  assert.deepEqual(checklist.source_extraction, {
    method: "read-only OOXML extraction from word/document.xml",
    fr_paragraph_range: "UIUX baseline paragraphs 755-839",
    principles_paragraph_range: "UIUX baseline paragraphs 65-78",
    non_functional_paragraph_range: "UIUX baseline paragraphs 841-859",
  });
  assert.match(roadmap, /FR-001~020/u);
  assert.match(roadmap, /A4 ux-acceptance-reviewer/u);
  assert.equal(
    readinessLedger.phase_1_exit_readiness.find(
      (item) => item.id === "EXIT-P1-1",
    )?.status,
    "not_ready",
  );
});

test("M1.5 UX acceptance checklist extracts FR-001 through FR-020 exactly", () => {
  const checklist = readJson(checklistPath);

  assert.deepEqual(
    checklist.fr_acceptance_items.map((item) => [
      item.id,
      item.module,
      item.source_priority,
      item.requirement,
    ]),
    expectedFrItems,
  );
  assert.equal(
    checklist.fr_acceptance_items.every((item) => item.phase_exit_required),
    true,
  );
  assert.equal(
    checklist.fr_acceptance_items.every(
      (item) =>
        Array.isArray(item.acceptance_checks) &&
        item.acceptance_checks.length > 0 &&
        Array.isArray(item.current_evidence) &&
        Array.isArray(item.remaining_gap) &&
        item.remaining_gap.length > 0,
    ),
    true,
  );
});

test("M1.5 UX acceptance checklist extracts design principles P1 through P7", () => {
  const checklist = readJson(checklistPath);
  const principleIds = new Set(
    checklist.design_principles.map((principle) => principle.id),
  );

  assert.deepEqual(
    checklist.design_principles.map((principle) => [
      principle.id,
      principle.description,
    ]),
    expectedPrinciples,
  );

  for (const item of checklist.fr_acceptance_items) {
    assert.ok(item.linked_principles.length > 0);
    for (const principleId of item.linked_principles) {
      assert.equal(principleIds.has(principleId), true);
    }
  }
});

test("M1.5 UX acceptance checklist summary matches item statuses", () => {
  const checklist = readJson(checklistPath);
  const items = checklist.fr_acceptance_items;
  const summary = checklist.acceptance_summary;

  assert.equal(summary.total_fr_items, items.length);
  assert.equal(summary.phase_exit_required_items, items.length);
  assert.equal(
    summary.source_must_items,
    countItems(items, (item) => item.source_priority === "MUST"),
  );
  assert.equal(
    summary.source_should_items,
    countItems(items, (item) => item.source_priority === "SHOULD"),
  );
  assert.equal(
    summary.candidate_evidence_available_items,
    countItems(
      items,
      (item) => item.current_evidence_status === "candidate_evidence_available",
    ),
  );
  assert.equal(
    summary.runtime_bridge_evidence_available_items,
    countItems(
      items,
      (item) =>
        item.current_evidence_status === "runtime_bridge_evidence_available",
    ),
  );
  assert.equal(
    summary.partial_runtime_bridge_evidence_items,
    countItems(
      items,
      (item) =>
        item.current_evidence_status === "partial_runtime_bridge_evidence",
    ),
  );
  assert.equal(
    summary.partial_or_scaffold_items,
    countItems(
      items,
      (item) =>
        item.current_evidence_status === "partial_evidence" ||
        item.current_evidence_status === "partial_scaffold",
    ),
  );
  assert.equal(
    summary.backend_or_schema_only_items,
    countItems(
      items,
      (item) =>
        item.current_evidence_status === "backend_evidence_only" ||
        item.current_evidence_status === "backend_or_schema_evidence_only",
    ),
  );
  assert.equal(
    summary.blocked_by_dependency_gate_items,
    countItems(
      items,
      (item) => item.current_evidence_status === "blocked_by_dependency_gate",
    ),
  );
  assert.equal(
    summary.not_started_items,
    countItems(items, (item) => item.current_evidence_status === "not_started"),
  );
  assert.equal(summary.accepted_items, 0);
  assert.match(summary.phase_exit_claim, /not_ready/u);
});

test("M1.5 UX acceptance checklist does not overclaim dependency-gated or scaffold-only work", () => {
  const checklist = readJson(checklistPath);
  const itemsById = new Map(
    checklist.fr_acceptance_items.map((item) => [item.id, item]),
  );

  assert.equal(
    checklist.fr_acceptance_items.every((item) =>
      allowedEvidenceStatuses.has(item.current_evidence_status),
    ),
    true,
  );
  assert.equal(
    checklist.fr_acceptance_items.some(
      (item) => item.current_evidence_status === "accepted",
    ),
    false,
  );
  assert.equal(
    itemsById.get("FR-004")?.current_evidence_status,
    "blocked_by_dependency_gate",
  );
  assert.equal(
    itemsById.get("FR-019")?.current_evidence_status,
    "blocked_by_dependency_gate",
  );
  assert.match(itemsById.get("FR-004")?.remaining_gap.join(" "), /@xyflow/u);
  assert.match(checklist.guardrails.join(" "), /does not claim A4 acceptance/u);
  assert.deepEqual(
    checklist.next_recommended_slices.map((slice) => slice.id),
    ["W1.5.201"],
  );
});
