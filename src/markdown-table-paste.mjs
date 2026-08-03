const splitPipeRow = (value) => {
  const line = String(value || "").trim();
  if (!line.includes("|")) return null;

  const cells = [];
  let cell = "";
  let delimiters = 0;
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && index + 1 < line.length) {
      cell += character + line[index + 1];
      index += 1;
      continue;
    }
    if (character === "`") {
      let run = 1;
      while (line[index + run] === "`") run += 1;
      cell += "`".repeat(run);
      if (!codeTicks) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      continue;
    }
    if (character === "|" && !codeTicks) {
      cells.push(cell.trim());
      cell = "";
      delimiters += 1;
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());

  if (!delimiters) return null;
  if (!cells[0] && line.startsWith("|")) cells.shift();
  if (!cells.at(-1) && line.endsWith("|")) cells.pop();
  return cells.length >= 2 ? cells : null;
};

const isSeparatorRow = (cells) =>
  Boolean(cells?.length) && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

const escapeCellPipes = (value) => {
  const cell = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let escaped = "";
  for (let index = 0; index < cell.length; index += 1) {
    if (cell[index] === "\\" && index + 1 < cell.length) {
      escaped += cell[index] + cell[index + 1];
      index += 1;
    } else {
      escaped += cell[index] === "|" ? "\\|" : cell[index];
    }
  }
  return escaped;
};

const formatPipeRow = (cells) =>
  `| ${cells.map(escapeCellPipes).join(" | ")} |`;

const fencedLineMask = (lines) => {
  const masked = new Set();
  let activeFence = null;
  lines.forEach((line, index) => {
    if (!activeFence) {
      const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (!opening) return;
      activeFence = { character: opening[1][0], size: opening[1].length };
      masked.add(index);
      return;
    }
    masked.add(index);
    const closing = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
    if (
      closing &&
      closing[1][0] === activeFence.character &&
      closing[1].length >= activeFence.size
    )
      activeFence = null;
  });
  return masked;
};

export const normalizeMarkdownTablePaste = (value) => {
  const original = String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!original) return null;

  const lines = original.split("\n");
  const fencedLines = fencedLineMask(lines);
  for (let headerIndex = 0; headerIndex < lines.length; headerIndex += 1) {
    if (fencedLines.has(headerIndex)) continue;
    const headerCells = splitPipeRow(lines[headerIndex]);
    if (!headerCells || isSeparatorRow(headerCells)) continue;

    let separatorIndex = headerIndex + 1;
    while (separatorIndex < lines.length && !lines[separatorIndex].trim())
      separatorIndex += 1;
    if (fencedLines.has(separatorIndex)) continue;
    const separatorCells = splitPipeRow(lines[separatorIndex]);
    if (
      !isSeparatorRow(separatorCells) ||
      separatorCells.length !== headerCells.length
    )
      continue;

    const dataRows = [];
    let cursor = separatorIndex + 1;
    let lastTableIndex = separatorIndex;
    while (cursor < lines.length) {
      if (!lines[cursor].trim()) {
        cursor += 1;
        continue;
      }
      if (fencedLines.has(cursor)) break;
      const cells = splitPipeRow(lines[cursor]);
      if (
        !cells ||
        cells.length !== headerCells.length ||
        isSeparatorRow(cells)
      )
        break;
      let nextRowIndex = cursor + 1;
      while (nextRowIndex < lines.length && !lines[nextRowIndex].trim())
        nextRowIndex += 1;
      const nextCells = fencedLines.has(nextRowIndex)
        ? null
        : splitPipeRow(lines[nextRowIndex]);
      if (
        isSeparatorRow(nextCells) &&
        nextCells.length === headerCells.length
      )
        break;
      dataRows.push({ index: cursor, cells });
      lastTableIndex = cursor;
      cursor += 1;
    }

    const prefix = lines.slice(0, headerIndex).join("\n").trim();
    const suffix = lines.slice(lastTableIndex + 1).join("\n").trim();
    const table = [
      formatPipeRow(headerCells),
      formatPipeRow(separatorCells),
      ...dataRows.map((row) => formatPipeRow(row.cells)),
    ].join("\n");
    const markdown = [prefix, table, suffix].filter(Boolean).join("\n\n");
    return {
      markdown,
      columnCount: headerCells.length,
      dataRowCount: dataRows.length,
    };
  }
  return null;
};
