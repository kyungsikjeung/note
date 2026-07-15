# KsNote

KsNote는 문서 작성, 표, 코드, 이미지, 다이어그램, 체크리스트와 AI 편집을 한 화면에서 다루는 로컬 우선 데스크톱 작업 공간입니다.

제품의 핵심 방향은 다음과 같습니다.

> 사용자는 형식과 문법을 외우지 않고 기록하며, 에디터와 AI가 내용을 이해하고 안전한 변경 단위로 편집한다.

이 문서는 프로그램 소개이면서, 다음 개발 세션에서 AI에게 그대로 전달할 수 있는 기능 요구사항과 MVP 체크리스트입니다.

## 상태 표시 규칙

- `[x]` 현재 소스에 구현되어 빌드 가능한 기능
- `[ ]` 아직 구현되지 않았거나 UI만 있고 실제 동작 연결이 필요한 기능
- 기능이 일부만 구현된 경우 구현된 부분과 남은 부분을 별도 항목으로 분리

## 실행 방법

요구 환경:

- Node.js
- npm
- Windows 우선 지원
- AI 기능 사용 시 로그인된 Codex CLI 또는 Claude Code CLI

```powershell
npm install
npm run dev
```

프로덕션 빌드:

```powershell
npm run build
npm run desktop
```

## 현재 기술 구성

- Electron
- React
- Vite
- TipTap/ProseMirror
- Mermaid
- Highlight.js
- 로컬 CLI 기반 Codex/Claude 실행
- 현재 데이터 저장소: 브라우저 `localStorage`

---

# MVP 1 — Smart Editor

목표: AI가 없어도 문서, 표, 코드, 이미지, 다이어그램과 할 일을 편하게 작성할 수 있는 로컬 데스크톱 노트 에디터를 완성한다.

## 1. 작업 공간과 프로젝트

- [x] 앱 이름을 `KsNote`로 표시
- [x] 프로젝트 목록 표시
- [x] 프로젝트 추가
- [x] 프로젝트 이름 변경
- [x] 프로젝트 삭제
- [x] 프로젝트 삭제 시 포함된 노트 cascade 삭제
- [x] 삭제 전 프로젝트 이름과 삭제되는 노트 수 표시
- [x] 프로젝트별 노트 필터링
- [x] 새 노트 생성
- [x] 현재 프로젝트에서 페이지 추가
- [x] 프로젝트 `…` 메뉴에서 해당 프로젝트에 페이지 추가
- [x] 노트 제목 직접 편집
- [x] 노트 검색
- [x] 최근 수정 시각 표시
- [x] 자동 저장 상태 표시
- [x] 사이드바 열기/닫기
- [x] 노트 이름 변경과 별도의 노트 삭제 메뉴
- [x] 노트 휴지통과 복원
- [x] 프로젝트 및 노트 드래그 정렬
- [x] 하위 노트 트리와 하위 페이지 추가

## 2. WYSIWYG 문서 편집기

- [x] TipTap 기반 실제 문서 편집
- [x] 일반 문단
- [x] 제목 1, 제목 2
- [x] 굵게, 기울임, 밑줄, 취소선
- [x] 글자색
- [x] 배경 강조색
- [x] 왼쪽, 가운데, 오른쪽 정렬
- [x] 글머리 목록
- [x] 번호 목록
- [x] 인용문
- [x] 구분선
- [x] Undo/Redo
- [x] 선택 영역이 툴바 클릭으로 사라지지 않도록 selection 복원
- [x] 코드 블록 마지막에서 `→` 키로 일반 문단으로 빠져나오기
- [x] 편집/분할/보기 모드
- [x] 분할 모드에서 실시간 HTML 프리뷰
- [x] 제목 3~6
- [x] 링크 삽입·수정 UI
- [x] 글꼴 크기와 글꼴 종류를 실제 Rich Editor에 적용
- [x] 찾기/바꾸기
- [x] 문서 목차
- [x] 블록 드래그 이동

## 3. Slash Command

빈 문단에서 `/`를 입력하면 현재 커서 주변에 블록 명령 메뉴를 표시해야 합니다.

- [x] `/` 입력 시 명령 목록 표시
- [x] 키워드 검색
- [x] 위/아래 방향키로 이동
- [x] Enter로 선택
- [x] Esc로 닫기
- [x] 마우스로 선택
- [x] `/table` 표 삽입
- [x] `/code` 코드 블록 삽입
- [x] `/file` 이미지/GIF 파일 선택창
- [x] `/diagram` 다이어그램 종류 선택
- [x] `/mermaid` Mermaid 블록 바로 삽입
- [x] `/plantuml` 로컬 렌더링 블록 삽입
- [x] `/check` 체크 가능한 할 일 목록
- [x] `/h1`, `/h2`
- [x] `/list`, `/number`
- [x] `/quote`, `/divider`, `/text`
- [x] 최근 사용 명령 우선 표시
- [x] 사용자 정의 Slash Command

## 4. 표 편집

표는 별도 소스 창이나 Markdown 문법이 아니라 본문 안에서 바로 보여야 하며 셀을 직접 편집할 수 있어야 합니다.

- [x] 본문 커서 위치에 실제 표 삽입
- [x] 툴바에서 8×8 크기 선택
- [x] 셀 직접 편집
- [x] 셀 범위 선택
- [x] 열 너비 드래그 조절
- [x] 위/아래 행 추가
- [x] 왼쪽/오른쪽 열 추가
- [x] 행 삭제
- [x] 열 삭제
- [x] 표 삭제
- [x] 셀 병합과 분할
- [x] 셀 배경색
- [x] `Ctrl+Alt+Right` 오른쪽 열 추가
- [x] `Ctrl+Alt+Down` 아래 행 추가
- [x] 표 전용 AI 지시 입력 UI
- [x] 표 셀 글자색 전용 UI
- [x] 셀별 좌/중/우 정렬 UI
- [x] Excel/CSV 클립보드를 Rich Table로 자동 변환
- [x] 선택 행·열 재정렬 UI
- [x] Jira/Confluence 호환 표 클립보드 내보내기

## 5. 코드 블록

- [x] `/code`로 코드 블록 생성
- [x] 본문 안에서 직접 코드 편집
- [x] 어두운 코드 전용 스타일
- [x] 코드 블록 밖으로 키보드 이동
- [x] 언어 선택 메뉴
- [x] Smart Paste 코드 유형 감지
- [x] 구문 강조
- [x] JSON 코드 자동 정렬/Beautify
- [x] 줄 번호
- [x] 코드 접기
- [x] 코드 블록 복사 버튼
- [x] 붙여 넣은 코드를 자동으로 코드 블록 변환

## 6. 이미지와 파일

- [x] 클립보드 이미지를 현재 커서 위치에 붙여 넣기
- [x] 파일 드래그 앤 드롭
- [x] `/file` 파일 선택창
- [x] PNG, JPEG, WebP, GIF 선택
- [x] 여러 이미지 선택
- [x] 이미지 좌/중/우 정렬
- [x] 25%, 50%, 75%, 100% 크기 버튼
- [x] 좌우 핸들로 이미지 크기 조절
- [x] 이미지 원본 비율 유지
- [x] 일반 첨부파일 블록
- [x] 이미지 캡션 편집
- [x] 큰 이미지 자동 압축(1.5MB 초과, GIF 제외)
- [x] 로컬 OCR(한국어/영어)
- [x] 로컬 asset 파일 저장소

## 7. Mermaid와 다이어그램

- [x] Mermaid 전용 블록
- [x] Source/Split/Preview 전환
- [x] Mermaid 소스 수정 시 즉시 렌더링
- [x] Mermaid 소스 복사
- [x] Mermaid 블록 삭제
- [x] Mermaid 문법 오류 표시
- [x] 편집 모드에서 SVG 렌더링
- [x] 오른쪽 분할 프리뷰에서 Mermaid SVG 렌더링
- [x] `/diagram` 통합 진입 화면
- [x] Mermaid 코드 Smart Paste 감지
- [x] PlantUML 로컬 Java/JAR 런타임 설정
- [x] PlantUML 블록 렌더링
- [x] Mermaid/PlantUML 기본 흐름·시퀀스 상호 변환
- [x] 다이어그램을 PNG/SVG로 내보내기

## 8. 체크리스트

- [x] `/check`로 실제 Task List 생성
- [x] 체크박스 클릭으로 완료/미완료 변경
- [x] 완료 항목 취소선 표시
- [x] Enter로 다음 할 일 추가
- [x] 빈 항목에서 Enter로 목록 종료
- [x] Tab/Shift+Tab 중첩 단계 변경
- [x] 프리뷰에 체크 상태 표시
- [x] 마감일
- [x] 담당자
- [x] 우선순위
- [x] 프로젝트 전체 할 일 모아보기
- [x] 완료 항목 숨기기

## 9. Smart Paste

- [x] 클립보드 이미지 감지
- [x] Mermaid 소스 감지
- [x] 붙여 넣은 Mermaid를 전용 블록으로 변환
- [x] 코드 자동 감지 및 코드 블록 변환
- [x] JSON 감지와 Beautify
- [x] CSV/TSV/Excel 표 변환
- [x] HTML 클립보드 Rich Text 변환
- [x] Markdown 전체 구조 변환
- [x] PlantUML 감지와 블록 변환
- [x] 붙여 넣기 변환 결과를 적용 전 선택할 수 있는 확인 UI

## 10. 설정과 작업 공간 메뉴

- [x] 상단 `…` 메뉴
- [x] 하단 작업 공간 `…` 메뉴
- [x] 메뉴 밖 클릭과 Esc로 닫기
- [x] 일반 설정 탭
- [x] 편집기 설정 탭
- [x] AI Agent 설정 탭
- [x] MCP 연결 설정 탭
- [x] 데이터 설정 탭
- [x] 보안 설정 탭
- [x] 설정을 로컬에 저장
- [x] Codex/Claude 기본 Agent 선택
- [x] Agent CLI 실행 명령 설정
- [x] MCP 서버 이름, 명령, 인자, 활성 상태 설정 UI
- [x] 테마 설정 실제 적용
- [x] 편집기 글꼴 설정 실제 적용
- [x] 맞춤법 설정 실제 적용
- [x] MCP 서버 연결 테스트
- [x] Agent CLI 설치/로그인 상태 테스트
- [x] 키보드 단축키 목록 화면

## 11. 저장과 내보내기

- [x] 로컬 자동 저장
- [x] 앱 재실행 후 프로젝트와 노트 복원
- [x] Markdown 파일 저장 대화상자
- [x] Rich HTML을 Markdown으로 변환해서 내보내기
- [x] HTML 내보내기
- [x] PDF 내보내기
- [x] DOCX 내보내기
- [x] SQLite 저장소
- [x] 노트별 revision history와 복원
- [x] 첨부파일을 별도 assets 디렉터리에 저장

## MVP 1 완료 기준

- [x] 프로젝트와 노트를 생성하고 자동 저장할 수 있다.
- [x] 일반 문서, 표, 코드, 이미지, Mermaid와 체크리스트를 본문에서 편집할 수 있다.
- [x] `/` 명령으로 주요 블록을 삽입할 수 있다.
- [x] 편집/분할/보기 모드가 동작한다.
- [x] Windows 개발 빌드가 성공한다.
- [x] Smart Paste가 코드, JSON, 표, Markdown을 편집 가능한 블록으로 변환한다.
- [x] GFM Markdown 내보내기·다시 가져오기와 Mermaid/PlantUML 왕복

---

# MVP 2 — AI Editor

목표: 구독형 Codex/Claude CLI를 사용해 노트를 질문하고 최소 범위로 안전하게 편집한다.

## 1. AI 푸터

- [x] AI 패널 열기/닫기
- [x] 노트 편집 모드
- [x] 질문 모드
- [x] Codex/Claude Provider 선택
- [x] 사용자 프롬프트 입력
- [x] Enter 전송, Shift+Enter 줄바꿈
- [x] 로딩 및 오류 표시
- [x] 결과를 노트에 삽입
- [x] 결과로 대상 범위 교체
- [x] 결과 취소
- [x] 표 전용 AI 프롬프트
- [ ] 선택 영역이 정확히 유지되는 AI Patch
- [ ] 적용 전 실제 diff 표시
- [ ] AI Prompt 세션 목록
- [ ] 프로젝트별 AI 대화 이력
- [ ] 실행 중 취소
- [ ] 응답 스트리밍
- [ ] CLI 설치 및 로그인 자동 진단

## 2. AI 안전 편집

- [x] Codex를 read-only sandbox로 실행
- [x] Claude 도구 사용을 제한한 print 모드 실행
- [x] 앱이 계정 비밀번호나 웹 세션 쿠키를 저장하지 않음
- [x] 사용자 설정 CLI 명령의 위험한 shell 구분자 차단
- [ ] Block ID 기반 Patch Schema
- [ ] revision 기반 충돌 확인
- [ ] AI 변경 revision 자동 저장
- [ ] 변경 전후 diff와 부분 선택 적용
- [ ] 전체 노트 교체 경고
- [ ] AI 실행 감사 로그

## MVP 2 완료 기준

- [ ] 선택 영역 요약 → diff → 적용 → Undo가 안정적으로 동작한다.
- [ ] 표를 AI로 수정해도 표 구조와 셀 서식이 유지된다.
- [ ] AI 세션과 실제 노트 변경 이력이 연결된다.
- [ ] Codex와 Claude가 동일한 Patch 응답 규격을 사용한다.

---

# MVP 3 — KsNote MCP Server

목표: Codex가 KsNote의 프로젝트와 노트를 MCP Tool로 안전하게 검색하고 편집할 수 있게 한다.

상세 조사 문서: [KsNote × Codex MCP 연동 조사 및 100개 시나리오](docs/codex-mcp-integration-research.md)

## 1. 저장소 기반

- [ ] `localStorage` 데이터를 SQLite로 마이그레이션
- [ ] Project Repository
- [ ] Note Repository
- [ ] Block Repository
- [ ] Asset Repository
- [ ] Task Repository
- [ ] Revision Repository
- [ ] 기존 사용자 데이터 자동 마이그레이션
- [ ] Electron과 MCP 프로세스의 동시 접근 처리
- [ ] 외부 변경 시 에디터 자동 갱신

## 2. 읽기 전용 MCP Tools

- [ ] `workspace_get_context`
- [ ] `project_list`
- [ ] `note_search`
- [ ] `note_get`
- [ ] `task_query`
- [ ] `asset_get`
- [ ] `history_list`
- [ ] pagination
- [ ] 검색 결과 score와 snippet
- [ ] block/heading 범위 읽기

## 3. 쓰기 MCP Tools

- [ ] `note_create`
- [ ] `note_patch`
- [ ] `note_move`
- [ ] `task_update`
- [ ] `history_restore`
- [ ] expected revision 검사
- [ ] 최소 block patch
- [ ] 쓰기 전 diff
- [ ] 쓰기 승인
- [ ] 충돌 응답

## 4. Codex 연결

- [ ] `mcp/ksnote-server.mjs`
- [ ] STDIO transport
- [ ] 서버 `instructions`
- [ ] Tool `description`
- [ ] `inputSchema`와 `outputSchema`
- [ ] `readOnlyHint`와 위험 annotation
- [ ] 프로젝트 `.codex/config.toml`
- [ ] `codex mcp add ksnote` 설치 흐름
- [ ] KsNote 설정 UI에서 설정 파일 생성
- [ ] MCP 상태/도구 목록/오류 로그 표시

## MVP 3 완료 기준

- [ ] Codex에서 현재 노트와 선택 영역을 읽을 수 있다.
- [ ] 프로젝트 전체 노트를 검색할 수 있다.
- [ ] 쓰기 작업은 revision과 사용자 승인을 요구한다.
- [ ] UI와 Codex가 동시에 편집해도 자동 덮어쓰지 않는다.
- [ ] 모든 MCP 변경을 history에서 복구할 수 있다.

---

# MVP 4 — Converter와 외부 도구

목표: KsNote의 문서를 Jira, Confluence, GitHub, Markdown과 업무 도구에 맞게 변환하고 전송한다.

- [ ] Markdown ↔ Rich Document 무손실 변환
- [ ] Markdown → Jira 변환
- [ ] Markdown → Confluence 변환
- [ ] Markdown → GitHub 변환
- [ ] 표 플랫폼별 호환 변환
- [ ] Jira MCP 연결
- [ ] Confluence MCP 연결
- [ ] GitHub MCP 연결
- [ ] Local Files MCP 연결
- [ ] 실행 전 승인 화면
- [ ] 실행 결과와 외부 URL을 노트에 기록
- [ ] 회의 노트에서 Jira 티켓 생성
- [ ] 노트에서 GitHub Issue 생성
- [ ] 프로젝트 Context Capsule

---

# AI에게 전달할 개발 지침

아래 내용을 다음 AI 개발 세션의 기본 프롬프트로 사용할 수 있습니다.

```text
당신은 KsNote 데스크톱 앱을 개발한다.

제품 목표:
KsNote는 Confluence/Word처럼 본문을 직접 편집하면서 표, 코드, 이미지,
Mermaid, 체크리스트와 AI 편집을 한 화면에서 제공하는 로컬 우선 AI 작업 공간이다.

작업 시작 규칙:
1. README.md의 MVP 체크리스트를 먼저 읽는다.
2. [x] 기능을 다시 만들거나 기존 동작을 제거하지 않는다.
3. 사용자가 요청한 기능과 직접 관련된 [ ] 항목만 구현한다.
4. 현재 데이터를 보존하며 기존 localStorage key를 임의로 변경하지 않는다.
5. Rich Editor는 TipTap/ProseMirror 구조를 유지한다.
6. 표, 이미지, 코드, Mermaid와 체크리스트는 문자열이 아닌 실제 편집 가능한 block/node로 처리한다.
7. AI 편집은 전체 덮어쓰기보다 선택 영역 또는 block 단위 patch를 우선한다.
8. 쓰기·삭제·복구·외부 전송은 적용 전 대상을 분명히 표시한다.
9. MCP Tool은 읽기와 쓰기를 분리하고 Description에 사용 시점, 선행 조건,
   부작용, 승인 조건을 기록한다.
10. 작업 후 npm run build와 관련 동작을 검증한다.

UX 원칙:
- 여러 단계보다 커서 위치에서 바로 실행되는 흐름을 우선한다.
- `/` 입력으로 삽입 가능한 블록을 검색할 수 있어야 한다.
- 팝업을 열더라도 현재 선택 영역과 커서 위치를 잃지 않아야 한다.
- 문서는 소스 코드가 아니라 최종 모양으로 보이고 그 자리에서 수정되어야 한다.
- 오류는 빈 화면으로 두지 말고 원인과 해결 방법을 표시한다.
- 설정은 상단 및 하단 `…` 메뉴에서 접근할 수 있어야 한다.
- 키보드와 마우스 모두로 같은 핵심 기능을 실행할 수 있어야 한다.

완료 보고 규칙:
- 구현한 README 체크박스를 [x]로 갱신한다.
- 아직 동작하지 않는 기능을 완료로 표시하지 않는다.
- 변경 파일, 사용자 동작, 검증 결과와 남은 제한을 보고한다.
```

## 개발 시 주의할 현재 제한

- 현재 노트 데이터는 `localStorage`에 있어 외부 MCP 프로세스가 직접 읽을 수 없다.
- 분할 프리뷰는 별도 Mermaid 렌더링 단계가 필요하다.
- 설정 화면의 MCP 항목은 현재 구성 UI이며 실제 서버 연결은 구현되지 않았다.
- PlantUML은 Java/JAR 또는 렌더링 서버가 필요하다.
- 현재 내보내기는 HTML 문서 내용을 `.md`로 저장할 수 있으므로 정식 변환기가 필요하다.
- 대용량 Mermaid 번들에 대한 code splitting이 필요하다.

## 검증 명령

```powershell
npm run build
git diff --check
```
