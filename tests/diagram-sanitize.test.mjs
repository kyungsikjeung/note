import assert from "node:assert/strict";
import test from "node:test";
import {
  DIAGRAM_CODE_SELECTOR,
  protectDiagramCodes,
  restoreDiagramCodes,
} from "../src/diagram-sanitize.mjs";

const fakeElement = (attrs = {}) => {
  const store = { ...attrs };
  return {
    getAttribute: (name) => store[name] ?? null,
    setAttribute: (name, value) => {
      store[name] = value;
    },
    store,
  };
};

const fakeRoot = (elements) => ({
  seenSelectors: [],
  querySelectorAll(selector) {
    this.seenSelectors.push(selector);
    return elements;
  },
});

test("diagram code selector covers mermaid, plantuml, and drawio", () => {
  assert.match(DIAGRAM_CODE_SELECTOR, /div\[data-type="mermaid"\]\[data-code\]/);
  assert.match(DIAGRAM_CODE_SELECTOR, /div\[data-type="plantuml"\]\[data-code\]/);
  assert.match(DIAGRAM_CODE_SELECTOR, /div\[data-type="drawio"\]\[data-code\]/);
});

test("protect swaps codes for inert tokens and restore puts them back", () => {
  const arrowCode = "flowchart TD\n  A[R/G/B 셀 값 읽기] --> B{숫자로 변환 가능한가?}";
  const plainCode = "flowchart LR\n  A --> B";
  const elements = [
    fakeElement({ "data-code": arrowCode }),
    fakeElement({ "data-code": plainCode }),
    fakeElement({}),
  ];
  const root = fakeRoot(elements);
  const codes = protectDiagramCodes(root, "TEST_CODE");
  assert.equal(codes.size, 3);
  assert.deepEqual(root.seenSelectors, [DIAGRAM_CODE_SELECTOR]);
  for (const element of elements) {
    const token = element.getAttribute("data-code");
    assert.match(token, /^__KSNOTE_TEST_CODE_\d+__$/);
    assert.doesNotMatch(token, /-->/);
  }
  // Simulate a sanitizer that keeps tokens but would drop "-->" values.
  restoreDiagramCodes(root, codes);
  assert.equal(elements[0].getAttribute("data-code"), arrowCode);
  assert.equal(elements[1].getAttribute("data-code"), plainCode);
  assert.equal(elements[2].getAttribute("data-code"), "");
});

test("restore leaves unknown tokens untouched and tolerates an empty map", () => {
  const element = fakeElement({ "data-code": "__KSNOTE_OTHER_0__" });
  const root = fakeRoot([element]);
  restoreDiagramCodes(root, new Map([["__KSNOTE_TEST_CODE_0__", "code"]]));
  assert.equal(element.getAttribute("data-code"), "__KSNOTE_OTHER_0__");
  restoreDiagramCodes(root, new Map());
  assert.equal(element.getAttribute("data-code"), "__KSNOTE_OTHER_0__");
});
