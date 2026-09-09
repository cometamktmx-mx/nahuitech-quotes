// Read-only public endpoint probe. No credentials or object writes.
const url = new URL('/storage/v1/object/public/machine-images/__diagnostic_missing__', process.env.NEXT_PUBLIC_SUPABASE_URL);
fetch(url, { signal: AbortSignal.timeout(15000) }).then(async (response) => {
  const body = await response.json();
  console.log(JSON.stringify({
    probe: 'Public read of intentionally missing object; this is NOT an upload test',
    httpStatus: response.status, statusCode: body.statusCode, error: body.error, message: body.message,
  }));
}).catch((error) => {
  console.error(JSON.stringify({ name: error.name, message: error.message, code: error.cause?.code }));
  process.exitCode = 1;
});
