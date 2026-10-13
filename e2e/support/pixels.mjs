/**
 * Screenshot differ, without a PNG decoder.
 *
 * Two PNG buffers go back into the page as data URLs, are drawn onto a canvas
 * and compared there — so this needs no image library in Node, and it works on
 * WebGPU output too (which cannot be read back from its own canvas).
 *
 * `region` is a CSS-pixel box: { x, y, width, height }. Omit it to diff the
 * whole image.
 */
export async function diffScreenshots(page, a, b, region) {
  return page.evaluate(
    async ([urlA, urlB, box]) => {
      const load = (url) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("image decode failed"));
          image.src = url;
        });
      const [imgA, imgB] = await Promise.all([load(urlA), load(urlB)]);
      const x = box ? Math.round(box.x) : 0;
      const y = box ? Math.round(box.y) : 0;
      const w = box ? Math.round(box.width) : Math.min(imgA.width, imgB.width);
      const h = box ? Math.round(box.height) : Math.min(imgA.height, imgB.height);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(imgA, x, y, w, h, 0, 0, w, h);
      const dataA = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(imgB, x, y, w, h, 0, 0, w, h);
      const dataB = ctx.getImageData(0, 0, w, h).data;

      let maxDelta = 0;
      let changed = 0;
      let best = [0, 0, 0];
      for (let i = 0; i < dataA.length; i += 4) {
        const dr = Math.abs(dataA[i] - dataB[i]);
        const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
        const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
        const delta = Math.max(dr, dg, db);
        if (delta > 2) changed += 1;
        if (delta > maxDelta) {
          maxDelta = delta;
          best = [dataA[i], dataA[i + 1], dataA[i + 2]];
        }
      }
      return {
        maxDelta,
        changedPercent: Math.round((changed / (w * h)) * 1000) / 10,
        brightestPixel: best,
        pixels: w * h,
      };
    },
    [a.toString("base64").replace(/^/, "data:image/png;base64,"), b.toString("base64").replace(/^/, "data:image/png;base64,"), region ?? null]
  );
}
