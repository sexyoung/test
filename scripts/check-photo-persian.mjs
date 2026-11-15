// Preserve the original static Persian source and authored face paint.
process.argv.push('--model','persian');
await import('./check-photo-pomeranian.mjs');
