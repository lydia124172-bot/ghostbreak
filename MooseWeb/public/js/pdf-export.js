const PDF_PAGE = { width: 210, height: 297, top: 12, right: 12, bottom: 14, left: 12, gap: 3 };

async function exportBlocksPdf({ className, css, html, filename }) {
  if (typeof html2pdf !== 'function') throw new Error('PDF 套件尚未載入，請稍後再試，或先複製全部。');
  const opt = {
    margin: [PDF_PAGE.top, PDF_PAGE.left, PDF_PAGE.bottom, PDF_PAGE.right],
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  };
  const hold = document.createElement('div');
  hold.style.cssText = 'position:fixed;left:-12000px;top:0;width:720px;background:#fff;';
  hold.innerHTML = `<style>${css} .pdf-block{padding:0 !important;}</style><div class="${className}">${html}</div>`;
  document.body.appendChild(hold);
  try {
    const blocks = Array.from(hold.lastElementChild.children);
    const doc = await html2pdf().set(opt).from(document.createElement('div')).toPdf().get('pdf');
    const innerW = PDF_PAGE.width - PDF_PAGE.left - PDF_PAGE.right;
    const bottom = PDF_PAGE.height - PDF_PAGE.bottom;
    const pageH = bottom - PDF_PAGE.top;
    let y = PDF_PAGE.top;
    for (const block of blocks) {
      const wrap = document.createElement('div');
      wrap.className = `${className} pdf-block`;
      wrap.appendChild(block.cloneNode(true));
      hold.appendChild(wrap);
      const canvas = await html2pdf().set(opt).from(wrap).toCanvas().get('canvas');
      wrap.remove();
      if (!canvas.width || !canvas.height) continue;
      const mmPerPx = innerW / canvas.width;
      let drawn = 0;
      while (drawn < canvas.height) {
        if (y > PDF_PAGE.top && y + Math.min(canvas.height - drawn, pageH / mmPerPx) * mmPerPx > bottom) {
          doc.addPage();
          y = PDF_PAGE.top;
        }
        const slicePx = Math.min(canvas.height - drawn, Math.floor((bottom - y) / mmPerPx));
        const piece = document.createElement('canvas');
        piece.width = canvas.width;
        piece.height = slicePx;
        const ctx = piece.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, piece.width, piece.height);
        ctx.drawImage(canvas, 0, drawn, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
        doc.addImage(piece.toDataURL('image/jpeg', 0.92), 'JPEG', PDF_PAGE.left, y, innerW, slicePx * mmPerPx);
        drawn += slicePx;
        y += slicePx * mmPerPx;
        if (drawn < canvas.height) {
          doc.addPage();
          y = PDF_PAGE.top;
        }
      }
      y += PDF_PAGE.gap;
    }
    doc.save(filename);
  } finally {
    hold.remove();
  }
}
