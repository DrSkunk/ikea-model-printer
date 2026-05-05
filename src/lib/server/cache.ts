import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Vercel's /var/task filesystem is read-only; /tmp is the only writable dir.
// Locally, prefer .cache/ next to the project root for easy inspection.
const CACHE_DIR =
	process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
		? '/tmp/ikea-model-printer'
		: path.resolve('.cache/ikea-model-printer');
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

function buildCacheKey(parts: string[]): string {
	const hash = createHash('sha256');
	hash.update(parts.join('|'));
	return hash.digest('hex');
}

function cacheFilePath(key: string, extension: string): string {
	return path.join(CACHE_DIR, `${key}.${extension}`);
}

async function ensureCacheDir(): Promise<void> {
	await mkdir(CACHE_DIR, { recursive: true });
}

export async function readCachedBinary(
	keyParts: string[],
	extension: string
): Promise<Uint8Array | null> {
	await ensureCacheDir();
	const key = buildCacheKey(keyParts);
	const filePath = cacheFilePath(key, extension);

	try {
		const info = await stat(filePath);
		if (Date.now() - info.mtimeMs > MAX_AGE_MS) {
			return null;
		}
		const bytes = await readFile(filePath);
		return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	} catch {
		return null;
	}
}

export async function writeCachedBinary(
	keyParts: string[],
	extension: string,
	bytes: Uint8Array
): Promise<void> {
	await ensureCacheDir();
	const key = buildCacheKey(keyParts);
	const filePath = cacheFilePath(key, extension);
	await writeFile(filePath, bytes);
}
