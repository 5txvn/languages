/** Area line chart with grid, day labels, and hover tooltips. */

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildSeries(history, days) {
  const today = new Date();
  const labels = [];
  const dates = [];
  const values = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    dates.push(key);
    labels.push(
      days <= 14
        ? DAY_NAMES[d.getDay()]
        : `${d.getMonth() + 1}/${d.getDate()}`
    );
    const row = (history ?? []).find((x) => x.date === key);
    values.push(row?.points ?? 0);
  }
  return { labels, dates, values };
}

function chartColors() {
  const hot = getComputedStyle(document.documentElement).getPropertyValue("--hot").trim() || "#16a34a";
  return { line: hot, fill: hot, grid: "#e5e5ea", muted: "#9ca3af" };
}

export function renderScoreChart(canvas, history, days = 7) {
  if (!canvas) return [];
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 140;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const { labels, dates, values } = buildSeries(history, days);
  const colors = chartColors();
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const max = Math.max(10, ...values);
  const niceMax = Math.ceil(max / 50) * 50 || 50;
  const n = values.length;
  const stepX = n > 1 ? chartW / (n - 1) : chartW;

  const points = values.map((v, i) => ({
    x: padL + i * stepX,
    y: padT + chartH - (v / niceMax) * chartH,
    v,
    label: labels[i],
    date: dates[i],
  }));

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let g = 0; g <= gridLines; g++) {
    const y = padT + (chartH / gridLines) * g;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
    const val = Math.round(niceMax - (niceMax / gridLines) * g);
    ctx.fillStyle = colors.muted;
    ctx.font = "10px DM Sans, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(val), padL - 6, y + 3);
  }

  const labelEvery = n > 20 ? Math.ceil(n / 10) : n > 12 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = padL + i * stepX;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + chartH);
    ctx.stroke();
    if (i % labelEvery === 0 || i === n - 1) {
      ctx.fillStyle = colors.muted;
      ctx.font = "10px DM Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels[i], x, h - 8);
    }
  }

  if (points.length) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, padT + chartH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = colors.fill;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  canvas._chartPoints = points;
  return points;
}

export function attachChartHover(canvas, tooltipEl) {
  if (!canvas || canvas._chartHoverBound) return;
  canvas._chartHoverBound = true;

  const show = (p) => {
    if (!tooltipEl || !p) return;
    tooltipEl.textContent = `${p.date ?? p.label}: ${p.v} pts`;
    tooltipEl.style.display = "block";
    const rect = canvas.getBoundingClientRect();
    tooltipEl.style.left = `${rect.left + p.x}px`;
    tooltipEl.style.top = `${rect.top + p.y - 28}px`;
  };

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pts = canvas._chartPoints ?? [];
    let best = null;
    let bestDist = 20;
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.y - (e.clientY - rect.top));
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best) show(best);
    else if (tooltipEl) tooltipEl.style.display = "none";
  });
  canvas.addEventListener("mouseleave", () => {
    if (tooltipEl) tooltipEl.style.display = "none";
  });

  const pickPoint = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pts = canvas._chartPoints ?? [];
    let best = null;
    let bestDist = 24;
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  };

  canvas.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (!t) return;
      const best = pickPoint(t.clientX, t.clientY);
      if (best) show(best);
      else if (tooltipEl) tooltipEl.style.display = "none";
    },
    { passive: true }
  );
  canvas.addEventListener("touchend", () => {
    setTimeout(() => {
      if (tooltipEl) tooltipEl.style.display = "none";
    }, 1800);
  });
}
