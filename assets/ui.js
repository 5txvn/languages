/** DOM helpers — text measurement, modals, sliders, effects, flags. */

let _measureEl = null;

export function measureWordWidth(text, referenceEl) {
  if (!_measureEl) {
    _measureEl = document.createElement("span");
    _measureEl.setAttribute("aria-hidden", "true");
    _measureEl.style.cssText =
      "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none;font-weight:700;";
    document.body.appendChild(_measureEl);
  }
  const cs = getComputedStyle(referenceEl);
  _measureEl.style.fontSize = cs.fontSize;
  _measureEl.style.fontFamily = cs.fontFamily;
  _measureEl.style.fontWeight = "700";
  _measureEl.style.letterSpacing = cs.letterSpacing;
  _measureEl.textContent = text || "M";
  return _measureEl.getBoundingClientRect().width;
}

const FLAG_SIZES = {
  sm: { w: 24, h: 18, cls: "w-6 h-[18px]" },
  md: { w: 32, h: 24, cls: "w-8 h-6" },
  lg: { w: 40, h: 30, cls: "w-10 h-[30px]" },
};

/** SVG flags — works on Windows (emoji regional indicators do not). */
export function flagEl(country, size = "md") {
  const code = (country || "xx").toLowerCase();
  const spec = FLAG_SIZES[size] ?? (typeof size === "string" && size.startsWith("w-") ? { w: 32, h: 24, cls: size } : FLAG_SIZES.md);

  const wrap = document.createElement("span");
  wrap.className = "flag-wrap inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border";
  wrap.style.borderColor = "var(--border)";
  wrap.style.background = "var(--card)";

  const img = document.createElement("img");
  img.src = `https://flagcdn.com/${code}.svg`;
  img.alt = "";
  img.className = `flag-img block object-cover ${spec.cls}`;
  img.width = spec.w;
  img.height = spec.h;
  img.loading = "lazy";
  img.decoding = "async";

  img.onerror = () => {
    img.remove();
    const fb = document.createElement("span");
    fb.className = "flex items-center justify-center font-bold uppercase text-[9px]";
    fb.style.color = "var(--muted)";
    fb.style.width = `${spec.w}px`;
    fb.style.height = `${spec.h}px`;
    fb.textContent = code.slice(0, 2);
    wrap.appendChild(fb);
  };

  wrap.appendChild(img);
  return wrap;
}

export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

export function bindModalDismiss() {
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeModal(el.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.classList.remove("open");
    });
  });
}

export function updateRangeFill(loInput, hiInput, fillEl) {
  const min = +loInput.min;
  const max = +loInput.max;
  const lo = +loInput.value;
  const hi = +hiInput.value;
  const loPct = ((lo - min) / (max - min)) * 100;
  const hiPct = ((hi - min) / (max - min)) * 100;
  fillEl.style.left = `${loPct}%`;
  fillEl.style.width = `${hiPct - loPct}%`;
}

export function bounceScore(el) {
  el.classList.remove("score-bounce");
  void el.offsetWidth;
  el.classList.add("score-bounce");
}

/** Multiple confetti bursts behind page content, using language flag colors. */
export function fireConfetti(colors = ["#e8a317", "#c45c26"]) {
  const palette = colors.length ? colors : ["#e8a317", "#c23b3b"];
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const bursts = [
    { x: canvas.width * 0.5, y: canvas.height * 0.38 },
    { x: canvas.width * 0.32, y: canvas.height * 0.42 },
    { x: canvas.width * 0.68, y: canvas.height * 0.42 },
  ];

  const pieces = [];
  for (const burst of bursts) {
    for (let i = 0; i < 45; i++) {
      const angle = (Math.PI * 2 * i) / 45 + Math.random() * 0.4;
      const speed = 4 + Math.random() * 10;
      pieces.push({
        x: burst.x + (Math.random() - 0.5) * 40,
        y: burst.y + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 14,
        w: 5 + Math.random() * 7,
        h: 3 + Math.random() * 5,
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 1,
        delay: Math.floor(Math.random() * 8),
      });
    }
  }

  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      if (p.delay > 0) {
        p.delay -= 1;
        alive = true;
        continue;
      }
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.32;
      p.vx *= 0.99;
      p.rot += p.vr;
      p.life -= 0.01;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 150) requestAnimationFrame(tick);
    else canvas.remove();
  }
  tick();
}
