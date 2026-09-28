// public/js/components/charts.js
// Chart.js wrappers that track instances so views can destroy them on unmount.
const registry = [];

function palette() {
  return ['#1E3A8A', '#F59E0B', '#16A34A', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#EA580C', '#4B5563', '#10B981'];
}

function track(chart) { registry.push(chart); return chart; }

export function barChart(canvas, labels, data, label = '') {
  if (!canvas || !window.Chart) return null;
  return track(new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: '#1E3A8A', borderRadius: 6, maxBarThickness: 46 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e2e8f0' } }, x: { grid: { display: false } } }
    }
  }));
}

export function lineChart(canvas, labels, data, label = '') {
  if (!canvas || !window.Chart) return null;
  return track(new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label, data, borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: .35, pointBackgroundColor: '#F59E0B' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e2e8f0' } }, x: { grid: { display: false } } } }
  }));
}

export function doughnutChart(canvas, labels, data, colors) {
  if (!canvas || !window.Chart) return null;
  return track(new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors && colors.length ? colors : palette(), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
  }));
}

// Destroy every chart created since the last reset. Call from a view's unmount().
export function destroyAllCharts() {
  while (registry.length) {
    const c = registry.pop();
    try { c.destroy(); } catch {}
  }
}

// Destroy a specific tracked chart and remove it from the registry.
export function destroyChart(chart) {
  if (!chart) return;
  try { chart.destroy(); } catch {}
  const i = registry.indexOf(chart);
  if (i > -1) registry.splice(i, 1);
}
