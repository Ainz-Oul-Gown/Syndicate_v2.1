export function applyTheme(color: string) {
  let hover = '#0070E0';
  let light = 'rgba(10, 132, 255, 0.1)';
  let border = 'rgba(10, 132, 255, 0.2)';

  if (color === '#FF2D55') {
    hover = '#E01E43';
    light = 'rgba(255, 45, 85, 0.1)';
    border = 'rgba(255, 45, 85, 0.2)';
  } else if (color === '#32D74B') {
    hover = '#24B33B';
    light = 'rgba(50, 215, 75, 0.1)';
    border = 'rgba(50, 215, 75, 0.2)';
  } else if (color === '#BF5AF2') {
    hover = '#A33CE0';
    light = 'rgba(191, 90, 242, 0.1)';
    border = 'rgba(191, 90, 242, 0.2)';
  }

  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-hover', hover);
  document.documentElement.style.setProperty('--primary-light', light);
  document.documentElement.style.setProperty('--primary-border', border);
}
