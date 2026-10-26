try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4317}/api/health`, {
    signal: AbortSignal.timeout(3000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
