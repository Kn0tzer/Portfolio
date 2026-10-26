try {
  const storedTheme = localStorage.getItem("kn0tzer-theme");
  document.documentElement.dataset.theme =
    storedTheme === "light" ? "light" : "dark";
} catch {}
if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
  document.documentElement.classList.add("intro-pending");
document.addEventListener(
  "DOMContentLoaded",
  () => {
    const TAU = Math.PI * 2;
    const clamp = (value, min = 0, max = 1) =>
      Math.min(max, Math.max(min, value));
    const easeOut = (value) => 1 - (1 - clamp(value)) ** 4;
    const CONTOUR_RADIUS = 300;
    const IRIS_BLADES = 6;
    function warpContourPoint(x, y, mouseX, mouseY, strength, elevation = 0.5) {
      const dx = x - mouseX,
        dy = y - mouseY;
      const u = (dx + dy * 0.32) / 270,
        v = (dy - dx * 0.18) / 210;
      const q = u * u + v * v;
      if (q >= 1 || !strength) return [x, y];
      const pressure = (1 - q) ** 4 * strength * (1 - elevation * 0.7);
      return [x + pressure * 9, y + pressure * 38];
    }
    function irisVertices(radius, cx, cy, rotation = 0) {
      return Array.from(
        {
          length: IRIS_BLADES,
        },
        (_, index) => {
          const angle = (index / IRIS_BLADES) * TAU + rotation;
          return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
        },
      );
    }
    function irisRadius(width, height, progress) {
      const eased = progress * progress * (3 - 2 * progress);
      return Math.hypot(width, height) * 0.68 * eased;
    }
    function stepLife(
      board,
      columns,
      rows,
      output = new Uint8Array(board.length),
    ) {
      for (let y = 0; y < rows; y += 1) {
        const above = ((y + rows - 1) % rows) * columns;
        const here = y * columns;
        const below = ((y + 1) % rows) * columns;
        for (let x = 0; x < columns; x += 1) {
          const left = (x + columns - 1) % columns;
          const right = (x + 1) % columns;
          const neighbors =
            board[above + left] +
            board[above + x] +
            board[above + right] +
            board[here + left] +
            board[here + right] +
            board[below + left] +
            board[below + x] +
            board[below + right];
          output[here + x] =
            neighbors === 3 || (board[here + x] && neighbors === 2) ? 1 : 0;
        }
      }
      return output;
    }
    function initEffects({
      onReady = () => {},
      initialScene: initialScene2 = 0,
    } = {}) {
      const rootElement = document.documentElement;
      const contour = document.querySelector("#contour-canvas");
      const lifeCanvas = document.querySelector("#life-canvas");
      const headingElement = document.querySelector("#hero-name");
      const introLogo = headingElement.querySelector(".zero-logo");
      function refreshLogoPixels() {
        if (forming) buildLifeGrid();
      }
      introLogo?.addEventListener("load", refreshLogoPixels);
      const hero = lifeCanvas?.parentElement;
      const iris = document.querySelector("#iris");
      const contourContext = contour?.getContext("2d", {
        alpha: true,
      });
      const lifeContext = lifeCanvas?.getContext("2d", {
        alpha: true,
      });
      const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      const coarseQuery = window.matchMedia("(pointer: coarse)");
      const compactQuery = window.matchMedia(
        "(max-width: 850px), (max-height: 680px)",
      );
      const transparencyQuery = window.matchMedia(
        "(prefers-reduced-transparency: reduce)",
      );
      let motionPreference = motionQuery.matches;
      let paused = false;
      let disposed = false;
      let readyDelivered = false;
      let ambientFrame = 0;
      let lifeFrame = 0;
      let irisTimer = 0;
      let lifeTimer = 0;
      let width = window.innerWidth;
      let height = window.innerHeight;
      let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let terrainSized = false;
      let paths = [];
      let scene = initialScene2;
      let forming = false;
      let lifeStart = 0;
      let lastGeneration = -1;
      let grid = null;
      let irisFrame = 0;
      let lastAmbientTime = 0;
      const backdrop = document.createElement("canvas");
      const backdropContext = backdrop.getContext("2d");
      let screenContours = [],
        baseScene = NaN,
        baseLight = null,
        lastPatch = null,
        shock = null;
      const CAMERA = [
        {
          dx: 0,
          dy: 0,
          scale: 1,
          rot: 0,
        },
        {
          dx: -36,
          dy: 20,
          scale: 1.07,
          rot: -0.7,
        },
        {
          dx: 30,
          dy: -24,
          scale: 1.12,
          rot: 0.9,
        },
        {
          dx: -16,
          dy: 10,
          scale: 1.05,
          rot: 0.35,
        },
      ];
      const camera = {
        ...(motionPreference ? CAMERA[0] : CAMERA[initialScene2] || CAMERA[0]),
      };
      function applyCamera() {
        if (!contour) return;
        if (motionPreference || coarseQuery.matches || compactQuery.matches) {
          contour.style.transition = "";
          contour.style.transform = "";
          return;
        }
        contour.style.transition =
          "transform 1.1s cubic-bezier(0.2, 0.8, 0.2, 1)";
        contour.style.transformOrigin = "72% 54%";
        contour.style.transform = `translate3d(${camera.dx.toFixed(1)}px, ${camera.dy.toFixed(1)}px, 0) scale(${camera.scale.toFixed(4)}) rotate(${camera.rot.toFixed(2)}deg)`;
        contour.style.willChange = "transform";
      }
      const pointer = {
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
        strength: 0,
        targetStrength: 0,
      };
      for (const canvas of [contour, lifeCanvas])
        canvas?.setAttribute("aria-hidden", "true");
      iris?.setAttribute("aria-hidden", "true");
      function deliverReady() {
        if (!readyDelivered && !disposed) {
          readyDelivered = true;
          onReady();
        }
      }
      function cancelIris() {
        clearTimeout(irisTimer);
        irisTimer = 0;
        cancelAnimationFrame(irisFrame);
        irisFrame = 0;
        for (const surface of iris?.querySelectorAll("canvas") || []) {
          surface.width = 0;
          surface.height = 0;
        }
        iris?.replaceChildren();
        if (iris) {
          iris.hidden = true;
          iris.style.display = "none";
          iris.classList.add("is-open");
        }
      }
      function revealHeading(withAnimation = false) {
        cancelAnimationFrame(lifeFrame);
        lifeFrame = 0;
        clearTimeout(lifeTimer);
        lifeTimer = 0;
        forming = false;
        hero?.classList.remove("is-forming");
        hero?.classList.remove("is-glitching");
        if (withAnimation) {
          headingElement?.setAttribute?.(
            "data-glitch",
            headingElement.textContent,
          );
          hero?.classList.add("is-glitching");
        }
        if (headingElement) {
          headingElement.style.visibility = "";
          headingElement.style.opacity = "";
        }
        if (lifeCanvas) {
          lifeCanvas.style.transition = withAnimation
            ? "opacity 360ms steps(6,end)"
            : "none";
          lifeCanvas.style.opacity = "0";
          if (withAnimation)
            lifeTimer = window.setTimeout(() => {
              lifeTimer = 0;
              lifeCanvas.hidden = true;
              lifeCanvas.style.display = "none";
              lifeCanvas.width = lifeCanvas.height = 0;
              grid = null;
              deliverReady();
              hero?.classList.remove("is-glitching");
            }, 360);
          else {
            lifeCanvas.hidden = true;
            lifeCanvas.style.display = "none";
            lifeCanvas.width = lifeCanvas.height = 0;
            grid = null;
          }
        }
        if (!withAnimation || !lifeCanvas) deliverReady();
      }
      function finishIntro() {
        cancelIris();
        revealHeading();
        rootElement.classList.remove("intro-pending");
      }
      function openIris() {
        cancelIris();
        if (!iris || motionPreference || paused || document.hidden) return;
        const width2 = window.innerWidth,
          height2 = window.innerHeight;
        const canvas = document.createElement("canvas");
        canvas.className = "iris-surface";
        canvas.setAttribute("aria-hidden", "true");
        canvas.width = Math.ceil(width2);
        canvas.height = Math.ceil(height2);
        const context = canvas.getContext("2d");
        if (!context) {
          rootElement.classList.remove("intro-pending");
          return;
        }
        iris.replaceChildren(canvas);
        iris.hidden = false;
        iris.style.display = "block";
        iris.style.background = "transparent";
        iris.classList.remove("is-open");
        const computed = getComputedStyle(rootElement);
        const background =
          computed.getPropertyValue("--intro-cover").trim() || "#1b2025";
        const seam =
          computed.getPropertyValue("--intro-seam").trim() || background;
        const start = performance.now();
        function aperture(now) {
          irisFrame = 0;
          if (disposed || motionPreference || paused || document.hidden) {
            cancelIris();
            return;
          }
          const progress = clamp((now - start - 100) / 1600);
          const radius = irisRadius(width2, height2, progress);
          const rotation = -0.3 + progress * 0.42;
          const inner = irisVertices(radius, width2 / 2, height2 / 2, rotation);
          const outer = irisVertices(
            Math.hypot(width2, height2) * 1.05,
            width2 / 2,
            height2 / 2,
            rotation + 0.25,
          );
          context.clearRect(0, 0, width2, height2);
          for (let i = 0; i < IRIS_BLADES; i++) {
            const next = (i + 1) % IRIS_BLADES;
            context.beginPath();
            context.moveTo(...inner[i]);
            context.lineTo(...inner[next]);
            context.lineTo(...outer[next]);
            context.lineTo(...outer[i]);
            context.closePath();
            context.fillStyle = background;
            context.strokeStyle = seam;
            context.lineWidth = 1.25;
            context.fill();
            context.stroke();
          }
          rootElement.classList.remove("intro-pending");
          if (progress < 1) irisFrame = requestAnimationFrame(aperture);
          else {
            cancelIris();
            if (!forming) deliverReady();
          }
        }
        aperture(start);
        irisTimer = window.setTimeout(() => {
          cancelIris();
          if (!forming) deliverReady();
        }, 1750);
      }
      function buildPaths() {
        const count = coarseQuery.matches ? 34 : 50;
        const points = coarseQuery.matches ? 88 : 128;
        const scale = Math.max(width, height);
        paths = Array.from(
          {
            length: count,
          },
          (_, index) => {
            const radius = scale * (0.041 + index * 0.0166);
            const phase = index * 0.077;
            const pointsArray = new Float32Array((points + 1) * 2);
            for (let point = 0; point <= points; point++) {
              const angle = (point / points) * TAU;
              const distortion =
                1 +
                0.095 * Math.sin(angle * 3 + phase) +
                0.059 * Math.cos(angle * 5 - phase * 0.4) +
                0.033 * Math.sin(angle * 8 + 0.8 + phase * 0.9);
              pointsArray[point * 2] = Math.cos(angle) * radius * distortion;
              pointsArray[point * 2 + 1] =
                Math.sin(angle) * radius * distortion * 0.66 +
                Math.cos(angle * 2 + phase) * radius * 0.09;
            }
            return pointsArray;
          },
        );
        baseScene = NaN;
      }
      function appendContour(
        path,
        points,
        mouseX,
        mouseY,
        strength,
        elevation,
      ) {
        const count = points.length / 2 - 1;
        const age = shock ? (performance.now() - shock.start) / 1e3 : 0;
        const point = (i) => {
          i = (i + count) % count;
          const x = points[i * 2],
            y = points[i * 2 + 1];
          let result = strength
            ? warpContourPoint(x, y, mouseX, mouseY, strength, elevation)
            : [x, y];
          if (shock) {
            const distance = Math.hypot(x - shock.x, (y - shock.y) * 0.75);
            const phase = distance / 170 - age * 19;
            const amplitude =
              22 * shock.strength * Math.exp(-age * 5) * (1 - elevation * 0.4);
            result[0] += Math.sin(phase) * amplitude * 0.25;
            result[1] += Math.cos(phase) * amplitude;
          }
          return result;
        };
        let previous = point(count - 1),
          loadedSource = point(0);
        path.moveTo(
          (previous[0] + loadedSource[0]) / 2,
          (previous[1] + loadedSource[1]) / 2,
        );
        for (let i = 0; i < count; i++) {
          const next = point(i + 1);
          path.quadraticCurveTo(
            loadedSource[0],
            loadedSource[1],
            (loadedSource[0] + next[0]) / 2,
            (loadedSource[1] + next[1]) / 2,
          );
          loadedSource = next;
        }
        path.closePath();
      }
      function contourGroups(patch = null) {
        const groups = [new Path2D(), new Path2D(), new Path2D()];
        screenContours.forEach(({ points, bounds }, index) => {
          if (
            patch &&
            (bounds.right < patch.x ||
              bounds.left > patch.x + patch.width ||
              bounds.bottom < patch.y ||
              bounds.top > patch.y + patch.height)
          )
            return;
          const strength = patch ? pointer.strength : 0;
          appendContour(
            groups[index % 6 === 0 ? 0 : 1],
            points,
            pointer.x,
            pointer.y,
            strength,
            1 - index / screenContours.length,
          );
          if (index % 4 === 2)
            appendContour(
              groups[2],
              points,
              pointer.x,
              pointer.y,
              strength,
              1 - index / screenContours.length,
            );
        });
        return groups;
      }
      function paintContours(context, groups, light) {
        context.save();
        const transparency = transparencyQuery.matches ? 0.5 : 1;
        context.lineWidth = 0.9;
        context.strokeStyle = light ? "#8d97a5" : "#738b85";
        context.globalAlpha = (light ? 0.3 : 0.32) * transparency;
        context.stroke(groups[0]);
        context.globalAlpha = (light ? 0.18 : 0.2) * transparency;
        context.stroke(groups[1]);
        if (!transparencyQuery.matches) {
          context.globalAlpha = light ? 0.055 : 0.085;
          context.strokeStyle = light ? "#a6816d" : "#cc9d82";
          context.translate(0.8, -0.5);
          context.stroke(groups[2]);
          context.strokeStyle = light ? "#638c98" : "#77acb2";
          context.translate(-1.6, 1);
          context.stroke(groups[2]);
        }
        context.restore();
      }
      function rebuildBackdrop(light) {
        const x = width * 0.78;
        const y = height * 0.53;
        const angle = -0.18;
        const cosine = Math.cos(angle),
          sine = Math.sin(angle);
        screenContours = paths.map((points) => {
          const screen = new Float32Array(points.length);
          const bounds = {
            left: Infinity,
            top: Infinity,
            right: -Infinity,
            bottom: -Infinity,
          };
          for (let i = 0; i < points.length; i += 2) {
            const px = x + points[i] * cosine - points[i + 1] * sine;
            const py = y + points[i] * sine + points[i + 1] * cosine;
            screen[i] = px;
            screen[i + 1] = py;
            bounds.left = Math.min(bounds.left, px);
            bounds.right = Math.max(bounds.right, px);
            bounds.top = Math.min(bounds.top, py);
            bounds.bottom = Math.max(bounds.bottom, py);
          }
          return {
            points: screen,
            bounds,
          };
        });
        backdropContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        backdropContext.clearRect(0, 0, width, height);
        paintContours(backdropContext, contourGroups(), light);
        baseScene = 0;
        baseLight = light;
        lastPatch = null;
        contourContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        contourContext.clearRect(0, 0, width, height);
        contourContext.drawImage(backdrop, 0, 0, width, height);
      }
      function restorePatch(rect) {
        if (!rect) return;
        const context = contourContext;
        context.clearRect(rect.x, rect.y, rect.width, rect.height);
        context.drawImage(
          backdrop,
          rect.x * dpr,
          rect.y * dpr,
          rect.width * dpr,
          rect.height * dpr,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        );
      }
      function drawAmbient() {
        if (!contourContext || !backdropContext || disposed || document.hidden)
          return;
        const light = rootElement.dataset.theme === "light";
        if (baseScene !== 0 || baseLight !== light) rebuildBackdrop(light);
        const context = contourContext;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.imageSmoothingEnabled = true;
        restorePatch(lastPatch);
        lastPatch = null;
        if (shock) {
          context.clearRect(0, 0, width, height);
          paintContours(
            context,
            contourGroups({
              x: 0,
              y: 0,
              width,
              height,
            }),
            light,
          );
          return;
        }
        if (motionPreference || paused || pointer.strength < 1e-3) return;
        const left = Math.max(
          0,
          Math.floor((pointer.x - CONTOUR_RADIUS - 3) * dpr) / dpr,
        );
        const top = Math.max(
          0,
          Math.floor((pointer.y - CONTOUR_RADIUS - 3) * dpr) / dpr,
        );
        const right = Math.min(
          width,
          Math.ceil((pointer.x + CONTOUR_RADIUS + 3) * dpr) / dpr,
        );
        const bottom = Math.min(
          height,
          Math.ceil((pointer.y + CONTOUR_RADIUS + 3) * dpr) / dpr,
        );
        const patch = {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        };
        if (patch.width <= 0 || patch.height <= 0) return;
        context.clearRect(patch.x, patch.y, patch.width, patch.height);
        context.save();
        context.beginPath();
        context.rect(patch.x, patch.y, patch.width, patch.height);
        context.clip();
        paintContours(context, contourGroups(patch), light);
        context.restore();
        lastPatch = patch;
      }
      function updateAmbient(now) {
        ambientFrame = 0;
        if (disposed || document.hidden || paused || motionPreference) return;
        const delta = Math.min(50, now - lastAmbientTime || 16);
        lastAmbientTime = now;
        const follow = 1 - Math.exp(-delta / 55);
        pointer.x += (pointer.targetX - pointer.x) * follow;
        pointer.y += (pointer.targetY - pointer.y) * follow;
        pointer.strength +=
          (pointer.targetStrength - pointer.strength) * follow;
        const moving =
          Math.abs(pointer.targetX - pointer.x) > 0.2 ||
          Math.abs(pointer.targetY - pointer.y) > 0.2;
        const pressing =
          Math.abs(pointer.targetStrength - pointer.strength) > 1e-3;
        if (!moving) {
          pointer.x = pointer.targetX;
          pointer.y = pointer.targetY;
        }
        if (!pressing) pointer.strength = pointer.targetStrength;
        if (shock && now - shock.start > 850) {
          shock = null;
          baseScene = NaN;
        }
        drawAmbient();
        if (shock || moving || pressing)
          ambientFrame = requestAnimationFrame(updateAmbient);
        else lastAmbientTime = 0;
      }
      function scheduleAmbient() {
        if (
          !ambientFrame &&
          !disposed &&
          !document.hidden &&
          !paused &&
          !motionPreference
        ) {
          ambientFrame = requestAnimationFrame(updateAmbient);
        }
      }
      function buildLifeGrid() {
        if (!lifeCanvas || !headingElement || !lifeContext) return false;
        const bounds = headingElement.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return false;
        const cellSize = bounds.width < 600 ? 4 : 5;
        const columns = Math.max(1, Math.ceil(bounds.width / cellSize));
        const rows = Math.max(1, Math.ceil(bounds.height / cellSize));
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = columns;
        maskCanvas.height = rows;
        const mask = maskCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!mask) return false;
        const computed = getComputedStyle(headingElement);
        const fontSize = parseFloat(computed.fontSize) || 120;
        const letterSpacing = parseFloat(computed.letterSpacing) || 0;
        mask.scale(1 / cellSize, 1 / cellSize);
        mask.font = `${computed.fontStyle} ${computed.fontWeight} ${fontSize}px ${computed.fontFamily}`;
        mask.fillStyle = "#fff";
        mask.textBaseline = "alphabetic";
        const text = headingElement.textContent.trim() || "Kn0tzer";
        if (document.createRange && document.createTreeWalker) {
          const probe = document.createElement("span");
          probe.style.cssText =
            "display:inline-block;width:0;height:0;font-size:0;letter-spacing:0";
          headingElement.append(probe);
          const baseline = probe.getBoundingClientRect().top - bounds.top;
          probe.remove();
          const walker = document.createTreeWalker(
            headingElement,
            NodeFilter.SHOW_TEXT,
          );
          const range = document.createRange();
          let node;
          while ((node = walker.nextNode())) {
            if (node.parentElement.closest(".hero-zero")) continue;
            for (let index = 0; index < node.length; index++) {
              range.setStart(node, index);
              range.setEnd(node, index + 1);
              mask.fillText(
                node.data[index],
                range.getBoundingClientRect().left - bounds.left,
                baseline,
              );
            }
          }
        } else {
          const widths = [...text].map(
            (character) => mask.measureText(character).width,
          );
          const metrics = mask.measureText(text);
          const baseline =
            (bounds.height -
              (metrics.actualBoundingBoxAscent || fontSize * 0.75) -
              (metrics.actualBoundingBoxDescent || fontSize * 0.12)) /
              2 +
            (metrics.actualBoundingBoxAscent || fontSize * 0.75);
          let x = 0;
          [...text].forEach((character, index) => {
            mask.fillText(character, x, baseline);
            x += widths[index] + letterSpacing;
          });
        }
        const pixels = mask.getImageData(0, 0, columns, rows).data;
        const logoCanvas = document.createElement("canvas");
        logoCanvas.width = columns;
        logoCanvas.height = rows;
        const logoContext = logoCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        const logo = headingElement.querySelector(".zero-logo");
        let logoPixels = new Uint8ClampedArray(columns * rows * 4);
        if (logoContext && logo?.complete && logo.naturalWidth) {
          try {
            const box = logo.getBoundingClientRect();
            logoContext.save();
            logoContext.beginPath();
            logoContext.roundRect(
              (box.left - bounds.left) / cellSize,
              (box.top - bounds.top) / cellSize,
              box.width / cellSize,
              box.height / cellSize,
              (box.width / cellSize) * 0.24,
            );
            logoContext.clip();
            logoContext.drawImage(
              logo,
              (box.left - bounds.left) / cellSize,
              (box.top - bounds.top) / cellSize,
              box.width / cellSize,
              box.height / cellSize,
            );
            logoContext.restore();
            logoPixels = logoContext.getImageData(0, 0, columns, rows).data;
          } catch {}
        }
        const colors = Array.from(
          {
            length: columns * rows,
          },
          (_, i) =>
            logoPixels[i * 4 + 3] > 55
              ? `rgb(${logoPixels[i * 4]} ${logoPixels[i * 4 + 1]} ${logoPixels[i * 4 + 2]})`
              : null,
        );
        const length = columns * rows;
        const board = new Uint8Array(length);
        const target = new Uint8Array(length);
        const thresholds = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          board[index] = Math.random() < 0.35 ? 1 : 0;
          target[index] = pixels[index * 4 + 3] > 55 || colors[index] ? 1 : 0;
          thresholds[index] = Math.random();
        }
        grid = {
          columns,
          rows,
          colors,
          cellSize,
          board,
          next: new Uint8Array(length),
          target,
          thresholds,
          width: bounds.width,
          height: bounds.height,
          color: computed.color || "#e9ede4",
        };
        lifeCanvas.width = Math.round(bounds.width * dpr);
        lifeCanvas.height = Math.round(bounds.height * dpr);
        lifeContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      }
      function drawLife(now) {
        lifeFrame = 0;
        if (!forming || !grid || disposed) return;
        if (paused || motionPreference || document.hidden) {
          finishIntro();
          return;
        }
        const elapsed = now - lifeStart;
        const generation = Math.floor(elapsed / 95);
        const attraction = clamp((elapsed - 1000) / 2200);
        if (generation !== lastGeneration) {
          stepLife(grid.board, grid.columns, grid.rows, grid.next);
          for (let index = 0; index < grid.next.length; index += 1) {
            if (attraction >= grid.thresholds[index])
              grid.next[index] = grid.target[index];
          }
          [grid.board, grid.next] = [grid.next, grid.board];
          lastGeneration = generation;
        }
        const context = lifeContext;
        context.clearRect(0, 0, grid.width, grid.height);
        context.fillStyle = grid.color;
        const birth = easeOut(elapsed / 360);
        for (let y = 0; y < grid.rows; y += 1) {
          for (let x = 0; x < grid.columns; x += 1) {
            const index = y * grid.columns + x;
            if (!grid.board[index]) continue;
            context.globalAlpha =
              birth * (grid.target[index] ? 1 : 0.26 * (1 - attraction) + 0.08);
            context.fillStyle = grid.colors[index] || grid.color;
            context.fillRect(
              x * grid.cellSize + 0.4,
              y * grid.cellSize + 0.4,
              grid.cellSize - 0.8,
              grid.cellSize - 0.8,
            );
          }
        }
        context.globalAlpha = 1;
        if (elapsed >= 3600) {
          revealHeading(true);
          return;
        }
        lifeFrame = requestAnimationFrame(drawLife);
      }
      function replayIntro() {
        cancelAnimationFrame(lifeFrame);
        clearTimeout(lifeTimer);
        cancelIris();
        if (disposed || motionPreference || paused || document.hidden) {
          finishIntro();
          return;
        }
        if (lifeCanvas && headingElement && scene === 0) {
          lifeCanvas.hidden = false;
          lifeCanvas.style.display = "block";
          lifeCanvas.style.opacity = "1";
          lifeCanvas.style.transition = "none";
          hero.classList.add("is-forming");
          headingElement.style.opacity = "0";
          forming = buildLifeGrid();
          if (forming) {
            lifeStart = performance.now();
            lastGeneration = -1;
            lifeFrame = requestAnimationFrame(drawLife);
          } else revealHeading();
        }
        openIris();
        if (!forming && !iris) deliverReady();
      }
      function resize() {
        if (disposed) return;
        const nextWidth = window.innerWidth;
        const touch = coarseQuery.matches || compactQuery.matches;
        const nextHeight = touch
          ? terrainSized &&
            nextWidth === width &&
            window.innerHeight <= height &&
            window.innerHeight >= height - 320
            ? height
            : window.innerHeight + 160
          : window.innerHeight;
        const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
        if (
          terrainSized &&
          width === nextWidth &&
          height === nextHeight &&
          dpr === nextDpr
        ) {
          drawAmbient();
          return;
        }
        width = nextWidth;
        height = nextHeight;
        dpr = nextDpr;
        terrainSized = true;
        if (contour) {
          contour.width = Math.round(width * dpr);
          contour.height = Math.round(height * dpr);
          contour.style.height = touch ? `${height}px` : "100%";
        }
        backdrop.width = Math.round(width * dpr);
        backdrop.height = Math.round(height * dpr);
        buildPaths();
        applyCamera();
        drawAmbient();
        if (forming) buildLifeGrid();
      }
      function impact(x, y, strength = 1) {
        if (motionPreference || paused || document.hidden) return;
        shock = {
          x,
          y,
          strength,
          start: performance.now(),
        };
        scheduleAmbient();
      }
      function setBackgroundScene(index) {
        scene = Math.max(0, Number(index) || 0);
        if (scene > 0 && (forming || lifeFrame || lifeTimer || irisTimer))
          finishIntro();
        Object.assign(
          camera,
          CAMERA[Math.min(scene, CAMERA.length - 1)] || CAMERA[0],
        );
        applyCamera();
      }
      function setPaused(value) {
        paused = Boolean(value);
        syncTouchMotion();
        if (paused) {
          cancelAnimationFrame(ambientFrame);
          ambientFrame = 0;
          pointer.x =
            pointer.y =
            pointer.targetX =
            pointer.targetY =
            pointer.strength =
            pointer.targetStrength =
              0;
          finishIntro();
          drawAmbient();
        } else {
          drawAmbient();
        }
      }
      function onPointer(event) {
        if (
          paused ||
          motionPreference ||
          coarseQuery.matches ||
          event.pointerType === "touch"
        )
          return;
        if (!pointer.targetStrength) {
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        }
        pointer.targetX = event.clientX;
        pointer.targetY = event.clientY;
        pointer.targetStrength = event.buttons ? 1.5 : 1;
        scheduleAmbient();
      }
      function onPointerLeave() {
        pointer.targetStrength = 0;
        scheduleAmbient();
      }
      function onVisibility() {
        syncTouchMotion();
        if (document.hidden) {
          cancelAnimationFrame(ambientFrame);
          ambientFrame = 0;
          shock = null;
          baseScene = NaN;
          finishIntro();
        } else {
          resize();
        }
      }
      function onMotionPreference(event) {
        motionPreference = event.matches;
        syncTouchMotion();
        if (motionPreference) {
          shock = null;
          baseScene = NaN;
          cancelAnimationFrame(ambientFrame);
          ambientFrame = 0;
          pointer.x =
            pointer.y =
            pointer.targetX =
            pointer.targetY =
            pointer.strength =
            pointer.targetStrength =
              0;
          Object.assign(camera, CAMERA[0]);
          applyCamera();
          finishIntro();
        }
        drawAmbient();
      }
      function syncTouchMotion() {
        const touch = coarseQuery.matches || compactQuery.matches;
        if (touch && !motionPreference && !disposed)
          rootElement.classList.add("touch-ambient");
        else rootElement.classList.remove("touch-ambient");
        if (document.hidden || paused)
          rootElement.classList.add("ambient-paused");
        else rootElement.classList.remove("ambient-paused");
      }
      const themeObserver = new MutationObserver(() => {
        if (grid && headingElement)
          grid.color = getComputedStyle(headingElement).color;
        drawAmbient();
      });
      themeObserver.observe(rootElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class"],
      });
      const heroObserver =
        typeof ResizeObserver === "function" && hero
          ? new ResizeObserver(() => {
              if (forming) buildLifeGrid();
            })
          : null;
      heroObserver?.observe(hero);
      const heroVisibilityObserver =
        typeof IntersectionObserver === "function" && hero
          ? new IntersectionObserver(
              (entries) => {
                if (forming && entries.some((entry) => !entry.isIntersecting))
                  finishIntro();
              },
              {
                threshold: 0.01,
              },
            )
          : null;
      heroVisibilityObserver?.observe(hero);
      window.addEventListener("resize", resize, {
        passive: true,
      });
      window.addEventListener("pointermove", onPointer, {
        passive: true,
      });
      window.addEventListener("pointerup", onPointer, {
        passive: true,
      });
      function onPageHide() {
        rootElement.classList.add("ambient-paused");
        cancelAnimationFrame(ambientFrame);
        ambientFrame = 0;
        finishIntro();
      }
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onVisibility);
      document.addEventListener("pointerleave", onPointerLeave, {
        passive: true,
      });
      document.addEventListener("visibilitychange", onVisibility);
      motionQuery.addEventListener("change", onMotionPreference);
      coarseQuery.addEventListener("change", syncTouchMotion);
      compactQuery.addEventListener("change", syncTouchMotion);
      function destroy() {
        introLogo?.removeEventListener("load", refreshLogoPixels);
        disposed = true;
        syncTouchMotion();
        cancelAnimationFrame(ambientFrame);
        cancelAnimationFrame(lifeFrame);
        clearTimeout(lifeTimer);
        cancelIris();
        backdrop.width = backdrop.height = 0;
        themeObserver.disconnect();
        heroObserver?.disconnect();
        heroVisibilityObserver?.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("pointerup", onPointer);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onVisibility);
        document.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        motionQuery.removeEventListener("change", onMotionPreference);
        coarseQuery.removeEventListener("change", syncTouchMotion);
        compactQuery.removeEventListener("change", syncTouchMotion);
        revealHeading();
      }
      resize();
      syncTouchMotion();
      replayIntro();
      return {
        setScene: setBackgroundScene,
        impact,
        setPaused,
        replayIntro,
        resize,
        destroy,
        stopIntro: finishIntro,
      };
    }
    const embeddedPhotos = JSON.parse(
      document.getElementById("portfolio-photos").textContent,
    );
    function photoSource(name, number, extension) {
      const album = name.toLowerCase();
      const relative =
        extension === "png"
          ? "assets/photos/raw/" + album + "/" + number + ".png"
          : "assets/photos/thumbnails/" + album + "/" + number + ".webp";
      return (
        embeddedPhotos[relative] ||
        (Object.keys(embeddedPhotos).length
          ? "https://kn0tzer.work.gd/" + relative
          : relative)
      );
    }
    function album(name, rows) {
      const photos = rows.map(
        ([alt, width, height, thumbnailWidth, thumbnailHeight], index) => ({
          id: `${name}-${index + 1}`,
          src: photoSource(name, index + 1, "png"),
          thumbnail: photoSource(name, index + 1, "thumb.webp"),
          title: `${name} ${index + 1}`,
          alt,
          width,
          height,
          thumbnailWidth,
          thumbnailHeight,
        }),
      );
      if (name === "Structures") photos.splice(14, 0, photos.shift());
      return { name, cover: photos[0].thumbnail, photos };
    }
    const GALLERY_ALBUMS = {
      sky: album("Sky", [
        ["An orange sunlit cloud above dark trees", 3206, 2405, 960, 720],
        [
          "A close view of the moon against a dark blue sky",
          1609,
          1609,
          960,
          960,
        ],
        ["Orange and violet sunset clouds above trees", 3150, 3150, 960, 960],
        [
          "Frost crystals forming intricate patterns on glass",
          3023,
          3023,
          960,
          960,
        ],
        ["An orange cloud and a small crescent moon", 3023, 3023, 960, 960],
        [
          "A silhouetted roof beneath orange and blue sunset clouds",
          4283,
          2408,
          960,
          540,
        ],
        [
          "Pink clouds and a crescent moon above a rooftop",
          2077,
          1571,
          960,
          726,
        ],
        ["Layered clouds glowing pink at sunset", 4032, 3024, 960, 720],
        [
          "Orange evening clouds behind sports field floodlights",
          2740,
          2740,
          960,
          960,
        ],
        [
          "A rooftop silhouette beneath mottled sunset clouds",
          4032,
          3024,
          960,
          720,
        ],
        [
          "Orange evening clouds beside a silhouetted roof",
          3023,
          3023,
          960,
          960,
        ],
        [
          "Dark clouds and power lines framing a blue evening sky",
          3021,
          2373,
          960,
          754,
        ],
        [
          "A boat wake stretching toward a sunset on the ocean",
          1850,
          4004,
          444,
          960,
        ],
        ["A pale moon in a blue sky above dark clouds", 2932, 2932, 960, 960],
        ["Clouds and evening light above the ocean", 2975, 3967, 720, 960],
        ["Dark clouds over the shore at dusk", 2805, 3741, 720, 960],
        ["Golden clouds above a dark treeline", 4601, 1598, 960, 333],
        ["Pink sunset clouds above a dark treeline", 4765, 1343, 960, 271],
        ["A faint star-filled sky at night", 3680, 8000, 442, 960],
      ]),
      nature: album("Nature", [
        ["A wooded lake between green hills", 2701, 2701, 960, 960],
        ["A person beside a waterfall and its pool", 4036, 4036, 960, 960],
        ["A mountain peak beneath a pink sunset", 3024, 3024, 960, 960],
        [
          "Tall grasses overlooking hazy mountains at sunset",
          4272,
          4272,
          960,
          960,
        ],
        [
          "A waterfall dropping beside a dark rock alcove",
          2519,
          2519,
          960,
          960,
        ],
        ["A person sitting on a log beside a waterfall", 3024, 4032, 720, 960],
        ["Clusters of bright pink flowers on a tree", 1545, 1941, 764, 960],
        [
          "A waterfall surrounded by mossy rocks and forest",
          5712,
          4284,
          960,
          720,
        ],
        ["Sunset light across golden grasses", 5471, 4103, 960, 720],
        [
          "Layered mountain valleys beneath a warm evening sky",
          2860,
          2860,
          960,
          960,
        ],
        ["A fallen tree across a shaded forest stream", 3020, 3020, 960, 960],
        ["A close view of water cascading over rock", 2829, 3773, 720, 960],
        ["A mountain framed by leafy trees", 4032, 3024, 960, 720],
        [
          "Green mountain ridges beneath streaks of cloud",
          3024,
          4032,
          720,
          960,
        ],
        [
          "Pink evening light over layered mountain ridges",
          4030,
          2138,
          960,
          509,
        ],
        ["Pink flowering trees in front of a house", 3024, 3779, 768, 960],
        [
          "A hilltop power pole overlooking mountain ridges",
          4283,
          3212,
          960,
          720,
        ],
        ["A grassy ridge under an evening sky", 2409, 4283, 540, 960],
        [
          "Distant mountains beyond a grassy ridge at sunset",
          4030,
          2267,
          960,
          540,
        ],
        ["Trees and a walking path beside a rock wall", 3612, 2289, 960, 608],
        ["A curving road through a green forest", 4032, 3024, 960, 720],
        ["Tall trees beside a rocky forest stream", 1838, 4002, 441, 960],
        [
          "A tall rock wall with plants growing in its cracks",
          3024,
          3024,
          960,
          960,
        ],
      ]),
      structures: album("Structures", [
        [
          "Three white crosses beneath dramatic sunset clouds",
          865,
          865,
          865,
          865,
        ],
        ["A dense city skyline beneath a cloudy sky", 4186, 5582, 720, 960],
        ["A person silhouetted among branches at sunset", 2958, 3925, 723, 960],
        [
          "A spired skyscraper framed by nearby city buildings",
          4284,
          5447,
          755,
          960,
        ],
        ["A city street leading toward a church tower", 1205, 1205, 960, 960],
        ["A tall building catching warm evening light", 3292, 3292, 960, 960],
        ["A close view of a quarter dollar coin", 2699, 2699, 960, 960],
        ["The Statue of Liberty viewed across the water", 2923, 3897, 720, 960],
        [
          "A group of people silhouetted on a ridge at sunset",
          4029,
          2380,
          960,
          567,
        ],
        ["A ship offshore beneath a pink sky", 1753, 1753, 960, 960],
        [
          "A person standing beneath a steel lookout tower",
          4284,
          5712,
          720,
          960,
        ],
        ["A repeating grid of windows and balconies", 1198, 1198, 960, 960],
        ["A tent and camping gear in evening light", 3024, 3024, 960, 960],
        ["Rows of curved balconies on a tall building", 2575, 3677, 672, 960],
        [
          "Beach grass with a Ferris wheel and buildings beyond",
          3023,
          3023,
          960,
          960,
        ],
        ["An arched bridge reflected in a river", 3021, 1680, 960, 534],
      ]),
    };
    function initGallery(motionPreference) {
      const grid = document.getElementById("gallery-grid"),
        dialog = document.getElementById("photo-dialog"),
        image = document.getElementById("lightbox-image");
      const buttons = [...document.querySelectorAll(".album[data-album]")];
      let selectedAlbum = "sky",
        returnFocus = null;
      function close() {
        if (dialog.open) dialog.close();
      }
      let requestedSrc = "";
      function open(index, trigger) {
        const photo = GALLERY_ALBUMS[selectedAlbum].photos[index];
        if (!photo) return;
        returnFocus = trigger || document.activeElement;
        try {
          requestedSrc = new URL(photo.src, document.baseURI || void 0).href;
        } catch {
          requestedSrc = photo.src;
        }
        image.alt = photo.alt;
        image.width = photo.width;
        image.height = photo.height;
        dialog.style.setProperty(
          "--photo-preview",
          `url("${photo.thumbnail}")`,
        );
        dialog.classList.add("is-loading");
        dialog.setAttribute("aria-busy", "true");
        image.src = photo.src;
        if (!dialog.open) dialog.showModal();
        document.documentElement.classList.add("photo-open");
      }
      dialog.addEventListener("click", close);
      image.addEventListener("load", () => {
        const loadedSource = image.currentSrc || image.src;
        if (loadedSource !== requestedSrc && image.src !== requestedSrc) return;
        dialog.classList.remove("is-loading");
        dialog.setAttribute("aria-busy", "false");
      });
      image.addEventListener("error", () => {
        dialog.classList.remove("is-loading");
        dialog.setAttribute("aria-busy", "false");
      });
      dialog.addEventListener("close", () => {
        document.documentElement.classList.remove("photo-open");
        image.removeAttribute("src");
        returnFocus?.focus({
          preventScroll: true,
        });
      });
      function setAlbum(next) {
        if (
          !Object.hasOwn(GALLERY_ALBUMS, next) ||
          (next === selectedAlbum && grid.children.length)
        )
          return;
        cancelGesture();
        close();
        selectedAlbum = next;
        grid.dataset.album = selectedAlbum;
        buttons.forEach((button) => {
          button.classList.toggle(
            "is-active",
            button.dataset.album === selectedAlbum,
          );
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.album === selectedAlbum),
          );
        });
        const fragment = document.createDocumentFragment();
        applySavedOrder(selectedAlbum);
        GALLERY_ALBUMS[selectedAlbum].photos.forEach((photo, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "photo-card";
          button.dataset.photoIndex = String(index);
          button.dataset.photoId = photo.id;
          button.setAttribute(
            "aria-label",
            `Expand ${photo.title}. Drag or use Alt and arrow keys to reorder.`,
          );
          const animationFrame = document.createElement("span");
          animationFrame.className = "photo-frame";
          const img = document.createElement("img");
          img.src = photo.thumbnail;
          img.alt = photo.alt;
          img.width = photo.thumbnailWidth;
          img.height = photo.thumbnailHeight;
          img.className = "photo-image";
          img.loading = "lazy";
          img.decoding = "async";
          img.draggable = false;
          animationFrame.append(img);
          button.append(animationFrame);
          bindPanorama(button);
          button.addEventListener("click", (event) => {
            if (button.dataset.suppressClick === "true") {
              button.dataset.suppressClick = "false";
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            const liveIndex = [...grid.children]
              .filter((el) => el.classList?.contains("photo-card"))
              .indexOf(button);
            open(liveIndex < 0 ? index : liveIndex, button);
          });
          fragment.append(button);
        });
        grid.replaceChildren(fragment);
        fitGallery();
        if (!motionPreference.matches)
          [...grid.children].forEach((card, index) =>
            card.animate(
              [
                {
                  opacity: 0,
                  transform: "translateY(8px) scale(.98)",
                },
                {
                  opacity: 1,
                  transform: "none",
                },
              ],
              {
                duration: 220,
                delay: Math.min(index, 5) * 25,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
              },
            ),
          );
        grid.parentElement.scrollTop = 0;
        document.dispatchEvent(new Event("gallery:render"));
        updateScrollAffordance();
      }
      function fitPanorama(card) {
        const frame = card.querySelector(".photo-frame"),
          image = card.querySelector(".photo-image");
        const box = frame.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        const ratio =
          Number(image.getAttribute("width")) /
          Number(image.getAttribute("height"));
        const frameWidth = frame.clientWidth || box.width,
          frameHeight = frame.clientHeight || box.height;
        const width = Math.max(frameWidth, frameHeight * ratio),
          height = width / ratio;
        image.style.setProperty("--photo-width", `${width}px`);
        image.style.setProperty("--photo-height", `${height}px`);
        return {
          box,
          frameWidth,
          frameHeight,
          width,
          height,
          image,
          frame,
        };
      }
      function fitGallery() {
        grid.querySelectorAll(".photo-card").forEach(fitPanorama);
      }
      function bindPanorama(button) {
        let geometry = null;
        function reset() {
          const image = button.querySelector(".photo-image"),
            frame = button.querySelector(".photo-frame");
          image.style.setProperty("--pan-x", "0px");
          image.style.setProperty("--pan-y", "0px");
          image.style.setProperty("--photo-zoom", "1");
          frame.style.setProperty("--photo-tilt-x", "0deg");
          frame.style.setProperty("--photo-tilt-y", "0deg");
        }
        button.addEventListener("pointerenter", (event) => {
          geometry = fitPanorama(button);
          if (
            !geometry ||
            motionPreference.matches ||
            event.pointerType === "touch"
          )
            return;
          geometry.image.style.setProperty("--photo-zoom", "1.12");
        });
        button.addEventListener(
          "pointermove",
          (event) => {
            if (
              !geometry ||
              motionPreference.matches ||
              event.pointerType === "touch" ||
              document.body.classList.contains("photo-dragging")
            )
              return;
            geometry = fitPanorama(button);
            const { box, width, height, image, frame } = geometry;
            const x = Math.max(
                -1,
                Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1),
              ),
              y = Math.max(
                -1,
                Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1),
              );
            const travelX = Math.max(
                0,
                (width * 1.12 - (geometry.frameWidth || box.width)) / 2 - 1,
              ),
              travelY = Math.max(
                0,
                (height * 1.12 - (geometry.frameHeight || box.height)) / 2 - 1,
              );
            image.style.setProperty("--pan-x", `${-x * travelX}px`);
            image.style.setProperty("--pan-y", `${-y * travelY}px`);
            frame.style.setProperty("--photo-tilt-x", `${-y * 2}deg`);
            frame.style.setProperty("--photo-tilt-y", `${x * 2}deg`);
          },
          {
            passive: true,
          },
        );
        button.addEventListener("pointerleave", reset);
        button.addEventListener("blur", reset);
      }
      function applySavedOrder(name) {
        try {
          const raw = localStorage.getItem(
            `kn0tzer-photo-order-${name === "structures" ? "v3" : "v2"}-${name}`,
          );
          if (!raw) return;
          const order = JSON.parse(raw);
          if (!Array.isArray(order)) return;
          const byId = new Map(
            GALLERY_ALBUMS[name].photos.map((photo) => [photo.id, photo]),
          );
          const next = [];
          for (const key of order) {
            const id =
              typeof key === "string"
                ? key
                    .split("/")
                    .at(-1)
                    .replace(/\.(png|webp)$/, "")
                : "";
            const photo = byId.get(id);
            if (photo) {
              next.push(photo);
              byId.delete(id);
            }
          }
          for (const photo of byId.values()) next.push(photo);
          GALLERY_ALBUMS[name].photos = next;
        } catch {}
      }
      function saveOrder(name) {
        try {
          localStorage.setItem(
            `kn0tzer-photo-order-${name === "structures" ? "v3" : "v2"}-${name}`,
            JSON.stringify(
              GALLERY_ALBUMS[name].photos.map((photo) => photo.id),
            ),
          );
        } catch {}
      }
      const scroller = grid.parentElement;
      function createScrollbar() {
        const track = scroller.parentElement.querySelector(
            ".gallery-scroll-track",
          ),
          thumb = track.querySelector(".gallery-scroll-thumb");
        let grabOffset = 0;
        const maximum = () =>
          Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        function update() {
          const max = maximum(),
            height = track.clientHeight || scroller.clientHeight;
          const size = Math.min(
            height,
            Math.max(
              32,
              (height * scroller.clientHeight) /
                Math.max(1, scroller.scrollHeight),
            ),
          );
          const top =
            max > 0 ? ((height - size) * scroller.scrollTop) / max : 0;
          thumb.style.height = `${size}px`;
          thumb.style.transform = `translateY(${top}px)`;
          track.setAttribute("aria-valuemax", String(Math.round(max)));
          track.setAttribute(
            "aria-valuenow",
            String(Math.round(scroller.scrollTop)),
          );
          track.setAttribute(
            "aria-valuetext",
            `${max ? Math.round((scroller.scrollTop / max) * 100) : 0}%`,
          );
          track.setAttribute("aria-disabled", String(max === 0));
        }
        function seek(clientY, animate = false) {
          const bounds = track.getBoundingClientRect(),
            travel = track.clientHeight - thumb.offsetHeight;
          const top =
            travel > 0
              ? Math.max(
                  0,
                  Math.min(1, (clientY - bounds.top - grabOffset) / travel),
                ) * maximum()
              : 0;
          if (animate && scroller.scrollTo)
            scroller.scrollTo({
              top,
              behavior: motionPreference.matches ? "instant" : "smooth",
            });
          else scroller.scrollTop = top;
          update();
        }
        track.addEventListener("pointerdown", (event) => {
          if (
            !event.isPrimary ||
            (event.pointerType === "mouse" && event.button !== 0)
          )
            return;
          event.preventDefault();
          track.focus({
            preventScroll: true,
          });
          const box = thumb.getBoundingClientRect();
          grabOffset =
            event.target === thumb
              ? event.clientY - box.top
              : thumb.offsetHeight / 2;
          track.setPointerCapture?.(event.pointerId);
          track.dataset.dragging = "true";
          seek(event.clientY);
        });
        track.addEventListener("pointermove", (event) => {
          if (track.dataset.dragging === "true") seek(event.clientY);
        });
        const finish = () => {
          track.dataset.dragging = "false";
        };
        track.addEventListener("pointerup", finish);
        track.addEventListener("pointercancel", finish);
        track.addEventListener("lostpointercapture", finish);
        track.addEventListener(
          "wheel",
          (event) => {
            event.preventDefault();
            event.stopPropagation();
            scroller.scrollTop +=
              event.deltaY *
              (event.deltaMode === 1
                ? 16
                : event.deltaMode === 2
                  ? scroller.clientHeight
                  : 1);
            update();
          },
          {
            passive: false,
          },
        );
        track.addEventListener("keydown", (event) => {
          const delta = {
            ArrowUp: -40,
            ArrowDown: 40,
            PageUp: -scroller.clientHeight * 0.9,
            PageDown: scroller.clientHeight * 0.9,
          }[event.key];
          if (
            delta === undefined &&
            event.key !== "Home" &&
            event.key !== "End"
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const top =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? maximum()
                : scroller.scrollTop + delta;
          if (scroller.scrollTo)
            scroller.scrollTo({
              top,
              behavior: motionPreference.matches ? "instant" : "smooth",
            });
          else scroller.scrollTop = top;
          update();
        });
        scroller.addEventListener("scroll", update, {
          passive: true,
        });
        if (typeof ResizeObserver !== "undefined") {
          const observer = new ResizeObserver(update);
          observer.observe(scroller);
          observer.observe(grid);
        }
        update();
        return {
          update,
        };
      }
      const galleryScrollbar = createScrollbar();
      const canEnhanceScroll =
        scroller &&
        scroller.parentElement &&
        typeof scroller.parentElement.querySelector === "function" &&
        typeof scroller.addEventListener === "function";
      function updateScrollAffordance() {
        galleryScrollbar.update();
        if (!canEnhanceScroll) return;
        const canScroll = scroller.scrollHeight - scroller.clientHeight > 8;
        const up = canScroll && scroller.scrollTop > 8;
        const down =
          canScroll &&
          scroller.scrollTop + scroller.clientHeight <
            scroller.scrollHeight - 8;
        scroller.classList.toggle("can-scroll-up", up);
        scroller.classList.toggle("can-scroll-down", down);
      }
      if (canEnhanceScroll) {
        scroller.addEventListener("scroll", updateScrollAffordance, {
          passive: true,
        });
        if (typeof ResizeObserver !== "undefined")
          new ResizeObserver(() => {
            updateScrollAffordance();
            fitGallery();
          }).observe(scroller);
      }
      let drag = null;
      let cancelGesture = () => {};
      function persistOrder(cards) {
        const byId = new Map(
          GALLERY_ALBUMS[selectedAlbum].photos.map((photo) => [
            photo.id,
            photo,
          ]),
        );
        GALLERY_ALBUMS[selectedAlbum].photos = cards.map((card) =>
          byId.get(card.dataset.photoId),
        );
        saveOrder(selectedAlbum);
        fitGallery();
      }
      function cancelDrag() {
        if (!drag) return;
        const active = drag;
        drag = null;
        cancelAnimationFrame(active.frame);
        active.animation?.cancel();
        active.card.classList.remove("is-drag-source");
        active.target?.classList.remove("is-drop-target");
        active.ghost.remove();
        document.body.classList.remove("photo-dragging");
      }
      function updateDrag(x, y) {
        if (!drag || drag.settling) return;
        drag.x = x;
        drag.y = y;
        drag.ghost.style.left = `${x - drag.offsetX}px`;
        drag.ghost.style.top = `${y - drag.offsetY}px`;
        const cards = [...grid.children];
        let nearest = drag.card,
          distance = Infinity;
        for (const card of cards) {
          const box = card.getBoundingClientRect();
          const dx = Math.max(box.left - x, 0, x - box.right);
          const dy = Math.max(box.top - y, 0, y - box.bottom);
          const score =
            dx * dx +
            dy * dy +
            Math.hypot(
              x - (box.left + box.width / 2),
              y - (box.top + box.height / 2),
            ) *
              0.001;
          if (score < distance) {
            nearest = card;
            distance = score;
          }
        }
        drag.target?.classList.remove("is-drop-target");
        drag.target = nearest;
        drag.targetIndex = cards.indexOf(nearest);
        if (nearest !== drag.card) nearest.classList.add("is-drop-target");
      }
      function scrollDrag() {
        if (!drag || drag.settling) return;
        const box = scroller.getBoundingClientRect();
        const local = scroller.scrollHeight > scroller.clientHeight + 2;
        const top = local ? box.top : 0,
          bottom = local ? box.bottom : innerHeight;
        const step = drag.y < top + 56 ? -10 : drag.y > bottom - 56 ? 10 : 0;
        if (step) {
          if (local) scroller.scrollTop += step;
          else window.scrollBy(0, step);
          updateDrag(drag.x, drag.y);
        }
        drag.frame = requestAnimationFrame(scrollDrag);
      }
      function finishDrag() {
        if (!drag) return;
        const active = drag;
        active.settling = true;
        cancelAnimationFrame(active.frame);
        const cards = [...grid.children].filter((card) => card !== active.card);
        cards.splice(active.targetIndex, 0, active.card);
        grid.replaceChildren(...cards);
        persistOrder(cards);
        active.target?.classList.remove("is-drop-target");
        const target = active.card.getBoundingClientRect();
        const image = active.card.querySelector(".photo-image"),
          previewImage = active.ghost.querySelector(".photo-image");
        previewImage.style.setProperty(
          "--photo-width",
          image.style.getPropertyValue("--photo-width"),
        );
        previewImage.style.setProperty(
          "--photo-height",
          image.style.getPropertyValue("--photo-height"),
        );
        for (const item of [image, previewImage]) {
          item.style.setProperty("--photo-zoom", "1");
          item.style.setProperty("--pan-x", "0px");
          item.style.setProperty("--pan-y", "0px");
        }
        const complete = () => {
          if (drag !== active) return;
          cancelDrag();
          active.card.focus({
            preventScroll: true,
          });
          updateScrollAffordance();
        };
        if (motionPreference.matches || !active.ghost.animate) {
          complete();
          return;
        }
        active.animation = active.ghost.animate(
          [
            {
              left: active.ghost.style.left,
              top: active.ghost.style.top,
              width: active.ghost.style.width,
              height: active.ghost.style.height,
              transform: "scale(1.025) rotate(-1deg)",
            },
            {
              left: `${target.left}px`,
              top: `${target.top}px`,
              width: `${target.width}px`,
              height: `${target.height}px`,
              transform: "none",
            },
          ],
          {
            duration: 180,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            fill: "forwards",
          },
        );
        active.animation.finished.then(complete).catch(complete);
      }
      document.addEventListener("portfolio:scene", () => cancelGesture());
      window.addEventListener("pagehide", () => cancelGesture());
      window.addEventListener("blur", () => cancelGesture());
      window.addEventListener("resize", () => cancelGesture(), {
        passive: true,
      });
      motionPreference.addEventListener("change", () => cancelGesture());
      grid.addEventListener("contextmenu", (event) => {
        if (drag) event.preventDefault();
      });
      grid.addEventListener("keydown", (event) => {
        const card = event.target.closest(".photo-card");
        const delta = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -2,
          ArrowDown: 2,
        }[event.key];
        if (!card || !event.altKey || !delta) return;
        event.preventDefault();
        cancelGesture();
        const cards = [...grid.children],
          start = cards.indexOf(card);
        const next = Math.max(0, Math.min(cards.length - 1, start + delta));
        cards.splice(start, 1);
        cards.splice(next, 0, card);
        grid.replaceChildren(...cards);
        persistOrder(cards);
        card.focus({
          preventScroll: true,
        });
        const status = document.getElementById("gallery-status");
        if (status)
          status.textContent = `Photo moved to position ${next + 1} of ${cards.length}.`;
      });
      grid.addEventListener("pointerdown", (event) => {
        const card = event.target.closest(".photo-card");
        if (
          !card ||
          !event.isPrimary ||
          (event.pointerType === "mouse" && event.button !== 0)
        )
          return;
        cancelGesture();
        const startX = event.clientX,
          startY = event.clientY,
          pointerId = event.pointerId;
        let timer = 0,
          started = false,
          aborted = false;
        const begin = (x, y) => {
          if (aborted || started) return;
          started = true;
          const box = card.getBoundingClientRect(),
            ghost = card.cloneNode(true);
          ghost.className = "photo-card photo-drag-preview";
          ghost.removeAttribute("id");
          ghost.setAttribute("aria-hidden", "true");
          ghost.tabIndex = -1;
          ghost.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;margin:0;pointer-events:none;z-index:100;transform-origin:${startX - box.left}px ${startY - box.top}px;`;
          document.body.append(ghost);
          card.classList.add("is-drag-source");
          drag = {
            card,
            ghost,
            offsetX: startX - box.left,
            offsetY: startY - box.top,
            target: card,
            targetIndex: [...grid.children].indexOf(card),
            frame: 0,
            settling: false,
            x,
            y,
          };
          document.body.classList.add("photo-dragging");
          updateDrag(x, y);
          drag.frame = requestAnimationFrame(scrollDrag);
        };
        const move = (next) => {
          if (next.pointerId !== pointerId) return;
          if (!started) {
            const distance = Math.hypot(
              next.clientX - startX,
              next.clientY - startY,
            );
            if (event.pointerType !== "mouse") {
              if (distance > 10) {
                clearTimeout(timer);
                aborted = true;
              }
              return;
            }
            if (distance <= 7) return;
            begin(next.clientX, next.clientY);
          }
          if (drag) {
            next.preventDefault();
            updateDrag(next.clientX, next.clientY);
          }
        };
        const removeListeners = () => {
          clearTimeout(timer);
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
          window.removeEventListener("pointercancel", cancel, true);
          document.removeEventListener("touchmove", touchMove);
        };
        const touchMove = (next) => {
          if (drag) next.preventDefault();
        };
        const up = (next) => {
          if (next.pointerId !== pointerId) return;
          removeListeners();
          if (!started || !drag) return;
          next.preventDefault();
          updateDrag(next.clientX, next.clientY);
          card.dataset.suppressClick = "true";
          setTimeout(() => {
            card.dataset.suppressClick = "false";
          }, 500);
          finishDrag();
        };
        const cancel = (next) => {
          if (next.pointerId === pointerId) cancelGesture();
        };
        cancelGesture = () => {
          aborted = true;
          removeListeners();
          cancelDrag();
        };
        if (event.pointerType !== "mouse")
          timer = setTimeout(() => begin(startX, startY), 380);
        window.addEventListener("pointermove", move, {
          capture: true,
          passive: false,
        });
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", cancel, true);
        document.addEventListener("touchmove", touchMove, {
          passive: false,
        });
      });
      buttons.forEach((button) => {
        button.style.setProperty(
          "--album-image",
          `url("${GALLERY_ALBUMS[button.dataset.album].cover}")`,
        );
        button.addEventListener("click", () => setAlbum(button.dataset.album));
      });
      setAlbum(selectedAlbum);
      return {
        setAlbum,
        open,
        close,
      };
    }
    function advanceBody(body, dt, floor, right) {
      dt = clamp(dt, 0, 0.035);
      if (body.held || body.rest) return;
      body.vy += 420 * dt;
      body.vx *= Math.exp(-dt * 0.6);
      body.spin *= Math.exp(-dt * 0.4);
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.spin * dt;
      if (body.x < 0 || body.x > right) {
        body.x = clamp(body.x, 0, right);
        body.vx *= -0.92;
        body.spin *= -0.9;
      }
      if (body.y < 0) {
        body.y = 0;
        body.vy *= -0.88;
      }
      if (body.y >= floor) {
        body.y = floor;
        body.vy = body.vy > 90 ? -body.vy * 0.88 : 0;
        body.vx *= 0.98;
        body.spin *= 0.9;
        body.angle *= Math.exp(-dt * 2);
      }
      if (
        body.vy === 0 &&
        Math.abs(body.vx) < 4 &&
        Math.abs(body.angle) < 0.1
      ) {
        body.vx = body.spin = body.angle = 0;
        body.rest = true;
      }
    }
    function throwVelocity(points) {
      if (points.length < 2) return null;
      const first = points[0],
        last = points[points.length - 1];
      const dt = Math.max(16, last.t - first.t) / 1e3;
      return {
        vx: Math.max(-1400, Math.min(1400, ((last.x - first.x) / dt) * 0.9)),
        vy: Math.max(-1400, Math.min(1400, ((last.y - first.y) / dt) * 0.9)),
      };
    }
    function isReturnPress(velocity) {
      return !velocity || Math.hypot(velocity.vx, velocity.vy) < 60;
    }
    function initPhysical(motionPreference) {
      const layer = document.createElement("div");
      layer.className = "physics-layer";
      document.body.append(layer);
      let bodies = [],
        animationFrame = 0,
        last = 0;
      function schedule() {
        if (!animationFrame && !document.hidden && !motionPreference.matches)
          animationFrame = requestAnimationFrame(tick);
      }
      function tick(now) {
        animationFrame = 0;
        const dt = Math.min(0.035, (now - last) / 1000 || 1 / 60);
        last = now;
        for (const body of bodies) {
          if (body.rest || body.held) continue;
          advanceBody(
            body,
            dt,
            Math.max(0, innerHeight - body.height - 8),
            Math.max(0, innerWidth - body.width),
          );
          body.element.style.transform = `translate3d(${body.x}px,${body.y}px,0) rotate(${body.angle}deg)`;
        }
        if (bodies.some((b) => !b.rest && !b.held)) schedule();
        else last = 0;
      }
      function release(element, box, options = {}) {
        const body = {
          element,
          x: box.left,
          y: box.top,
          vx: options.vx || 0,
          vy: options.vy || 0,
          width: box.width,
          height: box.height,
          angle: 0,
          spin: 0,
          rest: false,
          light: true,
          held: Boolean(options.held),
          age: 0,
        };
        bodies.push(body);
        element.style.cssText = `position:absolute;left:0;top:0;width:${box.width}px;height:${box.height}px;margin:0;pointer-events:auto;transform:translate(${box.left}px,${box.top}px);`;
        element.classList.add("is-detached");
        layer.append(element);
        return body;
      }
      const restores = [];
      document.querySelectorAll(".stat>.icon").forEach((icon, index) => {
        const socket = document.createElement("button");
        socket.type = "button";
        socket.className = "icon-socket";
        socket.setAttribute(
          "aria-label",
          [
            "Drag the page views eye; click to blink",
            "Drag the repository brackets",
            "Drag the star",
          ][index],
        );
        socket.title = "Drag to dislodge";
        icon.before(socket);
        socket.append(icon);
        let start = null,
          dragging = false,
          detachedAt = 0,
          trail = [],
          loose = null,
          looseBody = null;
        const launchLoose = ({ vx, vy }) => {
          looseBody.vx = vx;
          looseBody.vy = vy;
          looseBody.spin = Math.max(-360, Math.min(360, vx * 0.25));
          looseBody.held = false;
          looseBody.age = 0.22;
          loose.classList.remove("is-held");
          schedule();
        };
        const restore = () => {
          dragging = false;
          start = null;
          trail = [];
          socket.classList.remove("is-held");
          icon.style.translate = "";
          if (!loose) return;
          if (looseBody) bodies = bodies.filter((body) => body !== looseBody);
          icon.style.translate = "";
          icon.style.transform = "";
          socket.append(icon);
          loose.remove();
          loose = looseBody = null;
          socket.classList.remove("is-empty");
          socket.onclick = null;
        };
        restores.push(restore);
        const detach = (clientX, clientY) => {
          if (loose || socket.classList.contains("is-empty")) return;
          socket.classList.add("is-empty");
          socket.classList.remove("is-held");
          icon.style.translate = "";
          const box = icon.getBoundingClientRect();
          loose = document.createElement("button");
          loose.type = "button";
          loose.className = "loose-icon is-held";
          loose.setAttribute("aria-label", "Drag the icon; click to return it");
          loose.append(icon);
          looseBody = release(loose, box, {
            held: true,
            vx: 0,
            vy: 0,
          });
          detachedAt = performance.now();
          moveLoose(clientX, clientY);
          bindLooseDrag();
        };
        const moveLoose = (clientX, clientY) => {
          if (!loose || !looseBody) return;
          const halfW = looseBody.width / 2,
            halfH = looseBody.height / 2;
          looseBody.x = clientX - halfW;
          looseBody.y = clientY - halfH;
          loose.style.transform = `translate3d(${looseBody.x}px,${looseBody.y}px,0) rotate(${looseBody.angle || 0}deg)`;
        };
        const bindLooseDrag = () => {
          if (!loose || loose.dataset.dragBound) return;
          loose.dataset.dragBound = "true";
          let grabOffset = null,
            grabTrail = [],
            grabbing = false;
          loose.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || motionPreference.matches || !looseBody)
              return;
            grabbing = true;
            grabTrail = [
              {
                x: event.clientX,
                y: event.clientY,
                t: performance.now(),
              },
            ];
            grabOffset = {
              x: event.clientX - looseBody.x,
              y: event.clientY - looseBody.y,
            };
            looseBody.held = true;
            looseBody.rest = false;
            loose.classList.add("is-held");
            loose.setPointerCapture?.(event.pointerId);
            schedule();
          });
          loose.addEventListener("pointermove", (event) => {
            if (!grabbing || !looseBody) return;
            grabTrail.push({
              x: event.clientX,
              y: event.clientY,
              t: performance.now(),
            });
            if (grabTrail.length > 8) grabTrail.shift();
            looseBody.x = event.clientX - grabOffset.x;
            looseBody.y = event.clientY - grabOffset.y;
            loose.style.transform = `translate3d(${looseBody.x}px,${looseBody.y}px,0) rotate(${looseBody.angle || 0}deg)`;
          });
          const endGrab = (event) => {
            if (!grabbing || !looseBody) return;
            grabbing = false;
            const velocity = throwVelocity(grabTrail);
            launchLoose(
              velocity ?? {
                vx: 60,
                vy: -40,
              },
            );
            if (event.type === "pointerup" && isReturnPress(velocity))
              restore();
          };
          loose.addEventListener("pointerup", endGrab);
          loose.addEventListener("pointercancel", endGrab);
        };
        socket.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 && event.pointerType === "mouse") return;
          if (socket.classList.contains("is-empty")) return;
          start = {
            x: event.clientX,
            y: event.clientY,
          };
          trail = [
            {
              x: event.clientX,
              y: event.clientY,
              t: performance.now(),
            },
          ];
          dragging = true;
          try {
            socket.setPointerCapture(event.pointerId);
          } catch {}
          socket.classList.add("is-held");
        });
        socket.addEventListener("pointermove", (event) => {
          if (motionPreference.matches) return;
          if (!dragging) {
            if (loose && looseBody?.held) {
              trail.push({
                x: event.clientX,
                y: event.clientY,
                t: performance.now(),
              });
              if (trail.length > 8) trail.shift();
              moveLoose(event.clientX, event.clientY);
            }
            return;
          }
          trail.push({
            x: event.clientX,
            y: event.clientY,
            t: performance.now(),
          });
          if (trail.length > 8) trail.shift();
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          icon.style.translate = `${dx}px ${dy}px`;
          if (Math.hypot(dx, dy) > 48) {
            dragging = false;
            socket.classList.remove("is-held");
            detach(event.clientX, event.clientY);
          }
        });
        const endDrag = () => {
          if (motionPreference.matches) {
            dragging = false;
            socket.classList.remove("is-held");
            icon.style.translate = "";
            return;
          }
          if (!dragging) {
            if (loose && looseBody?.held) {
              const { vx = 0, vy = 0 } = throwVelocity(trail) ?? {};
              launchLoose({
                vx: vx || 60,
                vy: vy || -40,
              });
              icon.style.translate = "";
            }
            return;
          }
          dragging = false;
          socket.classList.remove("is-held");
          icon.style.translate = "";
          icon.animate(
            [
              {
                transform: "scale(0.92)",
              },
              {
                transform: "scale(1.04)",
              },
              {
                transform: "scale(1)",
              },
            ],
            {
              duration: 220,
              easing: "cubic-bezier(.2,.8,.2,1)",
            },
          );
        };
        socket.addEventListener("pointerup", endDrag);
        socket.addEventListener("pointercancel", () => {
          restore();
          dragging = false;
          trail = [];
          if (!loose) icon.style.translate = "";
          socket.classList.remove("is-held");
        });
        socket.addEventListener("click", () => {
          if (socket.classList.contains("is-empty")) {
            if (performance.now() - detachedAt > 350) restore();
            return;
          }
          if (motionPreference.matches) return;
          if (performance.now() - detachedAt < 350) return;
          const paths = [...icon.querySelectorAll("path")];
          if (index === 0)
            paths[0]?.animate(
              [
                {
                  transform: "scaleY(1)",
                },
                {
                  transform: "scaleY(.08)",
                },
                {
                  transform: "scaleY(1)",
                },
              ],
              {
                duration: 180,
              },
            );
          else if (index === 1)
            paths.slice(0, 2).forEach((path, i) =>
              path.animate(
                [
                  {
                    transform: "translateX(0)",
                  },
                  {
                    transform: `translateX(${i ? 3 : -3}px)`,
                  },
                  {
                    transform: "translateX(0)",
                  },
                ],
                {
                  duration: 360,
                  easing: "cubic-bezier(.2,.8,.2,1)",
                },
              ),
            );
          else {
            starBurst(icon, true);
          }
        });
      });
      function starBurst(icon) {
        if (motionPreference.matches) return;
        icon.animate(
          [
            {
              transform: "translateY(0)",
            },
            {
              transform: "translateY(-2px)",
              offset: 0.45,
            },
            {
              transform: "translateY(0)",
            },
          ],
          {
            duration: 300,
            easing: "cubic-bezier(0.2,0,0,1)",
          },
        );
      }
      const reset = () => {
        restores.forEach((restore) => restore());
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        last = 0;
      };
      document.addEventListener("portfolio:scene", reset);
      window.addEventListener("resize", reset, {
        passive: true,
      });
      window.addEventListener("pagehide", reset);
      motionPreference.addEventListener("change", reset);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) reset();
        else schedule();
      });
    }
    function tiltResponse(value) {
      const v = Math.max(-0.5, Math.min(0.5, value));
      return v * (1.5 - 0.5 * (Math.abs(v) / 0.5) ** 2);
    }
    function initMicrointeractions(motionPreference) {
      let maskId = 0;
      async function expand() {
        try {
          document.querySelectorAll("svg.icon use").forEach((use) => {
            const id = use.getAttribute("href")?.split("#")[1],
              symbol = document.getElementById(id);
            if (!symbol) return;
            const svg = use.parentElement;
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.dataset.micro = id;
            svg.replaceChildren(
              ...[...symbol.children].map((child) => child.cloneNode(true)),
            );
            if (id === "brand-discord") {
              const mask = svg.querySelector("mask");
              if (mask) {
                mask.id = "discord-eyes-" + ++maskId;
                svg
                  .querySelector(".discord-body")
                  .setAttribute("mask", "url(#" + mask.id + ")");
              }
            }
            if (id === "fingerprint") {
              [...svg.children].forEach((path, ridge) => {
                const ink = path.cloneNode(true);
                ink.classList.add("print-ink");
                ink.setAttribute("pathLength", "1");
                ink.style.setProperty("--ridge", ridge);
                svg.append(ink);
              });
            }
          });
          bind();
        } catch {}
      }
      function bind() {
        document
          .querySelectorAll("button,a,.stat,.project-feature,.current-card")
          .forEach((element) => {
            if (element.dataset.microBound) return;
            element.dataset.microBound = "true";
            let box,
              eyes = [];
            element.addEventListener("pointerenter", () => {
              box = element.getBoundingClientRect();
              eyes = [
                ...element.querySelectorAll(
                  'svg[data-micro="eye"],svg[data-micro="brand-discord"]',
                ),
              ].flatMap((svg) => {
                const box2 = svg.getBoundingClientRect();
                return [
                  ...svg.querySelectorAll(
                    svg.dataset.micro === "eye"
                      ? "path:first-child"
                      : ".discord-eye",
                  ),
                ].map((path) => {
                  const pupil = path.getBBox();
                  return {
                    path,
                    x:
                      box2.left +
                      ((pupil.x + pupil.width / 2) / 24) * box2.width,
                    y:
                      box2.top +
                      ((pupil.y + pupil.height / 2) / 24) * box2.height,
                  };
                });
              });
            });
            element.addEventListener(
              "pointermove",
              (event) => {
                if (
                  motionPreference.matches ||
                  event.pointerType === "touch" ||
                  !box
                )
                  return;
                const x = Math.max(
                    -1,
                    Math.min(
                      1,
                      ((event.clientX - box.left) / box.width) * 2 - 1,
                    ),
                  ),
                  y = Math.max(
                    -1,
                    Math.min(
                      1,
                      ((event.clientY - box.top) / box.height) * 2 - 1,
                    ),
                  );
                element.style.setProperty("--icon-x", `${x * 1.7}px`);
                element.style.setProperty("--icon-y", `${y * 1.2}px`);
                for (const eye of eyes) {
                  const dx = event.clientX - eye.x;
                  const dy = event.clientY - eye.y;
                  const length = Math.hypot(dx, dy) || 1,
                    reach = Math.min(1, length / 45);
                  eye.path.style.setProperty(
                    "--icon-x",
                    `${(dx / length) * reach * 2.2}px`,
                  );
                  eye.path.style.setProperty(
                    "--icon-y",
                    `${(dy / length) * reach * 1.5}px`,
                  );
                }
              },
              {
                passive: true,
              },
            );
            element.addEventListener("pointerleave", () => {
              element.style.setProperty("--icon-x", "0px");
              element.style.setProperty("--icon-y", "0px");
              eyes.forEach(({ path }) => {
                path.style.setProperty("--icon-x", "0px");
                path.style.setProperty("--icon-y", "0px");
              });
            });
          });
      }
      document.addEventListener("gallery:render", expand);
      document.addEventListener("icons:refresh", expand);
      expand();
    }
    function buildPath(nodes) {
      const points = [
        {
          x: nodes[0].x,
          y: 0,
        },
        nodes[0],
      ];
      for (let i = 1; i < nodes.length; i++) {
        const from = nodes[i - 1];
        const to = nodes[i];
        if (from.x !== to.x) {
          const bend = (to.y - from.y) * 0.3;
          points.push(
            {
              x: from.x,
              y: from.y + bend,
            },
            {
              x: to.x,
              y: to.y - bend,
            },
          );
        }
        points.push(to);
      }
      return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    }
    function lengthAtY(path, total, y) {
      let lo = 0;
      let hi = total;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (path.getPointAtLength(mid).y < y) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    const FALL_STEP = 1 / 60;
    const THROW_SPEED = 260;
    const THROW_DECAY = 0.35;
    const SWAY = 56;
    const SWAY_PERIOD = 1.8;
    const BOB = 16;
    const SKID = 0.35;
    function planFall(nose, left, right, floor) {
      const side = nose.x < 0 ? -1 : 1;
      const sway = Math.max(0, Math.min(SWAY, (right - left) / 2 - 8));
      const sink = Math.min(240, Math.max(90, floor / 2.6));
      const w = (2 * Math.PI) / SWAY_PERIOD;
      const xs = [0];
      const ys = [0];
      for (let t = FALL_STEP; t < 8; t += FALL_STEP) {
        const thrown =
          THROW_SPEED * THROW_DECAY * (1 - Math.exp(-t / THROW_DECAY));
        const grow = 1 - Math.exp(-t / 0.5);
        const fx = nose.x * thrown + side * sway * grow * Math.sin(w * t);
        const fy =
          nose.y * thrown +
          sink * (t - 0.4 * (1 - Math.exp(-t / 0.4))) +
          (BOB * grow * (Math.cos(2 * w * t) - 1)) / 2;
        xs.push(Math.min(right, Math.max(left, fx)));
        ys.push(Math.min(floor, fy));
        if (fy >= floor) break;
      }
      const n = xs.length;
      const drift = (xs[n - 1] - xs[n - 2]) / FALL_STEP;
      for (let t = FALL_STEP; t <= SKID; t += FALL_STEP) {
        const k = 1 - t / SKID;
        xs.push(
          Math.min(
            right,
            Math.max(left, xs[xs.length - 1] + drift * k * FALL_STEP),
          ),
        );
        ys.push(floor);
      }
      const angles = [];
      for (let i = 0; i < xs.length; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(xs.length - 1, i + 1);
        let angle =
          (Math.atan2(ys[b] - ys[a], xs[b] - xs[a]) * 180) / Math.PI + 90;
        if (i >= n) {
          const k = Math.min(1, (i - n + 1) / (SKID / FALL_STEP));
          const lying = drift ? (drift < 0 ? 270 : 90) : angle < 180 ? 90 : 270;
          angle += (lying - angle) * k;
        }
        const prev = angles[i - 1] ?? angle;
        angles.push(angle + 360 * Math.round((prev - angle) / 360));
      }
      return {
        xs,
        ys,
        angles,
        duration: (xs.length - 1) * FALL_STEP,
      };
    }
    function sampleFall(values, p) {
      const at = Math.min(1, Math.max(0, p)) * (values.length - 1);
      const i = Math.floor(at);
      const next = values[Math.min(values.length - 1, i + 1)];
      return values[i] + (next - values[i]) * (at - i);
    }
    function initRail(motionPreference, onReach = () => {}) {
      const nav = document.querySelector(".rail"),
        svg = nav.querySelector(".rail-route"),
        path = document.getElementById("rail-progress"),
        plane = document.getElementById("rail-plane");
      const links = [...nav.querySelectorAll("[data-scene]")],
        holes = [...svg.querySelectorAll(".plane-hole")];
      let nodes = [],
        dots = [],
        lengths = [],
        total = 0,
        position = 0,
        target = 0,
        velocity = 0,
        planeAngle = 180,
        headingTarget = 180,
        turnVelocity = 0,
        facing = 1,
        turnFrom = 0,
        animationFrame = 0,
        previous = 0,
        progress = 0,
        spill = 0,
        away = 0,
        fall = null,
        flight = 0,
        flightFrom = 0,
        flightTo = 0,
        flightStart = 0,
        flightDuration = 0,
        visible = false,
        activeNode = 0;
      const circle = (point, r, fill) => {
        const node = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        node.setAttribute("cx", point.x);
        node.setAttribute("cy", point.y);
        node.setAttribute("r", r);
        node.setAttribute("fill", fill);
        return node;
      };
      function measure() {
        visible = Boolean(svg.getBoundingClientRect().width);
        if (!visible) return;
        const box = nav.getBoundingClientRect();
        nodes = links.map((link, index) => ({
          x: 5 + [0, 1, 1, 0][index] * 14,
          y: link.getBoundingClientRect().top - box.top + link.offsetHeight / 2,
        }));
        const d = buildPath(nodes),
          height = nav.offsetHeight,
          width = 36;
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.style.height = `${height}px`;
        svg.style.width = `${width}px`;
        for (const route of svg.querySelectorAll("path"))
          route.setAttribute("d", d);
        for (const mask of svg.querySelectorAll("mask")) {
          mask.setAttribute("x", -8);
          mask.setAttribute("y", -8);
          mask.setAttribute("width", width + 16);
          mask.setAttribute("height", height + 16);
        }
        for (const rect of svg.querySelectorAll(".rail-mask-area")) {
          rect.setAttribute("x", -8);
          rect.setAttribute("y", -8);
          rect.setAttribute("width", width + 16);
          rect.setAttribute("height", height + 16);
        }
        document.getElementById("rail-fade").setAttribute("y2", nodes[0].y - 4);
        document
          .getElementById("rail-holes")
          .replaceChildren(...nodes.map((point) => circle(point, 4, "black")));
        dots = nodes.map((point) => circle(point, 3.25, "transparent"));
        document.getElementById("rail-nodes").replaceChildren(...dots);
        total = path.getTotalLength();
        lengths = nodes.map((point) => lengthAtY(path, total, point.y));
        path.style.strokeDasharray = String(total);
        setProgress(progress);
        position = target;
        draw();
      }
      function steer(angle) {
        headingTarget = angle + 360 * Math.round((planeAngle - angle) / 360);
      }
      function draw() {
        if (!total) return;
        const l = clamp(position, 0, total),
          point = path.getPointAtLength(l),
          behind = path.getPointAtLength(Math.max(0, l - 1)),
          ahead = path.getPointAtLength(Math.min(total, l + 1));
        let x = point.x,
          y = point.y;
        if (fall && flight) {
          x += sampleFall(fall.xs, flight);
          y += sampleFall(fall.ys, flight);
          steer(sampleFall(fall.angles, flight) + (away ? 0 : 180));
        } else
          steer(
            (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) /
              Math.PI +
              90 +
              (facing < 0 ? 180 : 0),
          );
        path.style.strokeDashoffset = String(total - l);
        const reached = activeNode + 1;
        dots.forEach((dot, index) => {
          dot.setAttribute("r", index < reached ? 3 : 3.25);
          dot.setAttribute(
            "fill",
            index < reached ? "var(--accent)" : "transparent",
          );
          dot.setAttribute(
            "stroke",
            index < reached ? "var(--accent)" : "var(--line)",
          );
        });
        links.forEach((link, index) =>
          link.classList.toggle("rail-reached", index === activeNode),
        );
        holes.forEach((hole) => {
          hole.setAttribute("cx", x);
          hole.setAttribute("cy", y);
          hole.setAttribute("r", 4 * Math.max(0, 1 - flight * 8));
        });
        plane.style.transform = `translate(${x - 12}px,${y - 12}px) rotate(${planeAngle}deg)`;
      }
      function tick(now) {
        animationFrame = 0;
        if (document.hidden) return;
        const dt = Math.min(0.04, (now - previous) / 1e3 || 1 / 60);
        previous = now;
        const flying = flightDuration ? 1 : 0;
        const turnStiff = flying ? 900 : 260;
        const turnDamp = flying ? 42 : 30;
        const steps = Math.ceil(dt / (1 / 120)),
          h = dt / steps;
        for (let i = 0; i < steps; i++) {
          velocity += (((target - position) * 200 - velocity * 30) / 0.6) * h;
          position += velocity * h;
          turnVelocity +=
            ((headingTarget - planeAngle) * turnStiff -
              turnVelocity * turnDamp) *
            h;
          planeAngle += turnVelocity * h;
        }
        if (flightDuration) {
          const t = clamp((now - flightStart) / flightDuration);
          const e = flightTo ? t : t * t * (3 - 2 * t);
          flight = flightFrom + (flightTo - flightFrom) * e;
          if (t === 1) {
            flightDuration = 0;
            flight = flightTo;
            if (!flight) fall = null;
          }
        }
        draw();
        if (
          Math.abs(target - position) > 0.01 ||
          Math.abs(velocity) > 0.02 ||
          Math.abs(headingTarget - planeAngle) > 0.03 ||
          Math.abs(turnVelocity) > 0.05 ||
          flightDuration
        )
          schedule();
        else {
          position = target;
          planeAngle = headingTarget;
          velocity = turnVelocity = 0;
          previous = 0;
          draw();
        }
      }
      function schedule() {
        if (
          !animationFrame &&
          !document.hidden &&
          !motionPreference.matches &&
          visible
        )
          animationFrame = requestAnimationFrame(tick);
      }
      function land() {
        spill = 0;
        if (!away && !flight) return;
        away = 0;
        facing = target >= lengths.at(-1) ? -1 : 1;
        planeAngle += (headingTarget - planeAngle) * 0.65;
        turnVelocity = 0;
        flightFrom = flight;
        flightTo = 0;
        flightStart = performance.now();
        flightDuration =
          Math.max(0.45, flight * (fall?.duration || 1) * 0.4) * 1e3;
        schedule();
      }
      function takeOff(edge) {
        if (
          motionPreference.matches ||
          away ||
          !svg.getBoundingClientRect().width
        )
          return;
        away = edge;
        facing = edge;
        if (!flight || !fall) {
          draw();
          const box = plane.getBoundingClientRect(),
            cx = box.left + box.width / 2,
            cy = box.top + box.height / 2,
            angle = (headingTarget * Math.PI) / 180;
          fall = planFall(
            {
              x: Math.sin(angle),
              y: -Math.cos(angle),
            },
            12 - cx,
            innerWidth - 12 - cx,
            innerHeight - 12 - cy,
          );
        }
        flightFrom = flight;
        flightTo = 1;
        flightStart = performance.now();
        flightDuration = (1 - flight) * fall.duration * 1e3;
        schedule();
      }
      function setProgress(value, immediate = false) {
        progress = clamp(value);
        const atNode = progress * (links.length - 1);
        const nodeIndex = Math.max(
          0,
          Math.min(links.length - 1, Math.round(atNode)),
        );
        if (nodeIndex !== activeNode) {
          activeNode = nodeIndex;
          onReach(nodeIndex);
        }
        if (!visible || !lengths.length) {
          return;
        }
        const at = progress * (lengths.length - 1),
          i = Math.min(lengths.length - 2, Math.floor(at));
        const next = lengths[i] + (lengths[i + 1] - lengths[i]) * (at - i);
        const dir = next - turnFrom;
        if (Math.abs(dir) > 0.5) {
          facing = dir > 0 ? 1 : -1;
          turnFrom = next;
        }
        target = next;
        if (away && progress > 1e-3 && progress < 0.999) land();
        if (motionPreference.matches || immediate) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
          flightDuration = flight = away = 0;
          position = target;
          draw();
          planeAngle = headingTarget;
          draw();
        } else schedule();
      }
      let edgeDirection = 0,
        edgeSince = 0,
        edgeEvents = 0;
      function input(delta) {
        const end = document.documentElement.scrollHeight - innerHeight;
        let edge = 0;
        if (scrollY <= 1 && delta < 0) edge = -1;
        else if (scrollY >= end - 1 && delta > 0) edge = 1;
        if (!edge) {
          edgeDirection = 0;
          edgeEvents = 0;
          spill = 0;
          land();
          return;
        }
        const now = performance.now();
        if (edge !== edgeDirection) {
          edgeDirection = edge;
          edgeSince = now;
          edgeEvents = 0;
          spill = 0;
        }
        edgeEvents++;
        spill += Math.abs(delta);
        if (spill >= 720 && edgeEvents >= 3 && now - edgeSince >= 250)
          takeOff(edge);
      }
      links.forEach((link, index) =>
        link.addEventListener("click", () => {
          land();
          setProgress(index / (links.length - 1));
        }),
      );
      window.addEventListener(
        "wheel",
        (event) =>
          input(event.deltaY * ([1, 16, innerHeight][event.deltaMode] ?? 1)),
        {
          passive: true,
        },
      );
      let touchY = 0;
      window.addEventListener(
        "touchstart",
        (event) => {
          touchY = event.touches[0]?.clientY || 0;
        },
        {
          passive: true,
        },
      );
      window.addEventListener(
        "touchmove",
        (event) => {
          const y = event.touches[0]?.clientY || touchY;
          input(touchY - y);
          touchY = y;
        },
        {
          passive: true,
        },
      );
      window.addEventListener("keydown", (event) => {
        if (
          [
            "ArrowDown",
            "ArrowUp",
            "PageDown",
            "PageUp",
            "Home",
            "End",
            " ",
          ].includes(event.key)
        ) {
          land();
        }
      });
      document.addEventListener("visibilitychange", () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        previous = 0;
        if (!document.hidden) {
          position = target;
          planeAngle = headingTarget;
          flightDuration = flight = away = 0;
          draw();
        }
      });
      motionPreference.addEventListener("change", () => {
        land();
        setProgress(progress);
      });
      const observer = new ResizeObserver(measure);
      observer.observe(nav);
      document.fonts.ready.then(measure);
      measure();
      return {
        setProgress,
      };
    }
    function initGithubCard() {
      const wrap = document.querySelector(".github-contact-wrap");
      const grid = document.getElementById("contribution-grid");
      const trigger = wrap.querySelector(".github-trigger");
      const tooltip = document.getElementById("contribution-tooltip");
      let loaded = false,
        retryAt = 0,
        pending = false,
        cells = [],
        selected = -1,
        touchSelection = false;
      function select(index) {
        cells[selected]?.classList.remove("is-selected");
        selected = Math.max(0, Math.min(cells.length - 1, index));
        const cell = cells[selected];
        if (!cell) return;
        cell.classList.add("is-selected");
        tooltip.textContent = `${cell.dataset.count} \xB7 ${new Date(
          `${cell.dataset.date}T12:00:00Z`,
        ).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        })}`;
      }
      function clearSelection() {
        touchSelection = false;
        cells[selected]?.classList.remove("is-selected");
        tooltip.textContent = "";
      }
      async function load() {
        if (loaded || pending || Date.now() < retryAt) return;
        pending = true;
        try {
          const data = await request("contributions");
          if (
            !Array.isArray(data.contributions) ||
            data.contributions.length > 371 ||
            !Number.isSafeInteger(data.total) ||
            data.total < 0 ||
            data.contributions.some(
              (day) =>
                !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
                !Number.isSafeInteger(day.count) ||
                day.count < 0 ||
                !Number.isInteger(day.level) ||
                day.level < 0 ||
                day.level > 4,
            )
          )
            throw new Error("Invalid data");
          const fragment = document.createDocumentFragment();
          const today = new Date().toISOString().slice(0, 10);
          const visible = data.contributions
            .filter((day) => day.date <= today)
            .slice(-133);
          grid.setAttribute(
            "aria-label",
            "GitHub contributions over the last 19 weeks; use arrow keys to inspect dates",
          );
          const start = new Date(`${visible[0]?.date}T12:00:00Z`).getUTCDay();
          for (let i = 0; i < start; i++) {
            const blank = document.createElement("span");
            blank.setAttribute("aria-hidden", "true");
            fragment.append(blank);
          }
          cells = visible.map((day, index) => {
            const cell = document.createElement("span");
            cell.className = "contribution-cell";
            cell.dataset.level = String(day.level);
            cell.dataset.date = day.date;
            cell.dataset.count = String(day.count);
            cell.setAttribute(
              "aria-label",
              `${day.count} contributions on ${day.date}`,
            );
            cell.addEventListener("pointerenter", (event) => {
              if (event.pointerType !== "touch") select(index);
            });
            cell.addEventListener("pointerleave", () => {
              if (!touchSelection) clearSelection();
            });
            fragment.append(cell);
            return cell;
          });
          grid.replaceChildren(fragment);
          document.getElementById("contribution-year").textContent =
            Number.isInteger(data.year) ? String(data.year) : "Past year";
          document.getElementById("contribution-total").textContent =
            `${data.total.toLocaleString("en")} contributions${data.stale ? " \xB7 cached" : ""}`;
          loaded = true;
        } catch {
          retryAt = Date.now() + 60000;
          document.getElementById("contribution-total").textContent =
            "Contributions unavailable";
        } finally {
          pending = false;
        }
      }
      load();
      wrap.addEventListener("pointerenter", () => {
        wrap.classList.remove("is-dismissed");
        load();
      });
      wrap.addEventListener("focusin", load);
      wrap.addEventListener("pointerleave", () =>
        wrap.classList.remove("is-dismissed"),
      );
      wrap.addEventListener("pointerleave", () => {
        if (!touchSelection) clearSelection();
      });
      grid.addEventListener("pointerleave", () => {
        if (!touchSelection) clearSelection();
      });
      grid.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || !cells.length) return;
        const box = grid.getBoundingClientRect(),
          style = getComputedStyle(grid);
        const step =
          cells[0].getBoundingClientRect().width + parseFloat(style.columnGap);
        const column = Math.max(
          0,
          Math.round((event.clientX - box.left - step / 2) / step),
        );
        const row = Math.max(
          0,
          Math.min(6, Math.round((event.clientY - box.top - step / 2) / step)),
        );
        const date = grid.children[column * 7 + row];
        const index = cells.indexOf(date);
        if (index >= 0) {
          touchSelection = true;
          select(index);
        }
      });
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (touchSelection && !grid.contains(event.target)) clearSelection();
        },
        {
          passive: true,
        },
      );
      grid.addEventListener("blur", clearSelection);
      grid.addEventListener("focus", () => {
        if (cells.length && !touchSelection) select(0);
      });
      grid.addEventListener("keydown", (event) => {
        const changes = {
          ArrowLeft: -7,
          ArrowRight: 7,
          ArrowUp: -1,
          ArrowDown: 1,
        };
        if (event.key in changes) {
          event.preventDefault();
          select(selected + changes[event.key]);
        }
        if (event.key === "Home") {
          event.preventDefault();
          select(0);
        }
        if (event.key === "End") {
          event.preventDefault();
          select(cells.length - 1);
        }
        if (event.key === "Escape") {
          wrap.classList.add("is-dismissed");
          trigger.focus();
        }
      });
    }
    const root = document.documentElement;
    const stage = document.getElementById("main");
    const heading = document.getElementById("hero-name");
    const initialText = document.createTreeWalker(
      heading,
      NodeFilter.SHOW_TEXT,
    );
    let textNode;
    while ((textNode = initialText.nextNode()))
      textNode.data = textNode.data.trim();
    const zeroMarkup = heading.querySelector(".hero-zero").innerHTML;
    const panels = [...document.querySelectorAll(".scene-panel")];
    const railLinks = [...document.querySelectorAll(".rail [data-scene]")];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = matchMedia("(pointer: coarse)");
    const compact = matchMedia("(max-width: 850px), (max-height: 680px)");
    const documentFlow = () => compact.matches || reduced.matches;
    const scenes = [
      {
        id: "about",
        label: "About",
        title: "Kn0tzer",
      },
      {
        id: "projects",
        label: "Projects",
        title: "Projects",
      },
      {
        id: "photography",
        label: "Photos",
        title: "Photos",
      },
      {
        id: "contact",
        label: "Contact",
        title: "Contact",
      },
    ];
    const rail = initRail(reduced, (index) => {
      if (!documentFlow()) setScene(index);
    });
    const ease = "cubic-bezier(0.2, 0, 0, 1)";
    let current = 0;
    let effects;
    let frame = 0;
    let titleTimer = 0;
    let transition = 0;
    let titleAnimations = [];
    let restoreSection = false;
    let zeroMeasure;
    for (const event of ["touchstart", "wheel", "pointerdown", "keydown"])
      window.addEventListener(
        event,
        () => {
          restoreSection = false;
        },
        {
          passive: true,
        },
      );
    function canAnimate() {
      return !reduced.matches;
    }
    function animate(element, keyframes, options = {}) {
      if (!element?.animate || !canAnimate()) return null;
      return element.animate(keyframes, {
        duration: 430,
        easing: ease,
        ...options,
      });
    }
    function setTitle(scene) {
      heading.setAttribute("aria-label", `${scene.title}.`);
      const line = document.createElement("span");
      line.className = "title-line";
      line.style.display = "block";
      if (scene.id === "about") {
        const zero = document.createElement("span");
        zero.className = "hero-zero";
        zero.innerHTML = zeroMarkup;
        line.append("Kn", zero, "tzer");
      } else line.append(scene.title);
      const period = document.createElement("span");
      period.className = "name-period";
      period.textContent = ".";
      line.append(period);
      heading.replaceChildren(line);
    }
    function markScene(index) {
      stage.dataset.scene = scenes[index].id;
      railLinks.forEach((link, linkIndex) => {
        if (linkIndex === index) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
      document.title = `${index ? `${scenes[index].label} | ` : ""}Kn0tzer`;
      history.replaceState(null, "", `#${scenes[index].id}`);
      document.dispatchEvent(new Event("portfolio:scene"));
    }
    function setScene(index, focus = false, force = false) {
      index = Math.max(0, Math.min(scenes.length - 1, index));
      if (documentFlow()) {
        current = index;
        railLinks.forEach((link, linkIndex) =>
          link.classList.toggle("rail-reached", linkIndex === index),
        );
        markScene(index);
        effects?.setScene(index);
        if (focus)
          document
            .getElementById(scenes[index].id)
            .querySelector(".panel-title")
            ?.focus({
              preventScroll: true,
            });
        return;
      }
      if (index === current && !force) return;
      const direction = index > current ? 1 : -1;
      const previous = panels[current];
      current = index;
      const version = ++transition;
      clearTimeout(titleTimer);
      titleAnimations.forEach((animation) => animation?.cancel());
      titleAnimations = [];
      panels.forEach((panel) =>
        panel.getAnimations().forEach((animation) => animation.cancel()),
      );
      effects?.setScene(index);
      if (previous && previous !== panels[index])
        animate(
          previous,
          [
            {
              opacity: 1,
              transform: "translateY(0) scale(1)",
            },
            {
              opacity: 0,
              transform: `translateY(${-direction * 15}px) scale(.985)`,
            },
          ],
          {
            duration: 240,
          },
        );
      panels.forEach((panel, panelIndex) => {
        const active = panelIndex === index;
        panel.classList.toggle("is-active", active);
        panel.inert = !active;
        panel.setAttribute("aria-hidden", String(!active));
      });
      markScene(index);
      const replace = () => {
        if (version !== transition) return;
        setTitle(scenes[index]);
        alignHeroZero();
        if (index === 0) {
        }
        titleAnimations.push(
          animate(
            heading,
            [
              {
                opacity: 0,
                transform: `translateY(${direction * 15}px)`,
              },
              {
                opacity: 1,
                transform: "translateY(0)",
              },
            ],
            {
              duration: 480,
            },
          ),
        );
        if (focus)
          heading.focus({
            preventScroll: true,
          });
      };
      if (canAnimate()) {
        titleAnimations.push(
          animate(
            heading,
            [
              {
                opacity: 1,
                transform: "translateY(0)",
              },
              {
                opacity: 0,
                transform: `translateY(${-direction * 10}px)`,
              },
            ],
            {
              duration: 120,
            },
          ),
        );
        titleTimer = setTimeout(replace, 105);
      } else replace();
      animate(
        panels[index],
        [
          {
            opacity: 0,
            transform: `translateY(${direction * 18}px) scale(.985)`,
          },
          {
            opacity: 1,
            transform: "translateY(0) scale(1)",
          },
        ],
        {
          duration: 620,
        },
      );
    }
    function scrollForScene(index) {
      if (documentFlow())
        return index === 0
          ? 0
          : panels[index].getBoundingClientRect().top + scrollY - 88;
      return (
        (index / (scenes.length - 1)) *
        Math.max(0, document.documentElement.scrollHeight - innerHeight)
      );
    }
    function navigate(index, focus = true) {
      restoreSection = false;
      index = Math.max(0, Math.min(scenes.length - 1, index));
      if (documentFlow()) {
        const panel = panels[index];
        if (focus) {
          const title = panel.querySelector(".panel-title");
          title.tabIndex = -1;
          title.focus({
            preventScroll: true,
          });
        }
        window.scrollTo({
          top: scrollForScene(index),
          behavior: reduced.matches ? "instant" : "smooth",
        });
        if (reduced.matches) setScene(index);
        return;
      }
      window.scrollTo({
        top: scrollForScene(index),
        behavior: "instant",
      });
      rail.setProgress(index / 3);
      setScene(index, focus);
    }
    function updateScroll() {
      frame = 0;
      if (document.getElementById("photo-dialog").open) return;
      if (documentFlow()) {
        let index = 0;
        panels.forEach((panel, i) => {
          if (
            panel.getBoundingClientRect().top <=
            Math.min(innerHeight * 0.3, 220)
          )
            index = i;
        });
        if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2)
          index = panels.length - 1;
        if (index !== current) setScene(index);
        return;
      }
      if (!documentFlow()) {
        const distance = document.documentElement.scrollHeight - innerHeight;
        rail.setProgress(distance > 0 ? scrollY / distance : 0);
      }
    }
    window.addEventListener(
      "scroll",
      () => {
        if (!frame) frame = requestAnimationFrame(updateScroll);
      },
      {
        passive: true,
      },
    );
    railLinks.forEach((link) =>
      link.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(Number(link.dataset.scene || 0));
      }),
    );
    const skipLink = document.querySelector(".skip-link");
    skipLink.addEventListener("click", (event) => {
      event.preventDefault();
      skipLink.blur();
      stage.focus({
        preventScroll: true,
      });
    });
    window.addEventListener("blur", () => {
      if (document.activeElement === skipLink) skipLink.blur();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && document.activeElement === skipLink)
        skipLink.blur();
    });
    window.addEventListener("hashchange", () => {
      const index = scenes.findIndex(
        (scene) => location.hash === `#${scene.id}`,
      );
      if (index >= 0) navigate(index, false);
    });
    window.addEventListener("resize", () => {
      if (!documentFlow()) {
        window.scrollTo({
          top: scrollForScene(current),
          behavior: "instant",
        });
        const progress = current / (scenes.length - 1);
        rail.setProgress(progress);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        reduced.matches ||
        document.getElementById("photo-dialog").open
      )
        return;
      if (
        event.target.closest(
          "button,a,input,textarea,[contenteditable],#contribution-grid",
        )
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(current + (event.key === "ArrowRight" ? 1 : -1));
      }
      if (event.key === "Home") {
        event.preventDefault();
        navigate(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        navigate(scenes.length - 1);
      }
    });
    const projectDetails = {
      microapps: {
        name: "Microapps",
        description: "Small, handmade web apps.",
        url: "https://github.com/Kn0tzer/microapps-monorepo",
        icon: "code",
      },
      shortcuts: {
        name: "Shortcuts exploits",
        description: "Pushing iOS Shortcuts past its intended limits.",
        url: "https://github.com/Kn0tzer/iOS-Shortcuts-Exploits",
        icon: "fingerprint",
      },
      server: {
        name: "Self hosting",
        description: "My own server. Apps, experiments, and infrastructure.",
        url: "https://github.com/Kn0tzer",
        icon: "server",
      },
    };
    let activeProject = "microapps";
    document.querySelectorAll("[data-project].project-row").forEach((button) =>
      button.addEventListener("click", () => {
        const selected = button.dataset.project;
        if (
          selected === activeProject ||
          !Object.hasOwn(projectDetails, selected)
        )
          return;
        activeProject = selected;
        const project = projectDetails[selected];
        document.querySelectorAll(".project-row").forEach((row) => {
          row.classList.toggle("is-selected", row === button);
          row.setAttribute("aria-pressed", String(row === button));
        });
        const feature = document.querySelector(".project-feature");
        feature.getAnimations().forEach((animation) => animation.cancel());
        if (
          !feature.classList.contains("is-loose") &&
          !feature.classList.contains("is-detached")
        )
          animate(
            feature,
            [
              {
                opacity: 0.55,
                transform: "scale(.98)",
              },
              {
                opacity: 1,
                transform: "scale(1)",
              },
            ],
            {
              duration: 380,
            },
          );
        document.getElementById("project-name").textContent = project.name;
        document.getElementById("project-description").textContent =
          project.description;
        document.getElementById("project-art").dataset.project = selected;
        document.querySelector(".app-tile svg").innerHTML =
          `<use href="#${project.icon}"/>`;
        document.dispatchEvent(new Event("icons:refresh"));
        document.getElementById("project-link").href = project.url;
      }),
    );
    let copyReset;
    document
      .getElementById("copy-email")
      .addEventListener("click", async () => {
        const button = document.getElementById("copy-email");
        try {
          await navigator.clipboard.writeText("kn3tzer@gmail.com");
          const alreadyCopied = button.classList.contains("is-copied");
          clearTimeout(copyReset);
          button.classList.add("is-copied");
          button.setAttribute("aria-label", "Email address copied");
          button.querySelector("svg").dataset.micro = "check";
          if (!alreadyCopied)
            button.querySelector("svg").innerHTML =
              '<path class="copy-check" d="M5 12l5 5l10 -10"/>';
          copyReset = setTimeout(() => {
            button.classList.remove("is-copied");
            button.setAttribute("aria-label", "Copy email address");
            button.querySelector("svg").innerHTML = '<use href="#copy"/>';
            document.dispatchEvent(new Event("icons:refresh"));
          }, 2200);
        } catch {
          button.setAttribute(
            "aria-label",
            "Copy unavailable; select kn3tzer@gmail.com",
          );
        }
      });
    function applyMotionPreference() {
      clearTimeout(titleTimer);
      titleAnimations.forEach((animation) => animation?.cancel());
      titleAnimations = [];
      panels.forEach((panel) =>
        panel.getAnimations().forEach((animation) => animation.cancel()),
      );
      if (documentFlow()) {
        panels.forEach((panel) => {
          panel.inert = false;
          panel.removeAttribute("aria-hidden");
        });
        setTitle(scenes[0]);
        setScene(current);
        if (reduced.matches)
          document.getAnimations().forEach((animation) => animation.cancel());
      } else {
        window.scrollTo({
          top: scrollForScene(current),
          behavior: "instant",
        });
        setScene(current, false, true);
      }
      alignHeroZero();
    }
    reduced.addEventListener("change", applyMotionPreference);
    compact.addEventListener("change", () => {
      applyMotionPreference();
    });
    let themeAnimation = null;
    let themeTransition = null;
    let themeReveal = 0;
    let themeRun = 0;
    const themeButton = document.getElementById("theme-toggle");
    function updateThemeControl() {
      const label =
        root.dataset.theme === "dark"
          ? "Switch to light mode"
          : "Switch to dark mode";
      themeButton.setAttribute("aria-label", label);
      themeButton.title = label;
      document.querySelector("meta[name=theme-color]").content =
        root.dataset.theme === "dark" ? "#1b2025" : "#e9ebef";
    }
    function applyTheme(theme) {
      root.classList.add("theme-switching");
      root.dataset.theme = theme;
      try {
        localStorage.setItem("kn0tzer-theme", theme);
      } catch {}
      updateThemeControl();
      effects?.resize();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => root.classList.remove("theme-switching")),
      );
    }
    themeButton.addEventListener("click", async (event) => {
      if (
        document.querySelector(".hero-name").classList.contains("is-forming")
      ) {
        effects?.stopIntro();
      }
      try {
        themeAnimation?.cancel();
      } catch {}
      themeAnimation = null;
      try {
        themeTransition?.skipTransition();
      } catch {}
      themeTransition = null;
      cancelAnimationFrame(themeReveal);
      themeReveal = 0;
      document
        .querySelectorAll(".theme-fallback")
        .forEach((element) => element.remove());
      const run = ++themeRun;
      const stale = () => run !== themeRun;
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      const box = themeButton.getBoundingClientRect();
      const x = event.detail ? event.clientX : box.left + box.width / 2;
      const y = event.detail ? event.clientY : box.top + box.height / 2;
      const radius = Math.hypot(
        Math.max(x, innerWidth - x),
        Math.max(y, innerHeight - y),
      );
      if (!canAnimate()) {
        applyTheme(next);
        return;
      }
      try {
        if (document.startViewTransition) {
          const transition2 = document.startViewTransition(() =>
            applyTheme(next),
          );
          if (stale()) return;
          themeTransition = transition2;
          await transition2.ready;
          if (stale()) return;
          const animation = root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 700,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
          themeAnimation = animation;
          await animation.finished;
          if (stale()) return;
          await transition2.finished;
          if (stale()) return;
        } else {
          const snapshot = document.createElement("div");
          snapshot.className = "theme-fallback";
          snapshot.inert = true;
          snapshot.setAttribute("aria-hidden", "true");
          const clone = document.body.cloneNode(true);
          clone
            .querySelectorAll(
              "#iris,dialog,script,.theme-fallback,.physics-layer,template",
            )
            .forEach((el) => el.remove());
          clone.querySelectorAll("[id]").forEach((el) => {
            el.dataset.snapshotId = el.id;
            el.removeAttribute("id");
          });
          clone.style.height = "100%";
          clone.style.background = "var(--bg)";
          clone.style.position = "relative";
          if (documentFlow()) {
            const original = stage.getBoundingClientRect();
            const copiedStage = clone.querySelector(
              '[data-snapshot-id="main"]',
            );
            copiedStage.style.cssText = `position:absolute;inset:auto;margin:0;left:${original.left}px;top:${original.top}px;width:${original.width}px;max-width:none`;
          }
          snapshot.dataset.theme = root.dataset.theme;
          const styles = getComputedStyle(root);
          [
            "bg",
            "surface",
            "surface-deep",
            "surface-hover",
            "text",
            "muted",
            "quiet",
            "accent",
            "line",
            "soft-line",
            "shadow",
          ].forEach((key) =>
            snapshot.style.setProperty(
              `--${key}`,
              styles.getPropertyValue(`--${key}`),
            ),
          );
          const canvasSource = document.getElementById("contour-canvas");
          const cloneCanvas = clone.querySelector("canvas");
          if (cloneCanvas) {
            cloneCanvas.width = canvasSource.width;
            cloneCanvas.height = canvasSource.height;
            cloneCanvas.getContext("2d")?.drawImage(canvasSource, 0, 0);
            cloneCanvas.style.position = "fixed";
            cloneCanvas.style.inset = "0";
            cloneCanvas.style.width = "100%";
            cloneCanvas.style.height = canvasSource.style.height || "100%";
            cloneCanvas.style.zIndex = "0";
            cloneCanvas.style.animation = "none";
            cloneCanvas.style.transform =
              getComputedStyle(canvasSource).transform;
          }
          snapshot.append(clone);
          document.body.append(snapshot);
          snapshot.style.clipPath = "none";
          applyTheme(next);
          const maskStart = `radial-gradient(circle 0px at ${x}px ${y}px, transparent 99%, #111 100%)`;
          snapshot.style.maskImage = maskStart;
          await new Promise((resolve) => {
            const start = performance.now();
            function reveal(now) {
              themeReveal = 0;
              if (stale() || !canAnimate()) {
                resolve();
                return;
              }
              const p = Math.min(1, (now - start) / 700);
              const t = p * p * (3 - 2 * p);
              snapshot.style.maskImage = `radial-gradient(circle ${Math.max(0.1, radius * t)}px at ${x}px ${y}px, transparent 99%, #111 100%)`;
              if (p < 1) themeReveal = requestAnimationFrame(reveal);
              else resolve();
            }
            themeReveal = requestAnimationFrame(reveal);
          });
          snapshot.remove();
        }
      } catch {
        if (run === themeRun && root.dataset.theme !== next) applyTheme(next);
        if (run === themeRun)
          document
            .querySelectorAll(".theme-fallback")
            .forEach((element) => element.remove());
      } finally {
        if (run === themeRun) {
          themeAnimation = null;
          themeTransition = null;
        }
      }
    });
    updateThemeControl();
    function bindInteractions(scope = document) {
      scope.querySelectorAll(".tilt-card").forEach((element) => {
        if (element.dataset.interactionBound) return;
        element.dataset.interactionBound = "true";
        let bounds;
        const reset = (event) => {
          if (event?.relatedTarget && element.contains(event.relatedTarget))
            return;
          element.style.setProperty("--tilt-x", "0deg");
          element.style.setProperty("--tilt-y", "0deg");
        };
        element.addEventListener("pointerenter", () => {
          bounds = element.getBoundingClientRect();
        });
        element.addEventListener(
          "pointermove",
          (event) => {
            if (
              !canAnimate() ||
              coarse.matches ||
              event.pointerType === "touch" ||
              element.classList.contains("is-detached")
            )
              return;
            const box = bounds || element.getBoundingClientRect();
            if (!box.width || !box.height) return;
            const x = (event.clientX - box.left) / box.width - 0.5,
              y = (event.clientY - box.top) / box.height - 0.5;
            element.style.setProperty("--tilt-x", `${-tiltResponse(y) * 4}deg`);
            element.style.setProperty("--tilt-y", `${tiltResponse(x) * 4}deg`);
          },
          {
            passive: true,
            capture: true,
          },
        );
        element.addEventListener("pointerleave", reset);
        element.addEventListener("blur", reset);
      });
    }
    document.addEventListener("gallery:render", () => bindInteractions());
    initGallery(reduced);
    bindInteractions();
    initMicrointeractions(reduced);
    initPhysical(reduced);
    async function request(path, options = {}) {
      if (location.protocol === "file:")
        throw new Error("Live data requires the hosted portfolio");
      const response = await fetch(`/portfolio/api/${path}`, {
        ...options,
        signal: AbortSignal.timeout(1e4),
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      return response.json();
    }
    const number = new Intl.NumberFormat("en");
    async function fetchViews(options) {
      const { views } = await request("views", options);
      if (!Number.isSafeInteger(views) || views < 0)
        throw new Error("Invalid count");
      return views;
    }
    async function loadViews() {
      try {
        const views = await fetchViews({
          method: "POST",
        });
        document.getElementById("view-count").textContent =
          number.format(views);
      } catch {
        document.getElementById("view-count").textContent = "—";
        document.querySelector(".stats-widget").title =
          "Page view count is temporarily unavailable";
      }
    }
    async function loadGithub() {
      try {
        const data = await request("stats");
        if (
          !Number.isSafeInteger(data.repos) ||
          !Number.isSafeInteger(data.stars) ||
          data.repos < 0 ||
          data.stars < 0
        )
          throw new Error("Invalid GitHub data");
        document
          .querySelectorAll("[data-repos]")
          .forEach((el) => (el.textContent = number.format(data.repos)));
        document
          .querySelectorAll("[data-stars]")
          .forEach((el) => (el.textContent = number.format(data.stars)));
        document.getElementById("github-state").hidden = !data.stale;
        document.getElementById("github-state").textContent = "Cached";
        const latest = data.latest;
        if (latest) {
          const url = new URL(latest.url);
          if (
            url.origin !== "https://github.com" ||
            url.username ||
            url.password
          )
            throw new Error("Invalid repository link");
          document
            .querySelectorAll(".current-top,#current-repo")
            .forEach((link) => (link.href = url.href));
          document.getElementById("current-repo").textContent = latest.repo;
          document.getElementById("current-description").textContent =
            latest.description || "";
          document.getElementById("current-commit").textContent =
            latest.commitMessage.split("\n")[0];
          document.getElementById("current-commit").title =
            latest.commitMessage;
          const date = new Date(latest.committedAt);
          document.getElementById("current-date").textContent = Number.isFinite(
            date.getTime(),
          )
            ? `Last commit ${date.toLocaleDateString("en", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}`
            : "Latest public commit";
        } else {
          document.getElementById("current-repo").textContent =
            "Nothing public just yet";
          document.getElementById("current-description").textContent =
            "Visit my GitHub profile to see what I\u2019m building.";
          document.getElementById("current-commit").textContent =
            "No recent public commit available";
        }
      } catch {
        document
          .querySelectorAll("[data-repos],[data-stars]")
          .forEach((el) => (el.textContent = "—"));
        document.getElementById("github-state").hidden = false;
        document.getElementById("github-state").textContent = "Unavailable";
        document.getElementById("current-repo").textContent =
          "See what I\u2019m building";
        document.getElementById("current-description").textContent = "";
        document.getElementById("current-commit").textContent =
          "Open my GitHub profile";
        document.getElementById("current-date").textContent = "";
      }
    }
    loadViews();
    const githubReady = loadGithub();
    initGithubCard();
    panels.forEach((panel, index) => {
      panel.inert = !documentFlow() && index !== 0;
      if (!documentFlow())
        panel.setAttribute("aria-hidden", String(index !== 0));
    });
    const initialScene = scenes.findIndex(
      (scene) => location.hash === `#${scene.id}`,
    );
    if (!documentFlow() && initialScene > 0) navigate(initialScene, false);
    else if (documentFlow() && initialScene > 0) {
      restoreSection = true;
      Promise.all([document.fonts.ready, githubReady]).then(() => {
        if (!restoreSection) return;
        window.scrollTo({
          top: scrollForScene(initialScene),
          behavior: "instant",
        });
        setScene(initialScene);
        restoreSection = false;
      });
    } else if (window.scrollY > 0) updateScroll();
    Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]).then(async () => {
      alignHeroZero();
      const avatarImage = heading.querySelector(".zero-logo");
      if (avatarImage?.decode && !avatarImage.complete)
        await Promise.race([
          avatarImage.decode().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
      effects = initEffects({
        initialScene: current,
      });
    });
    document.addEventListener("selectionchange", () => {
      const zero = heading.querySelector(".hero-zero"),
        selection = getSelection();
      if (!zero) return;
      zero.classList.toggle(
        "zero-selected",
        Boolean(
          selection?.rangeCount &&
          !selection.isCollapsed &&
          selection.getRangeAt(0).intersectsNode(zero),
        ),
      );
    });
    function serviceState(online) {
      if (online === true) return "online";
      if (online === false) return "offline";
      return "unknown";
    }
    const SERVICE_TITLES = {
      online: "is reachable",
      offline: "is unreachable",
      unknown: "status pending",
    };
    let statusPending = false;
    let nextHealthCheckAt = 0;
    async function checkServer({ manual = false } = {}) {
      if (statusPending || (!manual && Date.now() < nextHealthCheckAt)) return;
      statusPending = true;
      const widget = document.querySelector(".server-widget");
      const started = performance.now();
      refreshButton.disabled = true;
      if (manual) refreshButton.classList.add("is-checking");
      if (manual && !reduced.matches)
        refreshButton.animate(
          [
            {
              transform: "rotate(0deg)",
            },
            {
              transform: "rotate(360deg)",
            },
          ],
          {
            duration: 620,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          },
        );
      try {
        const data = await request("health");
        nextHealthCheckAt = 0;
        if (
          !Number.isFinite(data.uptimeSeconds) ||
          data.uptimeSeconds < 0 ||
          !Array.isArray(data.services) ||
          !data.services.length ||
          data.services.length > 20
        )
          throw new Error("Invalid health data");
        const states = data.services.map((service) =>
          serviceState(service.online),
        );
        const list = document.getElementById("server-services");
        list.replaceChildren(
          ...data.services.map((service, index) => {
            const item = document.createElement("li");
            item.className = "server-service";
            item.dataset.online = states[index];
            const name = document.createElement("span");
            name.className = "service-name";
            name.textContent = service.name;
            const latency = document.createElement("span");
            latency.className = "service-uptime";
            latency.textContent = Number.isFinite(service.latencyMs)
              ? `${Math.round(service.latencyMs)} ms`
              : states[index] === "offline"
                ? "Down"
                : "Pending";
            const dot = document.createElement("span");
            dot.className = "service-dot";
            dot.setAttribute("aria-hidden", "true");
            const history = document.createElement("span");
            history.className = "service-history";
            history.setAttribute("aria-hidden", "true");
            const samples = Array.isArray(service.history)
              ? service.history.slice(-30)
              : [];
            for (let i = 0; i < 30; i++) {
              const bar = document.createElement("i");
              const sample = samples[i - (30 - samples.length)];
              bar.dataset.online =
                sample === undefined
                  ? "unknown"
                  : String(Number.isFinite(sample));
              bar.style.setProperty(
                "--latency",
                Number.isFinite(sample)
                  ? String(Math.min(1, sample / 500))
                  : "0",
              );
              history.append(bar);
            }
            item.append(dot, name, history, latency);
            const minutes = Math.round(
              (samples.length * (data.intervalSeconds || 60)) / 60,
            );
            item.title = `${service.name} ${SERVICE_TITLES[states[index]]}. ${samples.length} checks over ${minutes} minutes${Number.isFinite(service.uptimePercent) ? `, ${service.uptimePercent.toFixed(1)}% reachable` : ""}.`;
            item.setAttribute(
              "aria-label",
              `${item.title} ${latency.textContent}.`,
            );
            return item;
          }),
        );
        const online = states.filter((state) => state === "online").length;
        const status = states.every((state) => state === "unknown")
          ? "unknown"
          : online === states.length
            ? "online"
            : "offline";
        widget.dataset.status = status;
        document.getElementById("server-status").textContent =
          status === "online"
            ? "All systems up"
            : status === "unknown"
              ? "Checking services"
              : "Some services down";
        document.getElementById("server-count").textContent =
          `${online}/${states.length}`;
        const days = Math.floor(data.uptimeSeconds / 86400);
        const hours = Math.floor(data.uptimeSeconds / 3600) % 24;
        document.getElementById("server-uptime").textContent =
          `Up ${days}d ${hours}h`;
        const system = data.system;
        function meter(name, label, fraction) {
          const node = widget.querySelector(`[data-meter="${name}"]`);
          const value = node.querySelector(".meter-value");
          if (value.textContent !== label && !reduced.matches)
            value.animate(
              [
                {
                  opacity: 0.55,
                },
                {
                  opacity: 1,
                },
              ],
              {
                duration: 150,
                easing: "ease-out",
              },
            );
          value.textContent = label;
          node.style.setProperty("--meter", String(clamp(fraction)));
        }
        if (system && Number.isFinite(system.cpuPercent))
          meter(
            "load",
            `${system.cpuPercent.toFixed(1)}%`,
            system.cpuPercent / 100,
          );
        else meter("load", "…", 0);
        if (system && system.memoryTotal > 0 && system.memoryUsed >= 0)
          meter(
            "memory",
            `${Math.round((system.memoryUsed / system.memoryTotal) * 100)}%`,
            system.memoryUsed / system.memoryTotal,
          );
        const ping = Math.round(performance.now() - started);
        meter("ping", `${ping} ms`, ping / 500);
        const samples = Math.max(
          ...data.services.map((service) => service.history?.length || 0),
        );
        document.getElementById("server-history-caption").textContent =
          `Last ${samples} checks · ${Math.round((data.intervalSeconds || 60) / 60)} min intervals`;
        list.setAttribute(
          "aria-label",
          "Service response time and recent reachability",
        );
      } catch {
        nextHealthCheckAt = Date.now() + 30000;
        widget.dataset.status = "unknown";
        document.getElementById("server-status").textContent =
          "Status unavailable";
        document.getElementById("server-count").textContent = "";
        document.getElementById("server-uptime").textContent =
          "Check again shortly";
        document.getElementById("server-services").replaceChildren();
        widget
          .querySelectorAll(".meter-value")
          .forEach((node) => (node.textContent = "—"));
        widget
          .querySelectorAll(".meter")
          .forEach((node) => node.style.setProperty("--meter", "0"));
        document.getElementById("server-history-caption").textContent =
          "Use refresh to check again";
      } finally {
        statusPending = false;
        refreshButton.disabled = false;
        refreshButton.classList.remove("is-checking");
      }
    }
    const refreshButton = document.querySelector(".server-refresh");
    refreshButton.addEventListener("click", () =>
      checkServer({
        manual: true,
      }),
    );
    let serverTimer = 0;
    function syncServerPolling() {
      clearInterval(serverTimer);
      serverTimer = 0;
      if (document.hidden || stage.dataset.scene !== "contact") return;
      checkServer();
      serverTimer = setInterval(checkServer, 3000);
    }
    document.addEventListener("portfolio:scene", syncServerPolling);
    document.addEventListener("visibilitychange", syncServerPolling);
    window.addEventListener("pagehide", () => {
      clearInterval(serverTimer);
      serverTimer = 0;
    });
    window.addEventListener("pageshow", syncServerPolling);
    checkServer();
    syncServerPolling();
    function alignHeroZero() {
      const zero = heading.querySelector(".hero-zero"),
        logo = zero?.querySelector(".zero-logo");
      if (!logo) return;
      const computed = getComputedStyle(heading);
      zeroMeasure ??= document.createElement("canvas").getContext("2d");
      zeroMeasure.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      const metrics = zeroMeasure.measureText("n"),
        probe = document.createElement("span");
      probe.style.cssText =
        "display:inline-block;width:0;height:0;font-size:0;letter-spacing:0";
      zero.append(probe);
      const baseline = probe.getBoundingClientRect().top,
        box = zero.getBoundingClientRect();
      probe.remove();
      const height =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const top = baseline - box.top - metrics.actualBoundingBoxAscent;
      const zeroAdvance = box.width || metrics.width;
      const size = height * 1.12;
      logo.style.top = `${top + (height - size) / 2}px`;
      logo.style.height = `${size}px`;
      logo.style.width = `${size}px`;
      let center = box.left + zeroAdvance / 2;
      const before = zero.previousSibling,
        after = zero.nextSibling;
      if (
        before?.nodeType === Node.TEXT_NODE &&
        after?.nodeType === Node.TEXT_NODE &&
        before.length &&
        after.length
      ) {
        const range = document.createRange();
        if (typeof range.getBoundingClientRect !== "function") {
          logo.style.left = `${(zeroAdvance - size) / 2}px`;
          return;
        }
        range.setStart(before, before.length - 1);
        range.setEnd(before, before.length);
        const left =
          range.getBoundingClientRect().left + metrics.actualBoundingBoxRight;
        range.setStart(after, 0);
        range.setEnd(after, 1);
        const right =
          range.getBoundingClientRect().left -
          zeroMeasure.measureText("t").actualBoundingBoxLeft;
        if (Number.isFinite(left) && Number.isFinite(right))
          center = (left + right) / 2;
      }
      logo.style.left = `${center - box.left - size / 2}px`;
    }
    document.fonts.ready.then(alignHeroZero);
    window.addEventListener("resize", alignHeroZero, {
      passive: true,
    });
  },
  {
    once: true,
  },
);
