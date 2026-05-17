/**
 * Export SVG element as PNG with 2x resolution for retina displays
 */
export async function exportAsPNG(
  svgElement: SVGSVGElement,
  filename: string = 'atlas-city-map.png'
): Promise<void> {
  try {
    // Get SVG dimensions
    const bbox = svgElement.getBoundingClientRect();
    const width = bbox.width;
    const height = bbox.height;

    // Serialize SVG to string
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgElement);

    // Ensure SVG has proper namespace and dimensions
    if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
      svgString = svgString.replace(
        '<svg',
        '<svg xmlns="http://www.w3.org/2000/svg"'
      );
    }

    // Create data URL from SVG
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    // Create image from SVG
    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load SVG as image'));
      img.src = svgUrl;
    });

    // Create canvas at 2x resolution for retina
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Fill with dark background (matching SVG background)
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Scale context for high-DPI rendering
    ctx.scale(scale, scale);

    // Draw SVG image onto canvas
    ctx.drawImage(img, 0, 0, width, height);

    // Clean up
    URL.revokeObjectURL(svgUrl);

    // Convert canvas to blob and trigger download
    canvas.toBlob((blob) => {
      if (!blob) {
        throw new Error('Failed to create PNG blob');
      }

      // Create temporary download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      
      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (error) {
    console.error('PNG export failed:', error);
    throw error;
  }
}

// Made with Bob
