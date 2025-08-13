// mosaic.js completo con evaluación de calidad al cargar imagen
document.addEventListener('DOMContentLoaded', () => {
  const imageInput = document.getElementById('imageInput');
  const tileSizeSlider = document.getElementById('tileSize');
  const tileSizeValue = document.getElementById('tileSizeValue');
  const distanceSelect = document.getElementById('distanceFunction');
  const topNInput = document.getElementById('topN');
  const blendingSlider = document.getElementById('blendingRange');
  const blendingValue = document.getElementById('blendingValue');
  const processBtn = document.getElementById('processButton');
  const originalCanvas = document.getElementById('originalCanvas');
  const mosaicCanvas = document.getElementById('mosaicCanvas');
  const originalCtx = originalCanvas.getContext('2d');
  const mosaicCtx = mosaicCanvas.getContext('2d');
  const timeSpan = document.getElementById('timeElapsed');
  const beautySpan = document.getElementById('beautyIndex');

  let csvData = [];
  let originalImage = null;
  const tileCache = new Map();
  const usedTiles = new Set();
  const usageCounts = new Map();

  tileSizeSlider.oninput = () => tileSizeValue.textContent = tileSizeSlider.value + 'px';
  blendingSlider.oninput = () => blendingValue.textContent = blendingSlider.value + '%';
  topNInput.oninput = () => topNInput.value = Math.max(1, Math.floor(topNInput.value) || 1);

  (function loadCSV() {
    const raw = document.getElementById('csvData').textContent.trim().split('\n');
    csvData = raw.slice(1)
      .map(line => line.split(','))
      .filter(cols => cols.length === 4)
      .map(([path, r, g, b]) => ({ path: path.trim(), r: +r, g: +g, b: +b }));
    console.log('CSV cargado:', csvData.length, 'entradas');
  })();

  function getGrayMode() {
    const selected = document.querySelector('input[name="grayscaleOption"]:checked');
    return selected ? selected.value : 'none';
  }

  function evaluateImageQuality(imgData, width, height) {
    const d = imgData.data;
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
    const px = d.length / 4;
    const brightness = (sum / px).toFixed(1);
    const contrast = (max - min).toFixed(1);
    const resolution = width * height;
    const aspectRatio = (width / height).toFixed(2);

    let evaluation = '✅ Buena candidata para mosaico';
    if (brightness < 30 || brightness > 220 || contrast < 30 || resolution < 100000) {
      evaluation = '⚠️ Imagen con características subóptimas';
    }

    alert(
      'Evaluación de la imagen:\n' +
      '- Brillo promedio: ' + brightness + '\n' +
      '- Contraste: ' + contrast + '\n' +
      '- Resolución: ' + width + 'x' + height + ' (' + resolution + ' px)\n' +
      '- Proporción: ' + aspectRatio + '\n\n' +
      evaluation
    );
  }

  imageInput.onchange = e => {
    document.getElementById('analysisResults').style.display = 'none';
    document.getElementById('analysisList').innerHTML = '';
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        const scale = Math.min(1, 600 / img.width);
        const w = img.width * scale;
        const h = img.height * scale;
        originalCanvas.width = mosaicCanvas.width = w;
        originalCanvas.height = mosaicCanvas.height = h;
        originalCtx.clearRect(0, 0, w, h);

        const mode = getGrayMode();
        if (mode === 'manual' || mode === 'filter') {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = w;
          tmpCanvas.height = h;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(img, 0, 0, w, h);
          const imgData = tmpCtx.getImageData(0, 0, w, h);
          for (let i = 0; i < imgData.data.length; i += 4) {
            const y = 0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2];
            imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = y;
          }
          originalCtx.putImageData(imgData, 0, 0);

        } else {
          originalCtx.drawImage(img, 0, 0, w, h);
          const imgData = originalCtx.getImageData(0, 0, w, h);

        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  document.querySelectorAll('input[name="grayscaleOption"]').forEach(radio => {
    radio.onchange = () => {
      if (originalImage) imageInput.dispatchEvent(new Event('change'));
    };
  });

  function distance(c1, c2, method) {
    if (method === 'euclidean') return Math.hypot(c1.r - c2.r, c1.g - c2.g, c1.b - c2.b);
    if (method === 'manhattan') return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
    return Math.abs(c1.r - c2.r);
  }

  function calcAvgColor(imgData) {
    const d = imgData.data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    const px = d.length / 4;
    return { r: Math.round(r / px), g: Math.round(g / px), b: Math.round(b / px) };
  }

  async function getBitmap(path, forceGray = false) {
    if (tileCache.has(path)) return tileCache.get(path);
    try {
      const blob = await (await fetch(path)).blob();
      const img = await createImageBitmap(blob);
      if (!forceGray) {
        tileCache.set(path, img);
        return img;
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const y = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
        data.data[i] = data.data[i + 1] = data.data[i + 2] = y;
      }
      ctx.putImageData(data, 0, 0);
      const grayBmp = await createImageBitmap(canvas);
      tileCache.set(path, grayBmp);
      return grayBmp;
    } catch {
      console.warn('Error al cargar', path);
      return null;
    }
  }

  function findUniqueTile(avg) {
    const method = distanceSelect.value;
    const topN = Math.max(1, Math.floor(+topNInput.value || 1));
    const ranked = csvData
      .map(e => ({ e, d: distance(avg, e, method) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, topN)
      .map(x => x.e);
    const candidates = ranked.filter(e => !usedTiles.has(e.path));
    let pick;
    if (candidates.length > 0) {
      pick = candidates[Math.floor(Math.random() * candidates.length)];
      usedTiles.add(pick.path);
    } else {
      pick = ranked[0];
    }
    usageCounts.set(pick.path, (usageCounts.get(pick.path) || 0) + 1);
    return pick;
  }

  processBtn.onclick = async () => {
    if (!originalImage) return alert('Sube una imagen.');
    if (!csvData.length) return alert('CSV no cargado.');
    document.getElementById('usageTableBody').innerHTML = '';
    document.getElementById('usageSummaryCard').style.display = 'none';
    usedTiles.clear();
    usageCounts.clear();
    timeSpan.textContent = beautySpan.textContent = '-';

    const tileSize = +tileSizeSlider.value;
    const blendPct = +blendingSlider.value / 100;
    const grayMode = getGrayMode();
    const rows = Math.ceil(mosaicCanvas.height / tileSize);
    const cols = Math.ceil(mosaicCanvas.width / tileSize);

    mosaicCtx.clearRect(0, 0, mosaicCanvas.width, mosaicCanvas.height);
    const t0 = performance.now();

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const x0 = x * tileSize, y0 = y * tileSize;
        const w = Math.min(tileSize, mosaicCanvas.width - x0);
        const h = Math.min(tileSize, mosaicCanvas.height - y0);

        let avg = calcAvgColor(originalCtx.getImageData(x0, y0, w, h));
        if (grayMode !== 'none') {
          const Y = Math.round(0.299 * avg.r + 0.587 * avg.g + 0.114 * avg.b);
          avg = { r: Y, g: Y, b: Y };
        }

        const tile = findUniqueTile(avg);
        const bmp = await getBitmap(tile.path, grayMode === 'manual');
        if (!bmp) continue;

        mosaicCtx.filter = (grayMode === 'filter') ? 'grayscale(1)' : 'none';
        mosaicCtx.globalAlpha = 1;
        mosaicCtx.drawImage(bmp, x0, y0, w, h);

        if (blendPct > 0) {
          mosaicCtx.globalAlpha = blendPct;
          mosaicCtx.filter = 'none';
          mosaicCtx.drawImage(originalCanvas, x0, y0, w, h, x0, y0, w, h);
          mosaicCtx.globalAlpha = 1;
        }
      }
      await new Promise(r => setTimeout(r, 0));
    }

    const t1 = performance.now();
    const total = rows * cols;
    const unique = usedTiles.size;

    timeSpan.textContent = `${(t1 - t0).toFixed(1)} ms`;
    beautySpan.textContent = `${(total / unique).toFixed(2)} (${total} / ${unique})`;

    const summary = Array.from(usageCounts.entries())
      .map(([path, count]) => ({ name: decodeURIComponent(path.split('/').pop()), count }))
      .sort((a, b) => b.count - a.count);

    const moreThanOnce = summary.filter(e => e.count > 1);
    const usedOnce = summary.filter(e => e.count === 1).length;

    console.table(moreThanOnce);
    console.log(`Imágenes usadas exactamente una vez1: ${usedOnce}`);

    // Llenar tabla en HTML
    // Llenar tabla en HTML
    const tbody = document.getElementById('usageTableBody');
    tbody.innerHTML = ''; // limpiar antes de agregar nuevos

    // Agregar imágenes repetidas (count > 1)
    moreThanOnce.forEach(({ name, count }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${name}</td><td>${count}</td>`;
      tbody.appendChild(tr);
    });

    // Separador opcional
    const separatorRow = document.createElement('tr');
    separatorRow.innerHTML = `<td colspan="2"><hr></td>`;
    tbody.appendChild(separatorRow);

    // Agregar imágenes usadas solo una vez
    summary.filter(e => e.count === 1).forEach(({ name, count }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${name}</td><td>${count}</td>`;
      tbody.appendChild(tr);
    });

    // Fila resumen final
    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `<td><strong>Total imágenes usadas una vez</strong></td><td><strong>${usedOnce}</strong></td>`;
    tbody.appendChild(totalRow);
    document.getElementById('usageSummaryCard').style.display = 'block';


  };

  document.getElementById('analyzeButton').onclick = () => {
    console.log('test');
    const img = originalImage;
    if (!img) return alert('Primero selecciona una imagen.');

    // Medidas
    const width = img.width;
    const height = img.height;
    const aspectRatio = (width / height).toFixed(2);

    // Crear canvas temporal para obtener datos de píxeles
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height).data;

    // Calcular brillo promedio y contraste
    let total = 0;
    let totalSq = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      const y = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      total += y;
      totalSq += y * y;
    }
    const n = imgData.length / 4;
    const mean = total / n;
    const variance = totalSq / n - mean * mean;
    const stddev = Math.sqrt(variance);

    // Criterios y evaluaciones
    const isBright = mean >= 90 && mean <= 200;
    const isContrastOk = stddev > 40;
    const isResolutionOk = width >= 400 && height >= 400;
    const isRatioOk = aspectRatio >= 0.8 && aspectRatio <= 1.25;

    const analysis = [
      `Brillo promedio: ${mean.toFixed(1)} (${isBright ? '✅ Bueno' : '⚠️ Pobre'})`,
      `Contraste (desv. estándar): ${stddev.toFixed(1)} (${isContrastOk ? '✅ Bueno' : '⚠️ Bajo'})`,
      `Resolución: ${width}x${height} (${isResolutionOk ? '✅ Aceptable' : '⚠️ Baja'})`,
      `Proporción: ${aspectRatio} (${isRatioOk ? '✅ Adecuada' : '⚠️ Desbalanceada'})`,
    ];

    const isGood = isBright && isContrastOk && isResolutionOk && isRatioOk;
    analysis.push(isGood
      ? '✅ La imagen es una buena candidata para mosaico.'
      : '⚠️ Esta imagen podría no ser ideal para un mosaico.');

    // Mostrar resultados
    const list = document.getElementById('analysisList');
    list.innerHTML = '';
    analysis.forEach(line => {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    });
    document.getElementById('analysisResults').style.display = 'block';
  };

});