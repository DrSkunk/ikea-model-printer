import { json } from '@sveltejs/kit';
import { readCachedBinary, writeCachedBinary } from '$lib/server/cache';
import { convertGlbToStl } from '$lib/server/glb-to-stl';
import { IkeaApiClient, isValidLocaleCode } from '$lib/server/ikea-api';
import type { RequestHandler } from './$types';

const DEFAULT_COUNTRY = 'us';
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_SCALE_DENOMINATOR = 20;
const MIN_SCALE_DENOMINATOR = 1;
const MAX_SCALE_DENOMINATOR = 1000;

function normalizeLocale(value: string | null, fallback: string): string {
	const lower = value?.toLowerCase() ?? fallback;
	return isValidLocaleCode(lower) ? lower : fallback;
}

function compactItemNo(itemNo: string): string {
	return itemNo.replace(/\D/g, '');
}

export const GET: RequestHandler = async ({ url }) => {
	const rawItemNo = url.searchParams.get('itemNo')?.trim() ?? '';
	const itemNo = compactItemNo(rawItemNo);
	if (!itemNo) {
		return json({ error: 'Missing itemNo parameter.' }, { status: 400 });
	}

	const country = normalizeLocale(url.searchParams.get('country'), DEFAULT_COUNTRY);
	const language = normalizeLocale(url.searchParams.get('language'), DEFAULT_LANGUAGE);

	const rawScaleDenominator = Number(url.searchParams.get('scaleDenominator'));
	const denominatorFromPct = Number(url.searchParams.get('scalePct'));
	const fallbackDenominator =
		Number.isFinite(denominatorFromPct) && denominatorFromPct > 0
			? 100 / denominatorFromPct
			: DEFAULT_SCALE_DENOMINATOR;
	const parsedScaleDenominator = Number.isFinite(rawScaleDenominator)
		? rawScaleDenominator
		: fallbackDenominator;
	const scaleDenominator = Math.max(
		MIN_SCALE_DENOMINATOR,
		Math.min(MAX_SCALE_DENOMINATOR, parsedScaleDenominator)
	);
	const scale = 1000 / scaleDenominator;

	const rawOptimize = url.searchParams.get('optimize');
	const optimize = rawOptimize === null ? true : rawOptimize !== 'false';

	const cacheKey = [
		country,
		language,
		itemNo,
		`scale-${scaleDenominator}`,
		optimize ? 'opt' : 'raw',
		'stl'
	];
	const cachedStl = await readCachedBinary(cacheKey, 'stl');
	if (cachedStl) {
		return new Response(Buffer.from(cachedStl), {
			headers: {
				'Content-Type': 'model/stl',
				'Content-Disposition': `attachment; filename="ikea-${itemNo}-1-${scaleDenominator}.stl"`,
				'Cache-Control': 'public, max-age=86400'
			}
		});
	}

	try {
		const api = new IkeaApiClient(country, language);
		const exists = await api.modelExists(itemNo);
		if (!exists) {
			return json(
				{
					error: 'No 3D model is available for this IKEA item in the selected locale.'
				},
				{ status: 404 }
			);
		}

		const modelInfo = await api.getModelInfo(itemNo);
		const glbCacheKey = [country, language, itemNo, modelInfo.modelUrl, 'glb'];
		let glbBytes = await readCachedBinary(glbCacheKey, 'glb');
		if (!glbBytes) {
			glbBytes = await api.download(modelInfo.modelUrl);
			await writeCachedBinary(glbCacheKey, 'glb', glbBytes);
		}

		const stl = await convertGlbToStl(glbBytes, scale, { optimize });
		await writeCachedBinary(cacheKey, 'stl', stl);

		return new Response(Buffer.from(stl), {
			headers: {
				'Content-Type': 'model/stl',
				'Content-Disposition': `attachment; filename="ikea-${itemNo}-1-${scaleDenominator}.stl"`,
				'Cache-Control': 'public, max-age=86400'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Conversion failed';
		return json(
			{
				error: 'Failed to convert IKEA model to STL.',
				details: message
			},
			{ status: 500 }
		);
	}
};
