export const OPERATION_MAX_ATTEMPTS = 2;

const RETRY_HINTS = {
  revision_conflict:
    "note_get으로 페이지를 다시 읽고 새 revision을 expectedRevision으로 넣어 최대 2회까지 재시도하세요.",
  diagram_syntax_invalid:
    "다이어그램 소스 문법을 수정하고 최대 2회까지 재시도하세요.",
  diagram_render_failed:
    "다이어그램 소스를 단순화·수정하고 최대 2회까지 재시도하세요.",
  operation_expired:
    "승인 만료 작업입니다. 같은 내용으로 새 operation을 요청하세요.",
  encoding_suspect:
    "텍스트를 UTF-8로 다시 전송하고 최대 2회까지 재시도하세요.",
};

export const operationRetryAdvice = (code) => {
  const hint = RETRY_HINTS[String(code || "")];
  if (!hint)
    return { retryable: false, maxAttempts: OPERATION_MAX_ATTEMPTS };
  return { retryable: true, hint, maxAttempts: OPERATION_MAX_ATTEMPTS };
};
