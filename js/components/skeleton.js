// public/js/components/skeleton.js
export function skeletonTable(rows = 6, cols = 5) {
  let html = '<div class="bg-white dark:bg-slate-800 rounded-card shadow-soft p-4 overflow-hidden">';
  html += `<div class="h-9 bg-slate-200 dark:bg-slate-700 rounded mb-3 animate-pulse"></div>`;
  for (let r = 0; r < rows; r++) {
    html += '<div class="flex gap-3 mb-3">';
    for (let c = 0; c < cols; c++) {
      html += `<div class="h-6 bg-slate-100 dark:bg-slate-700/60 rounded flex-1 animate-pulse"></div>`;
    }
    html += '</div>';
  }
  return html + '</div>';
}

export function skeletonCards(count = 6) {
  let html = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">';
  for (let i = 0; i < count; i++) {
    html += `<div class="bg-white dark:bg-slate-800 rounded-card shadow-soft p-4">
      <div class="h-32 bg-slate-200 dark:bg-slate-700 rounded mb-3 animate-pulse"></div>
      <div class="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2 animate-pulse"></div>
      <div class="h-3 bg-slate-100 dark:bg-slate-700/60 rounded w-1/2 animate-pulse"></div>
    </div>`;
  }
  return html + '</div>';
}
