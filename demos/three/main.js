// The showcase is the default. Keep the original workload for reproducible benchmarks.
const params = new URLSearchParams(location.search);
for (const [key, value] of new URLSearchParams(location.hash.replace(/^#/, ''))) params.set(key, value);
if (params.get('bench') === '1' || params.get('scene') === 'legacy' || params.has('freeze')) {
  await import('./reference.js');
} else {
  await import('../park/main.js');
}
