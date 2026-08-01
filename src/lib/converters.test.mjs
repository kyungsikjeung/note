/**
 * converters.mjs 검증 스크립트 — 테스트 프레임워크 없이 node assert 만 쓴다.
 *   node src/lib/converters.test.mjs
 * 모두 통과하면 PASS 줄을 찍고 exit 0, 하나라도 깨지면 스택과 함께 exit 1.
 */
import assert from "node:assert/strict";
import {
  richToMarkdown,
  markdownToRich,
  markdownToJira,
  markdownToConfluence,
  markdownToGithub,
  convertTable,
  buildContextCapsule,
} from "./converters.mjs";

let passed = 0;
const results = [];

const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    results.push(`PASS  ${name}`);
  } catch (error) {
    results.push(`FAIL  ${name}`);
    console.error(results.join("\n"));
    console.error(`\n${name} 실패:\n`, error);
    process.exit(1);
  }
};

const has = (haystack, needle, label) =>
  assert.ok(
    haystack.includes(needle),
    `${label || "출력"}에 ${JSON.stringify(needle)} 가 없습니다.\n---\n${haystack}\n---`,
  );

/* ───────────────────────── 1. 무손실 왕복 ───────────────────────── */

const FIXTURE_HTML = [
  "<h1>제목 1</h1>",
  "<h2>제목 2</h2>",
  "<h3>제목 3</h3>",
  "<h4>제목 4</h4>",
  "<h5>제목 5</h5>",
  "<h6>제목 6</h6>",
  "<p>본문에 <strong>굵게</strong>, <em>기울임</em>, <u>밑줄</u>, <s>취소선</s>, ",
  '<a href="https://ksnote.dev/docs">링크</a>가 섞여 있습니다.</p>',
  '<ul data-type="taskList">',
  '<li data-checked="true" data-due-date="2026-08-02" data-assignee="jinsim" data-priority="high">',
  '<label><input type="checkbox" checked><span></span></label><div><p>변환기 뼈대 만들기</p></div></li>',
  '<li data-checked="false" data-priority="normal">',
  '<label><input type="checkbox"><span></span></label><div><p>왕복 테스트 붙이기</p></div></li>',
  "</ul>",
  "<ul><li>글머리 하나</li><li>글머리 둘<ul><li>중첩 항목</li></ul></li></ul>",
  "<ol><li>첫째</li><li>둘째</li></ol>",
  "<blockquote><p>인용문입니다.</p></blockquote>",
  "<hr>",
  '<pre><code class="language-javascript">const answer = 42;</code></pre>',
  "<table><thead><tr><th>항목</th><th>값</th></tr></thead>",
  "<tbody><tr><td>수수료</td><td>3.5%</td></tr><tr><td>주기</td><td>T+7</td></tr></tbody></table>",
  '<img src="assets/diagram.png" alt="구조도" style="width:320px" data-align="right" data-caption="전체 구조" data-asset-path="assets/diagram.png">',
  '<div data-type="mermaid" data-code="flowchart LR&#10;  A --&gt; B"></div>',
  '<div data-type="plantuml" data-code="@startuml&#10;A -&gt; B&#10;@enduml"></div>',
  '<div data-type="attachment" name="spec.pdf" src="file:///notes/spec.pdf" size="20480"></div>',
].join("");

test("richToMarkdown/markdownToRich 왕복이 구조와 ks 속성을 보존한다", () => {
  const md = richToMarkdown(FIXTURE_HTML);
  const html = markdownToRich(md);
  const md2 = richToMarkdown(html);

  // 왕복이 고정점에 도달해야 한다(반복해도 더 이상 변하지 않음).
  assert.equal(md, md2, "왕복 후 마크다운이 달라졌습니다.");
  assert.equal(markdownToRich(md2), html, "왕복 후 HTML 이 달라졌습니다.");

  for (let depth = 1; depth <= 6; depth += 1) {
    has(md, `${"#".repeat(depth)} 제목 ${depth}`, "마크다운");
    has(html, `<h${depth}>제목 ${depth}</h${depth}>`, "HTML");
  }

  has(md, "**굵게**", "마크다운");
  has(md, "*기울임*", "마크다운");
  has(md, "<u>밑줄</u>", "마크다운");
  has(md, "~~취소선~~", "마크다운");
  has(md, "[링크](https://ksnote.dev/docs)", "마크다운");
  has(md, "* [x] 변환기 뼈대 만들기", "마크다운");
  has(md, "* [ ] 왕복 테스트 붙이기", "마크다운");
  has(md, "> 인용문입니다.", "마크다운");
  has(md, "```javascript", "마크다운");
  has(md, "| 항목 | 값 |", "마크다운");
  has(md, "```mermaid", "마크다운");
  has(md, "```plantuml", "마크다운");

  // ks 고유 속성이 HTML 로 그대로 돌아온다.
  has(html, '<li data-checked="true"', "HTML");
  has(html, 'data-due-date="2026-08-02"', "HTML");
  has(html, 'data-assignee="jinsim"', "HTML");
  has(html, 'data-priority="high"', "HTML");
  has(html, '<li data-checked="false"', "HTML");
  has(html, '<ul data-type="taskList">', "HTML");
  has(html, 'style="width:320px"', "HTML");
  has(html, 'data-align="right"', "HTML");
  has(html, 'data-caption="전체 구조"', "HTML");
  has(html, 'data-asset-path="assets/diagram.png"', "HTML");
  has(html, '<div data-type="mermaid" data-code="flowchart LR&#10;  A --&gt; B">', "HTML");
  has(html, '<div data-type="plantuml"', "HTML");
  has(html, "@startuml&#10;A -&gt; B&#10;@enduml", "HTML");
  has(html, '<div data-type="attachment" name="spec.pdf" src="file:///notes/spec.pdf" size="20480">', "HTML");

  // 체크리스트 다음에 오는 일반 목록이 체크리스트로 흡수되지 않아야 한다.
  has(html, "<li>글머리 하나</li>", "HTML");
  has(html, "<li>중첩 항목</li>", "HTML");
  has(html, "<ol>", "HTML");
  has(html, "<li>첫째</li>", "HTML");
  has(html, "<blockquote>", "HTML");
  has(html, "<hr>", "HTML");
  has(html, '<code class="language-javascript">', "HTML");
  has(html, "<th>항목</th>", "HTML");
  has(html, "<td>3.5%</td>", "HTML");

  // ks 주석은 rich HTML 에 남지 않는다.
  assert.ok(!html.includes("<!--ks:"), "rich HTML 에 ks 주석이 남았습니다.");
});

/* ─────────── 2~4. 플랫폼 내보내기 공통 픽스처 ─────────── */

const PLATFORM_MD = [
  "# 정산 리포트",
  "",
  "본문에 **굵게**와 <u>밑줄</u>, `inline` 코드가 있습니다.",
  "",
  '* [x] 수수료 정책 확정<!--ks:{"t":"task","due":"2026-08-10","assignee":"jinsim"}-->',
  "* [ ] 홀드백 검토",
  "",
  "- 일반 항목",
  "  - 중첩 항목",
  "",
  "1. 첫째",
  "2. 둘째",
  "",
  "> 인용 한 줄",
  "",
  "```java",
  "int fee = 35;",
  "```",
  "",
  "| 등급 | 수수료 | 주기 |",
  "| --- | ---: | :---: |",
  "| NORMAL | 3.5% | T+7 |",
  "| VIP | 2.5% | T+3 |",
  "",
  "[보고서](https://ksnote.dev/report)",
].join("\n");

test("markdownToJira 가 표·코드·체크박스를 Jira wiki 문법으로 옮긴다", () => {
  const jira = markdownToJira(PLATFORM_MD);
  has(jira, "h1. 정산 리포트", "Jira");
  has(jira, "*굵게*", "Jira");
  has(jira, "+밑줄+", "Jira");
  has(jira, "{{inline}}", "Jira");
  has(jira, "* (/) 수수료 정책 확정", "Jira");
  has(jira, "* (x) 홀드백 검토", "Jira");
  has(jira, "* 일반 항목\n** 중첩 항목", "Jira");
  has(jira, "# 첫째", "Jira");
  has(jira, "{quote}\n인용 한 줄\n{quote}", "Jira");
  has(jira, "{code:java}\nint fee = 35;\n{code}", "Jira");
  has(jira, "||등급||수수료||주기||", "Jira");
  has(jira, "|NORMAL|3.5%|T+7|", "Jira");
  has(jira, "[보고서|https://ksnote.dev/report]", "Jira");
  assert.ok(!jira.includes("<!--ks:"), "Jira 출력에 ks 주석이 남았습니다.");
});

test("markdownToConfluence 가 storage format(XHTML) 을 만든다", () => {
  const conf = markdownToConfluence(PLATFORM_MD);
  has(conf, "<h1>정산 리포트</h1>", "Confluence");
  has(conf, "<strong>굵게</strong>", "Confluence");
  has(conf, "<u>밑줄</u>", "Confluence");
  has(conf, "<code>inline</code>", "Confluence");
  has(conf, "<ac:task-list>", "Confluence");
  has(conf, "<ac:task-status>complete</ac:task-status>", "Confluence");
  has(conf, "<ac:task-status>incomplete</ac:task-status>", "Confluence");
  has(conf, "<ac:task-body>수수료 정책 확정</ac:task-body>", "Confluence");
  has(conf, "<ul><li>일반 항목<ul><li>중첩 항목</li></ul></li></ul>", "Confluence");
  has(conf, "<ol><li>첫째</li><li>둘째</li></ol>", "Confluence");
  has(conf, "<blockquote><p>인용 한 줄</p></blockquote>", "Confluence");
  has(conf, '<ac:structured-macro ac:name="code">', "Confluence");
  has(conf, '<ac:parameter ac:name="language">java</ac:parameter>', "Confluence");
  has(conf, "<ac:plain-text-body><![CDATA[int fee = 35;]]></ac:plain-text-body>", "Confluence");
  has(conf, "<table><tbody><tr><th>등급</th>", "Confluence");
  has(conf, "<td>NORMAL</td>", "Confluence");
  has(conf, '<a href="https://ksnote.dev/report">보고서</a>', "Confluence");

  const image = markdownToConfluence("![구조도](https://cdn/x.png)");
  has(image, '<ac:image ac:alt="구조도"><ri:url ri:value="https://cdn/x.png" /></ac:image>', "Confluence");

  // CDATA 종료 시퀀스가 본문에 있어도 섹션이 끊기지 않아야 한다.
  const cdata = markdownToConfluence('```\nvar a = "]]>";\n```');
  has(cdata, "]]]]><![CDATA[>", "Confluence");
});

test("markdownToGithub 이 GFM 으로 정규화하고 ks 주석을 제거한다", () => {
  const gh = markdownToGithub(PLATFORM_MD);
  has(gh, "# 정산 리포트", "GitHub");
  has(gh, "**굵게**", "GitHub");
  has(gh, "<u>밑줄</u>", "GitHub");
  has(gh, "`inline`", "GitHub");
  has(gh, "- [x] 수수료 정책 확정", "GitHub");
  has(gh, "- [ ] 홀드백 검토", "GitHub");
  has(gh, "- 일반 항목\n  - 중첩 항목", "GitHub");
  has(gh, "1. 첫째\n2. 둘째", "GitHub");
  has(gh, "> 인용 한 줄", "GitHub");
  has(gh, "```java\nint fee = 35;\n```", "GitHub");
  has(gh, "| 등급 | 수수료 | 주기 |", "GitHub");
  has(gh, "| --- | ---: | :---: |", "GitHub");
  has(gh, "[보고서](https://ksnote.dev/report)", "GitHub");
  assert.ok(!gh.includes("<!--ks:"), "GitHub 출력에 ks 주석이 남았습니다.");

  // mermaid 펜스는 GitHub 이 직접 렌더링하므로 그대로 둔다.
  has(markdownToGithub("```mermaid\ngraph TD\n```"), "```mermaid\ngraph TD\n```", "GitHub");
});

/* ─────────────────────── 5. convertTable ─────────────────────── */

const MD_TABLE = [
  "| 항목 | 설명 |",
  "| --- | --- |",
  "| **수수료** | 등급별 3.5% / 2.5% |",
  "| 파이프 | a \\| b |",
].join("\n");

test("convertTable 이 세 타깃 모두로 마크다운 표를 변환한다", () => {
  const jira = convertTable(MD_TABLE, "jira");
  has(jira, "||항목||설명||", "convertTable/jira");
  has(jira, "|*수수료*|등급별 3.5% / 2.5%|", "convertTable/jira");
  has(jira, "|파이프|a \\| b|", "convertTable/jira");

  const conf = convertTable(MD_TABLE, "confluence");
  has(conf, "<table><tbody>", "convertTable/confluence");
  has(conf, "<th>항목</th><th>설명</th>", "convertTable/confluence");
  has(conf, "<td><strong>수수료</strong></td>", "convertTable/confluence");

  const gh = convertTable(MD_TABLE, "github");
  has(gh, "| 항목 | 설명 |", "convertTable/github");
  has(gh, "| **수수료** | 등급별 3.5% / 2.5% |", "convertTable/github");
  has(gh, "a \\| b", "convertTable/github");

  assert.throws(() => convertTable(MD_TABLE, "notion"), /지원하지 않는/);
});

test("convertTable 이 HTML 표의 병합 셀과 줄바꿈을 낮춰서 변환한다", () => {
  const html = [
    "<table><tbody>",
    '<tr><th>구분</th><th colspan="2">2026 상반기</th></tr>',
    '<tr><td rowspan="2">정산</td><td>1분기</td><td>2분기<br>(잠정)</td></tr>',
    "<tr><td>3분기</td><td>4분기</td></tr>",
    "</tbody></table>",
  ].join("");

  const gh = convertTable(html, "github");
  // colspan 은 같은 값의 칸으로 펼친다.
  has(gh, "| 구분 | 2026 상반기 | 2026 상반기 |", "convertTable/github(html)");
  has(gh, "2분기<br>(잠정)", "convertTable/github(html)");
  has(gh, "병합 셀(colspan)", "convertTable/github(html)");
  has(gh, "세로 병합(rowspan)", "convertTable/github(html)");
  // rowspan 이 차지한 자리는 빈 칸으로 남는다.
  has(gh, "|  | 3분기 | 4분기 |", "convertTable/github(html)");

  const jira = convertTable(html, "jira");
  has(jira, "||구분||2026 상반기||2026 상반기||", "convertTable/jira(html)");
  has(jira, "2분기 \\\\ (잠정)", "convertTable/jira(html)");
  has(jira, "{color:#707070}※", "convertTable/jira(html)");

  const conf = convertTable(html, "confluence");
  has(conf, "<th>구분</th><th>2026 상반기</th><th>2026 상반기</th>", "convertTable/confluence(html)");
  has(conf, "2분기<br />(잠정)", "convertTable/confluence(html)");
  has(conf, "<em>※", "convertTable/confluence(html)");

  // 제목 행이 없는 표는 첫 행을 제목 행으로 올린다.
  const noHeader = convertTable(
    "<table><tbody><tr><td>가</td><td>나</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>",
    "github",
  );
  has(noHeader, "| 가 | 나 |", "convertTable/no-header");
  has(noHeader, "제목 행이 없어", "convertTable/no-header");
});

/* ────────────────────── 6. Context Capsule ────────────────────── */

test("buildContextCapsule 이 트리·본문·열린 작업을 한 문서로 묶는다", () => {
  const capsule = buildContextCapsule({
    project: { id: "p1", name: "AI 작업 공간" },
    notes: [
      {
        id: "n1",
        title: "MVP 설계",
        parentId: null,
        content:
          "<h1>MVP 설계</h1><p>핵심은 <strong>로컬 우선</strong>입니다.</p>" +
          '<ul data-type="taskList">' +
          '<li data-checked="false" data-due-date="2026-08-10" data-assignee="jinsim"><p>변환기 붙이기</p></li>' +
          '<li data-checked="true"><p>스키마 확정</p></li>' +
          "</ul>",
      },
      {
        id: "n2",
        title: "왕복 검증",
        parentId: "n1",
        content:
          "<h2>왕복 검증</h2><p>표와 코드가 살아 있어야 합니다.</p>" +
          '<ul data-type="taskList"><li data-checked="false"><p>회귀 픽스처 추가</p></li></ul>',
      },
      { id: "n3", title: "버린 노트", parentId: null, content: "<p>지움</p>", trashed: true },
    ],
    now: new Date("2026-08-02T09:30:00.000Z"),
  });

  has(capsule, "# Context Capsule — AI 작업 공간", "Capsule");
  has(capsule, "- 프로젝트 ID: `p1`", "Capsule");
  has(capsule, "- 생성 시각: 2026-08-02T09:30:00.000Z", "Capsule");
  has(capsule, "- 노트 수: 2 (휴지통 제외)", "Capsule");

  // 트리는 부모-자식 들여쓰기를 유지한다.
  has(capsule, "## 노트 트리\n\n- MVP 설계\n  - 왕복 검증", "Capsule");

  // 열린 작업만 모으고 마감·담당·출처 노트를 붙인다.
  has(capsule, "- [ ] 변환기 붙이기 — 마감 2026-08-10 · 담당 jinsim · 노트 MVP 설계", "Capsule");
  has(capsule, "- [ ] 회귀 픽스처 추가 — 노트 왕복 검증", "Capsule");
  assert.ok(!capsule.includes("[ ] 스키마 확정"), "완료된 작업이 열린 작업에 들어갔습니다.");

  // 본문은 richToMarkdown 결과로 들어간다.
  has(capsule, "### 1. MVP 설계", "Capsule");
  has(capsule, "<!-- ks-note id=n1 depth=0 parent=root -->", "Capsule");
  has(capsule, "핵심은 **로컬 우선**입니다.", "Capsule");
  has(capsule, "### 2. 왕복 검증", "Capsule");
  has(capsule, "<!-- ks-note id=n2 depth=1 parent=n1 -->", "Capsule");
  has(capsule, "* [x] 스키마 확정", "Capsule");

  // 휴지통 노트는 어디에도 없다.
  assert.ok(!capsule.includes("버린 노트"), "휴지통 노트가 캡슐에 들어갔습니다.");

  const empty = buildContextCapsule({
    project: { id: "p9", name: "빈 프로젝트" },
    notes: [],
    now: 0,
  });
  has(empty, "_노트가 없습니다._", "Capsule(empty)");
  has(empty, "_미완료 작업이 없습니다._", "Capsule(empty)");
});

console.log(results.join("\n"));
console.log(`\n${passed}/${passed} 통과 — converters.mjs`);
