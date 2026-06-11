/** Lightweight markdown → HTML for foundations and about pages. */

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const external = href.startsWith("http");
    const rel = external ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${href}"${rel}>${label}</a>`;
  });
  return s;
}

export function renderMarkdown(md) {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^---+$/.test(line.trim())) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      const id = slugify(h3[1]);
      out.push(`<h3 id="${id}">${inlineFormat(h3[1])}</h3>`);
      i += 1;
      continue;
    }

    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      const id = slugify(h2[1]);
      out.push(`<h2 id="${id}">${inlineFormat(h2[1])}</h2>`);
      i += 1;
      continue;
    }

    const h1 = line.match(/^# (.+)$/);
    if (h1) {
      out.push(`<h1>${inlineFormat(h1[1])}</h1>`);
      i += 1;
      continue;
    }

    if (/^> (.+)$/.test(line)) {
      const quotes = [];
      while (i < lines.length && /^> (.+)$/.test(lines[i])) {
        quotes.push(inlineFormat(lines[i].replace(/^> /, "")));
        i += 1;
      }
      out.push(`<blockquote>${quotes.join("<br>")}</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s|:-]+\|/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const parseRow = (row) =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
      const rows = tableLines.map(parseRow).filter((r) => r.some((c) => c) && !isSep(r));
      if (rows.length) {
        const [head, ...body] = rows;
        const thead = `<thead><tr>${head.map((c) => `<th>${inlineFormat(c)}</th>`).join("")}</tr></thead>`;
        const tbody = body.length
          ? `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inlineFormat(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
          : "";
        out.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }

    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].slice(2))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\d+\. /, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^#{1,3} /.test(lines[i]) && !/^[-*] /.test(lines[i]) && !/^\d+\. /.test(lines[i]) && !/^> /.test(lines[i]) && !/^---+$/.test(lines[i].trim())) {
      para.push(inlineFormat(lines[i]));
      i += 1;
    }
    out.push(`<p>${para.join("<br>")}</p>`);
  }

  return out.join("\n");
}

export async function fetchMarkdown(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  return res.text();
}
